import { Socket } from 'socket.io-client';
import { DataChannelMessageType } from '../../../config/signal.socket.event.webrtc';
import * as RTC from '../../../config/signal.socket.event.webrtc';
import type { WebRTCAnswer, WebRTCOffer, WebRTCIceCandidate, RequestNodeMessage, CanceledMessage, PeerStats } from '../../../types/signal';
import SettingUtils from '../utils/setting';
import { RTCSessionDescription, RTCIceCandidate, RTCPeerConnection, RTCDataChannel } from '@roamhq/wrtc';
import { CHUNK_SIZE } from '../config/constants';
import * as fs from 'fs';
import * as si from 'systeminformation';
import NetworkUtils from '../utils/network';


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
    totalBytes?: number;
    sentBytes?: number;
    fileStream?: fs.ReadStream;
    canceled?: boolean;
}

interface PeerConnectionData {
    connection: RTCPeerConnection;
    dataChannel?: RTCDataChannel;
    lastActivity: number;
    timeoutId?: NodeJS.Timeout;
    transferSessions?: Map<string, TransferSession>;
    stats?: PeerStats;
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

        const intervalId = setInterval(async () => await this.sendPeerStatsToServer(peerConnection, remoteId), 1000);

        // Handle connection state changes
        peerConnection.onconnectionstatechange = () => {
            console.log(`[WebRTC] Connection state with ${remoteId}: ${peerConnection.connectionState}`);

            if (peerConnection.connectionState === 'connected') {
                this.updateLastActivity(remoteId);
            } else if (peerConnection.connectionState === 'failed' ||
                peerConnection.connectionState === 'disconnected' ||
                peerConnection.connectionState === 'closed') {
                this.cleanupPeerConnection(remoteId);
                clearInterval(intervalId);
                this.sendPeerStatsToServer(peerConnection, remoteId, true);
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

    private async sendPeerStatsToServer(peerConnection: RTCPeerConnection, remoteId: string, isDisconnected = false) {
        try {
            let peerStats: PeerStats = {
                target: remoteId,
                isDisconnected: isDisconnected,
                rtt: -1,
                bytesSent: 0,
                bytesReceived: 0,
            };

            if (isDisconnected) {
                this.socket.emit(RTC.PEER_STATS, peerStats);
                return;
            }

            const report = await peerConnection.getStats();            

            const peerData = this.peerConnections.get(remoteId);
            const oldPeerStats = peerData?.stats;

            report.forEach(s => {
                if (s.type === 'candidate-pair' && s.state === 'succeeded')
                    peerStats.rtt = s.currentRoundTripTime * 1000;

                if (s.type === 'data-channel' && s.state === 'open') {
                    peerStats.bytesSent = s.bytesSent - (oldPeerStats?.bytesSent || 0);
                    peerStats.bytesReceived = s.bytesReceived - (oldPeerStats?.bytesReceived || 0);
                }
                if (s.type === 'remote-candidate') {
                    const ip = s.ip;
                    const { version, type } = NetworkUtils.classifyIp(ip);
                    if (type === 'public') {
                        if (version === 'IPv4') peerStats.remote_ipv4 = ip;
                        else peerStats.remote_ipv6 = ip;
                    }
                }
                if (s.type === 'local-candidate') {
                    const ip = s.ip;
                    const { version, type } = NetworkUtils.classifyIp(ip);
                    if (type === 'public') {
                        if (version === 'IPv4') peerStats.local_ipv4 = ip;
                        else peerStats.local_ipv6 = ip;
                    }
                }

                //console.log(`Peer stats:`, s);
            });
            peerData!.stats = peerStats;

            this.socket.emit(RTC.PEER_STATS, peerStats);
        } catch (error) {
            console.error(`[WebRTC] Error getting stats for ${remoteId}:`, error);
        }
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
                        this.handleCancelRequest(message, fromClientId);
                        break;
                    default:
                        console.log(`[WebRTC] Unknown message type: ${message.type}`);
                }
            }
        } catch (error) {
            console.error('[WebRTC] Error handling data channel message:', error);
        }
    }

    private handleCancelRequest(message: CanceledMessage, fromClientId: string) {
        console.log(`[WebRTC] Received cancel request for session ${message.session_id} from ${fromClientId}`);

        const peerConnection = this.peerConnections.get(fromClientId);
        if (peerConnection?.transferSessions) {
            const session = peerConnection.transferSessions.get(message.session_id);
            if (session && session.status === 'in-progress') {
                session.canceled = true;
                session.status = 'canceled';
                session.end = new Date();

                this.cleanupTransferSession(peerConnection, message.session_id);
            }
        }
    }

    private async handleFragmentRequest(message: RequestNodeMessage, fromClientId: string) {
        const fragmentPath = SettingUtils.getFragmentPath(message.fragment_id);
        if (fragmentPath && fs.existsSync(fragmentPath)) {
            const peerConnection = this.peerConnections.get(fromClientId);
            if (peerConnection && peerConnection.dataChannel && peerConnection.dataChannel.readyState === 'open') {
                const fileSize = fs.statSync(fragmentPath).size;

                // Initialize transfer sessions if not exists
                if (!peerConnection.transferSessions) {
                    peerConnection.transferSessions = new Map<string, TransferSession>();
                }

                const transferSession: TransferSession = {
                    fragmentId: message.fragment_id,
                    start: new Date(),
                    status: 'in-progress',
                    totalBytes: fileSize,
                    sentBytes: 0
                };
                peerConnection.transferSessions.set(message.session_id, transferSession);

                const dataChannel = peerConnection.dataChannel;
                //console.log(`[WebRTC] Data channel state with ${fromClientId}: ${dataChannel.readyState}`);

                // Check system resources
                const { available, total } = await si.mem();
                const memoryPercentage = (available / total) * 100;
                const highBufferAmount = dataChannel.bufferedAmount > 10 * 1024 * 1024;

                if (memoryPercentage < 15 || highBufferAmount) {
                    transferSession.status = 'failed';
                    transferSession.end = new Date();
                    transferSession.error = 'Node memory low, cannot start transfer';
                    console.warn(`[WebRTC] Cannot start transfer to ${fromClientId}: low memory (${memoryPercentage.toFixed(1)}%) or high buffered amount (${(dataChannel.bufferedAmount / (1024 * 1024)).toFixed(2)}MB)`);

                    const cancelMessage: CanceledMessage = {
                        type: DataChannelMessageType.CANCELED,
                        session_id: message.session_id,
                        fragment_id: message.fragment_id,
                        error: 'Node memory low, canceling transfer'
                    };
                    this.sendDataToPeer(fromClientId, JSON.stringify(cancelMessage));
                    return;
                }

                // Create a read stream with optimized buffer size
                const fileStream = fs.createReadStream(fragmentPath, {
                    highWaterMark: CHUNK_SIZE,
                    autoClose: true
                });
                transferSession.fileStream = fileStream;

                // Activity tracker
                const reportProgress = () => this.updateLastActivity(fromClientId);
                const reportId = setInterval(reportProgress, 5_000);

                // Pre-allocate buffers for headers to avoid repeated allocations
                const idBuf = Buffer.from(message.session_id);
                const headerSize = 2 + idBuf.length;

                // Flow control variables
                let flowPaused = false;
                const MAX_BUFFER_THRESHOLD = CHUNK_SIZE * 5;
                const THROTTLE_CHECK_INTERVAL = 50; // ms

                fileStream.on('data', async (chunk) => {
                    if (transferSession.canceled) return;

                    // Implement better flow control
                    if (dataChannel.bufferedAmount > MAX_BUFFER_THRESHOLD) {
                        if (!flowPaused) {
                            flowPaused = true;
                            fileStream.pause();
                        }

                        // Dynamic timeout based on buffer size
                        const timeoutDuration = Math.min(
                            10000, // 10 seconds max
                            Math.max(1000, dataChannel.bufferedAmount / 1024) // Scale with buffer size
                        );

                        let startTime = Date.now();
                        let timedOut = false;

                        const checkTimeout = () => {
                            const elapsed = Date.now() - startTime;
                            if (elapsed > timeoutDuration) {
                                timedOut = true;
                                clearInterval(reportId);
                                console.log(`[WebRTC] Transfer throttled too long (${elapsed}ms), aborting session ${message.session_id}`);
                                if (!transferSession.canceled) {
                                    transferSession.canceled = true;
                                    transferSession.status = 'failed';
                                    transferSession.end = new Date();
                                    transferSession.error = 'Transfer throttled too long';
                                    this.cleanupTransferSession(peerConnection, message.session_id);
                                }
                                return true;
                            }
                            return false;
                        };

                        // Wait for buffer to drain or timeout
                        while (dataChannel.bufferedAmount > CHUNK_SIZE && !timedOut) {
                            if (checkTimeout()) break;
                            await new Promise(resolve => setTimeout(resolve, THROTTLE_CHECK_INTERVAL));
                        }

                        if (timedOut) return;

                        flowPaused = false;
                        fileStream.resume();
                    }

                    // Optimize buffer handling
                    const chunkBuffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
                    const isLastChunk = transferSession.sentBytes! + chunkBuffer.length >= fileSize;

                    // Create header
                    const header = Buffer.alloc(2);
                    header.writeUInt8(idBuf.length, 0);
                    header.writeUInt8(isLastChunk ? 1 : 0, 1);

                    // Allocate exact buffer size to avoid unnecessary memory copies
                    const buffer = Buffer.allocUnsafe(headerSize + chunkBuffer.length);
                    header.copy(buffer, 0);
                    idBuf.copy(buffer, 2);
                    chunkBuffer.copy(buffer, headerSize);

                    // Send the data
                    dataChannel.send(buffer);
                    transferSession.sentBytes! += chunkBuffer.length;
                });

                fileStream.once('end', () => {
                    clearInterval(reportId);
                    if (transferSession.canceled) return;

                    transferSession.status = 'completed';
                    transferSession.end = new Date();
                    const durationSec = (transferSession.end.getTime() - transferSession.start.getTime()) / 1000;
                    transferSession.speedBytesPerSec = durationSec > 0 ? (transferSession.totalBytes || 0) / durationSec : 0;

                    const speedKBps = (transferSession.speedBytesPerSec! / 1024).toFixed(2);
                    const sizeMB = (transferSession.totalBytes! / (1024 * 1024)).toFixed(2);

                    console.log(`[WebRTC] Completed transfer of fragment ${message.fragment_id} (${sizeMB} MB) to ${fromClientId} in ${durationSec.toFixed(2)} sec (${speedKBps} KB/s)`);
                    this.cleanupTransferSession(peerConnection, message.session_id);
                });

                fileStream.on('error', (error) => {
                    clearInterval(reportId);
                    if (transferSession.canceled) return;

                    transferSession.status = 'failed';
                    transferSession.end = new Date();
                    transferSession.error = error.message;
                    console.error(`[WebRTC] Error reading fragment ${message.fragment_id} for ${fromClientId}:`, error);
                    this.cleanupTransferSession(peerConnection, message.session_id);
                });
            }
        } else {
            console.warn(`[WebRTC] Fragment ${message.fragment_id} not found for request from ${fromClientId}`);
        }
    }

    private buildHeader(sessionId: string, isLast: boolean) {
        const idBuf = Buffer.from(sessionId);
        const header = Buffer.alloc(2);
        header.writeUInt8(idBuf.length, 0);
        header.writeUInt8(isLast ? 1 : 0, 1);

        // Create a single buffer with exactly the right size
        const combined = Buffer.allocUnsafe(2 + idBuf.length);
        header.copy(combined, 0);
        idBuf.copy(combined, 2);
        return combined;
    }

    private cleanupTransferSession(peerData: PeerConnectionData, sessionId: string) {
        if (peerData.transferSessions) {
            const session = peerData.transferSessions.get(sessionId);
            if (session) {
                if (session.fileStream) {
                    session.fileStream.destroy();
                }
                peerData.transferSessions.delete(sessionId);
                console.log(`[WebRTC] Cleaned up transfer session: ${sessionId}`);
            }
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
