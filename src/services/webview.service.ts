import * as vscode from 'vscode';
import { VIEW_TYPES } from '../constants';
import { ViewData } from '../types';

export class WebViewService {
    private views: Map<string, vscode.WebviewView> = new Map();

    public setWebviewView(view: vscode.WebviewView): void {
        this.views.set(view.viewType, view);
    }

    public async updateViewData(data: ViewData): Promise<void> {
        // Process orgs to ensure they are properly initialized
        const processedOrgs = Array.isArray(data.orgs) ? data.orgs : [];

        // Ensure all arrays are properly initialized and connection state is valid
        const viewData: ViewData = {
            ...data,
            orgs: processedOrgs,
            projects: Array.isArray(data.projects) ? data.projects : [],
            branches: Array.isArray(data.branches) ? data.branches : [],
            databases: Array.isArray(data.databases) ? data.databases : [],
            roles: Array.isArray(data.roles) ? data.roles : [],
            selectedOrgId: data.selectedOrgId || '',
            selectedOrgName: data.selectedOrgName || '',
            selectedProjectId: data.selectedProjectId || '',
            selectedProjectName: data.selectedProjectName || '',
            selectedBranchId: data.selectedBranchId || '',
            selectedBranchName: data.selectedBranchName || '',
            parentBranchId: data.parentBranchId || '',
            parentBranchName: data.parentBranchName || '',
            selectedDriver: data.selectedDriver || 'postgres',
            selectedDatabase: data.selectedDatabase || '',
            selectedRole: data.selectedRole || '',
            connected: data.connected,
            connectionInfo: data.connectionInfo || '',
            connectionType: data.connectionType || 'existing',
            isStarting: data.isStarting || false
        };

        // Update main view first
        const mainView = this.views.get('neonLocalConnect');
        if (mainView) {
            console.log('WebView service: Updating main view');
            await mainView.webview.postMessage({
                command: 'updateViewData',
                data: viewData
            });

            // Small delay to ensure main view updates first
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        // Update database and actions views together
        const otherViews = ['neonLocalDatabase', 'neonLocalActions'];
        for (const viewType of otherViews) {
            const view = this.views.get(viewType);
            if (view) {
                console.log(`WebView service: Sending data to ${viewType}`);
                await view.webview.postMessage({
                    command: 'updateViewData',
                    data: viewData
                });
            }
        }
    }

    public showError(message: string): void {
        for (const view of this.views.values()) {
            if (!view.visible) {
                continue;
            }

            view.webview.postMessage({
                command: 'showError',
                message
            });
        }
    }

    public postMessage(message: { command: string; [key: string]: any }): void {
        for (const view of this.views.values()) {
            if (!view.visible) {
                continue;
            }

            try {
                view.webview.postMessage(message);
            } catch (error) {
                console.error('Failed to post message to view:', error);
            }
        }
    }

    public showPanel(context: vscode.ExtensionContext): void {
        const panel = vscode.window.createWebviewPanel(
            'neonLocal',
            'Neon Local',
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
                <title>Neon Local</title>
            </head>
            <body>
                <h1>Neon Local</h1>
                <p>Please use the Neon Local view in the Activity Bar.</p>
            </body>
            </html>`;
    }
} 