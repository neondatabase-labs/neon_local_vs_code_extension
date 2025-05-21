import * as vscode from 'vscode';
import { VIEW_TYPES } from './constants';
import { NeonLocalManager, WebviewMessage } from './types';
import { getDatabaseHtml } from './templates/databaseView';

export class DatabaseViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = VIEW_TYPES.DATABASE;
    private _view?: vscode.WebviewView;

    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly _neonLocal: NeonLocalManager
    ) {}

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

        this._neonLocal.setWebviewView(webviewView);
        this.updateView();

        webviewView.webview.onDidReceiveMessage(this.handleWebviewMessage.bind(this));
        webviewView.onDidChangeVisibility(() => {
            if (webviewView.visible) {
                this.updateView();
            }
        });
    }

    private async handleWebviewMessage(message: WebviewMessage): Promise<void> {
        if (!this._view) return;

        try {
            switch (message.command) {
                case 'selectDatabase':
                    await this._neonLocal.handleDatabaseSelection(message.database);
                    await this.updateView();
                    break;
                case 'selectRole':
                    await this._neonLocal.handleRoleSelection(message.role);
                    await this.updateView();
                    break;
                case 'openSqlEditor':
                    await vscode.commands.executeCommand('neon-local.openSqlEditor');
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
            const data = await this._neonLocal.getViewData();
            this._view.webview.html = getDatabaseHtml(data);
        } catch (error) {
            if (error instanceof Error) {
                vscode.window.showErrorMessage(error.message);
            }
        }
    }
} 