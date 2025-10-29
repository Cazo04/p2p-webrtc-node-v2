import { Socket } from 'socket.io-client';
import { RTCPeerConnection } from '@roamhq/wrtc';
import type { PeerStats } from '../../../../types/signal';
import NetworkUtils from '../../utils/network';
import { PEER_STATS } from '../../../../config/signal.socket.event.webrtc';

export default class StatsReporter {
    private socket: Socket;

    constructor(socket: Socket) {
        this.socket = socket;
    }

    public async reportPeerStats(
        peerConnection: RTCPeerConnection,
        remoteId: string,
        oldPeerStats?: PeerStats,
        isDisconnected = false
    ): Promise<PeerStats> {
        try {
            let peerStats: PeerStats = {
                target: remoteId,
                isDisconnected: isDisconnected,
                rtt: -1,
                bytesSent: 0,
                bytesReceived: 0,
            };

            if (isDisconnected) {
                this.socket.emit(PEER_STATS, peerStats);
                return peerStats;
            }

            const report = await peerConnection.getStats();

            report.forEach(s => {
                if (s.type === 'candidate-pair' && s.state === 'succeeded') {
                    peerStats.rtt = s.currentRoundTripTime * 1000;
                }

                if (s.type === 'data-channel' && s.state === 'open') {
                    peerStats.bytesSent = s.bytesSent - (oldPeerStats?.bytesSent || 0);
                    peerStats.bytesReceived = s.bytesReceived - (oldPeerStats?.bytesReceived || 0);
                }

                if (s.type === 'remote-candidate') {
                    const ip = s.ip;
                    const { version, type } = NetworkUtils.classifyIp(ip);
                    if (type === 'public') {
                        if (version === 'IPv4') peerStats.remote_ipv4 = ip;
                        else peerStats.remote_ipv6 = ip;
                    } else {
                        if (version === 'IPv4') peerStats.remote_private_ipv4 = ip;
                    }
                }

                if (s.type === 'local-candidate') {
                    const ip = s.ip;
                    const { version, type } = NetworkUtils.classifyIp(ip);
                    if (type === 'public') {
                        if (version === 'IPv4') peerStats.local_ipv4 = ip;
                        else peerStats.local_ipv6 = ip;
                    } else {
                        if (version === 'IPv4') peerStats.local_private_ipv4 = ip;
                    }
                }
            });

            this.socket.emit(PEER_STATS, peerStats);
            return peerStats;
        } catch (error) {
            console.error(`[WebRTC] Error getting stats for ${remoteId}:`, error);
            throw error;
        }
    }
}
