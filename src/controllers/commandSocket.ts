import { Socket } from 'socket.io-client';
import { exec } from 'child_process';
import { promisify } from 'util';
import { COMMAND, COMMAND_VERIFY, SHUTDOWN, IPROUTE_COMMAND, IPROUTE_COMMAND_ACK } from '../../../config/signal.socket.event.node';
import { NodeCommand, NodeCommandVerify, NodeResourceHash, NodeShutdownCommand, IprouteCommand, IprouteCommandAck } from '../../../types/signal';
import { NodeHttpHeader } from '../../../types/resource';
import SettingUtils from '../utils/setting';
import FileUtils from '../utils/file';
import PathUtils from '../utils/path';
import DownloadUtils from '../utils/download';

const execAsync = promisify(exec);

type OnShutdownCallback = (delaySeconds: number, reason?: string) => void;

export default class CommandSocketController {
    private socket: Socket;
    private onShutdownCallback?: OnShutdownCallback;
    private resetTimeout?: NodeJS.Timeout;
    private currentInterface?: string;

    constructor(socket: Socket) {
        this.socket = socket;
        this.handleCommand();
        this.handleShutdown();
        this.handleIprouteCommand();
    }

    public setOnShutdown(callback: OnShutdownCallback): void {
        this.onShutdownCallback = callback;
    }

    private handleShutdown(): void {
        this.socket.on(SHUTDOWN, (data: NodeShutdownCommand) => {
            console.log(`[Command] Received shutdown command: delay=${data.delay_seconds}s, reason=${data.reason || 'Not specified'}`);
            if (this.onShutdownCallback) {
                this.onShutdownCallback(data.delay_seconds, data.reason);
            }
        });
    }

    private handleCommand(): void {
        this.socket.on(COMMAND, async (command: NodeCommand) => {
            if (command.delete) {
                console.log("Received delete command:", command.delete);
                this.handleDelete(command.delete);
            }
            if (command.download) {
                console.log("Received download command:", command.download.length);
                await this.handleDownload(command.download);
            }
        });
    }

    private handleDelete(fragmentIds: string[]): void {
        let paths: string[] = [];
        fragmentIds.forEach(fragmentId => {
            const path = SettingUtils.getFragmentPath(fragmentId);
            if (path) {
                paths.push(path);
                SettingUtils.removeFragmentPath(fragmentId);
            } else {
                console.warn("Delete fragment path not found:", fragmentId);
            }
        });

        try {
            FileUtils.deleteFiles(paths);
        } catch (error) {
            console.error("Error deleting files:", error);
        }
    }

    private async handleDownload(urls: string[]): Promise<void> {
        const appInfo = SettingUtils.getAppInfo()!;
        const nodeInfo: NodeHttpHeader = {
            "Node-Id": appInfo.id,
            "Node-Token": appInfo.auth_token
        };
        let downloadResults: NodeResourceHash[] = [];

        for (const url of urls) {
            try {
                const fileHead = await DownloadUtils.head(url, nodeInfo);
                if (!fileHead['content-length']) {
                    throw new Error("Content-Length header is missing in the response");
                }
                // Extract filename from Content-Disposition header
                let fileName = '';
                if (fileHead['content-disposition']) {
                    const filenameMatch = fileHead['content-disposition'].match(/filename="([^"]+)"/);
                    if (filenameMatch && filenameMatch[1]) {
                        fileName = filenameMatch[1];
                    } else {
                        throw new Error("Filename not found in Content-Disposition header");
                    }
                } else {
                    throw new Error("Content-Disposition header is missing in the response");
                }

                const contentLength = parseInt(fileHead['content-length'], 10);

                const freePath = await PathUtils.findMostFreePath(SettingUtils.getRemotePaths());

                if (freePath && contentLength && freePath.availableSpace >= contentLength) {
                    const filePath = await DownloadUtils.stream(url, freePath.path, fileName, nodeInfo);

                    SettingUtils.addFragmentPath(fileName, filePath);

                    const fileHash = FileUtils.hashFile(filePath);
                    downloadResults.push({
                        fragment_id: fileName,
                        hash: fileHash || ''
                    });
                }
            } catch (error) {
                console.error("Error downloading file:", error);
            }
        }

