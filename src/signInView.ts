import * as vscode from 'vscode';
import { authenticate } from './auth';
import { ConfigurationManager } from './utils';

export class SignInWebviewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'neonLocal.signIn';
    private _view?: vscode.WebviewView;

    constructor(
        private readonly _extensionUri: vscode.Uri,
    ) {}

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };

        webviewView.webview.html = this._getHtmlForWebview();

        webviewView.webview.onDidReceiveMessage(async (message) => {
            switch (message.command) {
                case 'signIn':
                    try {
                        // Show loading state
                        webviewView.webview.postMessage({ command: 'showLoading' });
                        
                        // Attempt authentication
                        await authenticate();
                        
                        // Show success message briefly
                        webviewView.webview.postMessage({ command: 'signInSuccess' });
                        
                        // Wait a moment to show the success message
                        await new Promise(resolve => setTimeout(resolve, 1000));
                        
                        // Force a configuration change event to update the connect view
                        const config = vscode.workspace.getConfiguration('neonLocal');
                        const currentApiKey = config.get('apiKey');
                        
                        // Ensure the API key is set before proceeding
                        if (!currentApiKey) {
                            throw new Error('Failed to get API key after authentication');
                        }
                        
                        // Hide the sign-in view
                        if (this._view) {
                            await vscode.commands.executeCommand('workbench.view.extension.neonLocal.collapse');
                        }
                        
                        // Show the connect view and force a refresh
                        await vscode.commands.executeCommand('neonLocalConnect.focus');
                        
                        // Wait a moment for the connect view to be ready
                        await new Promise(resolve => setTimeout(resolve, 500));
                        
                        // Force a refresh of all views
                        await vscode.commands.executeCommand('neonLocal.refresh');
                        
                    } catch (error) {
                        console.error('Sign in error:', error);
                        webviewView.webview.postMessage({ 
                            command: 'showError',
                            text: error instanceof Error ? error.message : 'Unknown error'
                        });
                        vscode.window.showErrorMessage(`Failed to sign in: ${error instanceof Error ? error.message : 'Unknown error'}`);
                    }
                    break;
            }
        });
    }

    private _getHtmlForWebview() {
        return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline' 'unsafe-eval'; frame-src 'self';">
            <title>Sign In to Neon</title>
            <style>
                body {
                    padding: 20px;
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    min-height: 200px;
                    font-family: var(--vscode-font-family);
                    background-color: var(--vscode-editor-background);
                    color: var(--vscode-editor-foreground);
                }
                .container {
                    text-align: center;
                }
                .sign-in-button {
                    background-color: var(--vscode-button-background);
                    color: var(--vscode-button-foreground);
                    border: none;
                    padding: 8px 16px;
                    cursor: pointer;
                    border-radius: 4px;
                    font-size: 14px;
                    margin-top: 20px;
                }
                .sign-in-button:hover {
                    background-color: var(--vscode-button-hoverBackground);
                }
                .description {
                    margin-bottom: 20px;
                    color: var(--vscode-descriptionForeground);
                }
                .success-message {
                    color: var(--vscode-notificationsSuccessIcon-foreground, #89D185);
                    font-weight: bold;
                    margin-top: 20px;
                }
                .error-message {
                    color: var(--vscode-errorForeground);
                    margin-top: 20px;
                    display: none;
                }
                .spinner {
                    display: none;
                    width: 24px;
                    height: 24px;
                    margin: 20px auto;
                    border: 3px solid var(--vscode-button-background);
                    border-top: 3px solid var(--vscode-button-hoverBackground);
                    border-radius: 50%;
                    animation: spin 1s linear infinite;
                }
                @keyframes spin {
                    0% { transform: rotate(0deg); }
                    100% { transform: rotate(360deg); }
                }
            </style>
        </head>
        <body>
            <div class="container">
                <p class="description">Sign in to connect to your Neon database.</p>
                <button class="sign-in-button" id="signInButton">Sign in to Neon</button>
                <div class="spinner" id="spinner"></div>
                <div class="error-message" id="errorMessage"></div>
            </div>
            <script>
                if (!window.vscodeApi) {
                    window.vscodeApi = acquireVsCodeApi();
                }
                const vscode = window.vscodeApi;
                const container = document.querySelector('.container');
                const button = document.getElementById('signInButton');
                const spinner = document.getElementById('spinner');
                const errorMessage = document.getElementById('errorMessage');

                button.addEventListener('click', () => {
                    button.style.display = 'none';
                    spinner.style.display = 'block';
                    errorMessage.style.display = 'none';
                    vscode.postMessage({ command: 'signIn' });
                });

                window.addEventListener('message', event => {
                    const message = event.data;
                    switch (message.command) {
                        case 'showLoading':
                            button.style.display = 'none';
                            spinner.style.display = 'block';
                            errorMessage.style.display = 'none';
                            break;
                        case 'signInSuccess':
                            spinner.style.display = 'none';
                            container.innerHTML = '<p class="success-message">Successfully signed in!</p>';
                            break;
                        case 'showError':
                            button.style.display = 'block';
                            spinner.style.display = 'none';
                            errorMessage.textContent = message.text;
                            errorMessage.style.display = 'block';
                            break;
                    }
                });
            </script>
        </body>
        </html>`;
    }
} 