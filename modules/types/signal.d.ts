import { DataChannelMessageType, TransferErrorType, RequestFragmentStatus } from '../config/signal.socket.event.webrtc';

export interface ClientBaseInfo {
    id: string;
}

export interface NodeBaseInfo {
    id: string;
    auth_token: string;
}

export interface NodeDeviceUpdate extends NodeBaseInfo {
    space_available: number | null;     // bigint
    ram_available: number | null;
    cpu_usage: number | null;
}

export interface NodeCommand {
    download?: Array<string>;
    delete?: Array<string>;
}

export interface NodeCommandVerify {
    result: NodeResourceHash[];
}

export interface NodeResourceHash {
    fragment_id: string;
    hash: string;
}

export interface NodeResourcesVerify {
    index: number;
    total: number;
    resources: NodeResourceHash[];
}

export interface AckFromServer<T = unknown> {
    success: boolean;
    error?: string;
    data?: T;
}

declare namespace Endpoints {
    export interface SendNodePermissionUrls {
        body: Record<string, string[]>;
    }
}

// WebRTC Message Types
interface WebRTCOffer {
    target?: string;
    source?: string;
    offer: RTCSessionDescriptionInit;
}

interface WebRTCAnswer {
    target?: string;
    source?: string;
    answer: RTCSessionDescriptionInit;
}

interface WebRTCIceCandidate {
    target?: string;
    source?: string;
    candidate: RTCIceCandidateInit;
}

interface PeerStats {
    target?: string;
    isDisconnected: boolean;
    rtt: number;
    packetsSent?: number;
    packetsReceived?: number;
    bytesSent: number;
    bytesReceived: number;
    remote_private_ipv4?: string;
    remote_ipv4?: string;
    remote_ipv6?: string;
    local_private_ipv4?: string;
    local_ipv4?: string;
    local_ipv6?: string;
    updatedAt?: Date;
}

interface DataChannelMessage {
    source?: string;
    type: string;
    fragment_id?: string;
    fragment_url?: string;
    session_id?: string;
}

interface SessionRequest {
    fragment_id?: string;
    fragment_url?: string;
    peer_id?: string;
    chunks: Uint8Array<ArrayBuffer>[];
    resolve: (buffer: ArrayBuffer) => void;
    reject: (reason?: any) => void;
}

interface RequestNodeMessage {
    type: DataChannelMessageType.READY_NODE;
    fragment_id: string;
    session_id: string;
}

interface TransferStartMessage {
    type: DataChannelMessageType.TRANSFER_START;
    session_id: string;
    fragment_id: string;
    total_size: number;
}

interface CanceledMessage {
    type: DataChannelMessageType.CANCELED;
    fragment_id: string;
    session_id: string;
    error?: string;
}

interface ReportIssueBase {
    issue_type: TransferErrorType;
    details?: string;
    date?: Date;
}

interface ReportIssueMessage extends ReportIssueBase {
    node_id: string;
    fragment_id: string;
}

// interface ReportRequestStatsMessage {
//     [clientId: string]: {
//         [fragmentId: string]: RequestFragmentStats;
//     };
// }

interface RequestFragmentBase {
    status: RequestFragmentStatus;
    start?: Date;
    end?: Date;
}

interface RequestFragmentStats extends RequestFragmentBase {
    clientId: string;
    fragmentId: string;
}