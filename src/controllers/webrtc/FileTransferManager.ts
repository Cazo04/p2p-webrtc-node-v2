import { RTCDataChannel } from '@roamhq/wrtc';
import * as fs from 'fs';
import * as si from 'systeminformation';
import { DataChannelMessageType } from '../../../../config/signal.socket.event.webrtc';
import type { RequestNodeMessage, CanceledMessage, TransferStartMessage } from '../../../../types/signal';
import { CHUNK_SIZE } from '../../config/constants';
import SettingUtils from '../../utils/setting';
import type { TransferSession, PeerConnectionData, FlowControlConfig } from './types';
import RequestReporter from './RequestReporter';
import { RequestFragmentStatus } from '../../../../config/signal.socket.event.webrtc';

export default class FileTransferManager {
    private readonly flowControlConfig: FlowControlConfig = {
        maxBufferThreshold: CHUNK_SIZE * 8, // Increased buffer for better throughput
        throttleCheckInterval: 5 // Reduced from 50ms to 5ms for faster response
    };

    private requestReporter: RequestReporter;

    constructor(requestReporter: RequestReporter) {
        this.requestReporter = requestReporter;
    }

    public async startTransfer(
        message: RequestNodeMessage,
        fromClientId: string,
        peerData: PeerConnectionData,
        onActivityUpdate: (clientId: string) => void
    ): Promise<void> {
        this.requestReporter.reportRequestStats(
            fromClientId,
            message.fragment_id,
            RequestFragmentStatus.STARTING
        );
        const fragmentPath = SettingUtils.getFragmentPath(message.fragment_id);
        
        if (!fragmentPath || !fs.existsSync(fragmentPath)) {
            console.warn(`[WebRTC] Fragment ${message.fragment_id} not found for request from ${fromClientId}`);
            this.requestReporter.reportRequestStats(
                fromClientId,
                message.fragment_id,
                RequestFragmentStatus.FILE_NOT_FOUND
            );
            return;
        }

        if (!peerData.dataChannel || peerData.dataChannel.readyState !== 'open') {
            console.warn(`[WebRTC] Data channel not open for ${fromClientId}`);
            this.requestReporter.reportRequestStats(
                fromClientId,
                message.fragment_id,
                RequestFragmentStatus.DATA_CHANNEL_CLOSED
            );
            return;
        }

        const fileSize = fs.statSync(fragmentPath).size;
        const dataChannel = peerData.dataChannel;

        // Initialize transfer sessions if not exists
        if (!peerData.transferSessions) {
            peerData.transferSessions = new Map<string, TransferSession>();
        }

        // Check system resources
        const canStart = await this.checkSystemResources(dataChannel);
        if (!canStart) {
            await this.sendCancelMessage(
                dataChannel,
                message.session_id,
                message.fragment_id,
                'Node memory low, canceling transfer'
            );
            this.requestReporter.reportRequestStats(
                fromClientId,
                message.fragment_id,
                RequestFragmentStatus.LOW_MEMORY
            );
            return;
        }

        const transferSession: TransferSession = {
            fragmentId: message.fragment_id,
            start: new Date(),
            status: 'in-progress',
            totalBytes: fileSize,
            sentBytes: 0
        };
        this.requestReporter.reportRequestStats(
            fromClientId,
            message.fragment_id,
            RequestFragmentStatus.IN_PROGRESS
        );

        peerData.transferSessions.set(message.session_id, transferSession);

        await this.streamFile(
            fragmentPath,
            fileSize,
            message.session_id,
            message.fragment_id,
            fromClientId,
            dataChannel,
            transferSession,
            peerData,
            onActivityUpdate
        );
    }

