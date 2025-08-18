import got from "got";
import { IncomingHttpHeaders } from "http";
import { NodeHttpHeader } from '../../../types/resource';
import * as fs from 'fs/promises';
import { createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';
import { join } from 'path';

export default class DownloadUtils {
    public static async stream(url: string, destination: string, fragmentId: string, headers?: NodeHttpHeader): Promise<string> {
        try {
            const downloadStream = got.stream(url, { headers });
            const fullDestination = join(destination, fragmentId);
            const fileWriteStream = createWriteStream(fullDestination);
            
            await pipeline(downloadStream, fileWriteStream);
            return fullDestination;
        } catch (error) {
            // Clean up - delete the partial file if download fails
            try {
                await fs.unlink(destination);
            } catch {
                // Ignore errors if deletion fails
            }
            
            throw new Error(`Failed to download from ${url} to ${destination}: ${(error as Error).message}`);
        }
    }

    public static async head(url: string, headers?: NodeHttpHeader): Promise<IncomingHttpHeaders> {
        try {
            const response = await got.head(url, { headers });
            return response.headers;
        } catch (error) {
            throw new Error(`Failed to get headers from ${url}: ${(error as Error).message}`);
        }
    }
}