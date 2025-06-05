import * as vscode from 'vscode';

export class ConfigService {
    constructor(private context: vscode.ExtensionContext) {}

    async getConfig<T>(key: string): Promise<T | undefined> {
        return this.context.globalState.get<T>(key);
    }

    async setConfig<T>(key: string, value: T): Promise<void> {
        await this.context.globalState.update(key, value);
    }

    async clearConfig(key: string): Promise<void> {
        await this.context.globalState.update(key, undefined);
    }
} 