export type HttpUrl = `http://${string}` | `https://${string}`

export type IceUrl = `stun:${string}` | `turn:${string}` | `turns:${string}`

export interface IceServer {
    urls: IceUrl | ReadonlyArray<IceUrl>
    username?: string
    credential?: string
}

export interface WebRTCConfig {
    iceServers: ReadonlyArray<IceServer>
}

export interface AppInfo {
    id: string
    auth_token: string
}

export interface StoragePath {
    path: string
    threshold: number
}

export interface AppConfig {
    signaling_servers: ReadonlyArray<HttpUrl>
    webrtc: WebRTCConfig
    info: AppInfo
    paths: Array<StoragePath>
}

export interface FileSystemInfo {
    path: string
    filesystem: string
    mount: string
    availableSpace: number
}

export interface FragmentHash {
    fragment_id: string
    hash?: string
}

export interface SystemInfo {
    cpu_usage: number
    ram_available: number
    space_available: number
    filesystem_usage: FileSystemInfo[]
}

export interface FileHash {
    path: string
    hash: string
}