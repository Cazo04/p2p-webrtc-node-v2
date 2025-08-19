import * as fs from 'fs';
import { createHash } from 'blake2';
import { FileHash } from '../types';

export default class FileUtils {
    public static hashFile(filePath: string): string {
        const fileData = fs.readFileSync(filePath);
        const h = createHash('blake2b', { digestLength: 32 });
        h.update(fileData);
        return h.digest('hex');
    }

    public static hashFiles(filePaths: string[]): string[] {
        return filePaths.map(filePath => this.hashFile(filePath));
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