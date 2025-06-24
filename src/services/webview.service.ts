import * as vscode from 'vscode';
import { VIEW_TYPES } from '../constants';
import { ViewData } from '../types';
import { StateService } from './state.service';
import axios from 'axios';
import { Logger, ConfigurationManager } from '../utils';

export class WebViewService {
    private panels: Set<vscode.WebviewPanel> = new Set();
    private views: Set<vscode.Webview> = new Set();
    private lastViewData: Map<string, ViewData> = new Map();
    private readonly stateService: StateService;
    private context: vscode.ExtensionContext;

    constructor(context: vscode.ExtensionContext, stateService: StateService) {
        this.context = context;
        this.stateService = stateService;
    }

    public async initialize(): Promise<void> {
        // Initialize with empty state
        await this.updateAllViews();
    }

    public registerPanel(panel: vscode.WebviewPanel) {
        this.panels.add(panel);
        
        // Remove panel from registry when it's disposed
        panel.onDidDispose(() => {
            this.panels.delete(panel);
        });

        // Setup the webview
        this.setupWebview(panel.webview);
    }

    public registerWebview(webview: vscode.Webview) {
        this.views.add(webview);
        this.setupWebview(webview);
    }

    public unregisterWebview(webview: vscode.Webview) {
        this.views.delete(webview);
    }

    private setupWebview(webview: vscode.Webview) {
        webview.options = {
            enableScripts: true,
            localResourceRoots: [
                vscode.Uri.joinPath(this.context.extensionUri, 'dist')
            ]
        };
    }

    public postMessageToAll(message: any) {
        // Post to all panels
        for (const panel of this.panels) {
            try {
                panel.webview.postMessage(message);
            } catch (err) {
                console.error('Failed to post message to panel:', err);
                // Remove panel if it's no longer valid
                this.panels.delete(panel);
            }
        }

        // Post to all views
        for (const view of this.views) {
            try {
                view.postMessage(message);
            } catch (err) {
                console.error('Failed to post message to view:', err);
                // Remove view if it's no longer valid
                this.views.delete(view);
            }
        }
    }

    public updateViewData(viewType: string, data: ViewData): void {
        console.log(`WebView service: Updating view ${viewType} with data:`, {
            connected: data.connected,
            isStarting: data.isStarting,
            connectionType: data.connectionType,
            selectedBranchId: data.selectedBranchId,
            currentlyConnectedBranch: data.currentlyConnectedBranch,
            databases: data.databases?.length,
            roles: data.roles?.length,
            isExplicitUpdate: data.isExplicitUpdate
        });
        
        // Store the latest data
        this.lastViewData.set(viewType, data);
        
        // Send to all views
        this.postMessageToAll({ command: 'updateViewData', data });
        console.log('View data sent to', viewType);
    }

    public showPanel(context: vscode.ExtensionContext): void {
        const panel = vscode.window.createWebviewPanel(
            'neonLocal',
            'Neon Local Connect',
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                localResourceRoots: [context.extensionUri]
            }
        );

        panel.webview.html = this.getWebviewContent();
    }

    private getWebviewContent(): string {
        return `<!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Neon Local Connect</title>
            </head>
            <body>
                <h1>Neon Local Connect</h1>
                <p>Please use the Neon Local Connect view in the Activity Bar.</p>
            </body>
            </html>`;
    }

    public async handleDatabaseSelection(database: string) {
        await this.stateService.updateDatabase(database);
        await this.updateAllViews();
    }

    public async handleRoleSelection(role: string) {
        await this.stateService.updateRole(role);
        await this.updateAllViews();
    }

    public async getViewData(): Promise<ViewData> {
        return this.stateService.getViewData();
    }

    private async updateAllViews() {
        const viewData = await this.getViewData();
        this.updateViewData('neonLocal', viewData);
    }

    private getNonce(): string {
        let text = '';
        const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        for (let i = 0; i < 32; i++) {
            text += possible.charAt(Math.floor(Math.random() * possible.length));
        }
        return text;
    }

    private getScriptUri(): string {
        // Implement the logic to get the script URI based on the context
        // This is a placeholder and should be replaced with the actual implementation
        return '';
    }

    public async configure(): Promise<void> {
        const apiKey = await vscode.window.showInputBox({
            prompt: 'Enter your Neon API Key',
            password: true,
            ignoreFocusOut: true
        });

        if (apiKey) {
            await ConfigurationManager.updateSecureToken(this.context, 'apiKey', apiKey);
            await this.showPanel(this.context);
        }
    }

    public async getNeonApiClient() {
        const apiKey = await ConfigurationManager.getSecureToken(this.context, 'apiKey');
        
        if (!apiKey) {
            throw new Error('Neon API key not configured');
        }

        return axios.create({
            baseURL: 'https://console.neon.tech/api/v2',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            }
        });
    }

    public async updateWebview(webview: vscode.WebviewView, viewData: ViewData): Promise<void> {
        try {
            console.log('WebViewService: Sending updateViewData message');
            await webview.webview.postMessage({
                command: 'updateViewData',
                data: viewData
            });
            console.log('WebViewService: View update complete');
        } catch (error) {
            console.error('WebViewService: Error updating webview:', error);
            if (error instanceof Error) {
                vscode.window.showErrorMessage(`Webview update error: ${error.message}`);
            }
        }
    }
} 