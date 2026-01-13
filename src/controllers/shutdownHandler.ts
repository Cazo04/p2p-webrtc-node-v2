import { Socket } from 'socket.io-client';
import { SHUTDOWN_ACK } from '../../../config/signal.socket.event.node';
import { NodeShutdownAck } from '../../../types/signal';
import SignalSocketController from './signalSocket';
import WebRTCSocketController from './webRTCSocket';
import SettingUtils from '../utils/setting';

export default class ShutdownHandler {
    private socket: Socket;
    private signalSocketController: SignalSocketController;
    private webrtcSocketController: WebRTCSocketController;
    private isShuttingDown: boolean = false;

    constructor(
        socket: Socket,
        signalSocketController: SignalSocketController,
        webrtcSocketController: WebRTCSocketController
    ) {
        this.socket = socket;
        this.signalSocketController = signalSocketController;
        this.webrtcSocketController = webrtcSocketController;
    }

    public async initiateGracefulShutdown(delaySeconds: number, reason?: string): Promise<void> {
        if (this.isShuttingDown) {
            console.log('[Shutdown] Already in shutdown mode, ignoring duplicate request');
            return;
        }

        this.isShuttingDown = true;
        console.log(`[Shutdown] Graceful shutdown initiated. Reason: ${reason || 'Not specified'}. Shutting down in ${delaySeconds} seconds...`);

        // Send acknowledgment to signal server
        this.sendShutdownAck();

        // Step 1: Stop accepting new connections and deactivate device updates
        console.log('[Shutdown] Deactivating device updates...');
        this.signalSocketController.deactivateDeviceUpdates();

        // Step 2: Force close all active WebRTC peer connections immediately
        const connectedPeers = this.webrtcSocketController.getConnectedPeers();
        console.log(`[Shutdown] Force closing ${connectedPeers.length} WebRTC connection(s)...`);
        this.webrtcSocketController.cleanup();
        console.log('[Shutdown] All WebRTC connections closed');

        // Step 3: Disconnect WebSocket from signal server immediately
        console.log('[Shutdown] Disconnecting WebSocket from signal server...');
        this.socket.disconnect();
        console.log('[Shutdown] WebSocket disconnected');

        // Step 4: Enter sleep state for n seconds
        console.log(`[Shutdown] Entering sleep state for ${delaySeconds} seconds...`);
        await this.sleep(delaySeconds * 1000);

        // Step 5: Exit process
        console.log('[Shutdown] Sleep period complete. Exiting process...');
        process.exit(0);
    }

    private sendShutdownAck(): void {
        const appInfo = SettingUtils.getAppInfo();
        if (!appInfo) {
            console.warn('[Shutdown] Cannot send acknowledgment: no app info available');
            return;
        }

        const ack: NodeShutdownAck = {
            node_id: appInfo.id,
            received_at: new Date()
        };

        this.socket.emit(SHUTDOWN_ACK, ack);
        console.log('[Shutdown] Sent shutdown acknowledgment to signal server');
    }

    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    public isInShutdownMode(): boolean {
        return this.isShuttingDown;
    }
}
