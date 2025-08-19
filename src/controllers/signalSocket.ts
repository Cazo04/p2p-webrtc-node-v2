import { Socket } from 'socket.io-client';
import { NodeBaseInfo, AckFromServer } from '../../../types/signal';
import { AppInfo, StoragePath } from '../types';
import { NodeDeviceUpdate } from '../../../types/signal';
import SystemUtils from '../utils/system';
import * as NODE from '../../../config/signal.socket.event.node';
import SettingUtils from '../utils/setting';

export default class SignalSocketController {
    private socket: Socket;

    constructor(socket: Socket) {
        this.socket = socket;
    }

    public async signUpDevice(): Promise<AppInfo> {
        try {
            const res = await this.socket.timeout(5000).emitWithAck(NODE.SIGN_UP, undefined) as AckFromServer<NodeBaseInfo> | undefined;
            if (res && res.success && res.data) {
                console.log("Device signed up successfully with ID:", res.data.id);
                SettingUtils.setAppInfo(res.data);
                return res.data as AppInfo;
            } else {
                throw new Error(`Failed to sign up device: ${res?.error || 'Response is invalid'}`);
            }
        } catch (error) {
            throw new Error(`Error signing up device: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    public async signInDevice(): Promise<void> {
        try {
            const res = await this.socket.timeout(5000).emitWithAck(NODE.SIGN_IN, SettingUtils.getAppInfo()) as AckFromServer | undefined;
            if (res && res.success) {
                console.log("Device signed in successfully with ID:", SettingUtils.getAppInfo()?.id);
            } else {
                throw new Error(`Failed to sign in device: ${res?.error || 'Unknown error'}`);
            }
        } catch (error) {
            throw new Error(`Error signing in device: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    private async updateDevice(storagePaths: StoragePath[]): Promise<void> {
        const systemInfo = await SystemUtils.getSystemInfo(storagePaths);
        const appInfo = SettingUtils.getAppInfo();
        if (!appInfo) {
            throw new Error("AppInfo is not set");
        }

        const updatedInfo: NodeDeviceUpdate = {
            id: appInfo.id,
            auth_token: appInfo.auth_token,
            space_available: systemInfo.space_available,
            ram_available: systemInfo.ram_available,
            cpu_usage: systemInfo.cpu_usage
        };

        this.socket.emit(NODE.DEVICE_UPDATE, updatedInfo);
        console.log("Device information updated:", updatedInfo.ram_available);
    }

    private updateInterval: NodeJS.Timeout | null = null;

    public activateDeviceUpdates(storagePaths: StoragePath[]): void {
        // Clear any existing interval first
        this.deactivateDeviceUpdates();
        
        // Start a new interval to update device info every 5 seconds
        this.updateInterval = setInterval(() => {
            this.updateDevice(storagePaths);
        }, 5000);
        
        // Send initial update immediately
        this.updateDevice(storagePaths);
        console.log("Device updates activated, sending updates every 5 seconds");
    }

    public deactivateDeviceUpdates(): void {
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
            this.updateInterval = null;
            console.log("Device updates deactivated");
        }
    }
}
