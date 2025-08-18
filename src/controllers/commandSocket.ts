import { Socket } from 'socket.io-client';
import { COMMAND } from '../../../config/socket-event-node';
import { NodeCommand, FragmentDownloadInfo } from '../../../types/signal';
import { NodeHttpHeader } from '../../../types/resource';
import SettingUtils from '../utils/setting';
import FileUtils from '../utils/file';
import PathUtils from '../utils/path';
import DownloadUtils from '../utils/download';

export default class CommandSocketController {
    private socket: Socket;

    constructor(socket: Socket) {
        this.socket = socket;
        this.handleCommand();
    }

    private handleCommand(): void {
        this.socket.on(COMMAND, async (command: NodeCommand) => {
            if (command.delete) {
                this.handleDelete(command.delete);
            }
            if (command.download) {
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

    private async handleDownload(downloadInfo: FragmentDownloadInfo[]): Promise<void> {
        const appInfo = SettingUtils.getAppInfo()!;
        const nodeInfo: NodeHttpHeader = {
            "Node-Id": appInfo.id,
            "Node-Token": appInfo.auth_token
        };

        for (const info of downloadInfo) {
            try {
                const fileHead = await DownloadUtils.head(info.url, nodeInfo);
                if (!fileHead['content-length']) {
                    throw new Error("Content-Length header is missing in the response");
                }

                const contentLength = parseInt(fileHead['content-length'], 10);

                const freePath = await PathUtils.findMostFreePath(SettingUtils.getRemotePaths());

                if (freePath && contentLength && freePath.availableSpace >= contentLength) {
                    const filePath = await DownloadUtils.stream(info.url, freePath.path, info.fragment_id, nodeInfo);
                    const fileHash = FileUtils.hashFile(filePath);
                }
            } catch (error) {
                console.error("Error downloading file:", error);
            }
        }
    }
}
