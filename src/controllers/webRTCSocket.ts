import { Socket } from 'socket.io-client';
import * as RTC from '../../../config/signal.socket.event.webrtc';
import type { WebRTCAnswer, WebRTCOffer, WebRTCIceCandidate } from '../../../types/signal';
import PeerConnectionManager from './webrtc/PeerConnectionManager';
import DataChannelHandler from './webrtc/DataChannelHandler';
import FileTransferManager from './webrtc/FileTransferManager';
import StatsReporter from './webrtc/StatsReporter';
import RequestReporter from './webrtc/RequestReporter';

export default class WebRTCSocketController {
    private socket: Socket;
    private peerConnectionManager: PeerConnectionManager;
    private dataChannelHandler: DataChannelHandler;
    private fileTransferManager: FileTransferManager;
    private statsReporter: StatsReporter;
    private requestReporter: RequestReporter;

    constructor(socket: Socket) {
        this.socket = socket;
        
        // Initialize components
        this.requestReporter = new RequestReporter(socket);
        this.fileTransferManager = new FileTransferManager(this.requestReporter);
        this.statsReporter = new StatsReporter(socket);
        this.dataChannelHandler = new DataChannelHandler(
            this.fileTransferManager,
            this.updateLastActivity.bind(this)
        );
        this.peerConnectionManager = new PeerConnectionManager(
            socket,
            this.dataChannelHandler,
            this.statsReporter
        );

        this.setupWebRTCHandlers();
    }

    private setupWebRTCHandlers() {
        this.socket.on(RTC.OFFER, this.handleOffer.bind(this));
        this.socket.on(RTC.ANSWER, this.handleAnswer.bind(this));
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
            const peerData = this.peerConnectionManager.createPeerConnection(
                source,
                this.updateLastActivity.bind(this)
            );

            await this.peerConnectionManager.setRemoteDescription(source, offer);
            const answer = await this.peerConnectionManager.createAnswer(source);
            await this.peerConnectionManager.setLocalDescription(source, answer);

            const answerMessage: WebRTCAnswer = {
                target: source,
                answer: answer
            };

            this.socket.emit(RTC.ANSWER, answerMessage);
            console.log(`[WebRTC] Sent answer to client: ${source}`);
        } catch (error) {
            console.error(`[WebRTC] Error handling offer from ${source}:`, error);
            this.peerConnectionManager.cleanup(source);
        }
    }

    private async handleAnswer(data: WebRTCAnswer) {
        const { source, answer } = data;
        if (!source) {
            console.warn(`Received answer without source`);
            return;
        }
        console.log(`[WebRTC] Received answer from client: ${source}`);

        if (!this.peerConnectionManager.hasPeerConnection(source)) {
            console.warn(`[WebRTC] No peer connection found for client: ${source}`);
            return;
        }

        try {
            await this.peerConnectionManager.setRemoteDescription(source, answer);
            console.log(`[WebRTC] Set remote description for client: ${source}`);
            this.updateLastActivity(source);
        } catch (error) {
            console.error(`[WebRTC] Error handling answer from ${source}:`, error);
            this.peerConnectionManager.cleanup(source);
        }
    }

    private async handleIceCandidate(data: WebRTCIceCandidate) {
        const { source, candidate } = data;
        if (!source) {
            console.warn(`Received ICE candidate without source`);
            return;
        }
        console.log(`[WebRTC] Received ICE candidate from client: ${source}`);

        if (!this.peerConnectionManager.hasPeerConnection(source)) {
            console.warn(`[WebRTC] No peer connection found for client: ${source}`);
            return;
        }

        try {
            if (candidate && candidate.candidate) {
                await this.peerConnectionManager.addIceCandidate(source, candidate);
                console.log(`[WebRTC] Added ICE candidate for client: ${source}`);
                this.updateLastActivity(source);
            }
        } catch (error) {
            console.error(`[WebRTC] Error adding ICE candidate from ${source}:`, error);
        }
    }

    private updateLastActivity(clientId: string): void {
        this.peerConnectionManager.updateLastActivity(clientId);
    }

    // Public methods for external use
    public async connectToPeer(targetId: string): Promise<void> {
        if (this.peerConnectionManager.hasPeerConnection(targetId)) {
            console.log(`[WebRTC] Already connected or connecting to: ${targetId}`);
            return;
        }

        console.log(`[WebRTC] Initiating connection to: ${targetId}`);

        try {
            this.peerConnectionManager.createPeerConnection(
                targetId,
                this.updateLastActivity.bind(this)
            );

            const offer = await this.peerConnectionManager.createOffer(targetId);
            await this.peerConnectionManager.setLocalDescription(targetId, offer);

            const offerMessage: WebRTCOffer = {
                target: targetId,
                offer: offer
            };

            this.socket.emit(RTC.OFFER, offerMessage);
            console.log(`[WebRTC] Sent offer to: ${targetId}`);
        } catch (error) {
            console.error(`[WebRTC] Error connecting to peer ${targetId}:`, error);
            this.peerConnectionManager.cleanup(targetId);
            throw error;
        }
    }

    public getConnectedPeers(): string[] {
        return this.peerConnectionManager.getConnectedPeers();
    }

    public disconnectFromPeer(clientId: string): void {
        this.peerConnectionManager.cleanup(clientId);
    }

    public getPeerConnectionState(clientId: string): RTCPeerConnectionState | null {
        return this.peerConnectionManager.getConnectionState(clientId);
    }

    public cleanup() {
        this.peerConnectionManager.cleanupAll();
        console.log('[WebRTC] WebRTC controller cleaned up');
    }
}
