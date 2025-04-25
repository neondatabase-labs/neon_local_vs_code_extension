import * as vscode from 'vscode';
import { authenticate, refreshToken } from './auth';
import * as path from 'path';
import * as fs from 'fs';

interface ViewData {
    connected?: boolean;
    connectionInfo?: string;
    orgs?: Array<{ id: string; name: string }>;
    projects?: Array<{ id: string; name: string }>;
    branches?: Array<{ id: string; name: string }>;
    selectedOrgId?: string;
    selectedProjectId?: string;
    selectedBranchId?: string;
    selectedDriver?: string;
    selectedOrgName?: string;
    selectedProjectName?: string;
    selectedBranchName?: string;
    selectedBranch?: any;
    loading?: boolean;
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
                    case 'refresh':
                        console.log('Handling refresh request');
                        await this.updateView();
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

    private getWebviewContent(data: ViewData): string {
        console.log('getWebviewContent data:', JSON.stringify({
            organizations: data.orgs,
            selectedOrgId: data.selectedOrgId,
            connected: data.connected
        }, null, 2));
        
        // Rename to getMainHtml for consistency
        return this.getMainHtml(data);
    }

    private getMainHtml(data: ViewData): string {
        const isConnected = data.connected || !!data.connectionInfo;
        console.log('Main HTML data:', JSON.stringify({
            organizations: data.orgs,
            selectedOrgId: data.selectedOrgId,
            connected: isConnected
        }, null, 2));

        return `<!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Neon Local</title>
                ${this.getStyles()}
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

                    <div class="main-content">
                        <div class="connection-status">
                            <div class="status-indicator ${isConnected ? 'connected' : 'disconnected'}">
                                <span class="status-dot"></span>
                                ${isConnected ? 'Connected' : 'Not Connected'}
                            </div>
                        </div>

                        ${isConnected ? `
                            <div class="readonly-view">
                                <div class="readonly-section">
                                    <div class="readonly-label">Organization</div>
                                    <div class="readonly-value">${data.selectedOrgName || 'Not selected'}</div>
                                </div>
                                <div class="readonly-section">
                                    <div class="readonly-label">Project</div>
                                    <div class="readonly-value">${data.selectedProjectName || 'Not selected'}</div>
                                </div>
                                <div class="readonly-section">
                                    <div class="readonly-label">Branch</div>
                                    <div class="readonly-value">${data.selectedBranchName || 'Not selected'}</div>
                                </div>
                                <div class="readonly-section">
                                    <div class="readonly-label">Driver</div>
                                    <div class="readonly-value">${data.selectedDriver === 'neon' ? 'Neon Serverless' : 'PostgreSQL'}</div>
                                </div>
                            </div>
                        ` : this.getFormContent(data)}
                    </div>

                    ${this.getProxyContent(data)}
                </div>
                ${this.getScriptContent(data)}
            </body>
            </html>`;
    }

