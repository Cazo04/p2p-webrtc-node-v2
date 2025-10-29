import { Socket } from 'socket.io-client';
import type { RequestFragmentStats } from '../../../../types/signal';
import type { PeerConnectionData } from './types';
import { RequestFragmentStatus } from '../../../../config/signal.socket.event.webrtc';
import { CLIENT_REQUEST_STATS } from '../../../../config/signal.socket.event.node';

export default class RequestReporter {
    private socket: Socket;

    constructor(socket: Socket) {
        this.socket = socket;
    }

    public reportRequestStats(clientId: string, fragmentId: string, status: RequestFragmentStatus, start?: Date, end?: Date): void {
        const request: RequestFragmentStats = {
            clientId,
            fragmentId,
            status,
            start,
            end,
        };

        this.socket.emit(CLIENT_REQUEST_STATS, request);
        return;
    }
}