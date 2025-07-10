import * as vscode from 'vscode';
import { VIEW_TYPES } from './constants';
import { NeonLocalManager, ViewData, WebviewMessage } from './types';
import { WebViewService } from './services/webview.service';
import { StateService } from './services/state.service';
import { ConfigurationManager } from './utils';
import { SignInView } from './views/SignInView';
import { AuthManager } from './auth/authManager';

export class DatabaseViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = VIEW_TYPES.DATABASE;
    private _view?: vscode.WebviewView;
    private _lastUpdateData?: ViewData;
    private _isUpdating = false;
    private readonly _extensionUri: vscode.Uri;
    private readonly _webviewService: WebViewService;
    private readonly _stateService: StateService;
    private readonly _extensionContext: vscode.ExtensionContext;
    private _signInView?: SignInView;
    private readonly _authManager: AuthManager;

    constructor(
        extensionUri: vscode.Uri,
        webviewService: WebViewService,
        stateService: StateService,
        extensionContext: vscode.ExtensionContext
    ) {
        this._extensionUri = extensionUri;
        this._webviewService = webviewService;
        this._stateService = stateService;
        this._extensionContext = extensionContext;
        this._authManager = AuthManager.getInstance(extensionContext);

        // Listen for authentication state changes
        this._authManager.onDidChangeAuthentication(async (isAuthenticated) => {
            console.log('DatabaseViewProvider: Authentication state changed', { isAuthenticated });
            if (isAuthenticated) {
                // When signing in, ensure we update the view with fresh data
                if (this._view) {
                    this._view.webview.html = this.getWebviewContent(this._view.webview);
                    const data = await this._stateService.getViewData();
                    await this._webviewService.updateWebview(this._view, data);
                }
            } else {
                await this.updateView();
            }
        });
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ): void {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                this._extensionUri
            ]
        };

        webviewView.webview.html = this.getWebviewContent(webviewView.webview);

        // Set up message handler
        webviewView.webview.onDidReceiveMessage(async (message: WebviewMessage) => {
            await this.handleWebviewMessage(message);
        });

        // Create sign-in view
        this._signInView = new SignInView(webviewView.webview, this._stateService, this._authManager);

        // Handle visibility changes
        webviewView.onDidChangeVisibility(() => {
            if (webviewView.visible) {
                // Force update when becoming visible
                this._lastUpdateData = undefined;
                this.updateView().catch(error => {
                    console.error('Error updating database view on visibility change:', error);
                });
            }
        });

        // Register this view with the manager
        const viewId = this._webviewService.registerWebview(webviewView.webview, 'databaseView');
        console.log(`DatabaseViewProvider: Registered webview with ID: ${viewId}`);

        // Initial update with a small delay to ensure proper registration
        setTimeout(async () => {
            try {
                // Use AuthManager to check authentication state consistently
                const isAuthenticated = await this._authManager.isAuthenticatedAsync();
                console.log('DatabaseViewProvider: Authentication state check', { isAuthenticated });

                if (!isAuthenticated) {
                    console.log('DatabaseViewProvider: Not authenticated, showing sign-in message');
                    if (this._view && this._signInView) {
                        this._view.webview.html = this._signInView.getHtml("Sign in to Neon in the Connect view", false);
                    }
                    return;
                }

                // User is authenticated (either via OAuth or persistent API key), show database view
                console.log('DatabaseViewProvider: User is authenticated, showing database view');
                if (this._view) {
                    this._view.webview.html = this.getWebviewContent(this._view.webview);
                    const data = await this._stateService.getViewData();
                    await this._webviewService.updateWebview(this._view, data);
                }
            } catch (error) {
                console.error('Error in initial database view update:', error);
                if (error instanceof Error) {
                    vscode.window.showErrorMessage(`Database view initialization error: ${error.message}`);
                }
            }
        }, 100);
    }

    private async handleWebviewMessage(message: WebviewMessage): Promise<void> {
        if (!this._view) return;

        try {
            switch (message.command) {
                case 'selectDatabase':
                    await this._webviewService.handleDatabaseSelection(message.database);
                    await this.updateView();
                    break;
                case 'selectRole':
                    await this._webviewService.handleRoleSelection(message.role);
                    await this.updateView();
                    break;
            }
        } catch (error) {
            if (error instanceof Error) {
                vscode.window.showErrorMessage(error.message);
            }
        }
    }

    private getWebviewContent(webview: vscode.Webview): string {
        const scriptUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'dist', 'webview.js')
        );

        const styleUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'dist', 'styles.css')
        );

        const nonce = getNonce();

        return `<!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}' 'unsafe-eval'; img-src ${webview.cspSource} data: https:; font-src ${webview.cspSource}; connect-src 'self';">
                <link href="${styleUri}" rel="stylesheet" />
                <title>Neon Local Connect Database</title>
            </head>
            <body data-view-type="${VIEW_TYPES.DATABASE}">
                <div id="root"></div>
                <script nonce="${nonce}" src="${scriptUri}"></script>
            </body>
            </html>`;
    }

    public async updateView(): Promise<void> {
        if (!this._view || this._isUpdating) {
            return;
        }

        this._isUpdating = true;

        try {
            const persistentApiToken = await this._authManager.getPersistentApiToken();
            const apiKey = await ConfigurationManager.getSecureToken(this._extensionContext, 'apiKey');
            const refreshToken = await ConfigurationManager.getSecureToken(this._extensionContext, 'refreshToken');
            
            console.log('DatabaseViewProvider: Checking tokens for update', { 
                hasPersistentApiToken: !!persistentApiToken,
                hasApiKey: !!apiKey, 
                hasRefreshToken: !!refreshToken
            });

            // If no valid tokens, show sign-in message
            if (!persistentApiToken && !apiKey && !refreshToken) {
                console.log('DatabaseViewProvider: No tokens found, showing sign-in message');
                if (this._signInView) {
                    this._view.webview.html = this._signInView.getHtml("Sign in to Neon in the Connect view", false);
                }
                this._isUpdating = false;
                return;
            }

            // If we're transitioning from sign-in to database view, update the HTML
            if (this._view.webview.html.includes('sign-in-message')) {
                this._view.webview.html = this.getWebviewContent(this._view.webview);
            }

            const data = await this._stateService.getViewData();
            await this._webviewService.updateWebview(this._view, data);
        } catch (error) {
            console.error('Error updating database view:', error);
            if (error instanceof Error) {
                vscode.window.showErrorMessage(`Database view update error: ${error.message}`);
            }
        } finally {
            this._isUpdating = false;
        }
    }

    public dispose(): void {
        // Note: Configuration change listener removed since we now use SecretStorage
        // The authentication state change listener handles all token-related updates
    }
}

function getNonce() {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
} 