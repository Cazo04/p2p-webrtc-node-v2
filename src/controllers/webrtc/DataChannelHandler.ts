import { RTCDataChannel } from '@roamhq/wrtc';
import { DataChannelMessageType } from '../../../../config/signal.socket.event.webrtc';
import type { RequestNodeMessage, CanceledMessage } from '../../../../types/signal';
import type { PeerConnectionData } from './types';
import FileTransferManager from './FileTransferManager';

export default class DataChannelHandler {
    private fileTransferManager: FileTransferManager;
    private onActivityUpdate: (clientId: string) => void;

    constructor(
        fileTransferManager: FileTransferManager,
        onActivityUpdate: (clientId: string) => void
    ) {
        this.fileTransferManager = fileTransferManager;
        this.onActivityUpdate = onActivityUpdate;
    }

    public setupDataChannel(
        dataChannel: RTCDataChannel,
        remoteId: string,
        peerData: PeerConnectionData
    ): void {
        peerData.dataChannel = dataChannel;

        dataChannel.onopen = () => {
            console.log(`[WebRTC] Data channel opened with client: ${remoteId}`);
            this.onActivityUpdate(remoteId);
        };

        dataChannel.onmessage = (event) => {
            console.log(`[WebRTC] Received message from ${remoteId}`);
            this.onActivityUpdate(remoteId);
            this.handleMessage(event.data, remoteId, peerData);
        };

        dataChannel.onclose = () => {
            console.log(`[WebRTC] Data channel closed with client: ${remoteId}`);
        };

        dataChannel.onerror = (error) => {
            console.error(`[WebRTC] Data channel error with ${remoteId}:`, error);
        };
    }

    private handleMessage(
        data: string | ArrayBuffer,
        fromClientId: string,
        peerData: PeerConnectionData
    ): void {
        try {
            if (typeof data === 'string') {
                const message = JSON.parse(data);
                console.log(`[WebRTC] Received message from ${fromClientId}:`, message.type);

                switch (message.type) {
                    case DataChannelMessageType.READY_NODE:
                        this.handleFragmentRequest(message, fromClientId, peerData);
                        break;
                    case DataChannelMessageType.CANCELED:
                        this.handleCancelRequest(message, fromClientId, peerData);
                        break;
                    default:
                        console.log(`[WebRTC] Unknown message type: ${message.type}`);
                }
            }
        } catch (error) {
            console.error('[WebRTC] Error handling data channel message:', error);
        }
    }

    private handleFragmentRequest(
        message: RequestNodeMessage,
        fromClientId: string,
        peerData: PeerConnectionData
    ): void {
        this.fileTransferManager.startTransfer(
            message,
            fromClientId,
            peerData,
            this.onActivityUpdate
        );
    }

    private handleCancelRequest(
        message: CanceledMessage,
        fromClientId: string,
        peerData: PeerConnectionData
    ): void {
        console.log(
            `[WebRTC] Received cancel request for session ${message.session_id} from ${fromClientId}`
        );
        this.fileTransferManager.cancelTransfer(fromClientId, peerData, message.session_id);
    }

    public sendData(dataChannel: RTCDataChannel, data: string | ArrayBuffer): boolean {
        if (dataChannel.readyState !== 'open') {
            console.warn(`[WebRTC] Cannot send data: data channel not open`);
            return false;
        }

        try {
            if (typeof data === 'string') {
                dataChannel.send(data);
            } else {
                dataChannel.send(data);
            }
            return true;
        } catch (error) {
            console.error(`[WebRTC] Error sending data:`, error);
            return false;
        }
    }
}
