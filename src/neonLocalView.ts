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
            console.log('Received message in webview:', message);
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
                        console.log('Handling startProxy command with driver:', message.driver);
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
                        width: 100%;
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
                    .header {
                        display: flex;
                        align-items: center;
                        margin-bottom: 20px;
                        gap: 10px;
                    }
                    .header h1 {
                        margin: 0;
                        font-size: 1.2em;
                        color: var(--vscode-foreground);
                    }
                    .neon-logo {
                        width: 24px;
                        height: 24px;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        color: #00E699;
                    }
                    select {
                        width: 100%;
                    }
                </style>
            </head>
            <body>
                <div id="app">
                    <div class="header">
                        <div class="neon-logo">
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <path d="M12 24C18.6274 24 24 18.6274 24 12C24 5.37258 18.6274 0 12 0C5.37258 0 0 5.37258 0 12C0 18.6274 5.37258 24 12 24Z" fill="currentColor"/>
                                <path d="M17.0513 17.0513H13.7436V6.94873H17.0513V17.0513Z" fill="white"/>
                                <path d="M10.4359 17.0513H7.12821V6.94873H10.4359V17.0513Z" fill="white"/>
                            </svg>
                        </div>
                        <h1>Neon Local</h1>
                    </div>

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

                    // Track branch selection state
                    const branchState = {
                        selectedBranch: null,
                        branchList: [],
                        isProxyOperation: false,
                        lastKnownValue: null,
                        ignoreNextUpdate: false
                    };

                    function updateBranches(branches, selectedBranch, source = 'unknown') {
                        console.log('updateBranches called with:', { 
                            branches, 
                            selectedBranch, 
                            source,
                            branchState,
                            ignoreUpdate: branchState.ignoreNextUpdate 
                        });

                        const select = document.getElementById('branch-select');
                        if (!select) return;

                        // If we should ignore this update, just store the branch list
                        if (branchState.ignoreNextUpdate) {
                            console.log('Ignoring branch update as requested');
                            branchState.branchList = branches;
                            branchState.ignoreNextUpdate = false;
                            return;
                        }

                        // During proxy operations, only store the branch list but don't update the UI
                        if (branchState.isProxyOperation) {
                            console.log('Proxy operation in progress, storing branch list without UI update');
                            branchState.branchList = branches;
                            return;
                        }

                        // If we have a selected branch during a status update, preserve it
                        if (branchState.selectedBranch && source === 'status') {
                            console.log('Preserving selected branch during status update:', branchState.selectedBranch);
                            return;
                        }

                        // Store the current value before any changes
                        const currentValue = select.value || branchState.selectedBranch;
                        if (currentValue) {
                            branchState.lastKnownValue = currentValue;
                            console.log('Stored current value:', currentValue);
                        }

                        // Update branch list
                        branchState.branchList = branches;

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
                            
                            // Use the most appropriate value for selection
                            const valueToUse = branchState.lastKnownValue || selectedBranch;
                            option.selected = branch.id === valueToUse;
                            
                            select.add(option);
                        });

                        select.disabled = branches.length === 0;

                        // Update selected branch if this is an explicit selection
                        if (selectedBranch && source !== 'status') {
                            branchState.selectedBranch = selectedBranch;
                            branchState.lastKnownValue = selectedBranch;
                            console.log('Updated selected branch to:', selectedBranch);
                        }
                    }

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
                                // Reset branch state when project changes
                                branchState.selectedBranch = null;
                                branchState.lastKnownValue = null;
                                branchState.branchList = [];
                                branchState.isProxyOperation = false;
                                branchState.ignoreNextUpdate = false;
                                break;
                            case 'updateBranches':
                                updateBranches(message.branches, message.selectedBranch, 'message');
                                break;
                            case 'updateStatus':
                                console.log('Status update received:', { 
                                    branchState,
                                    connected: message.connected,
                                    loading: message.loading
                                });
                                
                                // If we're in a proxy operation, ignore the next branch update
                                if (branchState.isProxyOperation) {
                                    branchState.ignoreNextUpdate = true;
                                }
                                
                                updateStatus(message);
                                break;
                        }
                    });

                    // Event Listeners for buttons
                    document.getElementById('branch-select')?.addEventListener('change', (e) => {
                        const target = e.target;
                        if (!target) return;
                        
                        console.log('Branch selected:', target.value);
                        branchState.selectedBranch = target.value;
                        branchState.lastKnownValue = target.value;
                        currentState.selectedBranch = target.value;
                        branchState.isProxyOperation = false;
                        branchState.ignoreNextUpdate = false;
                        
                        vscode.postMessage({
                            command: 'selectBranch',
                            branchId: target.value,
                            restartProxy: false,
                            driver: document.getElementById('driver-select')?.value || 'postgres'
                        });
                    });

                    function updateStatus(status) {
                        console.log('Updating status with full details:', {
                            status,
                            currentState,
                            branchState
                        });
                        
                        const proxyButtonsContainer = document.querySelector('.proxy-buttons');
                        const connectionInfo = document.querySelector('.connection-info');

                        // Update current state first
                        currentState.connected = status.connected;

                        if (proxyButtonsContainer) {
                            // Clear existing content
                            proxyButtonsContainer.innerHTML = '';

                            // Determine if we're connected based on both status and connection info
                            const isConnected = status.connected || !!status.connectionInfo;
                            console.log('Connection state:', { 
                                statusConnected: status.connected, 
                                hasConnectionInfo: !!status.connectionInfo,
                                isConnected 
                            });

                            if (isConnected) {
                                console.log('Creating stop proxy button');
                                const stopButton = document.createElement('button');
                                stopButton.id = 'stop-proxy';
                                stopButton.textContent = 'Stop Proxy';
                                proxyButtonsContainer.appendChild(stopButton);
                                
                                stopButton.addEventListener('click', () => {
                                    console.log('Stop proxy clicked');
                                    branchState.isProxyOperation = true;
                                    branchState.ignoreNextUpdate = true;
                                    stopButton.disabled = true;
                                    stopButton.textContent = 'Stopping...';
                                    vscode.postMessage({ command: 'stopProxy' });
                                });
                            } else {
                                console.log('Creating start proxy button');
                                const startButton = document.createElement('button');
                                startButton.id = 'start-proxy';
                                startButton.textContent = 'Start Proxy';
                                startButton.disabled = !branchState.selectedBranch;
                                proxyButtonsContainer.appendChild(startButton);
                                
                                startButton.addEventListener('click', () => {
                                    console.log('Start proxy clicked');
                                    branchState.isProxyOperation = true;
                                    branchState.ignoreNextUpdate = true;
                                    startButton.disabled = true;
                                    startButton.textContent = 'Starting...';
                                    const driverSelect = document.getElementById('driver-select');
                                    const message = {
                                        command: 'startProxy',
                                        driver: driverSelect?.value || 'postgres'
                                    };
                                    console.log('Sending message:', message);
                                    vscode.postMessage(message);
                                });
                            }
                        }

                        // Update connection info
                        const appDiv = document.getElementById('app');
                        if (appDiv) {
                            // Remove existing connection info if present
                            const existingInfo = appDiv.querySelector('.connection-info');
                            if (existingInfo) {
                                existingInfo.remove();
                            }

                            // Add new connection info if available
                            if (status.connectionInfo) {
                                console.log('Adding connection info');
                                const div = document.createElement('div');
                                div.className = 'connection-info';
                                div.innerHTML = \`<strong>Connection Info:</strong><br>\${status.connectionInfo}\`;
                                appDiv.appendChild(div);
                            }
                        }

                        // Ensure branch selection is preserved
                        const branchSelect = document.getElementById('branch-select');
                        if (branchSelect && branchState.lastKnownValue) {
                            console.log('Restoring branch selection to last known value:', branchState.lastKnownValue);
                            branchSelect.value = branchState.lastKnownValue;
                        }

                        // If this was a proxy operation completion, reset the flags
                        if (!status.loading) {
                            setTimeout(() => {
                                branchState.isProxyOperation = false;
                                branchState.ignoreNextUpdate = false;
                            }, 100);
                        }
                    }

                    // Setup initial button event listeners
                    function setupButtonListeners() {
                        console.log('Setting up button listeners');
                        
                        // Setup start proxy button
                        const startButton = document.getElementById('start-proxy');
                        if (startButton) {
                            startButton.addEventListener('click', () => {
                                console.log('Start proxy clicked');
                                startButton.disabled = true;
                                startButton.textContent = 'Starting...';
                                const driverSelect = document.getElementById('driver-select');
                                const message = {
                                    command: 'startProxy',
                                    driver: driverSelect?.value || 'postgres'
                                };
                                console.log('Sending message:', message);
                                vscode.postMessage(message);
                            });
                        }

                        // Setup stop proxy button
                        const stopButton = document.getElementById('stop-proxy');
                        if (stopButton) {
                            stopButton.addEventListener('click', () => {
                                console.log('Stop proxy clicked');
                                stopButton.disabled = true;
                                stopButton.textContent = 'Stopping...';
                                vscode.postMessage({ command: 'stopProxy' });
                            });
                        }
                    }

                    // Call setup immediately
                    setupButtonListeners();

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

                    // Event Listeners for org and project selects
                    document.getElementById('org-select')?.addEventListener('change', (e) => {
                        const target = e.target;
                        if (!target) return;
                        
                        console.log('Organization selected:', target.value);
                        currentState.selectedOrg = target.value;
                        currentState.selectedProject = undefined;
                        currentState.selectedBranch = undefined;
                        branchState.selectedBranch = null; // Reset branch state when org changes
                        
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
                        currentState.selectedBranch = undefined;
                        branchState.selectedBranch = null; // Reset branch state when project changes
                        
                        vscode.postMessage({
                            command: 'selectProject',
                            projectId: target.value
                        });
                    });
                </script>
            </body>
            </html>`;
    }
}