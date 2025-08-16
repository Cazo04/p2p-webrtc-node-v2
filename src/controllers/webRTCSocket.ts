import { Socket } from 'socket.io-client';

export default class WebRTCSocketController {
    private socket: Socket;

    constructor(socket: Socket) {
        this.socket = socket;
    }

    // Add WebRTC socket methods as needed
}
