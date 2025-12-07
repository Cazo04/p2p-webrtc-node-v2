export const OFFER = 'webrtc:offer';
export const ANSWER = 'webrtc:answer';
export const ICE_CANDIDATE = 'webrtc:ice-candidate';
export const PEER_STATS = 'webrtc:peer-stats';

export enum DataChannelMessageType {
  READY_NODE = 'READY_NODE',
  READY_CLIENT = 'READY_CLIENT',
  TRANSFER_START = 'TRANSFER_START',
  CANCELED = 'CANCELED',
}

export enum TransferErrorType {
  TIMEOUT = 'TIMEOUT',
  DECRYPTION_ERROR = 'DECRYPTION_ERROR',
}

export enum RequestFragmentStatus {
  STARTING = 'STARTING',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  CANCELED = 'CANCELED',
  FILE_NOT_FOUND = 'FILE_NOT_FOUND',
  DATA_CHANNEL_CLOSED = 'DATA_CHANNEL_CLOSED',
  LOW_MEMORY = 'LOW_MEMORY',
}