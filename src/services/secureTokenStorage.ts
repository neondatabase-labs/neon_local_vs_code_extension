import * as vscode from 'vscode';

export class SecureTokenStorage {
    private static instance: SecureTokenStorage;
    private context: vscode.ExtensionContext;

    private constructor(context: vscode.ExtensionContext) {
        this.context = context;
    }

    static getInstance(context: vscode.ExtensionContext): SecureTokenStorage {
        if (!SecureTokenStorage.instance) {
            SecureTokenStorage.instance = new SecureTokenStorage(context);
        }
        return SecureTokenStorage.instance;
    }

    // Store OAuth access token
    async storeAccessToken(token: string): Promise<void> {
        await this.context.secrets.store('neon.accessToken', token);
    }

    // Retrieve OAuth access token
    async getAccessToken(): Promise<string | undefined> {
        return await this.context.secrets.get('neon.accessToken');
    }

    // Store OAuth refresh token
    async storeRefreshToken(token: string): Promise<void> {
        await this.context.secrets.store('neon.refreshToken', token);
    }

    // Retrieve OAuth refresh token
    async getRefreshToken(): Promise<string | undefined> {
        return await this.context.secrets.get('neon.refreshToken');
    }

    // Store persistent API token
    async storePersistentApiToken(token: string): Promise<void> {
        await this.context.secrets.store('neon.persistentApiToken', token);
    }

    // Retrieve persistent API token
    async getPersistentApiToken(): Promise<string | undefined> {
        return await this.context.secrets.get('neon.persistentApiToken');
    }

    // Clear all tokens
    async clearAllTokens(): Promise<void> {
        await this.context.secrets.delete('neon.accessToken');
        await this.context.secrets.delete('neon.refreshToken');
        await this.context.secrets.delete('neon.persistentApiToken');
    }

    // Check if any token exists
    async hasAnyToken(): Promise<boolean> {
        const accessToken = await this.getAccessToken();
        const refreshToken = await this.getRefreshToken();
        const persistentToken = await this.getPersistentApiToken();
        
        return !!(accessToken || refreshToken || persistentToken);
    }

    // Migration helper: migrate from config to secrets
    async migrateFromConfig(): Promise<void> {
        const config = vscode.workspace.getConfiguration('neonLocal');
        let migrationPerformed = false;
        
        // Migrate access token
        const accessToken = config.get<string>('apiKey');
        if (accessToken) {
            console.log('SecureTokenStorage: Migrating access token from config to secure storage');
            await this.storeAccessToken(accessToken);
            await config.update('apiKey', undefined, true);
            migrationPerformed = true;
        }

        // Migrate refresh token
        const refreshToken = config.get<string>('refreshToken');
        if (refreshToken) {
            console.log('SecureTokenStorage: Migrating refresh token from config to secure storage');
            await this.storeRefreshToken(refreshToken);
            await config.update('refreshToken', undefined, true);
            migrationPerformed = true;
        }

        // Migrate persistent API token
        const persistentToken = config.get<string>('persistentApiToken');
        if (persistentToken) {
            console.log('SecureTokenStorage: Migrating persistent API token from config to secure storage');
            await this.storePersistentApiToken(persistentToken);
            await config.update('persistentApiToken', undefined, true);
            migrationPerformed = true;
        }

        if (migrationPerformed) {
            console.log('SecureTokenStorage: Token migration completed successfully');
        } else {
            console.log('SecureTokenStorage: No tokens found in config to migrate');
        }
    }
} 