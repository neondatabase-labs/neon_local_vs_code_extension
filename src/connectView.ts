import * as vscode from 'vscode';
import { authenticate } from './auth';
import { ConfigurationManager, Logger } from './utils';
import { DEBOUNCE_DELAY, VIEW_TYPES } from './constants';
import { ViewData, WebviewMessage, NeonOrg, NeonProject, NeonBranch } from './types';
import { getStyles } from './templates/styles';
import { getSignInHtml } from './templates/signIn';
import * as path from 'path';
import { WebViewService } from './services/webview.service';
import { StateService } from './services/state.service';
import { DockerService } from './services/docker.service';
import { NeonApiService } from './services/api.service';

export class ConnectViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = VIEW_TYPES.CONNECT;
    private _view?: vscode.WebviewView;
    private _configurationChangeListener: vscode.Disposable;
    private _updateViewTimeout?: NodeJS.Timeout;
    private _isUpdating = false;
    private _lastRequestedConnectionType?: 'existing' | 'new';
    private _connectionTypeUpdateTimeout?: NodeJS.Timeout;
    private readonly _extensionUri: vscode.Uri;
    private readonly _webviewService: WebViewService;
    private readonly _stateService: StateService;
    private readonly _dockerService: DockerService;
    private readonly _extensionContext: vscode.ExtensionContext;
    private _lastUpdateData?: ViewData;

    constructor(
        extensionUri: vscode.Uri,
        webviewService: WebViewService,
        stateService: StateService,
        dockerService: DockerService,
        extensionContext: vscode.ExtensionContext
    ) {
        this._extensionUri = extensionUri;
        this._webviewService = webviewService;
        this._stateService = stateService;
        this._dockerService = dockerService;
        this._extensionContext = extensionContext;
        this._configurationChangeListener = vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('neonLocal.refreshToken') || e.affectsConfiguration('neonLocal.apiKey')) {
                this.debouncedUpdateView();
            }
        });
    }

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

        // Set up message handler first
        webviewView.webview.onDidReceiveMessage(this.handleWebviewMessage.bind(this));
        
        // Handle visibility changes
        webviewView.onDidChangeVisibility(() => {
            if (webviewView.visible) {
                // Force update when becoming visible
                this._lastUpdateData = undefined;
                this.updateView().catch(error => {
                    console.error('Error updating connect view on visibility change:', error);
                });
            }
        });

        // Initialize view with React app
        webviewView.webview.html = this.getWebviewContent(webviewView.webview);

        // Register this view with the manager
        this._webviewService.registerWebview(webviewView.webview);

        // Initial update with a small delay to ensure proper registration
        setTimeout(async () => {
            try {
                const apiService = new NeonApiService();

                // Start loading organizations
                await this._stateService.updateLoadingState({
                    orgs: true,
                    projects: true,
                    branches: true
                });

                // Fetch organizations first
                const orgs = await apiService.getOrgs();
                await this._stateService.setOrganizations(orgs);
                await this._stateService.updateLoadingState({
                    orgs: false
                });

                // If there's a pre-selected organization, fetch its projects
                const currentOrgId = this._stateService.currentOrg;
                if (currentOrgId) {
                    try {
                        const projects = await apiService.getProjects(currentOrgId);
                        await this._stateService.setProjects(projects);
                        await this._stateService.updateLoadingState({
                            projects: false
                        });

                        // If there's a pre-selected project, fetch its branches
                        const currentProjectId = this._stateService.currentProject;
                        if (currentProjectId) {
                            try {
                                const branches = await apiService.getBranches(currentProjectId);
                                await this._stateService.setBranches(branches);
                            } catch (error) {
                                console.error('Error fetching branches for pre-selected project:', error);
                                if (error instanceof Error) {
                                    vscode.window.showErrorMessage(`Failed to fetch branches: ${error.message}`);
                                }
                            }
                        }
                    } catch (error) {
                        console.error('Error fetching projects for pre-selected organization:', error);
                        if (error instanceof Error) {
                            vscode.window.showErrorMessage(`Failed to fetch projects: ${error.message}`);
                        }
                    }
                }

                // Clear loading states
                await this._stateService.updateLoadingState({
                    orgs: false,
                    projects: false,
                    branches: false
                });
                
                // Update view
                await this.updateView();
            } catch (error) {
                console.error('Error during initial connect view update:', error);
                if (error instanceof Error) {
                    vscode.window.showErrorMessage(error.message);
                }
                // Clear loading states on error
                await this._stateService.updateLoadingState({
                    orgs: false,
                    projects: false,
                    branches: false
                });
            }
        }, 100);
    }

    private debouncedUpdateView = () => {
        if (this._updateViewTimeout) {
            clearTimeout(this._updateViewTimeout);
        }
        this._updateViewTimeout = setTimeout(() => {
            this.updateView();
        }, DEBOUNCE_DELAY);
    };

    private async handleWebviewMessage(message: WebviewMessage): Promise<void> {
        if (!this._view) return;

        try {
            switch (message.command) {
                case 'signIn':
                    await this.handleSignIn();
                    break;
                case 'selectOrg':
                    // Get current state data
                    const viewData = await this._stateService.getViewData();
                    const selectedOrg = viewData.orgs.find((org: NeonOrg) => org.id === message.orgId);
                    if (!selectedOrg) {
                        console.error('Selected org not found:', message.orgId);
                        vscode.window.showErrorMessage('Selected organization not found');
                        return;
                    }
                    await this._stateService.updateState({
                        selection: {
                            orgs: viewData.orgs,
                            projects: [],
                            branches: [],
                            selectedOrgId: message.orgId,
                            selectedOrgName: selectedOrg.name,
                            selectedProjectId: undefined,
                            selectedProjectName: undefined,
                            selectedBranchId: undefined,
                            selectedBranchName: undefined,
                            parentBranchId: undefined,
                            parentBranchName: undefined
                        }
                    });
                    
                    // Fetch projects for the selected organization
                    try {
                        const apiService = new NeonApiService();
                        const projects = await apiService.getProjects(message.orgId);
                        await this._stateService.setProjects(projects);
                    } catch (error) {
                        console.error('Error fetching projects:', error);
                        if (error instanceof Error) {
                            vscode.window.showErrorMessage(`Failed to fetch projects: ${error.message}`);
                        }
                    }
                    await this.updateView();
                    break;
                case 'selectProject':
                    // Get current state data
                    const currentState = await this._stateService.getViewData();
                    const selectedProject = currentState.projects.find((project: NeonProject) => project.id === message.projectId);
                    if (!selectedProject) {
                        console.error('Selected project not found:', message.projectId);
                        vscode.window.showErrorMessage('Selected project not found');
                        return;
                    }
                    await this._stateService.updateState({
                        selection: {
                            orgs: currentState.orgs,
                            projects: currentState.projects,
                            branches: [],
                            selectedOrgId: currentState.selectedOrgId || '',
                            selectedOrgName: currentState.selectedOrgName || '',
                            selectedProjectId: message.projectId,
                            selectedProjectName: selectedProject.name,
                            selectedBranchId: undefined,
                            selectedBranchName: undefined,
                            parentBranchId: undefined,
                            parentBranchName: undefined
                        }
                    });
                    
                    // Fetch branches for the selected project
                    try {
                        const apiService = new NeonApiService();
                        const branches = await apiService.getBranches(message.projectId);
                        await this._stateService.setBranches(branches);
                    } catch (error) {
                        console.error('Error fetching branches:', error);
                        if (error instanceof Error) {
                            vscode.window.showErrorMessage(`Failed to fetch branches: ${error.message}`);
                        }
                    }
                    await this.updateView();
                    break;
                case 'selectBranch':
                    const branchState = await this._stateService.getViewData();
                    const selectedBranch = branchState.branches.find((branch: NeonBranch) => branch.id === message.branchId);
                    if (!selectedBranch) {
                        console.error('Selected branch not found:', message.branchId);
                        vscode.window.showErrorMessage('Selected branch not found');
                        return;
                    }
                    await this._stateService.setCurrentBranch(message.branchId);
                    await this._stateService.updateState({
                        selection: {
                            orgs: branchState.orgs,
                            projects: branchState.projects,
                            branches: branchState.branches,
                            selectedOrgId: branchState.selectedOrgId || '',
                            selectedOrgName: branchState.selectedOrgName || '',
                            selectedProjectId: branchState.selectedProjectId,
                            selectedProjectName: branchState.selectedProjectName,
                            selectedBranchId: message.branchId,
                            selectedBranchName: selectedBranch.name,
                            parentBranchId: branchState.parentBranchId,
                            parentBranchName: branchState.parentBranchName
                        }
                    });

                    // Only fetch databases and roles after branch selection
                    try {
                        const apiService = new NeonApiService();
                        const projectId = branchState.selectedProjectId;
                        if (!projectId) {
                            throw new Error('No project selected');
                        }
                        const [databases, roles] = await Promise.all([
                            apiService.getDatabases(projectId, message.branchId),
                            apiService.getRoles(projectId, message.branchId)
                        ]);
                        await Promise.all([
                            this._stateService.setDatabases(databases),
                            this._stateService.setRoles(roles)
                        ]);
                    } catch (error) {
                        console.error('Error fetching databases and roles:', error);
                        if (error instanceof Error) {
                            vscode.window.showErrorMessage(`Failed to fetch databases and roles: ${error.message}`);
                        }
                    }
                    await this.updateView();
                    break;
                case 'startProxy':
                    await this._stateService.setIsStarting(true);
                    try {
                        // Get the current state before starting the proxy
                        const currentState = await this._stateService.getViewData();
                        
                        // Start the container
                        await this._dockerService.startContainer({
                            branchId: message.branchId || message.parentBranchId,
                            driver: message.driver,
                            isExisting: message.isExisting,
                            context: this._extensionContext,
                            projectId: this._stateService.currentProject
                        });

                        // Update the state with the current branch information
                        if (message.isExisting) {
                            await this._stateService.setCurrentBranch(message.branchId);
                            await this._stateService.setCurrentlyConnectedBranch(message.branchId);
                        } else {
                            await this._stateService.setParentBranchId(message.parentBranchId);
                            await this._stateService.setCurrentlyConnectedBranch(message.parentBranchId);
                        }

                        // Preserve the current state
                        const currentFullState = await this._stateService.getViewData();
                        await this._stateService.updateState({
                            selection: {
                                orgs: currentState.orgs,
                                projects: currentState.projects,
                                branches: currentState.branches,
                                selectedOrgId: currentState.selectedOrgId || '',
                                selectedOrgName: currentState.selectedOrgName || '',
                                selectedProjectId: currentState.selectedProjectId,
                                selectedProjectName: currentState.selectedProjectName,
                                selectedBranchId: currentState.selectedBranchId,
                                selectedBranchName: currentState.selectedBranchName,
                                parentBranchId: currentState.parentBranchId,
                                parentBranchName: currentState.parentBranchName
                            },
                            connection: {
                                connected: currentFullState.connected,
                                isStarting: currentFullState.isStarting,
                                type: currentFullState.connectionType,
                                driver: currentFullState.selectedDriver,
                                connectionInfo: currentFullState.connectionInfo,
                                currentlyConnectedBranch: currentFullState.currentlyConnectedBranch,
                                selectedDatabase: currentFullState.selectedDatabase,
                                selectedRole: currentFullState.selectedRole,
                                databases: currentFullState.databases,
                                roles: currentFullState.roles
                            },
                            loading: currentFullState.loading
                        });

                        // Fetch and update databases and roles
                        const apiService = new NeonApiService();
                        const projectId = this._stateService.currentProject;
                        const branchId = message.branchId || message.parentBranchId;
                        const [databases, roles] = await Promise.all([
                            apiService.getDatabases(projectId, branchId),
                            apiService.getRoles(projectId, branchId)
                        ]);
                        await Promise.all([
                            this._stateService.setDatabases(databases),
                            this._stateService.setRoles(roles)
                        ]);
                    } catch (error) {
                        console.error('Error starting proxy:', error);
                        if (error instanceof Error) {
                            vscode.window.showErrorMessage(`Failed to start proxy: ${error.message}`);
                        }
                    } finally {
                        await this._stateService.setIsStarting(false);
                        await this.updateView();
                    }
                    break;
                case 'stopProxy':
                    await this._dockerService.stopContainer();
                    await this._stateService.setIsProxyRunning(false);
                    await this.updateView();
                    break;
                case 'updateConnectionType':
                    console.log('ConnectViewProvider: Handling connection type update:', {
                        newType: message.connectionType,
                        currentType: this._lastRequestedConnectionType
                    });
                    // Store the requested connection type
                    this._lastRequestedConnectionType = message.connectionType;
                    // Update the connection type through the state service
                    await this._stateService.setConnectionType(message.connectionType);
                    // Update the view to reflect the change
                    await this.updateView();
                    break;
                case 'requestInitialData':
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

    public dispose(): void {
        if (this._updateViewTimeout) {
            clearTimeout(this._updateViewTimeout);
        }
        if (this._connectionTypeUpdateTimeout) {
            clearTimeout(this._connectionTypeUpdateTimeout);
        }
        this._configurationChangeListener.dispose();
    }

    private getWebviewContent(webview: vscode.Webview): string {
        const scriptUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'dist', 'webview.js')
        );

        const styleUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'dist', 'styles.css')
        );

        const nonce = getNonce();

        return `<!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}' 'unsafe-eval'; img-src ${webview.cspSource} data: https:; font-src ${webview.cspSource}; connect-src 'self';">
                <link href="${styleUri}" rel="stylesheet" />
                <title>Neon Local</title>
            </head>
            <body data-view-type="${VIEW_TYPES.CONNECT}">
                <div id="root"></div>
                <script nonce="${nonce}" src="${scriptUri}"></script>
            </body>
            </html>`;
    }

    public async updateView(): Promise<void> {
        console.log('ConnectViewProvider: Starting updateView');
        if (!this._view || this._isUpdating) {
            console.log('ConnectViewProvider: Skipping update - view not ready or already updating');
            return;
        }

        this._isUpdating = true;
        console.log('ConnectViewProvider: Set _isUpdating flag');

        try {
            const apiKey = ConfigurationManager.getConfigValue('apiKey');
            const refreshToken = ConfigurationManager.getConfigValue('refreshToken');
            console.log('ConnectViewProvider: Checked tokens', { 
                hasApiKey: !!apiKey, 
                hasRefreshToken: !!refreshToken 
            });

            if (!apiKey && !refreshToken) {
                console.log('ConnectViewProvider: No tokens found, showing sign-in HTML');
                this._view.webview.html = getSignInHtml();
                this._isUpdating = false;
                return;
            }

            // If we're transitioning from sign-in to connect view, update the HTML
            if (this._view.webview.html.includes('sign-in-button')) {
                console.log('ConnectViewProvider: Transitioning from sign-in to connect view');
                this._view.webview.html = this.getWebviewContent(this._view.webview);
            }

            // Get the current view data
            console.log('ConnectViewProvider: Getting view data');
            const viewData = await this._stateService.getViewData();
            console.log('ConnectViewProvider: Got view data', {
                connected: viewData.connected,
                isStarting: viewData.isStarting,
                connectionType: viewData.connectionType,
                hasOrgs: viewData.orgs?.length > 0,
                hasProjects: viewData.projects?.length > 0,
                hasBranches: viewData.branches?.length > 0
            });

            // If we have a pending connection type change, ensure it's respected
            if (this._lastRequestedConnectionType && viewData.connectionType !== this._lastRequestedConnectionType) {
                console.log('ConnectViewProvider: Connection type mismatch, correcting:', {
                    requested: this._lastRequestedConnectionType,
                    received: viewData.connectionType
                });
                viewData.connectionType = this._lastRequestedConnectionType;
                viewData.isExplicitUpdate = true;
            }

            // Send data via postMessage
            console.log('ConnectViewProvider: Sending updateViewData message');
            await this._view.webview.postMessage({
                command: 'updateViewData',
                data: viewData
            });
            console.log('ConnectViewProvider: View update complete');
        } catch (error) {
            console.error('ConnectViewProvider: Error updating view:', error);
            if (error instanceof Error) {
                vscode.window.showErrorMessage(`Connect view update error: ${error.message}`);
            }
        } finally {
            this._isUpdating = false;
            console.log('ConnectViewProvider: Cleared _isUpdating flag');
        }
    }

    private async handleSignIn(): Promise<void> {
        try {
            // Show loading state
            if (this._view) {
                this._view.webview.postMessage({ command: 'showLoading' });
            }

            // Attempt authentication
            await authenticate();

            // Show success message briefly
            if (this._view) {
                this._view.webview.postMessage({ command: 'signInSuccess' });
            }

            // Wait a moment to show the success message
            await new Promise(resolve => setTimeout(resolve, 1000));

            // Update state service with authenticated state
            await this._stateService.updateState({
                connection: {
                    connected: false,
                    isStarting: false,
                    type: 'existing',
                    driver: 'postgres',
                    connectionInfo: '',
                    currentlyConnectedBranch: '',
                    selectedDatabase: '',
                    selectedRole: '',
                    databases: [],
                    roles: []
                },
                selection: {
                    orgs: [],
                    projects: [],
                    branches: [],
                    selectedOrgId: '',
                    selectedOrgName: '',
                    selectedProjectId: undefined,
                    selectedProjectName: undefined,
                    selectedBranchId: undefined,
                    selectedBranchName: undefined,
                    parentBranchId: undefined,
                    parentBranchName: undefined
                },
                loading: {
                    orgs: false,
                    projects: false,
                    branches: false
                }
            });

            // Update the view to show the connect interface
            await this.updateView();

            // Start loading organizations
            const apiService = new NeonApiService();
            await this._stateService.updateLoadingState({
                orgs: true,
                projects: false,
                branches: false
            });

            // Fetch organizations
            const orgs = await apiService.getOrgs();
            await this._stateService.setOrganizations(orgs);
            await this._stateService.updateLoadingState({
                orgs: false,
                projects: false,
                branches: false
            });

            // Update view again with organizations
            await this.updateView();

        } catch (error) {
            Logger.error('Error during sign in:', error);
            if (this._view) {
                this._view.webview.postMessage({ 
                    command: 'showError',
                    text: error instanceof Error ? error.message : 'Unknown error'
                });
            }
            if (error instanceof Error) {
                vscode.window.showErrorMessage(`Sign in error: ${error.message}`);
            }
        }
    }
}

function getNonce() {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
} 