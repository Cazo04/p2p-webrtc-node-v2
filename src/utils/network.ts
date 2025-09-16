import * as net from 'net';

/**
 * Type definition for IP classification result
 */
type IpClassification = {
    version: 'IPv4' | 'IPv6' | 'unknown';
    type: 'private' | 'public' | 'unknown';
};

/**
 * Network utilities for IP address classification and validation
 */
export default class NetworkUtils {
    /**
     * Classifies an IP address as IPv4/IPv6 and private/public
     * @param ip - The IP address to classify
     * @returns Classification result with version and type
     */
    public static classifyIp(ip: string): IpClassification {
        const ver = net.isIP(ip);
        if (ver === 0) return { version: 'unknown', type: 'unknown' };

        if (ver === 4) {
            return { version: 'IPv4', type: this.isPrivateV4(ip) ? 'private' : 'public' };
        }

        return { version: 'IPv6', type: this.isPrivateV6(ip) ? 'private' : 'public' };
    }

    /**
     * Checks if an IPv4 address is private
     * @param ip - The IPv4 address to check
     * @returns True if the IP is private, false otherwise
     */
    private static isPrivateV4(ip: string): boolean {
        const [a, b] = ip.split('.').map(Number);

        // RFC 1918 private blocks
        if (a === 10) return true;                     // 10.0.0.0/8
        if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
        if (a === 192 && b === 168) return true;       // 192.168.0.0/16

        if (a === 127) return true;                    // loopback 127.0.0.0/8
        if (a === 169 && b === 254) return true;       // link‑local 169.254.0.0/16
        if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64.0.0/10

        return false;
    }

    /**
     * Checks if an IPv6 address is private
     * @param ip - The IPv6 address to check
     * @returns True if the IP is private, false otherwise
     */
    private static isPrivateV6(ip: string): boolean {
        const addr = ip.split('%')[0].toLowerCase();

        if (addr.startsWith('fc') || addr.startsWith('fd')) return true;

        if (/^fe[89ab]/.test(addr)) return true;

        if (addr === '::1') return true;

        return false;
    }
}