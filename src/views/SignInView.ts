import * as vscode from 'vscode';
import { StateService } from '../services/state.service';
import { WebviewMessage } from '../types';
import { AuthManager } from '../auth/authManager';
import { Logger } from '../utils';
import { NeonApiService } from '../services/api.service';
import { getStyles } from '../templates/styles';

export class SignInView {
    private readonly webview: vscode.Webview;
    private readonly stateService: StateService;
    private readonly authManager: AuthManager;
    
    constructor(webview: vscode.Webview, stateService: StateService, authManager: AuthManager) {
        this.webview = webview;
        this.stateService = stateService;
        this.authManager = authManager;
    }

    public getHtml(message?: string, showSignInButton: boolean = true): string {
        return `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Neon Local - Sign In</title>
                ${getStyles()}
            </head>
            <body>
                <div class="container">
                    ${message ? `<div class="message">${message}</div>` : ''}
                    ${showSignInButton ? `
                        <div class="button-container">
                            <button class="button" id="signInButton">Sign in with Neon</button>
                            <button class="button secondary" id="importTokenButton">Import API Key</button>
                        </div>
                    ` : ''}
                </div>
                <script>
                    const vscode = acquireVsCodeApi();
                    
                    document.getElementById('signInButton')?.addEventListener('click', () => {
                        vscode.postMessage({ command: 'signIn' });
                    });
                    
                    document.getElementById('importTokenButton')?.addEventListener('click', () => {
                        vscode.postMessage({ command: 'importToken' });
                    });
                </script>
            </body>
            </html>
        `;
    }

    public async handleSignIn(): Promise<void> {
        try {
            await this.authManager.signIn();
        } catch (error) {
            Logger.error('Sign in failed:', error);
            throw error;
        }
    }

    public handleMessage(message: WebviewMessage): void {
        switch (message.command) {
            case 'showLoading':
                this.webview.html = this.getHtml('Signing in...', false);
                break;
            case 'resetSignIn':
                this.webview.html = this.getHtml();
                break;
            case 'showError':
                this.webview.html = this.getHtml(`Error: ${message.error}`, true);
                break;
        }
    }
} 