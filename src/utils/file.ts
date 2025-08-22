import * as fs from 'fs';
import { createHash } from 'blake2';
import { FragmentHash } from '../types';
const path = require('path');

export default class FileUtils {
    public static hashFile(filePath: string): string | undefined {
        try {
            const fileData = fs.readFileSync(filePath);
            const h = createHash('blake2b', { digestLength: 32 });
            h.update(fileData);
            return h.digest('hex');
        } catch (error) {
            console.error(`Error hashing file ${filePath}:`, error);
            return undefined;
        }
    }

    public static hashFiles(filePaths: string[]): FragmentHash[] {
        return filePaths.map(filePath => ({
            fragment_id: path.basename(filePath),
            hash: this.hashFile(filePath)
        }));
    }

    public static deleteFile(filePath: string): void {
        // Check if file exists first
        if (fs.existsSync(filePath)) {
            fs.promises.unlink(filePath);
        }
    }

    public static deleteFiles(filePaths: string[]): void {
        filePaths.forEach(filePath => {
            this.deleteFile(filePath);
        });
    }

    public static readFileStream(filePath: string, processCallback: (chunk: string | Buffer) => void): Promise<void> {
        return new Promise((resolve, reject) => {
            // Check if file exists first
            if (!fs.existsSync(filePath)) {
                reject(new Error(`File does not exist: ${filePath}`));
                return;
            }

            const readStream = fs.createReadStream(filePath);
            
            readStream.on('data', (chunk) => {
                processCallback(chunk);
            });
            
            readStream.on('error', (error) => {
                reject(error);
            });
            
            readStream.on('end', () => {
                resolve();
            });
        });
    }
}