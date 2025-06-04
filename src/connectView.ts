import * as vscode from 'vscode';
import { authenticate } from './auth';
import { ConfigurationManager, Logger } from './utils';
import { DEBOUNCE_DELAY, VIEW_TYPES } from './constants';
import { ViewData, WebviewMessage, NeonLocalManager } from './types';
import { getStyles } from './templates/styles';
import { getSignInHtml } from './templates/signIn';
import * as path from 'path';

export class ConnectViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = VIEW_TYPES.CONNECT;
    private _view?: vscode.WebviewView;
    private _configurationChangeListener: vscode.Disposable;
    private _updateViewTimeout?: NodeJS.Timeout;
    private _isUpdating = false;
    private _lastRequestedConnectionType?: 'existing' | 'new';
    private _connectionTypeUpdateTimeout?: NodeJS.Timeout;

    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly _neonLocal: NeonLocalManager
    ) {
        this._configurationChangeListener = vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('neonLocal.refreshToken') || e.affectsConfiguration('neonLocal.apiKey')) {
                this.debouncedUpdateView();
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

        // Initialize view with empty state
        webviewView.webview.html = this.getWebviewContent(webviewView.webview);

        // Register the webview with the manager
        this._neonLocal.setWebviewView(webviewView);

        // Set up message handlers
        webviewView.webview.onDidReceiveMessage(this.handleWebviewMessage.bind(this));
        webviewView.onDidChangeVisibility(() => {
            if (webviewView.visible) {
                this.debouncedUpdateView();
            }
        });
    }

    private debouncedUpdateView = () => {
        if (this._updateViewTimeout) {
            clearTimeout(this._updateViewTimeout);
        }
        this._updateViewTimeout = setTimeout(() => {
            this.updateView();
        }, DEBOUNCE_DELAY);
    };

    private async handleWebviewMessage(message: WebviewMessage): Promise<void> {
        if (!this._view) return;

        try {
            switch (message.command) {
                case 'signIn':
                    await this.handleSignIn();
                    break;
                case 'selectOrg':
                    await this._neonLocal.handleOrgSelection(message.orgId);
                    break;
                case 'selectProject':
                    await this._neonLocal.handleProjectSelection(message.projectId);
                    break;
                case 'selectBranch':
                    await this._neonLocal.handleBranchSelection(message.branchId, message.restartProxy, message.driver);
                    break;
                case 'startProxy':
                    await this._neonLocal.handleStartProxy(
                        message.driver,
                        message.isExisting,
                        message.branchId,
                        message.parentBranchId
                    );
                    await this.updateView();
                    break;
                case 'stopProxy':
                    await this._neonLocal.handleStopProxy();
                    await this.updateView();
                    break;
                case 'updateConnectionType':
                    console.log('ConnectViewProvider: Handling connection type update:', {
                        newType: message.connectionType,
                        currentType: this._lastRequestedConnectionType
                    });
                    // Store the requested connection type
                    this._lastRequestedConnectionType = message.connectionType;
                    // Update the connection type through the state service
                    await this._neonLocal.stateService.setConnectionType(message.connectionType);
                    // Update the view to reflect the change
                    await this.updateView();
                    break;
                case 'requestInitialData':
                    await this.updateView();
                    break;
            }
        } catch (error) {
            Logger.error('Error handling webview message', error);
            if (error instanceof Error) {
                vscode.window.showErrorMessage(error.message);
            }
        }
    }

    public dispose(): void {
        if (this._updateViewTimeout) {
            clearTimeout(this._updateViewTimeout);
        }
        if (this._connectionTypeUpdateTimeout) {
            clearTimeout(this._connectionTypeUpdateTimeout);
        }
        this._configurationChangeListener.dispose();
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
                <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}' 'unsafe-eval'; img-src ${webview.cspSource} data: https:; font-src ${webview.cspSource}; frame-src 'self';">
                <link href="${styleUri}" rel="stylesheet" />
                <title>Neon Local</title>
            </head>
            <body>
                <div id="root"></div>
                <script nonce="${nonce}">
                    window.vscodeApi = acquireVsCodeApi();
                </script>
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
            const apiKey = ConfigurationManager.getConfigValue('apiKey');
            const refreshToken = ConfigurationManager.getConfigValue('refreshToken');

            if (!apiKey && !refreshToken) {
                this._view.webview.html = getSignInHtml();
                this._isUpdating = false;
                return;
            }

            // Get the current view data
            const viewData = await this._neonLocal.getViewData();

            // If we have a pending connection type change, ensure it's respected
            if (this._lastRequestedConnectionType && viewData.connectionType !== this._lastRequestedConnectionType) {
                console.log('ConnectViewProvider: Connection type mismatch, correcting:', {
                    requested: this._lastRequestedConnectionType,
                    received: viewData.connectionType
                });
                viewData.connectionType = this._lastRequestedConnectionType;
                viewData.isExplicitUpdate = true;
            }

            // Log the complete view data being sent to the webview
            console.log('ConnectViewProvider: Updating view with data:', {
                orgsCount: viewData.orgs?.length,
                selectedOrgId: viewData.selectedOrgId,
                selectedOrgName: viewData.selectedOrgName,
                selectedProjectId: viewData.selectedProjectId,
                selectedProjectName: viewData.selectedProjectName,
                selectedBranchId: viewData.selectedBranchId,
                selectedBranchName: viewData.selectedBranchName,
                currentlyConnectedBranch: viewData.currentlyConnectedBranch,
                parentBranchId: viewData.parentBranchId,
                parentBranchName: viewData.parentBranchName,
                connectionType: viewData.connectionType,
                lastRequestedType: this._lastRequestedConnectionType,
                connected: viewData.connected,
                isStarting: viewData.isStarting,
                isExplicitUpdate: viewData.isExplicitUpdate
            });

            // Update the HTML first
            this._view.webview.html = this.getWebviewContent(this._view.webview);

            // Wait a moment for the webview to be ready
            await new Promise(resolve => setTimeout(resolve, 50));

            // Send the complete view data update
            await this._view.webview.postMessage({
                command: 'updateViewData',
                data: viewData
            });

            // Log what was actually sent
            console.log('ConnectViewProvider: Sent view data update with branch info:', {
                selectedBranchId: viewData.selectedBranchId,
                selectedBranchName: viewData.selectedBranchName,
                currentlyConnectedBranch: viewData.currentlyConnectedBranch,
                connectionType: viewData.connectionType,
                connected: viewData.connected
            });
        } catch (error) {
            Logger.error('Error updating view', error);
            if (error instanceof Error) {
                vscode.window.showErrorMessage(error.message);
            }
        } finally {
            this._isUpdating = false;
        }
    }

    private async handleSignIn(): Promise<void> {
        try {
            await authenticate();
            await this.updateView();
        } catch (error) {
            Logger.error('Error during sign in', error);
            if (error instanceof Error) {
                vscode.window.showErrorMessage(error.message);
            }
        }
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