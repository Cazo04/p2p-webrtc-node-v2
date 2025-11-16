import got from "got";
import https from "https";
import http from "http";
import { IncomingHttpHeaders } from "http";
import { NodeHttpHeader } from '../../../types/resource';
import * as fs from 'fs/promises';
import { createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';
import { join } from 'path';

export default class DownloadUtils {
    private static readonly httpsAgent = new https.Agent({ rejectUnauthorized: false });
    private static readonly httpAgent = new http.Agent();

    private static readonly agentOptions = {
        http: this.httpAgent,
        https: this.httpsAgent
    };

    public static async stream(url: string, destination: string, fileName: string, headers?: NodeHttpHeader): Promise<string> {
        const fullDestination = join(destination, fileName);
        const fileWriteStream = createWriteStream(fullDestination);
        try {
            const downloadStream = got.stream(url, { headers, agent: this.agentOptions });

            await pipeline(downloadStream, fileWriteStream);
            return fullDestination;
        } catch (error) {
            // Clean up - delete the partial file if download fails
            try {
                await fs.unlink(fullDestination);
            } catch {
                // Ignore errors if deletion fails
            }

            throw new Error(`Failed to download from ${url} to ${fullDestination}: ${(error as Error).message}`);
        }
    }

    public static async head(url: string, headers?: NodeHttpHeader): Promise<IncomingHttpHeaders> {
        try {
            const response = await got.head(url, { headers, agent: this.agentOptions });
            return response.headers;
        } catch (error) {
            throw new Error(`Failed to get headers from ${url}: ${(error as Error).message}`);
        }
    }
}