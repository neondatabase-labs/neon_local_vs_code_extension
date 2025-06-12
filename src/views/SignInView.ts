import * as vscode from 'vscode';
import { StateService } from '../services/state.service';
import { WebviewMessage } from '../types';
import { authenticate } from '../services/auth.service';
import { Logger } from '../utils';
import { NeonApiService } from '../services/api.service';
import { getStyles } from '../templates/styles';

export class SignInView {
    private readonly webview: vscode.Webview;
    private readonly stateService: StateService;
    
    constructor(webview: vscode.Webview, stateService: StateService) {
        this.webview = webview;
        this.stateService = stateService;
    }

    public getHtml(customMessage?: string, showSignInButton: boolean = true): string {
        return `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Neon Local</title>
            ${getStyles()}
            <style>
                .container {
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    padding: 20px;
                    text-align: center;
                }
                .error-message {
                    color: var(--vscode-errorForeground);
                    margin: 10px 0;
                    display: none;
                    text-align: center;
                }
                .spinner {
                    border: 2px solid var(--vscode-editor-foreground);
                    border-top: 2px solid transparent;
                    border-radius: 50%;
                    width: 16px;
                    height: 16px;
                    animation: spin 1s linear infinite;
                    margin: 10px auto;
                    display: none;
                }
                @keyframes spin {
                    0% { transform: rotate(0deg); }
                    100% { transform: rotate(360deg); }
                }
                .sign-in-message {
                    margin: 10px 0;
                    color: var(--vscode-foreground);
                    text-align: center;
                }
                .description {
                    text-align: center;
                }
                .sign-in-button {
                    margin: 10px auto;
                    display: block;
                }
            </style>
        </head>
        <body>
            <div class="container">
                ${customMessage ? `<p class="sign-in-message">${customMessage}</p>` : `<p class="description">Sign in to access your Neon projects and databases.</p>`}
                <div class="error-message" id="errorMessage"></div>
                ${showSignInButton ? `
                    <button class="sign-in-button" id="signInButton">Sign in to Neon</button>
                    <div class="spinner" id="spinner"></div>
                    <script>
                        const vscode = acquireVsCodeApi();
                        const signInButton = document.getElementById('signInButton');
                        const spinner = document.getElementById('spinner');
                        const errorMessage = document.getElementById('errorMessage');

                        signInButton.addEventListener('click', () => {
                            signInButton.disabled = true;
                            spinner.style.display = 'block';
                            errorMessage.style.display = 'none';
                            vscode.postMessage({ command: 'signIn' });
                        });

                        window.addEventListener('message', event => {
                            const message = event.data;
                            switch (message.command) {
                                case 'showLoading':
                                    signInButton.disabled = true;
                                    spinner.style.display = 'block';
                                    errorMessage.style.display = 'none';
                                    break;
                                case 'resetSignIn':
                                    signInButton.disabled = false;
                                    spinner.style.display = 'none';
                                    break;
                                case 'showError':
                                    signInButton.disabled = false;
                                    spinner.style.display = 'none';
                                    errorMessage.textContent = message.text;
                                    errorMessage.style.display = 'block';
                                    break;
                            }
                        });
                    </script>
                ` : ''}
            </div>
        </body>
        </html>`;
    }

    public async handleSignIn(): Promise<void> {
        try {
            // Show loading state
            this.webview.postMessage({ command: 'showLoading' });

            // Attempt authentication
            await authenticate();

            // Show success message briefly
            this.webview.postMessage({ command: 'signInSuccess' });

            // Wait a moment to show the success message
            await new Promise(resolve => setTimeout(resolve, 1000));

            // Update state service with authenticated state
            await this.stateService.updateState({
                connection: {
                    connected: false,
                    isStarting: false,
                    type: 'existing',
                    driver: 'postgres',
                    connectionInfo: '',
                    currentlyConnectedBranch: '',
                    connectedOrgId: '',
                    connectedOrgName: '',
                    connectedProjectId: '',
                    connectedProjectName: '',
                    selectedDatabase: '',
                    selectedRole: '',
                    databases: [],
                    roles: []
                },
                selection: {
                    orgs: [],
                    projects: [],
                    branches: [],
                    selectedOrgId: '',
                    selectedOrgName: '',
                    selectedProjectId: undefined,
                    selectedProjectName: undefined,
                    selectedBranchId: undefined,
                    selectedBranchName: undefined,
                    parentBranchId: undefined,
                    parentBranchName: undefined
                },
                loading: {
                    orgs: true,  // Set to true as we're about to load orgs
                    projects: false,
                    branches: false
                }
            });

            // Start loading organizations
            const apiService = new NeonApiService();

            // Fetch organizations
            const orgs = await apiService.getOrgs();
            await this.stateService.setOrganizations(orgs);
            
            // Update loading state after fetching orgs
            await this.stateService.updateLoadingState({
                orgs: false,
                projects: false,
                branches: false
            });

            // Ensure project and branch selections are cleared
            await this.stateService.setProjects([]);
            await this.stateService.setBranches([]);

        } catch (error) {
            Logger.error('Error during sign in:', error);
            this.webview.postMessage({ 
                command: 'showError',
                text: error instanceof Error ? error.message : 'Unknown error'
            });
            if (error instanceof Error) {
                vscode.window.showErrorMessage(`Sign in error: ${error.message}`);
            }
        }
    }

    public handleMessage(message: WebviewMessage): void {
        switch (message.command) {
            case 'showLoading':
            case 'resetSignIn':
            case 'showError':
                this.webview.postMessage(message);
                break;
        }
    }
} 