    private getFormContent(data: ViewData): string {
        // Debug logging
        console.log('Form content data:', {
            selectedOrgId: data.selectedOrgId,
            projects: data.projects,
            connected: data.connected
        });
        
        // Use orgs instead of organizations
        const organizations = Array.isArray(data.orgs) ? data.orgs : [];
        
        return `
            <div class="form-content">
                <div class="section">
                    <label for="org-select">Organization</label>
                    <select id="org-select" ${data.connected ? 'disabled' : ''}>
                        <option value="">Select Organization</option>
                        ${organizations.map((org) => `
                            <option value="${org.id}" ${org.id === data.selectedOrgId ? 'selected' : ''}>
                                ${org.name}
                            </option>
                        `).join('')}
                    </select>
                </div>

                <div class="section">
                    <label for="project-select">Project</label>
                    <select id="project-select" ${!data.selectedOrgId || data.connected ? 'disabled' : ''}>
                        <option value="">Select Project</option>
                        ${Array.isArray(data.projects) ? data.projects.map((project) => `
                            <option value="${project.id}" ${project.id === data.selectedProjectId ? 'selected' : ''}>
                                ${project.name}
                            </option>
                        `).join('') : ''}
                    </select>
                </div>

                <div class="section">
                    <label for="branch-select">Branch</label>
                    <select id="branch-select" ${!data.selectedProjectId || data.connected ? 'disabled' : ''}>
                        <option value="">Select Branch</option>
                        ${Array.isArray(data.branches) ? data.branches.map((branch) => `
                            <option value="${branch.id}" ${branch.id === data.selectedBranchId ? 'selected' : ''}>
                                ${branch.name}
                            </option>
                        `).join('') : ''}
                    </select>
                </div>

                <div class="section">
                    <label for="driver-select">Driver</label>
                    <select id="driver-select" ${!data.selectedBranchId || data.connected ? 'disabled' : ''}>
                        <option value="neon" ${data.selectedDriver === 'neon' ? 'selected' : ''}>Neon Serverless</option>
                        <option value="postgres" ${data.selectedDriver === 'postgres' ? 'selected' : ''}>PostgreSQL</option>
                    </select>
                </div>
            </div>
        `;
    }

    private getProxyContent(data: ViewData): string {
        return `
            <div class="section proxy-buttons">
                ${data.connected ? 
                    `<button id="stop-proxy">Stop Proxy</button>` : 
                    `<button id="start-proxy" ${!data.selectedBranch ? 'disabled' : ''}>Start Proxy</button>`
                }
            </div>

            ${data.connectionInfo ? `
                <div class="connection-info">
                    <div class="connection-header">
                        <strong>Connection Info</strong>
                        <button class="copy-button">
                            Copy
                            <span class="copy-success">Copied!</span>
                        </button>
                    </div>
                    <div class="connection-string">${data.connectionInfo}</div>
                </div>
            ` : ''}`;
    }

