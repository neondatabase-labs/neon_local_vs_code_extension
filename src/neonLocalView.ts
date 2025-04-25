import * as vscode from 'vscode';
import { authenticate, refreshToken } from './auth';
import * as path from 'path';
import * as fs from 'fs';

interface ViewData {
    // Define your view data structure here
    [key: string]: any;
}

export class NeonLocalViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'neonLocalView';
    private _view?: vscode.WebviewView;
    private _neonLocal: any; // Reference to NeonLocalManager
    private _configurationChangeListener: vscode.Disposable;
    private _updateViewTimeout?: NodeJS.Timeout;
    private _isUpdating = false;

    constructor(
        private readonly _extensionUri: vscode.Uri,
        neonLocal: any
    ) {
        this._neonLocal = neonLocal;
        
        // Listen for configuration changes with debouncing
        this._configurationChangeListener = vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('neonLocal.refreshToken') || e.affectsConfiguration('neonLocal.apiKey')) {
                this.debouncedUpdateView();
            }
        });
    }

    private debouncedUpdateView() {
        if (this._updateViewTimeout) {
            clearTimeout(this._updateViewTimeout);
        }
        this._updateViewTimeout = setTimeout(() => {
            this.updateView();
        }, 100); // Debounce for 100ms
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

        // Set the webview first
        this._neonLocal.setWebviewView(webviewView);

        // Then update the view
        this.updateView();

        webviewView.webview.onDidReceiveMessage(async (message) => {
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
                        await this._neonLocal.handleStartProxy(message.driver);
                        break;
                    case 'stopProxy':
                        await this._neonLocal.handleStopProxy();
                        break;
                    case 'createBranch':
                        await this._neonLocal.handleCreateBranch();
                        break;
                }
            } catch (error) {
                if (error instanceof Error && error.message.includes('authentication')) {
                    await this.handleAuthenticationFailure();
                } else {
                    vscode.window.showErrorMessage(`Error: ${error}`);
                }
            }
        });

        webviewView.onDidChangeVisibility(() => {
            if (webviewView.visible) {
                this.debouncedUpdateView();
            }
        });
    }

    public dispose() {
        if (this._updateViewTimeout) {
            clearTimeout(this._updateViewTimeout);
        }
        this._configurationChangeListener.dispose();
    }

    private async handleAuthenticationFailure() {
        // Clear the stored tokens
        const config = vscode.workspace.getConfiguration('neonLocal');
        await config.update('apiKey', undefined, true);
        await config.update('refreshToken', undefined, true);
        
        // Show error message
        vscode.window.showErrorMessage('Authentication expired. Please sign in again.');
        
        // Update view to show sign in UI
        await this.updateView();
    }

    private async validateToken(): Promise<boolean> {
        const config = vscode.workspace.getConfiguration('neonLocal');
        const storedRefreshToken = config.get<string>('refreshToken');
        
        if (!storedRefreshToken) {
            return false;
        }

        try {
            await refreshToken(storedRefreshToken);
            return true;
        } catch (error) {
            console.error('Token validation failed:', error);
            await this.handleAuthenticationFailure();
            return false;
        }
    }

    private async handleSignIn() {
        if (!this._view) return;

        try {
            // Show loading state
            this._view.webview.postMessage({ command: 'showLoading' });
            
            // Get the API key from authentication
            const apiKey = await authenticate();
            
            // Save the API key to configuration
            const config = vscode.workspace.getConfiguration('neonLocal');
            await config.update('apiKey', apiKey, true);
            
            // Show success message briefly
            this._view.webview.postMessage({ command: 'signInSuccess' });
            
            // Wait a moment to show the success message and let configuration update
            await new Promise(resolve => setTimeout(resolve, 1500));
            
            try {
                // Force refresh the view with the main UI
                const data = await this._neonLocal.getViewData();
                this._view.webview.html = this.getMainHtml(data);
            } catch (viewError) {
                console.error('Error getting view data:', viewError);
                // If we fail to get view data, show an error but don't reset the sign-in
                vscode.window.showErrorMessage(`Error loading data: ${viewError instanceof Error ? viewError.message : String(viewError)}`);
                // Try updating the view again after a short delay
                setTimeout(async () => {
                    try {
                        const retryData = await this._neonLocal.getViewData();
                        if (this._view) {
                            this._view.webview.html = this.getMainHtml(retryData);
                        }
                    } catch (retryError) {
                        console.error('Retry error:', retryError);
                    }
                }, 1000);
            }
        } catch (error) {
            console.error('Sign in error:', error);
            vscode.window.showErrorMessage(`Failed to sign in: ${error instanceof Error ? error.message : 'Unknown error'}`);
            this._view.webview.postMessage({ command: 'resetSignIn' });
        }
    }

    public async updateView() {
        if (!this._view) {
            return;
        }

        try {
            const config = vscode.workspace.getConfiguration('neonLocal');
            const apiKey = config.get<string>('apiKey');
            const refreshToken = config.get<string>('refreshToken');

            if (!apiKey && !refreshToken) {
                this._view.webview.html = this.getSignInHtml();
                return;
            }

            const data = await this._neonLocal.getViewData();
            const htmlContent = await this.getMainHtml(data);
            this._view.webview.html = htmlContent;
        } catch (error) {
            console.error('Error updating view:', error);
            this._view.webview.html = this.getSignInHtml();
        }
    }

    private getSignInHtml() {
        return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Neon Local</title>
            <style>
                body {
                    padding: 20px;
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    min-height: 200px;
                    font-family: var(--vscode-font-family);
                    background-color: var(--vscode-editor-background);
                    color: var(--vscode-editor-foreground);
                }
                .container {
                    text-align: center;
                }
                .sign-in-button {
                    background-color: var(--vscode-button-background);
                    color: var(--vscode-button-foreground);
                    border: none;
                    padding: 8px 16px;
                    cursor: pointer;
                    border-radius: 4px;
                    font-size: 14px;
                    margin-top: 20px;
                }
                .sign-in-button:hover {
                    background-color: var(--vscode-button-hoverBackground);
                }
                .description {
                    margin-bottom: 20px;
                    color: var(--vscode-descriptionForeground);
                }
                .success-message {
                    color: var(--vscode-notificationsSuccessIcon-foreground, #89D185);
                    font-weight: bold;
                    margin-top: 20px;
                }
                .spinner {
                    display: none;
                    width: 24px;
                    height: 24px;
                    margin: 20px auto;
                    border: 3px solid var(--vscode-button-background);
                    border-top: 3px solid var(--vscode-button-hoverBackground);
                    border-radius: 50%;
                    animation: spin 1s linear infinite;
                }
                @keyframes spin {
                    0% { transform: rotate(0deg); }
                    100% { transform: rotate(360deg); }
                }
            </style>
        </head>
        <body>
            <div class="container">
                <p class="description">Sign in to access your Neon projects and databases.</p>
                <button class="sign-in-button" id="signInButton">Sign in to Neon</button>
                <div class="spinner" id="spinner"></div>
            </div>
            <script>
                const vscode = acquireVsCodeApi();
                const container = document.querySelector('.container');
                const button = document.getElementById('signInButton');
                const spinner = document.getElementById('spinner');

                button.addEventListener('click', () => {
                    button.style.display = 'none';
                    spinner.style.display = 'block';
                    vscode.postMessage({ command: 'signIn' });
                });

                window.addEventListener('message', event => {
                    const message = event.data;
                    switch (message.command) {
                        case 'showLoading':
                            button.style.display = 'none';
                            spinner.style.display = 'block';
                            break;
                        case 'signInSuccess':
                            spinner.style.display = 'none';
                            container.innerHTML = '<p class="success-message">Successfully signed in!</p>';
                            break;
                        case 'resetSignIn':
                            spinner.style.display = 'none';
                            button.style.display = 'block';
                            break;
                    }
                });
            </script>
        </body>
        </html>`;
    }

    private getMainHtml(data: ViewData): string {
        return `<!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Neon Local</title>
                <style>
                    body {
                        padding: 20px;
                        font-family: var(--vscode-font-family);
                        background-color: var(--vscode-editor-background);
                        color: var(--vscode-editor-foreground);
                    }
                    select, button {
                        width: 100%;
                        padding: 8px;
                        margin: 8px 0;
                        background-color: var(--vscode-dropdown-background);
                        color: var(--vscode-dropdown-foreground);
                        border: 1px solid var(--vscode-dropdown-border);
                        border-radius: 4px;
                    }
                    button {
                        background-color: var(--vscode-button-background);
                        color: var(--vscode-button-foreground);
                        border: none;
                        cursor: pointer;
                    }
                    button:hover {
                        background-color: var(--vscode-button-hoverBackground);
                    }
                    button:disabled {
                        opacity: 0.5;
                        cursor: not-allowed;
                    }
                    .section {
                        margin-bottom: 20px;
                    }
                    .connection-info {
                        background-color: var(--vscode-textBlockQuote-background);
                        padding: 10px;
                        border-radius: 4px;
                        margin-top: 10px;
                        white-space: pre-wrap;
                    }
                    .proxy-buttons {
                        display: flex;
                        gap: 10px;
                    }
                </style>
            </head>
            <body>
                <div id="app">
                    <div class="section">
                        <label for="org-select">Organization:</label>
                        <select id="org-select">
                            <option value="">Select Organization</option>
                            ${data.orgs.map((org: { id: string; name: string }) => `
                                <option value="${org.id}" ${org.id === data.selectedOrg ? 'selected' : ''}>
                                    ${org.name}
                                </option>
                            `).join('')}
                        </select>
                    </div>

                    <div class="section">
                        <label for="project-select">Project:</label>
                        <select id="project-select" ${!data.selectedOrg ? 'disabled' : ''}>
                            <option value="">Select Project</option>
                            ${data.projects.map((project: { id: string; name: string }) => `
                                <option value="${project.id}" ${project.id === data.selectedProject ? 'selected' : ''}>
                                    ${project.name}
                                </option>
                            `).join('')}
                        </select>
                    </div>

                    <div class="section">
                        <label for="branch-select">Branch:</label>
                        <select id="branch-select" ${!data.selectedProject ? 'disabled' : ''}>
                            <option value="">Select Branch</option>
                            ${data.branches.map((branch: { id: string; name: string }) => `
                                <option value="${branch.id}" ${branch.id === data.selectedBranch ? 'selected' : ''}>
                                    ${branch.name}
                                </option>
                            `).join('')}
                        </select>
                    </div>

                    <div class="section">
                        <label for="driver-select">Driver:</label>
                        <select id="driver-select">
                            <option value="postgres">PostgreSQL</option>
                            <option value="neon">Neon Serverless</option>
                        </select>
                    </div>

                    <div class="section proxy-buttons">
                        ${data.connected ? 
                            `<button id="stop-proxy">Stop Proxy</button>` : 
                            `<button id="start-proxy" ${!data.selectedBranch ? 'disabled' : ''}>Start Proxy</button>`
                        }
                        <button id="create-branch" ${!data.selectedProject ? 'disabled' : ''}>Create Branch</button>
                    </div>

                    ${data.connectionInfo ? `
                        <div class="connection-info">
                            <strong>Connection Info:</strong><br>
                            ${data.connectionInfo}
                        </div>
                    ` : ''}
                </div>

                <script>
                    const vscode = acquireVsCodeApi();
                    let currentState = ${JSON.stringify(data)};

                    // Handle all incoming messages
                    window.addEventListener('message', event => {
                        const message = event.data;
                        console.log('Received message:', message);

                        switch (message.command) {
                            case 'updateOrgs':
                                updateOrganizations(message.orgs, message.selectedOrg);
                                break;
                            case 'updateProjects':
                                updateProjects(message.projects, message.selectedProject);
                                break;
                            case 'updateBranches':
                                updateBranches(message.branches, message.selectedBranch);
                                break;
                            case 'updateStatus':
                                updateStatus(message);
                                break;
                        }
                    });

                    function updateStatus(status) {
                        console.log('Updating status:', status);
                        const proxyButtonsContainer = document.querySelector('.proxy-buttons');
                        const connectionInfo = document.querySelector('.connection-info');

                        if (proxyButtonsContainer) {
                            if (status.connected) {
                                proxyButtonsContainer.innerHTML = \`
                                    <button id="stop-proxy">Stop Proxy</button>
                                    <button id="create-branch" \${!currentState.selectedProject ? 'disabled' : ''}>Create Branch</button>
                                \`;
                                
                                // Add event listener to new stop button
                                document.getElementById('stop-proxy')?.addEventListener('click', () => {
                                    const button = document.getElementById('stop-proxy');
                                    if (button) {
                                        button.disabled = true;
                                        button.textContent = 'Stopping...';
                                    }
                                    vscode.postMessage({ command: 'stopProxy' });
                                });
                            } else {
                                proxyButtonsContainer.innerHTML = \`
                                    <button id="start-proxy" \${!currentState.selectedBranch ? 'disabled' : ''}>Start Proxy</button>
                                    <button id="create-branch" \${!currentState.selectedProject ? 'disabled' : ''}>Create Branch</button>
                                \`;
                                
                                // Add event listener to new start button
                                document.getElementById('start-proxy')?.addEventListener('click', () => {
                                    const button = document.getElementById('start-proxy');
                                    const driverSelect = document.getElementById('driver-select');
                                    if (button) {
                                        button.disabled = true;
                                        button.textContent = 'Starting...';
                                    }
                                    vscode.postMessage({
                                        command: 'startProxy',
                                        driver: driverSelect?.value || 'postgres'
                                    });
                                });
                            }

                            // Add event listener to new create branch button
                            document.getElementById('create-branch')?.addEventListener('click', () => {
                                vscode.postMessage({ command: 'createBranch' });
                            });
                        }

                        // Update connection info
                        if (status.connectionInfo) {
                            if (!connectionInfo) {
                                const div = document.createElement('div');
                                div.className = 'connection-info';
                                div.innerHTML = \`<strong>Connection Info:</strong><br>\${status.connectionInfo}\`;
                                document.getElementById('app')?.appendChild(div);
                            } else {
                                connectionInfo.innerHTML = \`<strong>Connection Info:</strong><br>\${status.connectionInfo}\`;
                            }
                        } else if (connectionInfo) {
                            connectionInfo.remove();
                        }

                        // Update current state
                        currentState.connected = status.connected;
                    }

                    // Update functions
                    function updateOrganizations(orgs, selectedOrg) {
                        const select = document.getElementById('org-select');
                        if (!select) return;

                        // Save current options
                        const defaultOption = select.options[0];
                        
                        // Clear current options
                        select.innerHTML = '';
                        
                        // Restore default option
                        select.add(defaultOption);
                        
                        // Add new options
                        orgs.forEach(org => {
                            const option = document.createElement('option');
                            option.value = org.id;
                            option.text = org.name;
                            option.selected = org.id === selectedOrg;
                            select.add(option);
                        });
                    }

                    function updateProjects(projects, selectedProject) {
                        console.log('Updating projects:', projects);
                        const select = document.getElementById('project-select');
                        if (!select) return;

                        // Save current options
                        const defaultOption = select.options[0];
                        
                        // Clear current options
                        select.innerHTML = '';
                        
                        // Restore default option
                        select.add(defaultOption);
                        
                        // Add new options
                        projects.forEach(project => {
                            const option = document.createElement('option');
                            option.value = project.id;
                            option.text = project.name;
                            option.selected = project.id === selectedProject;
                            select.add(option);
                        });

                        select.disabled = projects.length === 0;
                        
                        // Clear and disable branch select
                        const branchSelect = document.getElementById('branch-select');
                        if (branchSelect) {
                            branchSelect.value = '';
                            branchSelect.disabled = true;
                        }
                    }

                    function updateBranches(branches, selectedBranch) {
                        const select = document.getElementById('branch-select');
                        if (!select) return;

                        // Save current options
                        const defaultOption = select.options[0];
                        
                        // Clear current options
                        select.innerHTML = '';
                        
                        // Restore default option
                        select.add(defaultOption);
                        
                        // Add new options
                        branches.forEach(branch => {
                            const option = document.createElement('option');
                            option.value = branch.id;
                            option.text = branch.name;
                            option.selected = branch.id === selectedBranch;
                            select.add(option);
                        });

                        select.disabled = branches.length === 0;
                    }

                    // Event Listeners
                    document.getElementById('org-select')?.addEventListener('change', (e) => {
                        const target = e.target;
                        if (!target) return;
                        
                        console.log('Organization selected:', target.value);
                        currentState.selectedOrg = target.value;
                        
                        vscode.postMessage({
                            command: 'selectOrg',
                            orgId: target.value
                        });
                    });

                    document.getElementById('project-select')?.addEventListener('change', (e) => {
                        const target = e.target;
                        if (!target) return;
                        
                        console.log('Project selected:', target.value);
                        currentState.selectedProject = target.value;
                        
                        vscode.postMessage({
                            command: 'selectProject',
                            projectId: target.value
                        });
                    });

                    document.getElementById('branch-select')?.addEventListener('change', (e) => {
                        const target = e.target;
                        if (!target) return;
                        
                        console.log('Branch selected:', target.value);
                        currentState.selectedBranch = target.value;
                        
                        const driverSelect = document.getElementById('driver-select');
                        vscode.postMessage({
                            command: 'selectBranch',
                            branchId: target.value,
                            restartProxy: false,
                            driver: driverSelect ? driverSelect.value : 'postgres'
                        });
                    });

                    document.getElementById('start-proxy')?.addEventListener('click', () => {
                        console.log('Start proxy clicked');
                        const driverSelect = document.getElementById('driver-select');
                        const branchSelect = document.getElementById('branch-select');
                        
                        if (!branchSelect || !branchSelect.value) {
                            console.error('No branch selected');
                            return;
                        }
                        
                        const driver = driverSelect ? driverSelect.value : 'postgres';
                        console.log('Starting proxy with driver:', driver);
                        
                        vscode.postMessage({
                            command: 'startProxy',
                            driver: driver
                        });
                        
                        // Disable the button while starting
                        const startButton = document.getElementById('start-proxy');
                        if (startButton) {
                            startButton.disabled = true;
                            startButton.textContent = 'Starting...';
                        }
                    });

                    document.getElementById('stop-proxy')?.addEventListener('click', () => {
                        console.log('Stop proxy clicked');
                        vscode.postMessage({
                            command: 'stopProxy'
                        });
                        
                        // Disable the button while stopping
                        const stopButton = document.getElementById('stop-proxy');
                        if (stopButton) {
                            stopButton.disabled = true;
                            stopButton.textContent = 'Stopping...';
                        }
                    });

                    document.getElementById('create-branch')?.addEventListener('click', () => {
                        console.log('Create branch clicked');
                        vscode.postMessage({
                            command: 'createBranch'
                        });
                    });
                </script>
            </body>
            </html>`;
    }

    private renderViewData(data: ViewData): string {
        return `<pre>${JSON.stringify(data, null, 2)}</pre>`;
    }
} 