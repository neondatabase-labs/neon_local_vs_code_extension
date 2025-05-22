import * as vscode from 'vscode';
import { VIEW_TYPES } from '../constants';
import { ViewData } from '../types';

export class WebViewService {
    private views: Map<string, vscode.WebviewView> = new Map();

    public setWebviewView(view: vscode.WebviewView): void {
        this.views.set(view.viewType, view);
    }

    public async updateViewData(data: ViewData): Promise<void> {
        for (const [viewType, view] of this.views) {
            if (!view.visible) {
                continue;
            }

            try {
                await view.webview.postMessage({
                    command: 'updateViewData',
                    data
                });
            } catch (error) {
                console.error(`Failed to update ${viewType} view:`, error);
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