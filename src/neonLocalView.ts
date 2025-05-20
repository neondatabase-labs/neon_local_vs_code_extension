import * as vscode from 'vscode';
import { authenticate } from './auth';
import { ConfigurationManager, Logger, debounce } from './utils';
import { DEBOUNCE_DELAY, SUCCESS_MESSAGE_DELAY, VIEW_RETRY_DELAY, VIEW_TYPES } from './constants';
import { ViewData, WebviewMessage } from './types';
import { getMainHtml } from './templates/mainView';
import { getSignInHtml } from './templates/signIn';
import { NeonLocalManager } from './extension';

export class NeonLocalViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = VIEW_TYPES.NEON_LOCAL;
    private _view?: vscode.WebviewView;
    private _configurationChangeListener: vscode.Disposable;
    private _updateViewTimeout?: NodeJS.Timeout;
    private _isUpdating = false;

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

    private debouncedUpdateView = debounce(() => {
        this.updateView();
    }, DEBOUNCE_DELAY);

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
                this.debouncedUpdateView();
            }
        });
    }

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
                    await ConfigurationManager.updateConfig('connectionType', message.connectionType);
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

    private async handleSignIn(): Promise<void> {
        if (!this._view) return;

        try {
            this._view.webview.postMessage({ command: 'showLoading' });
            
            const apiKey = await authenticate();
            await ConfigurationManager.updateConfig('apiKey', apiKey);
            
            try {
                const data = await this._neonLocal.getViewData();
                this._view.webview.html = getMainHtml(data);
            } catch (viewError) {
                Logger.error('Error getting view data', viewError);
                this._view.webview.postMessage({ command: 'resetSignIn' });
                throw viewError;
            }
        } catch (error) {
            Logger.error('Sign in error', error);
            this._view.webview.postMessage({ command: 'resetSignIn' });
            if (error instanceof Error) {
                vscode.window.showErrorMessage(`Authentication failed: ${error.message}`);
            }
        }
    }

    public dispose(): void {
        if (this._updateViewTimeout) {
            clearTimeout(this._updateViewTimeout);
        }
        this._configurationChangeListener.dispose();
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
                return;
            }

            const data = await this._neonLocal.getViewData();
            this._view.webview.html = getMainHtml(data);
        } catch (error) {
            Logger.error('Error updating view', error);
            this._view.webview.html = getSignInHtml();
            if (error instanceof Error) {
                vscode.window.showErrorMessage(error.message);
            }
        } finally {
            this._isUpdating = false;
        }
    }
}