        const res: NodeCommandVerify = { result: downloadResults };
        this.socket.emit(COMMAND_VERIFY, res);
    }

    /**
     * Handle iproute2 network simulation commands
     */
    private handleIprouteCommand(): void {
        this.socket.on(IPROUTE_COMMAND, async (command: IprouteCommand) => {
            console.log(`[Command] Received iproute command: action=${command.action}`);
            
            const appInfo = SettingUtils.getAppInfo();
            const nodeId = appInfo?.id || 'unknown';
            
            try {
                // Get the default network interface for internet traffic
                const interfaceName = await this.getDefaultInterface();
                this.currentInterface = interfaceName;
                
                if (command.action === 'apply') {
                    await this.applyNetworkConditions(interfaceName, command);
                    
                    // Schedule auto-reset if duration is specified
                    if (command.duration_seconds && command.duration_seconds > 0) {
                        // Clear any existing reset timeout
                        if (this.resetTimeout) {
                            clearTimeout(this.resetTimeout);
                        }
                        
                        this.resetTimeout = setTimeout(async () => {
                            console.log(`[Iproute] Auto-reset after ${command.duration_seconds}s`);
                            try {
                                await this.resetNetworkConditions(interfaceName);
                                this.sendIprouteAck(nodeId, true, 'reset', interfaceName);
                            } catch (error: any) {
                                console.error(`[Iproute] Auto-reset failed:`, error.message);
                            }
                        }, command.duration_seconds * 1000);
                    }
                    
                    this.sendIprouteAck(nodeId, true, 'apply', interfaceName);
                } else if (command.action === 'reset') {
                    // Clear any pending reset timeout
                    if (this.resetTimeout) {
                        clearTimeout(this.resetTimeout);
                        this.resetTimeout = undefined;
                    }
                    
                    await this.resetNetworkConditions(interfaceName);
                    this.sendIprouteAck(nodeId, true, 'reset', interfaceName);
                }
            } catch (error: any) {
                console.error(`[Iproute] Command failed:`, error.message);
                this.sendIprouteAck(nodeId, false, command.action, this.currentInterface, undefined, error.message);
            }
        });
    }

    /**
     * Get the default network interface for internet traffic
     */
    private async getDefaultInterface(): Promise<string> {
        try {
            // Get the default route to internet
            const { stdout } = await execAsync('ip route get 8.8.8.8 | head -1 | awk \'{print $5}\'');
            const interfaceName = stdout.trim();
            
            if (!interfaceName) {
                throw new Error('Could not determine default network interface');
            }
            
            console.log(`[Iproute] Detected default interface: ${interfaceName}`);
            return interfaceName;
        } catch (error: any) {
            // Fallback to checking common interface names
            const commonInterfaces = ['eth0', 'ens5', 'ens3', 'enp0s3', 'wlan0'];
            for (const iface of commonInterfaces) {
                try {
                    await execAsync(`ip link show ${iface}`);
                    console.log(`[Iproute] Using fallback interface: ${iface}`);
                    return iface;
                } catch {
                    continue;
                }
            }
            throw new Error('Could not find any valid network interface');
        }
    }

    /**
     * Apply network conditions using tc qdisc
     */
    private async applyNetworkConditions(interfaceName: string, command: IprouteCommand): Promise<void> {
        // First, try to delete any existing qdisc
        try {
            await execAsync(`tc qdisc del dev ${interfaceName} root 2>/dev/null || true`);
        } catch {
            // Ignore errors - qdisc might not exist
        }

        // Build the tc netem command
        const netemParams: string[] = [];
        
        if (command.delay_ms !== undefined && command.delay_ms > 0) {
            netemParams.push(`delay ${command.delay_ms}ms`);
        }
        
        if (command.loss_percent !== undefined && command.loss_percent > 0) {
            netemParams.push(`loss ${command.loss_percent}%`);
        }
        
        if (command.duplicate_percent !== undefined && command.duplicate_percent > 0) {
            netemParams.push(`duplicate ${command.duplicate_percent}%`);
        }
        
        if (command.corrupt_percent !== undefined && command.corrupt_percent > 0) {
            netemParams.push(`corrupt ${command.corrupt_percent}%`);
        }

        if (netemParams.length === 0) {
            console.log('[Iproute] No network conditions specified, skipping apply');
            return;
        }

        const tcCommand = `tc qdisc add dev ${interfaceName} root netem ${netemParams.join(' ')}`;
        console.log(`[Iproute] Executing: ${tcCommand}`);
        
        const { stdout, stderr } = await execAsync(tcCommand);
        
        if (stdout) console.log(`[Iproute] stdout: ${stdout}`);
        if (stderr) console.log(`[Iproute] stderr: ${stderr}`);
        
        console.log(`[Iproute] Network conditions applied successfully on ${interfaceName}`);
    }

    /**
     * Reset network conditions by removing tc qdisc
     */
    private async resetNetworkConditions(interfaceName: string): Promise<void> {
        const tcCommand = `tc qdisc del dev ${interfaceName} root 2>/dev/null || true`;
        console.log(`[Iproute] Executing: ${tcCommand}`);
        
        await execAsync(tcCommand);
        console.log(`[Iproute] Network conditions reset on ${interfaceName}`);
    }

    /**
     * Send acknowledgment back to signal server
     */
    private sendIprouteAck(
        nodeId: string, 
        success: boolean, 
        action: 'apply' | 'reset', 
        interfaceName?: string,
        stdout?: string,
        error?: string
    ): void {
        const ack: IprouteCommandAck = {
            node_id: nodeId,
            success,
            action,
            interface_name: interfaceName,
            stdout,
            error,
            received_at: new Date()
        };
        
        this.socket.emit(IPROUTE_COMMAND_ACK, ack);
        console.log(`[Iproute] Sent ack: success=${success}, action=${action}, interface=${interfaceName}`);
    }
}
