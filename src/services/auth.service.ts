import * as vscode from 'vscode';
import { ConfigService } from './config.service';

export class AuthService {
    private readonly API_KEY_CONFIG_KEY = 'neonLocal.apiKey';

    constructor(
        private context: vscode.ExtensionContext,
        private configService: ConfigService
    ) {}

    async getApiKey(): Promise<string | undefined> {
        return this.configService.getConfig<string>(this.API_KEY_CONFIG_KEY);
    }

    async setApiKey(apiKey: string): Promise<void> {
        await this.configService.setConfig(this.API_KEY_CONFIG_KEY, apiKey);
    }

    async clearApiKey(): Promise<void> {
        await this.configService.clearConfig(this.API_KEY_CONFIG_KEY);
    }

    async isAuthenticated(): Promise<boolean> {
        const apiKey = await this.getApiKey();
        return !!apiKey;
    }
} 