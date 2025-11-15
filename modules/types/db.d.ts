/** Table: download_permission */
export interface DownloadPermission {
  id: string;
  resource_id: string;
  expiry_date?: Date;
  status?: string;
  created_at?: Date;
}

/** Table: fragment */
export interface Fragment {
  id: string;
  track_id: string;
  hash?: string;
  nodes?: number;
  updated_at?: Date;
  status?: string;
  size?: number;                // bigint
  file_name?: string;
  pending_replica_increment?: number;
  pending_replica_increment_at?: Date;
  is_split: boolean;                  // NOT NULL DEFAULT false
}

/** Table: fragment_part */
export interface FragmentPart {
  id: string;
  fragment_id: string;
  hash: string | null;
  part_index: number;
  byte_start: number;                 // bigint
  byte_end: number;                   // bigint
  updated_at: Date | null;
  nodes: number;                      // NOT NULL DEFAULT 0
}

/** Table: media */
export interface Media {
  id: string;
  title: string;
  duration: number | null;
  resolution: string | null;
  created_at: Date | null;
  updated_at: Date | null;
  status: string | null;
}

/** Table: media_track */
export interface MediaTrack {
  id: string;
  media_id: string;
  type: string | null;
  language: string | null;
  total_fragments: number | null;
  updated_at: Date | null;
  status: string | null;
}

/** Table: node */
export interface Node {
  id: string;
  ip?: string;
  auth_token?: string;
  health?: string;
  space_available?: number;     // bigint
  ram_available?: number;
  cpu_usage?: number;
  avg_download_speed?: number;
  avg_upload_speed?: number;
  total_fragments?: number;
  connection_id?: string;
  last_heartbeat?: Date;
  first_online_at?: Date;
  total_uptime_seconds?: number; // bigint
  last_offline_at?: Date;
}

/** Table: node_resource */
export interface NodeResource {
  id: string;
  fragment_id?: string;
  part_id?: string;
  node_id: string;
  key?: string;
  auth_tag?: string;
  nonce?: string;
  mac?: string;
  hash?: string;
  updated_at?: Date;
  status?: string;
  created_at: Date;
}

/** Table: node_resource_request */
export interface NodeResourceRequest {
  client_id: string;
  resource_id: string;
  start: Date | null;
  end: Date | null;
  avg_speed: number | null;
  status: string | null;
  error: string | null;
  updated_at: Date | null;
}

export interface Client {
  id: string;
  last_online: Date | null;
}

export interface ClientConnection {
  id: string;
  client_id: string;
  connection_id: string;
  ip: string | null;
}
