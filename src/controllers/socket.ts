import { io, Socket } from 'socket.io-client';
import SettingUtils from '../utils/setting';
import SignalSocketController from './signalSocket';
import CommandSocketController from './commandSocket';

export default class SocketController {
    private socket!: Socket;
    private serverIndex: number = 0;
    private maxServerIndex: number = 0;
    private signalSocketController!: SignalSocketController;
    private commandSocketController!: CommandSocketController;

    constructor() {
        
    }

    public createConnection(): void {
        const servers = SettingUtils.getSignalingServers();
        if (!servers || servers.length === 0) {
            console.error("No signaling servers configured.");
            process.exit(1);
        }

        const signalServerUrl = servers[0];
        this.socket = io(signalServerUrl, {
            path: '/socket.io'
        });
        this.signalSocketController = new SignalSocketController(this.socket);
        this.commandSocketController = new CommandSocketController(this.socket);
        this.serverIndex = 0;
        this.maxServerIndex = servers.length - 1;
        this.socket.on('connect_error', this.handleConnectError);
        this.socket.on('connect', this.handleConnect);
    }

    private handleConnect = async (): Promise<void> => {
        console.log(`Connected to signaling server: ${this.socket.io.opts.hostname}:${this.socket.io.opts.port}`);

        const info = SettingUtils.getAppInfo();
        if (!info || info.id === '' || info.auth_token === '') {
            try {
                const res = await this.signalSocketController.signUpDevice();
                SettingUtils.setAppInfo(res);
                //Setting.saveSettings();
            } catch (error) {
                console.error("Socket controller signup error: ", error);
                process.exit(1);
            }
        }

        try {
            await this.signalSocketController.signInDevice();
            this.signalSocketController.activateDeviceUpdates(SettingUtils.getRemotePaths());
        } catch (error) {
            console.error("Socket controller signin error: ", error);
            process.exit(1);
        }
    }

    private handleConnectError = (error: Error): void => {
        this.signalSocketController.deactivateDeviceUpdates();

        console.error(`Connection error: ${error.message}`);

        const servers = SettingUtils.getSignalingServers();
        if (!servers) return;

        if (this.serverIndex < this.maxServerIndex) {
            this.serverIndex++;
            const nextServer = servers[this.serverIndex];
            console.log(`Attempting to connect to alternative server: ${nextServer}`);

            // Close current connection
            this.socket.disconnect();

            setTimeout(() => {
                console.log(`Reconnecting to ${nextServer}...`);
                // Update the URI and attempt reconnection
                // @ts-ignore - io.uri is not in the types but is used in the original code
                this.socket.io.uri = nextServer;
                this.socket.connect();
            }, 5000);
        } else {
            console.error("Tried all available signaling servers without success.");
            process.exit(1);
        }
    }
}