    private getScriptContent(data: ViewData): string {
        return `
            <script>
                const vscode = acquireVsCodeApi();
                let currentState = ${JSON.stringify({
                    organizations: data.orgs || [],
                    projects: data.projects || [],
                    branches: data.branches || [],
                    selectedOrgId: data.selectedOrgId,
                    selectedProjectId: data.selectedProjectId,
                    selectedBranchId: data.selectedBranchId,
                    selectedDriver: data.selectedDriver,
                    connected: data.connected,
                    connectionInfo: data.connectionInfo
                })};
                console.log('Initial state:', currentState);

                function updateStartProxyButton() {
                    const startButton = document.getElementById('start-proxy');
                    if (!startButton) return;

                    const orgSelect = document.getElementById('org-select');
                    const projectSelect = document.getElementById('project-select');
                    const branchSelect = document.getElementById('branch-select');
                    const driverSelect = document.getElementById('driver-select');

                    const allSelected = orgSelect?.value && 
                                      projectSelect?.value && 
                                      branchSelect?.value && 
                                      driverSelect?.value;

                    startButton.disabled = !allSelected || currentState.connected;
                }

                function updateProjectDropdown(projects) {
                    console.log('Updating project dropdown with:', projects);
                    const projectSelect = document.getElementById('project-select');
                    if (!projectSelect) return;

                    // Store current selection
                    const currentSelection = projectSelect.value;

                    // Clear existing options except the first one
                    while (projectSelect.options.length > 1) {
                        projectSelect.remove(1);
                    }

                    // Add new options
                    projects.forEach(project => {
                        const option = document.createElement('option');
                        option.value = project.id;
                        option.text = project.name;
                        option.selected = project.id === currentSelection;
                        projectSelect.add(option);
                    });

                    // Enable the dropdown if we have an organization selected
                    const orgSelect = document.getElementById('org-select');
                    projectSelect.disabled = !orgSelect.value || currentState.connected;

                    // Update start proxy button state
                    updateStartProxyButton();
                }

                function updateBranchDropdown(branches) {
                    console.log('Updating branch dropdown with:', branches);
                    const branchSelect = document.getElementById('branch-select');
                    if (!branchSelect) return;

                    // Store current selection
                    const currentSelection = branchSelect.value;

                    // Clear existing options except the first one
                    while (branchSelect.options.length > 1) {
                        branchSelect.remove(1);
                    }

                    // Add new options
                    branches.forEach(branch => {
                        const option = document.createElement('option');
                        option.value = branch.id;
                        option.text = branch.name;
                        option.selected = branch.id === currentSelection;
                        branchSelect.add(option);
                    });

                    // Enable the dropdown if we have a project selected
                    const projectSelect = document.getElementById('project-select');
                    branchSelect.disabled = !projectSelect.value || currentState.connected;

                    // Update driver dropdown state
                    const driverSelect = document.getElementById('driver-select');
                    if (driverSelect) {
                        driverSelect.disabled = !branchSelect.value || currentState.connected;
                    }

                    // Update start proxy button state
                    updateStartProxyButton();
                }

                function initializeDropdowns() {
                    // Setup organization dropdown
                    const orgSelect = document.getElementById('org-select');
                    if (orgSelect) {
                        orgSelect.addEventListener('change', function() {
                            console.log('Organization selected:', this.value);
                            currentState.selectedOrgId = this.value;
                            
                            // Clear and disable dependent dropdowns
                            const projectSelect = document.getElementById('project-select');
                            const branchSelect = document.getElementById('branch-select');
                            const driverSelect = document.getElementById('driver-select');
                            
                            if (projectSelect) {
                                projectSelect.value = '';
                                projectSelect.disabled = !this.value || currentState.connected;
                                currentState.selectedProjectId = '';
                            }
                            if (branchSelect) {
                                branchSelect.value = '';
                                branchSelect.disabled = true;
                                currentState.selectedBranchId = '';
                            }
                            if (driverSelect) {
                                driverSelect.value = 'postgres';
                                driverSelect.disabled = true;
                            }

                            // Update start proxy button state
                            updateStartProxyButton();

                            vscode.postMessage({
                                command: 'selectOrg',
                                orgId: this.value
                            });
                        });
                    }

                    // Setup project dropdown
                    const projectSelect = document.getElementById('project-select');
                    if (projectSelect) {
                        projectSelect.addEventListener('change', function() {
                            console.log('Project selected:', this.value);
                            currentState.selectedProjectId = this.value;
                            
                            // Clear and disable dependent dropdowns
                            const branchSelect = document.getElementById('branch-select');
                            const driverSelect = document.getElementById('driver-select');
                            
                            if (branchSelect) {
                                branchSelect.value = '';
                                branchSelect.disabled = !this.value || currentState.connected;
                                currentState.selectedBranchId = '';
                            }
                            if (driverSelect) {
                                driverSelect.value = 'postgres';
                                driverSelect.disabled = true;
                            }

                            // Update start proxy button state
                            updateStartProxyButton();

                            vscode.postMessage({
                                command: 'selectProject',
                                projectId: this.value
                            });
                        });
                    }

                    // Setup branch dropdown
                    const branchSelect = document.getElementById('branch-select');
                    if (branchSelect) {
                        branchSelect.addEventListener('change', function() {
                            console.log('Branch selected:', this.value);
                            currentState.selectedBranchId = this.value;
                            
                            const driverSelect = document.getElementById('driver-select');
                            if (driverSelect) {
                                driverSelect.disabled = !this.value || currentState.connected;
                            }

                            // Update start proxy button state
                            updateStartProxyButton();

                            vscode.postMessage({
                                command: 'selectBranch',
                                branchId: this.value,
                                restartProxy: false,
                                driver: driverSelect?.value || 'postgres'
                            });
                        });
                    }

                    // Setup driver dropdown
                    const driverSelect = document.getElementById('driver-select');
                    if (driverSelect) {
                        driverSelect.addEventListener('change', function() {
                            console.log('Driver selected:', this.value);
                            currentState.selectedDriver = this.value;

                            // Update start proxy button state
                            updateStartProxyButton();
                            
                            const branchSelect = document.getElementById('branch-select');
                            if (branchSelect && branchSelect.value) {
                                vscode.postMessage({
                                    command: 'selectBranch',
                                    branchId: branchSelect.value,
                                    restartProxy: true,
                                    driver: this.value
                                });
                            }
                        });
                    }

                    // Setup proxy buttons
                    const startButton = document.getElementById('start-proxy');
                    if (startButton) {
                        startButton.addEventListener('click', handleStartProxy);
                    }

                    const stopButton = document.getElementById('stop-proxy');
                    if (stopButton) {
                        stopButton.addEventListener('click', handleStopProxy);
                    }

                    // Setup copy button
                    const copyButton = document.querySelector('.copy-button');
                    if (copyButton) {
                        copyButton.addEventListener('click', copyConnectionString);
                    }

                    // Initialize dropdowns with current state if available
                    if (currentState.projects && currentState.projects.length > 0) {
                        updateProjectDropdown(currentState.projects);
                    }
                    if (currentState.branches && currentState.branches.length > 0) {
                        updateBranchDropdown(currentState.branches);
                    }
                }

                function handleStartProxy() {
                    console.log('Start proxy clicked');
                    const startButton = document.getElementById('start-proxy');
                    const driverSelect = document.getElementById('driver-select');
                    
                    if (startButton) {
                        startButton.disabled = true;
                        startButton.textContent = 'Starting...';
                    }
                    
                    vscode.postMessage({
                        command: 'startProxy',
                        driver: driverSelect?.value || 'postgres'
                    });
                }

                function handleStopProxy() {
                    console.log('Stop proxy clicked');
                    const stopButton = document.getElementById('stop-proxy');
                    
                    if (stopButton) {
                        stopButton.disabled = true;
                        stopButton.textContent = 'Stopping...';
                    }
                    
                    vscode.postMessage({ command: 'stopProxy' });
                }

                function copyConnectionString() {
                    const connectionString = document.querySelector('.connection-string')?.textContent;
                    if (connectionString) {
                        navigator.clipboard.writeText(connectionString).then(() => {
                            const successMessage = document.querySelector('.copy-success');
                            if (successMessage) {
                                successMessage.classList.add('visible');
                                setTimeout(() => {
                                    successMessage.classList.remove('visible');
                                }, 2000);
                            }
                        });
                    }
                }

                // Handle all incoming messages
                window.addEventListener('message', event => {
                    const message = event.data;
                    console.log('Received message:', message);

                    switch (message.command) {
                        case 'updateStatus':
                            console.log('Status update received:', message);
                            updateStatus(message);
                            break;
                        case 'updateProjects':
                            console.log('Projects update received:', message.projects);
                            currentState.projects = message.projects;
                            updateProjectDropdown(message.projects);
                            break;
                        case 'updateBranches':
                            console.log('Branches update received:', message.branches);
                            currentState.branches = message.branches;
                            updateBranchDropdown(message.branches);
                            break;
                    }
                });

                function updateStatus(status) {
                    console.log('Updating status with full details:', {
                        status,
                        currentState
                    });
                    
                    // Update current state first
                    const wasConnected = currentState.connected;
                    currentState.connected = status.connected || !!status.connectionInfo;
                    console.log('Connection state change:', { wasConnected, isConnected: currentState.connected });

                    // If connection state changed, request a full page refresh
                    if (wasConnected !== currentState.connected) {
                        console.log('Connection state changed, requesting refresh');
                        vscode.postMessage({ command: 'refresh' });
                        return;
                    }

                    // Update proxy buttons
                    const proxyButtonsContainer = document.querySelector('.proxy-buttons');
                    if (proxyButtonsContainer) {
                        proxyButtonsContainer.innerHTML = currentState.connected ?
                            \`<button id="stop-proxy">Stop Proxy</button>\` :
                            \`<button id="start-proxy">Start Proxy</button>\`;
                        
                        // Re-attach event listeners
                        const startButton = document.getElementById('start-proxy');
                        const stopButton = document.getElementById('stop-proxy');
                        if (startButton) {
                            startButton.addEventListener('click', handleStartProxy);
                            // Update button state
                            updateStartProxyButton();
                        }
                        if (stopButton) {
                            stopButton.addEventListener('click', handleStopProxy);
                        }
                    }

                    // Update connection info
                    const appDiv = document.getElementById('app');
                    if (appDiv) {
                        const existingInfo = appDiv.querySelector('.connection-info');
                        if (existingInfo) {
                            existingInfo.remove();
                        }

                        if (status.connectionInfo) {
                            const div = document.createElement('div');
                            div.className = 'connection-info';
                            div.innerHTML = \`
                                <div class="connection-header">
                                    <strong>Connection Info</strong>
                                    <button class="copy-button">
                                        Copy
                                        <span class="copy-success">Copied!</span>
                                    </button>
                                </div>
                                <div class="connection-string">\${status.connectionInfo}</div>
                            \`;
                            appDiv.appendChild(div);

                            // Re-attach copy button event listener
                            const copyButton = div.querySelector('.copy-button');
                            if (copyButton) {
                                copyButton.addEventListener('click', copyConnectionString);
                            }
                        }
                    }
                }

                // Initialize dropdowns when the DOM is loaded
                document.addEventListener('DOMContentLoaded', () => {
                    console.log('DOM loaded, initializing dropdowns');
                    initializeDropdowns();
                });
            </script>`;
    }

