import { Socket } from 'socket.io-client';
import { DataChannelMessageType } from '../../../config/signal.socket.event.webrtc';
import * as RTC from '../../../config/signal.socket.event.webrtc';
import type { WebRTCAnswer, WebRTCOffer, WebRTCIceCandidate, RequestNodeMessage } from '../../../types/signal';
import SettingUtils from '../utils/setting';
import { RTCSessionDescription, RTCIceCandidate, RTCPeerConnection, RTCDataChannel } from '@roamhq/wrtc';


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

interface TransferSession {
    fragmentId: string;
    start: Date;
    end?: Date;
    status: 'in-progress' | 'completed' | 'failed' | 'canceled';
    error?: string;
    speedBytesPerSec?: number;
}

interface PeerConnectionData {
    connection: RTCPeerConnection;
    dataChannel?: RTCDataChannel;
    lastActivity: number;
    timeoutId?: NodeJS.Timeout;
    transferSessions?: Map<string, TransferSession>;
}

export default class WebRTCSocketController {
    private socket: Socket;
    private peerConnections: Map<string, PeerConnectionData> = new Map();
    private readonly INACTIVITY_TIMEOUT = 10000; // 10 seconds

    constructor(socket: Socket) {
        this.socket = socket;
        this.setupWebRTCHandlers();
        this.startInactivityChecker();
    }

    private setupWebRTCHandlers() {
        // Handle incoming WebRTC offers
        this.socket.on(RTC.OFFER, this.handleOffer.bind(this));

        // Handle incoming WebRTC answers
        this.socket.on(RTC.ANSWER, this.handleAnswer.bind(this));

        // Handle incoming ICE candidates
        this.socket.on(RTC.ICE_CANDIDATE, this.handleIceCandidate.bind(this));
    }

    private async handleOffer(data: WebRTCOffer) {
        const { source, offer } = data;
        if (!source) {
            console.warn(`Received offer without source`);
            return;
        }
        console.log(`[WebRTC] Received offer from client: ${source}`);

        try {
            const peerData = this.createPeerConnection(source);

            // Set the remote description with the received offer
            await peerData.connection.setRemoteDescription(new RTCSessionDescription(offer));

            // Create an answer
            const answer = await peerData.connection.createAnswer();
            await peerData.connection.setLocalDescription(answer);

            // Send the answer back to the offering client
            const answerMessage: WebRTCAnswer = {
                target: source,
                answer: answer
            };

            this.socket.emit(RTC.ANSWER, answerMessage);
            console.log(`[WebRTC] Sent answer to client: ${source}`);

        } catch (error) {
            console.error(`[WebRTC] Error handling offer from ${source}:`, error);
            this.cleanupPeerConnection(source);
        }
    }

    private async handleAnswer(data: WebRTCAnswer) {
        const { source, answer } = data;
        if (!source) {
            console.warn(`Received offer without source`);
            return;
        }
        console.log(`[WebRTC] Received answer from client: ${source}`);

        const peerData = this.peerConnections.get(source);
        if (!peerData) {
            console.warn(`[WebRTC] No peer connection found for client: ${source}`);
            return;
        }

        try {
            await peerData.connection.setRemoteDescription(new RTCSessionDescription(answer));
            console.log(`[WebRTC] Set remote description for client: ${source}`);
            this.updateLastActivity(source);
        } catch (error) {
            console.error(`[WebRTC] Error handling answer from ${source}:`, error);
            this.cleanupPeerConnection(source);
        }
    }

    private async handleIceCandidate(data: WebRTCIceCandidate) {
        const { source, candidate } = data;
        if (!source) {
            console.warn(`Received offer without source`);
            return;
        }
        console.log(`[WebRTC] Received ICE candidate from client: ${source}`);

        const peerData = this.peerConnections.get(source);
        if (!peerData) {
            console.warn(`[WebRTC] No peer connection found for client: ${source}`);
            return;
        }

        try {
            if (candidate && candidate.candidate) {
                await peerData.connection.addIceCandidate(new RTCIceCandidate(candidate));
                console.log(`[WebRTC] Added ICE candidate for client: ${source}`);
                this.updateLastActivity(source);
            }
        } catch (error) {
            console.error(`[WebRTC] Error adding ICE candidate from ${source}:`, error);
        }
    }

    private createPeerConnection(remoteId: string): PeerConnectionData {
        const peerConnection = new RTCPeerConnection(RTC_CONFIG);

        const peerData: PeerConnectionData = {
            connection: peerConnection,
            lastActivity: Date.now()
        };

        // Store the peer connection
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

        // Handle connection state changes
        peerConnection.onconnectionstatechange = () => {
            console.log(`[WebRTC] Connection state with ${remoteId}: ${peerConnection.connectionState}`);

            if (peerConnection.connectionState === 'connected') {
                this.updateLastActivity(remoteId);
            } else if (peerConnection.connectionState === 'failed' ||
                peerConnection.connectionState === 'disconnected' ||
                peerConnection.connectionState === 'closed') {
                this.cleanupPeerConnection(remoteId);
            }
        };

        // Handle data channel from remote peer
        peerConnection.ondatachannel = (event) => {
            const dataChannel = event.channel;
            this.setupDataChannel(dataChannel, remoteId);
        };

        // Create data channel for outgoing messages
        // const dataChannel = peerConnection.createDataChannel(`node-${remoteId}`, {
        //     ordered: true
        // });
        // this.setupDataChannel(dataChannel, remoteId);
        // peerData.dataChannel = dataChannel;

        return peerData;
    }

