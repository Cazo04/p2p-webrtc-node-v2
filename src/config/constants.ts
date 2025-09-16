import * as path from 'path';
import { AppConfig } from '../types';

export const ROOT_PATH: string = path.join(__dirname, '../..');
export const SETTING_PATH: string = path.join(ROOT_PATH, 'node-settings.json');

export const DEFAULT_SETTING: AppConfig = {
    signaling_servers: [
        //"https://p2p.cazo-dev.net",
        "http://localhost:3000",
        "http://192.168.5.20:3000"
    ],
    webrtc: {
        iceServers: [
            { urls: "stun:stun.l.google.com:19302" },
            { urls: "stun:stun1.l.google.com:19302" },
            { urls: "stun:stun2.l.google.com:19302" },
            { urls: "stun:stun3.l.google.com:19302" },

            // Twilio
            { urls: "stun:global.stun.twilio.com:3478" },
            { urls: "stun:global.stun.twilio.com:443" },

            // OpenRelay
            { urls: "stun:openrelay.metered.ca:80" },
            { urls: "stun:openrelay.metered.ca:443" }
        ]
    },
    info: {
        id: "",
        auth_token: ""
    },
    paths: [
        {
            path: ROOT_PATH,
            threshold: 80
        },
    ]
};

export const REMOTE_PATH_NAME = "p2p-node-remote";

export const LIMIT_VERIFY_FRAGMENT_PER_EMIT = 5;

export const CHUNK_SIZE = 53 * 1024; // 53KB
