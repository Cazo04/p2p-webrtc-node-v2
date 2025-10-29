import { RTCPeerConnection, RTCDataChannel } from '@roamhq/wrtc';
import * as fs from 'fs';
import type { PeerStats } from '../../../../types/signal';

export interface TransferSession {
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

export interface PeerConnectionData {
    connection: RTCPeerConnection;
    dataChannel?: RTCDataChannel;
    lastActivity: number;
    timeoutId?: NodeJS.Timeout;
    transferSessions?: Map<string, TransferSession>;
    stats?: PeerStats;
}

export interface FlowControlConfig {
    maxBufferThreshold: number;
    throttleCheckInterval: number;
    maxTimeoutDuration: number;
    minTimeoutDuration: number;
}
