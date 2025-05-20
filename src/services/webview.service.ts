import * as vscode from 'vscode';
import { ViewData } from '../types';

export class WebViewService {
    private webviewPanel?: vscode.WebviewPanel;
    private webviewView?: vscode.WebviewView;

    public setWebviewView(webviewView: vscode.WebviewView) {
        this.webviewView = webviewView;
    }

    public getActiveWebview(): vscode.Webview | undefined {
        return this.webviewPanel?.webview || this.webviewView?.webview;
    }

    public showPanel(context: vscode.ExtensionContext) {
        if (this.webviewPanel) {
            this.webviewPanel.reveal();
            return;
        }

        this.webviewPanel = vscode.window.createWebviewPanel(
            'neonLocal',
            'Neon Local',
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true
            }
        );

        this.webviewPanel.onDidDispose(() => {
            this.webviewPanel = undefined;
        });

        this.webviewPanel.webview.html = this.getWebviewContent();
    }

    public updateViewData(viewData: ViewData) {
        console.log('WebViewService: Updating view data:', viewData);
        const webview = this.getActiveWebview();
        if (webview) {
            console.log('WebViewService: Sending updateViewData message to webview');
            webview.postMessage({
                command: 'updateViewData',
                data: viewData
            });
        } else {
            console.log('WebViewService: No active webview found');
        }
    }

    public updateConnectionStatus(connected: boolean, branch?: string) {
        const webview = this.getActiveWebview();
        if (webview) {
            webview.postMessage({
                command: 'updateStatus',
                connected,
                branch,
                loading: false
            });
        }
    }

    public showError(message: string) {
        const webview = this.getActiveWebview();
        if (webview) {
            webview.postMessage({
                command: 'showError',
                message
            });
        }
    }

    private getWebviewContent(): string {
        return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Neon Local</title>
            <style>
                body {
                    padding: 20px;
                    color: var(--vscode-foreground);
                    font-family: var(--vscode-font-family);
                    background-color: var(--vscode-editor-background);
                }
                .container {
                    max-width: 800px;
                    margin: 0 auto;
                }
                select, button {
                    margin: 10px 0;
                    padding: 5px;
                    width: 100%;
                    background-color: var(--vscode-button-background);
                    color: var(--vscode-button-foreground);
                    border: 1px solid var(--vscode-button-border);
                    border-radius: 3px;
                }
                button:hover {
                    background-color: var(--vscode-button-hoverBackground);
                }
                .error {
                    color: var(--vscode-errorForeground);
                    margin: 10px 0;
                    padding: 10px;
                    border: 1px solid var(--vscode-errorForeground);
                    border-radius: 3px;
                }
                .status {
                    margin: 10px 0;
                    padding: 10px;
                    border-radius: 3px;
                }
                .connected {
                    background-color: var(--vscode-testing-iconPassed);
                    color: var(--vscode-editor-background);
                }
                .disconnected {
                    background-color: var(--vscode-testing-iconFailed);
                    color: var(--vscode-editor-background);
                }
            </style>
        </head>
        <body>
            <div class="container">
                <h2>Neon Local Development</h2>
                <div id="status" class="status"></div>
                <div id="error" class="error" style="display: none;"></div>
                <div id="content">
                    <select id="orgSelect"></select>
                    <select id="projectSelect"></select>
                    <select id="branchSelect"></select>
                    <button id="startButton">Start Proxy</button>
                    <button id="stopButton">Stop Proxy</button>
                </div>
            </div>
            <script>
                (function() {
                    const vscode = acquireVsCodeApi();
                    let viewData = {};

                    window.addEventListener('message', event => {
                        const message = event.data;
                        switch (message.command) {
                            case 'updateViewData':
                                updateUI(message.data);
                                break;
                            case 'updateStatus':
                                updateStatus(message.connected, message.branch, message.loading);
                                break;
                            case 'showError':
                                showError(message.message);
                                break;
                        }
                    });

                    function updateUI(data) {
                        viewData = data;
                        updateSelect('orgSelect', data.orgs, data.selectedOrgId);
                        updateSelect('projectSelect', data.projects, data.selectedProjectId);
                        updateSelect('branchSelect', data.branches, data.selectedBranchId);
                        updateStatus(data.connected, data.selectedBranchName, data.loading);
                    }

                    function updateSelect(id, items, selectedId) {
                        const select = document.getElementById(id);
                        select.innerHTML = '';
                        items.forEach(item => {
                            const option = document.createElement('option');
                            option.value = item.id;
                            option.text = item.name;
                            option.selected = item.id === selectedId;
                            select.appendChild(option);
                        });
                    }

                    function updateStatus(connected, branch, loading) {
                        const status = document.getElementById('status');
                        status.className = 'status ' + (connected ? 'connected' : 'disconnected');
                        status.textContent = connected ? 
                            'Connected to branch: ' + branch :
                            'Disconnected';
                        
                        const startButton = document.getElementById('startButton');
                        const stopButton = document.getElementById('stopButton');
                        startButton.disabled = connected || loading;
                        stopButton.disabled = !connected || loading;
                    }

                    function showError(message) {
                        const error = document.getElementById('error');
                        if (message) {
                            error.textContent = message;
                            error.style.display = 'block';
                        } else {
                            error.style.display = 'none';
                        }
                    }

                    // Event listeners
                    document.getElementById('orgSelect').addEventListener('change', (e) => {
                        vscode.postMessage({ command: 'selectOrg', orgId: e.target.value });
                    });

                    document.getElementById('projectSelect').addEventListener('change', (e) => {
                        vscode.postMessage({ command: 'selectProject', projectId: e.target.value });
                    });

                    document.getElementById('branchSelect').addEventListener('change', (e) => {
                        vscode.postMessage({ command: 'selectBranch', branchId: e.target.value });
                    });

                    document.getElementById('startButton').addEventListener('click', () => {
                        vscode.postMessage({ command: 'startProxy' });
                    });

                    document.getElementById('stopButton').addEventListener('click', () => {
                        vscode.postMessage({ command: 'stopProxy' });
                    });
                }())
            </script>
        </body>
        </html>`;
    }
} 