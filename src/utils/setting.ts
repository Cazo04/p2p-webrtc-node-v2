import * as fs from 'fs';
import * as path from 'path';
import { SETTING_PATH, DEFAULT_SETTING, REMOTE_PATH_NAME } from '../config/constants';
import { AppConfig, StoragePath, AppInfo } from '../types';
import PathUtils from './path';

export default class SettingUtils {
    private static config?: AppConfig;
    private static remotePaths: StoragePath[] = [];
    private static fragmentMap: Map<string, string> = new Map<string, string>();

    /**
     * Checks if the settings file exists, creates it with default values if it doesn't
     */
    public static checkSettingsFileExists(): boolean {
        try {
            if (fs.existsSync(SETTING_PATH)) {
                return true;
            } else {
                fs.writeFileSync(SETTING_PATH, JSON.stringify(DEFAULT_SETTING, null, 2), 'utf8');
                return false;
            }
        } catch (error) {
            console.error('Error checking or creating settings file:', error);
            return false;
        }
    }

    /**
     * Loads settings from the settings file
     */
    public static async loadSettings(): Promise<AppConfig> {
        try {
            const data = fs.readFileSync(SETTING_PATH, 'utf8');
            SettingUtils.config = JSON.parse(data);

            if (!SettingUtils.config) {
                throw new Error("No valid config found");
            }

            if (SettingUtils.config.paths) {
                await PathUtils.checkUniqueMounts(SettingUtils.config.paths);
            } else {
                throw new Error("No valid paths found");
            }

            SettingUtils.updateRemotePaths();
            SettingUtils.createRemoteDir();
            SettingUtils.createFragmentMap();

            return SettingUtils.config;
        } catch (error) {
            throw new Error(`Error loading settings: ${error}`);
        }
    }

    /**
     * Saves the current settings to the settings file
     */
    public static saveSettings(): void {
        if (SettingUtils.config) {
            fs.writeFileSync(SETTING_PATH, JSON.stringify(SettingUtils.config, null, 2), 'utf8');
        }
    }

    /**
     * Gets the application information from the settings
     */
    public static getAppInfo(): AppInfo | undefined {
        return SettingUtils.config ? SettingUtils.config.info : undefined;
    }

    /**
     * Sets the application information in the settings
     * @param appInfo - The application information to set
     */
    public static setAppInfo(appInfo: AppInfo): void {
        if (SettingUtils.config) {
            SettingUtils.config.info = appInfo;
        }
    }

    /**
     * Gets the signaling servers from the settings
     */
    public static getSignalingServers(): string[] | null {
        return SettingUtils.config ? SettingUtils.config.signaling_servers as unknown as string[] : null;
    }

    /**
     * Gets the ICE servers from the settings
     */
    public static getIceServers(): any[] | null {
        return SettingUtils.config ? SettingUtils.config.webrtc.iceServers as unknown as any[] : null;
    }

    /**
     * Gets the storage paths from the settings
     */
    public static getPaths(): StoragePath[] | undefined {
        return SettingUtils.config ? SettingUtils.config.paths : undefined;
    }

    public static getRemotePaths(): StoragePath[] {
        return SettingUtils.remotePaths;
    }

    private static updateRemotePaths(): void {
        const configuredPaths = SettingUtils.getPaths();
        let remotePaths: StoragePath[] = [];

        if (configuredPaths && configuredPaths.length > 0) {
            for (const localPath of configuredPaths) {
                const remotePath = path.join(localPath.path, REMOTE_PATH_NAME);
                remotePaths.push({
                    path: remotePath,
                    threshold: localPath.threshold
                });
            }
            SettingUtils.remotePaths = remotePaths;
        } else {
            throw new Error("No valid paths found");
        }
    }

    private static createRemoteDir(): void {
        const remotePaths = SettingUtils.getRemotePaths();
        for (const remotePath of remotePaths) {
            if (!fs.existsSync(remotePath.path)) {
                fs.mkdirSync(remotePath.path, { recursive: true });
            }
        }
    }

    private static createFragmentMap(): void {
        const remotePaths = SettingUtils.getRemotePaths();
        SettingUtils.fragmentMap.clear();

        for (const remotePath of remotePaths) {
            try {
                if (!fs.existsSync(remotePath.path)) {
                    throw new Error(`Remote path does not exist: ${remotePath.path}`);
                }

                const files = fs.readdirSync(remotePath.path);
                for (const file of files) {
                    const filePath = path.join(remotePath.path, file);

                    try {
                        const stat = fs.statSync(filePath);

                        if (stat.isFile()) {
                            SettingUtils.fragmentMap.set(file, filePath);
                            console.log(`Fragment path added: ${file}`);
                        }
                    } catch (err) {
                        throw new Error(`Error processing file ${filePath}: ${err}`);
                    }
                }
            } catch (err) {
                throw new Error(`Error reading directory ${remotePath.path}: ${err}`);
            }
        }
    }

    public static getFragmentMap(): Map<string, string> {
        return SettingUtils.fragmentMap;
    }

    public static getFragmentPath(fragmentId: string): string | undefined {
        return SettingUtils.fragmentMap.get(fragmentId);
    }

    public static addFragmentPath(fragmentId: string, filePath: string): void {
        SettingUtils.fragmentMap.set(fragmentId, filePath);
    }

    public static removeFragmentPath(fragmentId: string): void {
        SettingUtils.fragmentMap.delete(fragmentId);
    }
}