    private async checkSystemResources(dataChannel: RTCDataChannel): Promise<boolean> {
        const { available, total } = await si.mem();
        const memoryPercentage = (available / total) * 100;
        const highBufferAmount = dataChannel.bufferedAmount > 10 * 1024 * 1024;

        if (memoryPercentage < 15 || highBufferAmount) {
            console.warn(
                `[WebRTC] Cannot start transfer: low memory (${memoryPercentage.toFixed(1)}%) or ` +
                `high buffered amount (${(dataChannel.bufferedAmount / (1024 * 1024)).toFixed(2)}MB)`
            );
            return false;
        }

        return true;
    }

    private async sendCancelMessage(
        dataChannel: RTCDataChannel,
        sessionId: string,
        fragmentId: string,
        error: string
    ): Promise<void> {
        const cancelMessage: CanceledMessage = {
            type: DataChannelMessageType.CANCELED,
            session_id: sessionId,
            fragment_id: fragmentId,
            error
        };
        dataChannel.send(JSON.stringify(cancelMessage));
    }

    private async streamFile(
        fragmentPath: string,
        fileSize: number,
        sessionId: string,
        fragmentId: string,
        clientId: string,
        dataChannel: RTCDataChannel,
        transferSession: TransferSession,
        peerData: PeerConnectionData,
        onActivityUpdate: (clientId: string) => void
    ): Promise<void> {
        // Send transfer start message with total size first
        const transferStartMessage: TransferStartMessage = {
            type: DataChannelMessageType.TRANSFER_START,
            session_id: sessionId,
            fragment_id: fragmentId,
            total_size: fileSize
        };
        dataChannel.send(JSON.stringify(transferStartMessage));
        console.log(`[WebRTC] Sent TRANSFER_START for fragment ${fragmentId} (${fileSize} bytes) to ${clientId}`);

        const fileStream = fs.createReadStream(fragmentPath, {
            highWaterMark: CHUNK_SIZE,
            autoClose: true
        });
        transferSession.fileStream = fileStream;

        // Activity tracker
        const reportProgress = () => onActivityUpdate(clientId);
        const reportId = setInterval(reportProgress, 5_000);

        // Pre-allocate buffers for headers
        const idBuf = Buffer.from(sessionId);
        const headerSize = 1 + idBuf.length;

        // Set up bufferedAmountLowThreshold for efficient flow control
        const LOW_WATER_MARK = CHUNK_SIZE * 2;
        (dataChannel as any).bufferedAmountLowThreshold = LOW_WATER_MARK;

        // Promise-based drain waiting using bufferedamountlow event
        let drainResolve: (() => void) | null = null;
        
        const onBufferedAmountLow = () => {
            if (drainResolve) {
                drainResolve();
                drainResolve = null;
            }
        };
        
        (dataChannel as any).onbufferedamountlow = onBufferedAmountLow;

        const waitForDrain = (): Promise<void> => {
            // If buffer is already low enough, resolve immediately
            if (dataChannel.bufferedAmount <= LOW_WATER_MARK) {
                return Promise.resolve();
            }
            
            // Use bufferedamountlow event for efficient waiting
            return new Promise<void>((resolve) => {
                drainResolve = resolve;
                
                // Fallback timeout in case event doesn't fire (shouldn't happen but safety net)
                const fallbackCheck = setInterval(() => {
                    if (dataChannel.bufferedAmount <= LOW_WATER_MARK) {
                        clearInterval(fallbackCheck);
                        if (drainResolve) {
                            drainResolve();
                            drainResolve = null;
                        }
                    }
                }, this.flowControlConfig.throttleCheckInterval);
                
                // Clear interval when resolved
                const originalResolve = drainResolve;
                drainResolve = () => {
                    clearInterval(fallbackCheck);
                    originalResolve?.();
                };
            });
        };

        // Process chunks synchronously when possible, async only when needed
        fileStream.on('data', (chunk) => {
            if (transferSession.canceled) {
                fileStream.destroy();
                return;
            }

            const chunkBuffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);

            // Create the packet
            const header = Buffer.alloc(1);
            header.writeUInt8(idBuf.length, 0);
            const buffer = Buffer.allocUnsafe(headerSize + chunkBuffer.length);
            header.copy(buffer, 0);
            idBuf.copy(buffer, 1);
            chunkBuffer.copy(buffer, headerSize);

            // Send the data
            dataChannel.send(buffer);
            transferSession.sentBytes! += chunkBuffer.length;

            // Check if we need to pause for flow control
            if (dataChannel.bufferedAmount > this.flowControlConfig.maxBufferThreshold) {
                fileStream.pause();
                
                // Wait for buffer to drain then resume
                waitForDrain().then(() => {
                    if (!transferSession.canceled && !fileStream.destroyed) {
                        fileStream.resume();
                    }
                });
            }
        });

