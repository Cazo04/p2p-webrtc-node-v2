import * as si from 'systeminformation';
import { SystemInfo, StoragePath } from '../types';
import PathUtils from './path';

export default class SystemUtils {
    public static async getSystemInfo(storagePaths: StoragePath[]): Promise<SystemInfo> {
        const [mem, cpu, analyzedPaths] = await Promise.all([
            si.mem(),
            si.currentLoad(),
            PathUtils.analyzeStoragePaths(storagePaths)
        ]);

        return {
            cpu_usage: cpu.currentLoad,
            ram_available: mem.available,
            space_available: analyzedPaths.reduce((acc, curr) => acc + curr.availableSpace, 0),
            filesystem_usage: analyzedPaths
        };
    }
}