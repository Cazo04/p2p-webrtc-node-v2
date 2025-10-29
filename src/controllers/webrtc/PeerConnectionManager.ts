import { Socket } from 'socket.io-client';
import { RTCPeerConnection, RTCSessionDescription, RTCIceCandidate } from '@roamhq/wrtc';
import * as RTC from '../../../../config/signal.socket.event.webrtc';
import type { WebRTCAnswer, WebRTCOffer, WebRTCIceCandidate } from '../../../../types/signal';
import SettingUtils from '../../utils/setting';
import type { PeerConnectionData } from './types';
import DataChannelHandler from './DataChannelHandler';
import StatsReporter from './StatsReporter';

// WebRTC Configuration
const ICE_SERVERS: RTCIceServer[] = SettingUtils.getIceServers() || [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    { urls: 'stun:stun4.l.google.com:19302' }
];

const RTC_CONFIG: RTCConfiguration = {
    iceServers: ICE_SERVERS,
    iceCandidatePoolSize: 5
};

export default class PeerConnectionManager {
    private socket: Socket;
    private peerConnections: Map<string, PeerConnectionData> = new Map();
    private dataChannelHandler: DataChannelHandler;
    private statsReporter: StatsReporter;
    private readonly INACTIVITY_TIMEOUT = 10000; // 10 seconds

    constructor(
        socket: Socket,
        dataChannelHandler: DataChannelHandler,
        statsReporter: StatsReporter
    ) {
        this.socket = socket;
        this.dataChannelHandler = dataChannelHandler;
        this.statsReporter = statsReporter;
        this.startInactivityChecker();
    }