    private setupDataChannel(dataChannel: RTCDataChannel, remoteId: string) {
        const peerData = this.peerConnections.get(remoteId);
        if (peerData) {
            peerData.dataChannel = dataChannel;
        }

        dataChannel.onopen = () => {
            console.log(`[WebRTC] Data channel opened with client: ${remoteId}`);
            this.updateLastActivity(remoteId);
        };

        dataChannel.onmessage = (event) => {
            console.log(`[WebRTC] Received message from ${remoteId}`);
            this.updateLastActivity(remoteId);
            this.handleDataChannelMessage(event.data, remoteId);
        };

        dataChannel.onclose = () => {
            console.log(`[WebRTC] Data channel closed with client: ${remoteId}`);
        };

        dataChannel.onerror = (error) => {
            console.error(`[WebRTC] Data channel error with ${remoteId}:`, error);
        };
    }

    private handleDataChannelMessage(data: string | ArrayBuffer, fromClientId: string) {
        try {
            if (typeof data === 'string') {
                const message = JSON.parse(data);
                console.log(`[WebRTC] Received message from ${fromClientId}:`, message.type);

                switch (message.type) {
                    case DataChannelMessageType.READY_NODE:
                        this.handleFragmentRequest(message, fromClientId);
                        break;
                    case DataChannelMessageType.CANCELED:
                        
                        break;
                    default:
                        console.log(`[WebRTC] Unknown message type: ${message.type}`);
                }
            }
        } catch (error) {
            console.error('[WebRTC] Error handling data channel message:', error);
        }
    }

    private handleFragmentRequest(message: RequestNodeMessage, fromClientId: string) {
        //console.log(`[WebRTC] Fragment request for ${message.fragment_id} from ${fromClientId}`);
        const fragmentPath = SettingUtils.getFragmentPath(message.fragment_id);
        if (fragmentPath) {
            //console.log(`[WebRTC] Would send fragment ${message.fragment_id} from path ${fragmentPath} to ${fromClientId}`);

            const peerConnection = this.peerConnections.get(fromClientId);
            if (peerConnection && peerConnection.dataChannel?.readyState === 'open') {
                peerConnection.transferSessions = new Map<string, TransferSession>();
                const transferSession: TransferSession = {
                    fragmentId: message.fragment_id,
                    start: new Date(),
                    status: 'in-progress'
                };
                peerConnection.transferSessions.set(message.fragment_id, transferSession);

                
            }
        } else {
            console.warn(`[WebRTC] Fragment ${message.fragment_id} not found for request from ${fromClientId}`);
        }
    }

    private sendDataToPeer(clientId: string, data: string | ArrayBuffer): boolean {
        const peerData = this.peerConnections.get(clientId);
        if (!peerData || !peerData.dataChannel || peerData.dataChannel.readyState !== 'open') {
            console.warn(`[WebRTC] Cannot send data to ${clientId}: no open data channel`);
            return false;
        }

        try {
            if (typeof data === 'string') {
                peerData.dataChannel.send(data);
            } else {
                peerData.dataChannel.send(data);
            }
            this.updateLastActivity(clientId);
            return true;
        } catch (error) {
            console.error(`[WebRTC] Error sending data to ${clientId}:`, error);
            return false;
        }
    }

    private updateLastActivity(clientId: string) {
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
                this.cleanupPeerConnection(clientId);
            }, this.INACTIVITY_TIMEOUT);
        }
    }

    private cleanupPeerConnection(clientId: string) {
        const peerData = this.peerConnections.get(clientId);
        if (peerData) {
            // Clear timeout
            if (peerData.timeoutId) {
                clearTimeout(peerData.timeoutId);
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

    private startInactivityChecker() {
        // Check for inactive connections every 5 seconds
        setInterval(() => {
            const now = Date.now();
            this.peerConnections.forEach((peerData, clientId) => {
                if (now - peerData.lastActivity > this.INACTIVITY_TIMEOUT) {
                    console.log(`[WebRTC] Cleaning up inactive connection with ${clientId}`);
                    this.cleanupPeerConnection(clientId);
                }
            });
        }, 5000);
    }

    // Public methods for external use
    public async connectToPeer(targetId: string): Promise<void> {
        if (this.peerConnections.has(targetId)) {
            console.log(`[WebRTC] Already connected or connecting to: ${targetId}`);
            return;
        }

        console.log(`[WebRTC] Initiating connection to: ${targetId}`);

        try {
            const peerData = this.createPeerConnection(targetId);

            // Create an offer
            const offer = await peerData.connection.createOffer();
            await peerData.connection.setLocalDescription(offer);

            // Send the offer
            const offerMessage: WebRTCOffer = {
                target: targetId,
                offer: offer
            };

            this.socket.emit(RTC.OFFER, offerMessage);
            console.log(`[WebRTC] Sent offer to: ${targetId}`);

        } catch (error) {
            console.error(`[WebRTC] Error connecting to peer ${targetId}:`, error);
            this.cleanupPeerConnection(targetId);
            throw error;
        }
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

    public disconnectFromPeer(clientId: string): void {
        this.cleanupPeerConnection(clientId);
    }

    public getPeerConnectionState(clientId: string): RTCPeerConnectionState | null {
        const peerData = this.peerConnections.get(clientId);
        return peerData ? peerData.connection.connectionState : null;
    }

    public cleanup() {
        // Clean up all peer connections
        this.peerConnections.forEach((_, clientId) => {
            this.cleanupPeerConnection(clientId);
        });

        this.peerConnections.clear();
        console.log('[WebRTC] WebRTC controller cleaned up');
    }
}
