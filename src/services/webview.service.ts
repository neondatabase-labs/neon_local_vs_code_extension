import * as vscode from 'vscode';
import { VIEW_TYPES } from '../constants';
import { ViewData } from '../types';

export class WebViewService {
    private views: Map<string, vscode.WebviewView> = new Map();
    private lastViewData: Map<string, ViewData> = new Map();

    public setWebviewView(view: vscode.WebviewView): void {
        console.log(`WebView service: Registering view ${view.viewType}`);
        this.views.set(view.viewType, view);
        
        // Initialize last view data for this view
        if (!this.lastViewData.has(view.viewType)) {
            this.lastViewData.set(view.viewType, {
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
        }

        // Get the most up-to-date data from any existing view
        const latestData = Array.from(this.lastViewData.values())
            .reduce((latest, current) => {
                // Prefer data that shows a connection
                if (current.connected && !latest.connected) {
                    return current;
                }
                // Prefer data with more complete state
                if (current.orgs?.length > (latest.orgs?.length || 0)) {
                    return current;
                }
                return latest;
            }, this.lastViewData.get(view.viewType)!);

        // Force an immediate update for this view with the latest data
        if (latestData) {
            console.log(`WebView service: Sending initial data to newly registered view ${view.viewType}`, {
                connected: latestData.connected,
                isStarting: latestData.isStarting,
                connectionType: latestData.connectionType
            });
            try {
                void view.webview.postMessage({
                    command: 'updateViewData',
                    data: latestData
                });
                console.log(`Initial data sent to view ${view.viewType}`);
            } catch (err) {
                if (err instanceof Error) {
                    console.error(`Error sending initial data to view ${view.viewType}:`, err);
                }
            }
        }
    }

    public async updateViewData(data: ViewData): Promise<void> {
        // Process orgs to ensure they are properly initialized
        const processedOrgs = Array.isArray(data.orgs) ? data.orgs : [];

        // Get the last view data for comparison
        const lastData = this.lastViewData.get('connect');

        // Determine if we should preserve the connection type
        const connectionType = data.isExplicitUpdate ? data.connectionType : (lastData?.connectionType || data.connectionType);

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
            connected: Boolean(data.connected),
            connectionInfo: data.connectionInfo || '',
            connectionType: connectionType,
            isStarting: Boolean(data.isStarting),
            isExplicitUpdate: data.isExplicitUpdate // Preserve the isExplicitUpdate flag
        };

        // Log the data being sent to views
        console.log('WebView service: Updating views with data:', {
            connected: viewData.connected,
            connectionInfo: viewData.connectionInfo,
            selectedDatabase: viewData.selectedDatabase,
            selectedRole: viewData.selectedRole,
            databases: viewData.databases?.length,
            connectionType: viewData.connectionType,
            isStarting: viewData.isStarting,
            isExplicitUpdate: viewData.isExplicitUpdate,
            preservedConnectionType: connectionType === lastData?.connectionType
        });

        // First update the lastViewData for all views to ensure consistent state
        for (const [viewType] of this.views) {
            this.lastViewData.set(viewType, {...viewData});
        }

        // Then send the update to all views
        for (const [viewType, view] of this.views) {
            if (view.visible) {
                view.webview.postMessage({
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