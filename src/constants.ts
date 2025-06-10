export const DEBOUNCE_DELAY = 100; // ms
export const VIEW_RETRY_DELAY = 500; // ms
export const SUCCESS_MESSAGE_DELAY = 1500; // ms

export const CONFIG = {
    EXTENSION_NAME: 'neonLocal',
    SETTINGS: {
        API_KEY: 'apiKey',
        REFRESH_TOKEN: 'refreshToken',
        PROJECT_ID: 'projectId',
        DRIVER: 'driver',
        DELETE_ON_STOP: 'deleteOnStop',
        CONNECTION_TYPE: 'connectionType',
        PERSISTENT_API_TOKEN: 'persistentApiToken'
    }
} as const;

export const DOCKER = {
    PROXY_PORT: 5432
} as const;

export const VIEW_TYPES = {
    CONNECT: 'neonLocalConnect',
    DATABASE: 'neonLocalDatabase',
    ACTIONS: 'neonLocalActions',
    SIGN_IN: 'neonLocal.signIn'
} as const; 