    public createPeerConnection(
        remoteId: string,
        onActivityUpdate: (clientId: string) => void
    ): PeerConnectionData {
        const peerConnection = new RTCPeerConnection(RTC_CONFIG);

        const peerData: PeerConnectionData = {
            connection: peerConnection,
            lastActivity: Date.now()
        };

        this.peerConnections.set(remoteId, peerData);

        // Handle ICE candidates
        peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                const candidateMessage: WebRTCIceCandidate = {
                    target: remoteId,
                    candidate: event.candidate.toJSON()
                };
                this.socket.emit(RTC.ICE_CANDIDATE, candidateMessage);
                console.log(`[WebRTC] Sent ICE candidate to client: ${remoteId}`);
            }
        };

        // Set up stats reporting
        const statsIntervalId = setInterval(
            async () => {
                const stats = await this.statsReporter.reportPeerStats(
                    peerConnection,
                    remoteId,
                    peerData.stats
                );
                peerData.stats = stats;
            },
            1000
        );

        // Handle connection state changes
        peerConnection.onconnectionstatechange = () => {
            console.log(
                `[WebRTC] Connection state with ${remoteId}: ${peerConnection.connectionState}`
            );

            if (peerConnection.connectionState === 'connected') {
                onActivityUpdate(remoteId);
            } else if (
                peerConnection.connectionState === 'failed' ||
                peerConnection.connectionState === 'disconnected' ||
                peerConnection.connectionState === 'closed'
            ) {
                clearInterval(statsIntervalId);
                this.statsReporter.reportPeerStats(peerConnection, remoteId, undefined, true);
                this.cleanup(remoteId);
            }
        };

        // Handle data channel from remote peer
        peerConnection.ondatachannel = (event) => {
            const dataChannel = event.channel;
            this.dataChannelHandler.setupDataChannel(dataChannel, remoteId, peerData);
        };

        return peerData;
    }

    public async setRemoteDescription(
        remoteId: string,
        description: RTCSessionDescriptionInit
    ): Promise<void> {
        const peerData = this.peerConnections.get(remoteId);
        if (!peerData) {
            throw new Error(`No peer connection found for ${remoteId}`);
        }
        await peerData.connection.setRemoteDescription(new RTCSessionDescription(description));
    }

    public async setLocalDescription(
        remoteId: string,
        description: RTCSessionDescriptionInit
    ): Promise<void> {
        const peerData = this.peerConnections.get(remoteId);
        if (!peerData) {
            throw new Error(`No peer connection found for ${remoteId}`);
        }
        await peerData.connection.setLocalDescription(description);
    }

    public async createAnswer(remoteId: string): Promise<RTCSessionDescriptionInit> {
        const peerData = this.peerConnections.get(remoteId);
        if (!peerData) {
            throw new Error(`No peer connection found for ${remoteId}`);
        }
        return await peerData.connection.createAnswer();
    }

    public async createOffer(remoteId: string): Promise<RTCSessionDescriptionInit> {
        const peerData = this.peerConnections.get(remoteId);
        if (!peerData) {
            throw new Error(`No peer connection found for ${remoteId}`);
        }
        return await peerData.connection.createOffer();
    }

    public async addIceCandidate(
        remoteId: string,
        candidate: RTCIceCandidateInit
    ): Promise<void> {
        const peerData = this.peerConnections.get(remoteId);
        if (!peerData) {
            throw new Error(`No peer connection found for ${remoteId}`);
        }
        await peerData.connection.addIceCandidate(new RTCIceCandidate(candidate));
    }

    public getPeerData(remoteId: string): PeerConnectionData | undefined {
        return this.peerConnections.get(remoteId);
    }

    public hasPeerConnection(remoteId: string): boolean {
        return this.peerConnections.has(remoteId);
    }

    public getConnectionState(remoteId: string): RTCPeerConnectionState | null {
        const peerData = this.peerConnections.get(remoteId);
        return peerData ? peerData.connection.connectionState : null;
    }

    public getConnectedPeers(): string[] {
        const connectedPeers: string[] = [];
        this.peerConnections.forEach((peerData, clientId) => {
            if (peerData.connection.connectionState === 'connected') {
                connectedPeers.push(clientId);
            }
        });
        return connectedPeers;
    }

    public updateLastActivity(clientId: string): void {
        const peerData = this.peerConnections.get(clientId);
        if (peerData) {
            peerData.lastActivity = Date.now();

            // Clear existing timeout
            if (peerData.timeoutId) {
                clearTimeout(peerData.timeoutId);
            }

            // Set new timeout
            peerData.timeoutId = setTimeout(() => {
                console.log(`[WebRTC] Connection with ${clientId} timed out due to inactivity`);
                this.cleanup(clientId);
            }, this.INACTIVITY_TIMEOUT);
        }
    }

    public cleanup(clientId: string): void {
        const peerData = this.peerConnections.get(clientId);
        if (peerData) {
            // Clear timeout
            if (peerData.timeoutId) {
                clearTimeout(peerData.timeoutId);
            }

            // Cleanup transfer sessions
            if (peerData.transferSessions) {
                peerData.transferSessions.forEach((session, sessionId) => {
                    if (session.fileStream) {
                        session.fileStream.destroy();
                    }
                });
                peerData.transferSessions.clear();
            }

            // Close data channel
            if (peerData.dataChannel) {
                peerData.dataChannel.close();
            }

            // Close peer connection
            peerData.connection.close();

            // Remove from map
            this.peerConnections.delete(clientId);

            console.log(`[WebRTC] Cleaned up peer connection for client: ${clientId}`);
        }
    }

    public cleanupAll(): void {
        this.peerConnections.forEach((_, clientId) => {
            this.cleanup(clientId);
        });
        this.peerConnections.clear();
        console.log('[WebRTC] All peer connections cleaned up');
    }

    private startInactivityChecker(): void {
        // Check for inactive connections every 5 seconds
        setInterval(() => {
            const now = Date.now();
            this.peerConnections.forEach((peerData, clientId) => {
                if (now - peerData.lastActivity > this.INACTIVITY_TIMEOUT) {
                    console.log(`[WebRTC] Cleaning up inactive connection with ${clientId}`);
                    this.cleanup(clientId);
                }
            });
        }, 5000);
    }
}
