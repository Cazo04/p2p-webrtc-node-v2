import { Socket } from 'socket.io-client';
import { COMMAND, COMMAND_VERIFY } from '../../../config/signal.socket.event.node';
import { NodeCommand, NodeCommandVerify, NodeResourceHash } from '../../../types/signal';
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
}
