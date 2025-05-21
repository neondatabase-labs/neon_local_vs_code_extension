import * as vscode from 'vscode';
import { NeonLocalManager, ViewData } from './types';
import { getStyles } from './templates/styles';
import { getActionsHtml } from './templates/actionsView';

export class ActionsViewProvider implements vscode.WebviewViewProvider {
    private _view?: vscode.WebviewView;

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

        this._manager.setWebviewView(webviewView);
        this.updateView();

        webviewView.webview.onDidReceiveMessage(this.handleWebviewMessage.bind(this));
        webviewView.onDidChangeVisibility(() => {
            if (webviewView.visible) {
                this.updateView();
            }
        });
    }

    private async handleWebviewMessage(message: any): Promise<void> {
        if (!this._view) return;

        try {
            switch (message.command) {
                case 'resetFromParent':
                    await vscode.commands.executeCommand('neon-local.resetFromParent');
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
            const data = await this._manager.getViewData();
            this._view.webview.html = getActionsHtml(data);
        } catch (error) {
            if (error instanceof Error) {
                vscode.window.showErrorMessage(error.message);
            }
        }
    }
} 