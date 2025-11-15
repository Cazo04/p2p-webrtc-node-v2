export interface ResourceHash {
    id: string;
    hash: string;
}

declare namespace Endpoints {
    export interface HashVerify {
        Body: {
            resources?: ResourceHash[];
            nodeId?: string;
        }
    }
    export interface HashVerifyResponse {
        deletedResources: string[];
    }
    export interface OfflineNode {
        Body: {
            id: string;
        }
    }
}