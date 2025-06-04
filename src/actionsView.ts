import * as vscode from 'vscode';
import { VIEW_TYPES } from './constants';
import { NeonLocalManager, ViewData, WebviewMessage } from './types';
import { getActionsHtml } from './templates/actionsView';

export class ActionsViewProvider implements vscode.WebviewViewProvider {
    private _view?: vscode.WebviewView;
    private _lastUpdateData?: ViewData;

    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly _manager: NeonLocalManager
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

        // Initialize view with empty state
        webviewView.webview.html = getActionsHtml({
            orgs: [],
            projects: [],
            branches: [],
            databases: [],
            roles: [],
            selectedOrgId: '',
            selectedOrgName: '',
            selectedBranchId: '',
            selectedDriver: 'postgres',
            connected: false,
            isStarting: false,
            connectionType: 'existing'
        });

        // Register this view with the manager
        this._manager.setWebviewView(webviewView);

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

    public async updateView(): Promise<void> {
        if (!this._view) {
            return;
        }

        try {
            const data = await this._manager.getViewData();
            
            // Always update on any connection state changes
            const needsUpdate = !this._lastUpdateData || 
                this._lastUpdateData.connected !== data.connected ||
                this._lastUpdateData.isStarting !== data.isStarting ||
                this._lastUpdateData.connectionInfo !== data.connectionInfo ||
                this._lastUpdateData.connectionType !== data.connectionType ||
                this._lastUpdateData.selectedBranchId !== data.selectedBranchId ||
                this._lastUpdateData.parentBranchId !== data.parentBranchId;

            if (needsUpdate) {
                console.log('ActionsView: Updating view with new data:', {
                    connected: data.connected,
                    connectionType: data.connectionType,
                    selectedBranchId: data.selectedBranchId,
                    parentBranchId: data.parentBranchId,
                    isStarting: data.isStarting,
                    connectionInfo: data.connectionInfo,
                    lastConnectionType: this._lastUpdateData?.connectionType
                });

                // Store the last update data before sending
                this._lastUpdateData = {...data};

                // Update the view's HTML first
                this._view.webview.html = getActionsHtml(data);

                // Small delay to ensure HTML is updated
                await new Promise(resolve => setTimeout(resolve, 50));

                // Send data via postMessage
                await this._view.webview.postMessage({
                    command: 'updateViewData',
                    data: data
                });

                console.log('ActionsView: Update complete, new state:', {
                    connected: data.connected,
                    connectionType: data.connectionType,
                    selectedBranchId: data.selectedBranchId,
                    parentBranchId: data.parentBranchId
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