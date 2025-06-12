import * as vscode from 'vscode';
import { CONFIG } from './constants';
import type { NeonConfiguration } from './types';

export class ConfigurationManager {
    private static getConfig(): vscode.WorkspaceConfiguration {
        return vscode.workspace.getConfiguration(CONFIG.EXTENSION_NAME);
    }

    static async updateConfig<K extends keyof NeonConfiguration>(
        key: K,
        value: NeonConfiguration[K],
        global = true
    ): Promise<void> {
        const config = this.getConfig();
        await config.update(key, value, global);
    }

    static getConfigValue<K extends keyof NeonConfiguration>(key: K): NeonConfiguration[K] {
        const config = this.getConfig();
        return config.get<NeonConfiguration[K]>(key);
    }

    static async clearAuth(): Promise<void> {
        await this.updateConfig('apiKey', undefined);
        await this.updateConfig('refreshToken', undefined);
        await this.updateConfig('persistentApiToken', undefined);
    }
}

export function debounce<T extends (...args: any[]) => void>(
    func: T,
    wait: number
): (...args: Parameters<T>) => void {
    let timeout: NodeJS.Timeout | undefined;
    
    return function executedFunction(...args: Parameters<T>) {
        if (timeout) {
            clearTimeout(timeout);
        }
        
        timeout = setTimeout(() => {
            func(...args);
        }, wait);
    };
}

export class Logger {
    static error(message: string, error?: unknown): void {
        console.error(message, error);
        if (error instanceof Error) {
            vscode.window.showErrorMessage(`${message}: ${error.message}`);
        } else {
            vscode.window.showErrorMessage(message);
        }
    }

    static info(message: string): void {
        console.log(message);
        vscode.window.showInformationMessage(message);
    }
} 