        fileStream.once('end', () => {
            // Clean up event listener
            (dataChannel as any).onbufferedamountlow = null;
            
            this.handleTransferComplete(
                transferSession,
                fragmentId,
                clientId,
                peerData,
                sessionId,
                reportId
            );
        });

        fileStream.on('error', (error) => {
            // Clean up event listener
            (dataChannel as any).onbufferedamountlow = null;
            
            this.handleTransferError(
                error,
                transferSession,
                fragmentId,
                clientId,
                peerData,
                sessionId,
                reportId
            );
        });
    }

    private handleTransferComplete(
        transferSession: TransferSession,
        fragmentId: string,
        clientId: string,
        peerData: PeerConnectionData,
        sessionId: string,
        reportId: NodeJS.Timeout
    ): void {
        clearInterval(reportId);
        if (transferSession.canceled) return;

        transferSession.status = 'completed';
        transferSession.end = new Date();
        const durationSec = (transferSession.end.getTime() - transferSession.start.getTime()) / 1000;
        transferSession.speedBytesPerSec = durationSec > 0 
            ? (transferSession.totalBytes || 0) / durationSec 
            : 0;

        const speedKBps = (transferSession.speedBytesPerSec! / 1024).toFixed(2);
        const sizeMB = (transferSession.totalBytes! / (1024 * 1024)).toFixed(2);

        console.log(
            `[WebRTC] Completed transfer of fragment ${fragmentId} (${sizeMB} MB) to ${clientId} ` +
            `in ${durationSec.toFixed(2)} sec (${speedKBps} KB/s)`
        );
        this.cleanupTransferSession(peerData, sessionId);

        this.requestReporter.reportRequestStats(
            clientId,
            fragmentId,
            RequestFragmentStatus.COMPLETED
        );
    }

    private handleTransferError(
        error: Error,
        transferSession: TransferSession,
        fragmentId: string,
        clientId: string,
        peerData: PeerConnectionData,
        sessionId: string,
        reportId: NodeJS.Timeout
    ): void {
        clearInterval(reportId);
        if (transferSession.canceled) return;

        transferSession.status = 'failed';
        transferSession.end = new Date();
        transferSession.error = error.message;
        console.error(`[WebRTC] Error reading fragment ${fragmentId} for ${clientId}:`, error);
        this.cleanupTransferSession(peerData, sessionId);

        this.requestReporter.reportRequestStats(
            clientId,
            fragmentId,
            RequestFragmentStatus.FAILED
        );
    }

    public cancelTransfer(fromClientId: string, peerData: PeerConnectionData, sessionId: string): void {
        if (!peerData.transferSessions) return;

        const session = peerData.transferSessions.get(sessionId);
        if (session && session.status === 'in-progress') {
            session.canceled = true;
            session.status = 'canceled';
            session.end = new Date();
            this.cleanupTransferSession(peerData, sessionId);

            this.requestReporter.reportRequestStats(
                fromClientId,
                session.fragmentId,
                RequestFragmentStatus.CANCELED
            );
        }
    }

    private cleanupTransferSession(peerData: PeerConnectionData, sessionId: string): void {
        if (!peerData.transferSessions) return;

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
