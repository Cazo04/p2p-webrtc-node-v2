export const CREATE_ENCRYPT_REPLICA = {
    path: '/local/replica/encrypt',
    method: 'POST'
}

export const REMIND_DOWNLOAD_PERMISSION_URLS = {
    path: '/local/permissions/remind/:node_id',
    method: 'POST'
}

export const DOWNLOAD_ENCRYPTED_REPLICA = {
    path: '/api/replica',
    public_path: '/request/replica',
    param: '/:id',
    method: 'GET'
}

export const DOWNLOAD_RESOURCES = {
    path: '/api/resources',
    param: '/:mixed_id',
    method: 'GET'
}

export const GET_RANKED_NODES = {
    path: '/api/nodes/ranking',
    method: 'GET'
}

export const REQUEST_ALTERNATIVE_NODE = {
    path: '/api/fallback',
    param: '/:fragment_id',
    method: 'POST'
}

export const GET_RANKING_CACHE_STATUS = {
    path: '/api/ranking/cache/status',
    method: 'GET'
}

export const FORCE_RANKING_CACHE_UPDATE = {
    path: '/api/ranking/cache/update',
    method: 'POST'
}