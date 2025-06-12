import * as vscode from 'vscode';
import { VIEW_TYPES } from './constants';
import { NeonLocalManager, ViewData, WebviewMessage } from './types';
import { WebViewService } from './services/webview.service';
import { StateService } from './services/state.service';
import { ConfigurationManager } from './utils';
import { SignInView } from './views/SignInView';

export class DatabaseViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = VIEW_TYPES.DATABASE;
    private _view?: vscode.WebviewView;
    private _lastUpdateData?: ViewData;
    private _configurationChangeListener: vscode.Disposable;
    private _isUpdating = false;
    private readonly _extensionUri: vscode.Uri;
    private readonly _webviewService: WebViewService;
    private readonly _stateService: StateService;
    private _signInView?: SignInView;

    constructor(
        extensionUri: vscode.Uri,
        webviewService: WebViewService,
        stateService: StateService
    ) {
        this._extensionUri = extensionUri;
        this._webviewService = webviewService;
        this._stateService = stateService;
        this._configurationChangeListener = vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('neonLocal.refreshToken') || 
                e.affectsConfiguration('neonLocal.apiKey') ||
                e.affectsConfiguration('neonLocal.persistentApiToken')) {
                this.updateView();
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
            localResourceRoots: [this._extensionUri]
        };

        // Initialize SignInView
        this._signInView = new SignInView(webviewView.webview, this._stateService);

        // Set up message handler first
        webviewView.webview.onDidReceiveMessage(this.handleWebviewMessage.bind(this));
        
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
        this._webviewService.registerWebview(webviewView.webview);

        // Initial update with a small delay to ensure proper registration
        setTimeout(async () => {
            try {
                const persistentApiToken = ConfigurationManager.getConfigValue('persistentApiToken');
                const apiKey = ConfigurationManager.getConfigValue('apiKey');
                const refreshToken = ConfigurationManager.getConfigValue('refreshToken');
                
                console.log('DatabaseViewProvider: Checked tokens', { 
                    hasPersistentApiToken: !!persistentApiToken,
                    hasApiKey: !!apiKey, 
                    hasRefreshToken: !!refreshToken
                });

                // If persistent token exists, we can proceed
                if (persistentApiToken) {
                    console.log('DatabaseViewProvider: Using persistent API token');
                    if (this._view) {
                        this._view.webview.html = this.getWebviewContent(this._view.webview);
                    }
                    await this._stateService.setPersistentApiToken(persistentApiToken);
                    await this.updateView();
                    return;
                }

                // Otherwise, check for OAuth tokens
                if (!apiKey && !refreshToken) {
                    console.log('DatabaseViewProvider: No tokens found, showing sign-in message');
                    if (this._view && this._signInView) {
                        this._view.webview.html = this._signInView.getHtml("Sign in to Neon in the Connect view", false);
                    }
                    return;
                }

                // If we have OAuth tokens, show database view and initialize
                if (this._view) {
                    this._view.webview.html = this.getWebviewContent(this._view.webview);
                }
                await this.updateView();
            } catch (error) {
                console.error('DatabaseViewProvider: Error during initial setup', error);
                if (this._view && this._signInView) {
                    this._view.webview.html = this._signInView.getHtml("Sign in to Neon in the Connect view", false);
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
                <title>Neon Local Database</title>
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
            const persistentApiToken = ConfigurationManager.getConfigValue('persistentApiToken');
            const apiKey = ConfigurationManager.getConfigValue('apiKey');
            const refreshToken = ConfigurationManager.getConfigValue('refreshToken');
            
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

            const data = await this._webviewService.getViewData();
            
            // Always update on any connection state changes
            const needsUpdate = !this._lastUpdateData || 
                this._lastUpdateData.connected !== data.connected ||
                this._lastUpdateData.connectionInfo !== data.connectionInfo ||
                this._lastUpdateData.selectedDatabase !== data.selectedDatabase ||
                this._lastUpdateData.selectedRole !== data.selectedRole ||
                this._lastUpdateData.currentlyConnectedBranch !== data.currentlyConnectedBranch ||
                JSON.stringify(this._lastUpdateData.databases) !== JSON.stringify(data.databases) ||
                JSON.stringify(this._lastUpdateData.roles) !== JSON.stringify(data.roles);

            if (needsUpdate) {
                console.log('DatabaseView: Updating view with new data:', {
                    connected: data.connected,
                    databasesCount: data.databases?.length,
                    rolesCount: data.roles?.length,
                    selectedDatabase: data.selectedDatabase,
                    selectedRole: data.selectedRole,
                    isStarting: data.isStarting,
                    connectionInfo: data.connectionInfo,
                    currentlyConnectedBranch: data.currentlyConnectedBranch
                });

                // Store the last update data before sending
                this._lastUpdateData = {...data};

                // Send data via postMessage
                await this._view.webview.postMessage({
                    command: 'updateViewData',
                    data: data
                });
            }
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
        this._configurationChangeListener.dispose();
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