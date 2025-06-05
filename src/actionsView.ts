import * as vscode from 'vscode';
import { VIEW_TYPES } from './constants';
import { NeonLocalManager, ViewData, WebviewMessage } from './types';
import { WebViewService } from './services/webview.service';
import { StateService } from './services/state.service';

export class ActionsViewProvider implements vscode.WebviewViewProvider {
    private _view?: vscode.WebviewView;
    private _lastUpdateData?: ViewData;
    private readonly _extensionUri: vscode.Uri;
    private readonly _webviewService: WebViewService;
    private readonly _stateService: StateService;

    constructor(
        extensionUri: vscode.Uri,
        webviewService: WebViewService,
        stateService: StateService
    ) {
        this._extensionUri = extensionUri;
        this._webviewService = webviewService;
        this._stateService = stateService;
    }

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

        // Set up message handler first
        webviewView.webview.onDidReceiveMessage(this.handleWebviewMessage.bind(this));
        
        // Handle visibility changes
        webviewView.onDidChangeVisibility(() => {
            if (webviewView.visible) {
                // Force update when becoming visible
                this._lastUpdateData = undefined;
                this.updateView().catch(error => {
                    console.error('Error updating actions view on visibility change:', error);
                });
            }
        });

        // Initialize view with React app
        webviewView.webview.html = this.getWebviewContent(webviewView.webview);

        // Register this view with the manager
        this._webviewService.registerWebview(webviewView.webview);

        // Initial update with a small delay to ensure proper registration
        setTimeout(() => {
            this.updateView().catch(error => {
                console.error('Error during initial actions view update:', error);
            });
        }, 100);
    }

    private async handleWebviewMessage(message: WebviewMessage): Promise<void> {
        if (!this._view) return;

        try {
            switch (message.command) {
                case 'resetFromParent':
                    await vscode.commands.executeCommand('neon-local.resetFromParent');
                    break;
                case 'openSqlEditor':
                    await vscode.commands.executeCommand('neon-local.openSqlEditor');
                    break;
                case 'openTableView':
                    await vscode.commands.executeCommand('neon-local.openTableView');
                    break;
                case 'launchPsql':
                    await vscode.commands.executeCommand('neon-local.launchPsql');
                    break;
                case 'refresh':
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
                <title>Neon Local Actions</title>
            </head>
            <body data-view-type="${VIEW_TYPES.ACTIONS}">
                <div id="root"></div>
                <script nonce="${nonce}" src="${scriptUri}"></script>
            </body>
            </html>`;
    }

    public async updateView(): Promise<void> {
        if (!this._view) {
            return;
        }

        try {
            const data = await this._webviewService.getViewData();
            
            // Always update on any connection state changes
            const needsUpdate = !this._lastUpdateData || 
                this._lastUpdateData.connected !== data.connected ||
                this._lastUpdateData.isStarting !== data.isStarting ||
                this._lastUpdateData.connectionInfo !== data.connectionInfo ||
                this._lastUpdateData.connectionType !== data.connectionType ||
                this._lastUpdateData.selectedBranchId !== data.selectedBranchId ||
                this._lastUpdateData.parentBranchId !== data.parentBranchId ||
                this._lastUpdateData.currentlyConnectedBranch !== data.currentlyConnectedBranch ||
                this._lastUpdateData.isExplicitUpdate;

            if (needsUpdate) {
                console.log('ActionsView: Updating view with new data:', {
                    connected: data.connected,
                    connectionType: data.connectionType,
                    selectedBranchId: data.selectedBranchId,
                    parentBranchId: data.parentBranchId,
                    isStarting: data.isStarting,
                    connectionInfo: data.connectionInfo,
                    lastConnectionType: this._lastUpdateData?.connectionType,
                    currentlyConnectedBranch: data.currentlyConnectedBranch,
                    isExplicitUpdate: data.isExplicitUpdate
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
            console.error('Error updating actions view:', error);
            if (error instanceof Error) {
                vscode.window.showErrorMessage(`Actions view update error: ${error.message}`);
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