import { OutgoingHttpHeaders } from 'http';

export interface NodeHttpHeader extends OutgoingHttpHeaders {
    "Node-Id": string;
    "Node-Token": string;
}

declare namespace Endpoints {
    export interface CreateEncryptReplicaRequest {
        Body: string[];
    }
    export interface DownloadEncryptedReplicaRequest {
        Params: {
            id: string;
        };
        Headers: NodeHttpHeader;
    }
    export interface DownloadResourcesRequest {
        Params: {
            mixed_id: string;
        };
        Headers: NodeHttpHeader;
    }
    export interface RequestAlternativeNodeRequest {
        Params: {
            fragment_id: string;
        };
        Body: {
            failed_nodes: string[]; // Array of connection_ids that failed
        };
    }
}

export interface ReplicaFragmentInfo extends DecryptInfo {
    id: string;
    node_id: string;
}

export interface DecryptInfo {
    hash: string;
    key: string;
    nonce: string;
    auth_tag: string;
}