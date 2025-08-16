import { Socket } from 'socket.io-client';
import { COMMAND } from '../../../config/socket-event-node';
import { NodeCommand, FragmentDownloadInfo } from '../../../types/signal';
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
        this.socket.on(COMMAND, (command: NodeCommand) => {
            if (command.delete){
                this.handleDelete(command.delete);
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

    private handleDownload(downloadInfo: FragmentDownloadInfo[]): void {
    }
}
