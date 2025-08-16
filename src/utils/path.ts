import * as fs from 'fs';
import * as path from 'path';
import * as si from 'systeminformation';
import { AppConfig, StoragePath, FileSystemInfo } from '../types';

export default class PathUtils {
    public static async analyzeStoragePath(storagePath: StoragePath): Promise<FileSystemInfo> {
        try {
            const { path, threshold } = storagePath;

            if (!fs.existsSync(path)) {
                throw new Error(`Storage path does not exist: ${path}`);
            }

            const fsInfo = await si.fsSize();
            let relevantFs: si.Systeminformation.FsSizeData | undefined;
            let longestMatch = 0;

            for (const fs of fsInfo) {
                if (fs.mount && path.startsWith(fs.mount)) {
                    if (fs.mount.length > longestMatch) {
                        longestMatch = fs.mount.length;
                        relevantFs = fs;
                    }
                }
            }

            if (!relevantFs) {
                throw new Error(`No relevant filesystem found for path: ${path}`);
            }

            const thresholdLimit = Math.floor((relevantFs.size * threshold) / 100);

            return {
                path,
                filesystem: relevantFs.fs,
                mount: relevantFs.mount,
                availableSpace: Math.min(relevantFs.available, thresholdLimit)
            };
        } catch (error) {
            throw new Error(`Failed to analyze storage path ${storagePath.path}: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    public static async analyzeStoragePaths(storagePaths: StoragePath[]): Promise<FileSystemInfo[]> {
        const res = await Promise.all(storagePaths.map(storagePath => this.analyzeStoragePath(storagePath)));
        return res;
    }

    public static async findMostFreePath(storagePaths: StoragePath[]): Promise<FileSystemInfo | null> {
        if (storagePaths.length === 0) {
            return null;
        }
        
        const analyzedPaths = await this.analyzeStoragePaths(storagePaths);
        
        // Sort by available space (descending)
        analyzedPaths.sort((a, b) => b.availableSpace - a.availableSpace);
        
        // Return the path with the most available space
        return analyzedPaths[0];
    }

    public static async checkUniqueMounts(storagePaths: StoragePath[]): Promise<void> {
        const res = await Promise.all(storagePaths.map(storagePath => this.analyzeStoragePath(storagePath)));

        const mounts = new Map<string, FileSystemInfo>();
        res.forEach(info => {
            if (mounts.has(info.mount)) {
                const existing = mounts.get(info.mount)!;
                throw new Error(`Duplicate mount point detected: ${info.mount}
                    Path 1: ${existing.path}
                    Path 2: ${info.path}`);
            }
            mounts.set(info.mount, info);
        });
    }
}