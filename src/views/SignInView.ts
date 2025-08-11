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
                <title>Neon Local Connect - Sign In</title>
                ${getStyles()}
                <style>
                    .message {
                        text-align: center;
                        margin-bottom: 8px;
                    }
                    
                    .token-requirement {
                        padding: 16px;
                        margin: 16px 20px 20px 20px;
                        background-color: var(--vscode-editor-background);
                        border-radius: 4px;
                        border: 1px solid var(--vscode-widget-border);
                        position: absolute;
                        bottom: 0;
                        left: 0;
                        right: 0;
                    }

                    .token-requirement p {
                        margin: 0 0 16px 0;
                        font-size: 13px;
                        line-height: 1.4;
                        color: var(--vscode-foreground);
                    }

                    .token-actions {
                        display: flex;
                        gap: 8px;
                        flex-direction: column;
                    }

                    .token-button {
                        flex: 1;
                        padding: 8px;
                        background-color: var(--vscode-button-background);
                        color: var(--vscode-button-foreground);
                        border: none;
                        border-radius: 4px;
                        font-size: 13px;
                        cursor: pointer;
                        font-weight: 500;
                        text-align: center;
                        transition: background-color 0.2s;
                        margin: 0;
                    }

                    .token-button:hover:not(:disabled) {
                        background-color: var(--vscode-button-hoverBackground);
                    }
                    
                    .token-button.secondary {
                        background-color: var(--vscode-button-secondaryBackground);
                        color: var(--vscode-button-secondaryForeground);
                    }

                    .token-button.secondary:hover:not(:disabled) {
                        background-color: var(--vscode-button-secondaryHoverBackground);
                    }
                    
                    body {
                        margin: 0;
                        padding: 0;
                        height: 100vh;
                        position: relative;
                    }
                    
                    .main-content {
                        height: 100vh;
                        display: flex;
                        flex-direction: column;
                        position: relative;
                    }
                    
                    .container {
                        padding: 20px;
                        flex: 1;
                    }
                    
                    .button-container {
                        margin-bottom: 16px;
                    }
                </style>
            </head>
            <body>
                <div class="main-content">
                <div class="container">
                    ${message ? `<div class="message">${message}</div>` : ''}
                    ${showSignInButton ? `
                    <div class="button-container">
                        <button class="button" id="signInButton">Sign in with Neon</button>
                    </div>
                    ` : ''}
                </div>
                
                ${showSignInButton ? `
                <div class="token-requirement">
                    <p>Don't want to have to keep logging into the Extension? Import a Neon API key instead.</p>
                    <div class="token-actions">
                        <button class="token-button secondary" id="generateTokenButton">Create API Key</button>
                        <button class="token-button secondary" id="importTokenButton">Import API Key</button>
                    </div>
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
                    
                    document.getElementById('generateTokenButton')?.addEventListener('click', () => {
                        vscode.postMessage({ 
                            command: 'openNeonConsole',
                            path: '/app/settings#api-keys'
                        });
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