    private getStyles(): string {
        return `
            <style>
                body {
                    padding: 20px;
                    font-family: var(--vscode-font-family);
                    background-color: var(--vscode-editor-background);
                    color: var(--vscode-editor-foreground);
                    line-height: 1.5;
                }
                select, button {
                    width: 100%;
                    padding: 8px 12px;
                    margin: 8px 0;
                    background-color: var(--vscode-dropdown-background);
                    color: var(--vscode-dropdown-foreground);
                    border: 1px solid var(--vscode-dropdown-border);
                    border-radius: 4px;
                    font-size: 13px;
                    transition: border-color 0.2s, opacity 0.2s;
                }
                select:focus, button:focus {
                    outline: 1px solid var(--vscode-focusBorder);
                    outline-offset: -1px;
                }
                select:hover:not(:disabled) {
                    border-color: var(--vscode-dropdown-listBackground);
                }
                button {
                    background-color: var(--vscode-button-background);
                    color: var(--vscode-button-foreground);
                    border: none;
                    cursor: pointer;
                    font-weight: 500;
                    text-align: center;
                    transition: background-color 0.2s;
                }
                button:hover:not(:disabled) {
                    background-color: var(--vscode-button-hoverBackground);
                }
                button:disabled {
                    opacity: 0.5;
                    cursor: not-allowed;
                }
                .section {
                    margin-bottom: 20px;
                }
                .section label {
                    display: block;
                    margin-bottom: 6px;
                    color: var(--vscode-foreground);
                    font-size: 13px;
                    font-weight: 500;
                }
                .connection-info {
                    background-color: var(--vscode-textBlockQuote-background);
                    padding: 12px;
                    border-radius: 4px;
                    margin-top: 16px;
                    white-space: pre-wrap;
                    font-family: var(--vscode-editor-font-family);
                    font-size: 13px;
                    border-left: 4px solid var(--vscode-textBlockQuote-border);
                }
                .connection-info strong {
                    color: var(--vscode-foreground);
                    display: block;
                    margin-bottom: 8px;
                }
                .proxy-buttons {
                    display: flex;
                    gap: 12px;
                }
                .header {
                    display: flex;
                    align-items: center;
                    margin-bottom: 24px;
                    gap: 12px;
                    padding-bottom: 12px;
                    border-bottom: 1px solid var(--vscode-panel-border);
                }
                .header h1 {
                    margin: 0;
                    font-size: 16px;
                    font-weight: 600;
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
                select:disabled {
                    opacity: 0.5;
                    cursor: not-allowed;
                }
                .copy-button {
                    background-color: var(--vscode-button-secondaryBackground);
                    color: var(--vscode-button-secondaryForeground);
                    padding: 4px 8px;
                    margin-left: 8px;
                    font-size: 12px;
                    border-radius: 3px;
                }
                .copy-button:hover:not(:disabled) {
                    background-color: var(--vscode-button-secondaryHoverBackground);
                }
                .copy-success {
                    color: var(--vscode-notificationsSuccessIcon-foreground, #89D185);
                    font-size: 12px;
                    margin-left: 8px;
                    opacity: 0;
                    transition: opacity 0.3s;
                }
                .copy-success.visible {
                    opacity: 1;
                }
                .connection-info-container {
                    position: relative;
                }
                .connection-string {
                    margin-top: 8px;
                    padding: 8px;
                    background-color: var(--vscode-input-background);
                    border: 1px solid var(--vscode-input-border);
                    border-radius: 3px;
                    font-family: var(--vscode-editor-font-family);
                    font-size: 12px;
                }
                .tooltip {
                    position: absolute;
                    background-color: var(--vscode-notifications-background);
                    color: var(--vscode-notifications-foreground);
                    padding: 4px 8px;
                    border-radius: 3px;
                    font-size: 12px;
                    z-index: 1000;
                    opacity: 0;
                    transition: opacity 0.2s;
                    pointer-events: none;
                }
                .tooltip.visible {
                    opacity: 1;
                }
                .connection-details {
                    background-color: var(--vscode-editor-background);
                    border: 1px solid var(--vscode-panel-border);
                    border-radius: 4px;
                    padding: 12px;
                    margin: 16px 0;
                }
                .detail-row {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    padding: 6px 0;
                    border-bottom: 1px solid var(--vscode-panel-border);
                }
                .detail-row:last-child {
                    border-bottom: none;
                }
                .detail-label {
                    color: var(--vscode-descriptionForeground);
                    font-size: 13px;
                    font-weight: 500;
                }
                .detail-value {
                    color: var(--vscode-foreground);
                    font-size: 13px;
                    font-weight: normal;
                }
                .connection-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin-bottom: 8px;
                }
                .connection-header strong {
                    margin-bottom: 0;
                }
                .connection-status {
                    margin-bottom: 20px;
                    padding: 8px 0;
                }
                .status-indicator {
                    display: flex;
                    align-items: center;
                    font-size: 13px;
                    font-weight: 500;
                }
                .status-dot {
                    width: 8px;
                    height: 8px;
                    border-radius: 50%;
                    margin-right: 8px;
                }
                .status-indicator.connected {
                    color: var(--vscode-testing-iconPassed, #73C991);
                }
                .status-indicator.connected .status-dot {
                    background-color: var(--vscode-testing-iconPassed, #73C991);
                    box-shadow: 0 0 4px var(--vscode-testing-iconPassed, #73C991);
                }
                .status-indicator.disconnected {
                    color: var(--vscode-testing-iconQueued, #919191);
                }
                .status-indicator.disconnected .status-dot {
                    background-color: var(--vscode-testing-iconQueued, #919191);
                }
                .readonly-view {
                    background-color: var(--vscode-editor-background);
                    border: 1px solid var(--vscode-panel-border);
                    border-radius: 4px;
                    overflow: hidden;
                }
                .readonly-section {
                    display: flex;
                    padding: 10px 12px;
                    border-bottom: 1px solid var(--vscode-panel-border);
                }
                .readonly-section:last-child {
                    border-bottom: none;
                }
                .readonly-label {
                    flex: 0 0 100px;
                    color: var(--vscode-descriptionForeground);
                    font-size: 13px;
                }
                .readonly-value {
                    flex: 1;
                    color: var(--vscode-foreground);
                    font-size: 13px;
                    font-weight: 500;
                }
            </style>`;
    }
}