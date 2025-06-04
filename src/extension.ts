import * as vscode from 'vscode';
import { DockerService } from './services/docker.service';
import { NeonApiService } from './services/api.service';
import { IStateService, StateService } from './services/state.service';
import { WebViewService } from './services/webview.service';
import { SignInWebviewProvider } from './signInView';
import { NeonLocalManager, ViewData, NeonDatabase, NeonRole } from './types';
import { ConnectViewProvider } from './connectView';
import { DatabaseViewProvider } from './databaseView';
import { ActionsViewProvider } from './actionsView';
import { VIEW_TYPES } from './constants';

export class NeonLocalExtension implements NeonLocalManager {
    private dockerService: DockerService;
    private apiService: NeonApiService;
    public stateService: IStateService;
    private webviewService: WebViewService;
    private statusCheckInterval?: NodeJS.Timeout;
    private _databases: NeonDatabase[] = [];
    private _roles: NeonRole[] = [];

    constructor(private context: vscode.ExtensionContext) {
        this.dockerService = new DockerService(context);
        this.apiService = new NeonApiService();
        this.stateService = new StateService(context);
        this.webviewService = new WebViewService();
    }

    public async activate() {
        // Register commands
        this.registerCommands();

        // Register views
        this.registerViews();

        // Start status check
        this.startStatusCheck();

        // Initial container status check and view data update
        await this.checkContainerStatus();
        await this.updateViewData();
    }

    public deactivate() {
        if (this.statusCheckInterval) {
            clearInterval(this.statusCheckInterval);
        }
    }

    private registerCommands() {
        this.context.subscriptions.push(
            vscode.commands.registerCommand('neon-local.configure', () => this.configure()),
            vscode.commands.registerCommand('neon-local.showPanel', () => this.showPanel()),
            vscode.commands.registerCommand('neon-local.stopProxy', () => this.stopProxy()),
            vscode.commands.registerCommand('neon-local.clearAuth', () => this.clearAuth()),
            vscode.commands.registerCommand('neon-local.resetFromParent', async () => {
                if (!this.stateService.currentProject || !this.stateService.isProxyRunning) {
                    vscode.window.showErrorMessage('No active project or proxy connection.');
                    return;
                }

                // Determine which branch ID to use
                let branchId: string;
                if (this.stateService.connectionType === 'new') {
                    // For new branches, read from the file
                    branchId = await this.stateService.currentlyConnectedBranch;
                    if (!branchId) {
                        vscode.window.showErrorMessage('Could not determine branch ID. Please wait for the connection to be established.');
                        return;
                    }
                } else {
                    // For existing branches, use the selected branch
                    branchId = this.stateService.currentBranch || '';
                    if (!branchId) {
                        vscode.window.showErrorMessage('No branch selected.');
                        return;
                    }
                }

                // Show confirmation dialog
                const answer = await vscode.window.showWarningMessage(
                    'Are you sure you want to reset this branch to its parent state? This action cannot be undone.',
                    { modal: true },
                    'Yes, Reset Branch',
                    'Cancel'
                );

                if (answer !== 'Yes, Reset Branch') {
                    return;
                }

                try {
                    // Show progress notification
                    await vscode.window.withProgress({
                        location: vscode.ProgressLocation.Notification,
                        title: 'Resetting branch to parent...',
                        cancellable: false
                    }, async () => {
                        await this.apiService.resetBranchToParent(this.stateService.currentProject || '', branchId);
                        vscode.window.showInformationMessage('Branch has been reset to parent state.');
                        
                        // Refresh the view data after reset
                        await this.updateViewData();
                    });
                } catch (error) {
                    this.handleError(error);
                }
            }),
            vscode.commands.registerCommand('neon-local.openSqlEditor', async () => {
                if (!this.stateService.currentProject || !this.stateService.isProxyRunning) {
                    vscode.window.showErrorMessage('No active project or proxy connection.');
                    return;
                }

                // Determine which branch ID to use
                let branchId: string;
                if (this.stateService.connectionType === 'new') {
                    // For new branches, read from the file
                    branchId = await this.stateService.currentlyConnectedBranch;
                    if (!branchId) {
                        vscode.window.showErrorMessage('Could not determine branch ID. Please wait for the connection to be established.');
                        return;
                    }
                } else {
                    // For existing branches, use the selected branch
                    branchId = this.stateService.currentBranch || '';
                    if (!branchId) {
                        vscode.window.showErrorMessage('No branch selected.');
                        return;
                    }
                }

                // Fetch latest databases
                await this.fetchDatabasesAndRoles();

                // Get list of databases
                const databases = this._databases.map(db => db.name);
                if (databases.length === 0) {
                    vscode.window.showErrorMessage('No databases available. Please wait a moment and try again.');
                    return;
                }

                // Ask user to select a database
                const selectedDatabase = await vscode.window.showQuickPick(databases, {
                    placeHolder: 'Select a database to open in SQL Editor'
                });

                if (!selectedDatabase) {
                    return; // User cancelled
                }

                // Open SQL Editor URL
                const url = `https://console.neon.tech/app/projects/${this.stateService.currentProject}/branches/${branchId}/sql-editor?database=${selectedDatabase}`;
                vscode.env.openExternal(vscode.Uri.parse(url));
            }),
            vscode.commands.registerCommand('neon-local.openTableView', async () => {
                if (!this.stateService.currentProject || !this.stateService.isProxyRunning) {
                    vscode.window.showErrorMessage('No active project or proxy connection.');
                    return;
                }

                // Determine which branch ID to use
                let branchId: string;
                if (this.stateService.connectionType === 'new') {
                    // For new branches, read from the file
                    branchId = await this.stateService.currentlyConnectedBranch;
                    if (!branchId) {
                        vscode.window.showErrorMessage('Could not determine branch ID. Please wait for the connection to be established.');
                        return;
                    }
                } else {
                    // For existing branches, use the selected branch
                    branchId = this.stateService.currentBranch || '';
                    if (!branchId) {
                        vscode.window.showErrorMessage('No branch selected.');
                        return;
                    }
                }

                // Fetch latest databases
                await this.fetchDatabasesAndRoles();

                // Get list of databases
                const databases = this._databases.map(db => db.name);
                if (databases.length === 0) {
                    vscode.window.showErrorMessage('No databases available. Please wait a moment and try again.');
                    return;
                }

                // Ask user to select a database
                const selectedDatabase = await vscode.window.showQuickPick(databases, {
                    placeHolder: 'Select a database to view tables'
                });

                if (!selectedDatabase) {
                    return; // User cancelled
                }

                // Open Table View URL with database parameter
                const url = `https://console.neon.tech/app/projects/${this.stateService.currentProject}/branches/${branchId}/tables?database=${selectedDatabase}`;
                vscode.env.openExternal(vscode.Uri.parse(url));
            }),
            vscode.commands.registerCommand('neon-local.launchPsql', async () => {
                if (!this.stateService.currentProject || !this.stateService.isProxyRunning) {
                    vscode.window.showErrorMessage('No active project or proxy connection.');
                    return;
                }

                // Determine which branch ID to use
                let branchId: string;
                if (this.stateService.connectionType === 'new') {
                    // For new branches, read from the file
                    branchId = await this.stateService.currentlyConnectedBranch;
                    if (!branchId) {
                        vscode.window.showErrorMessage('Could not determine branch ID. Please wait for the connection to be established.');
                        return;
                    }
                } else {
                    // For existing branches, use the selected branch
                    branchId = this.stateService.currentBranch || '';
                    if (!branchId) {
                        vscode.window.showErrorMessage('No branch selected.');
                        return;
                    }
                }

                // Get list of databases
                const databases = this._databases.map(db => db.name);
                if (databases.length === 0) {
                    vscode.window.showErrorMessage('No databases available.');
                    return;
                }

                // Ask user to select a database
                const selectedDatabase = await vscode.window.showQuickPick(databases, {
                    placeHolder: 'Select a database'
                });

                if (!selectedDatabase) {
                    return; // User cancelled
                }

                // Get list of roles
                const roles = this._roles.map(role => role.name);
                if (roles.length === 0) {
                    vscode.window.showErrorMessage('No roles available.');
                    return;
                }

                // Ask user to select a role
                const selectedRole = await vscode.window.showQuickPick(roles, {
                    placeHolder: 'Select a role'
                });

                if (!selectedRole) {
                    return; // User cancelled
                }

                try {
                    // Get the branch endpoint and role password
                    const [endpoint, password] = await Promise.all([
                        this.apiService.getBranchEndpoint(this.stateService.currentProject, branchId),
                        this.apiService.getRolePassword(this.stateService.currentProject, branchId, selectedRole)
                    ]);

                    // Create the psql connection string
                    const connectionString = `postgresql://${selectedRole}:${password}@${endpoint}/${selectedDatabase}?sslmode=require`;

                    // Create a new terminal and run the psql command
                    const terminal = vscode.window.createTerminal('Neon PSQL');
                    terminal.show();
                    terminal.sendText(`psql '${connectionString}'`);
                } catch (error) {
                    this.handleError(error);
                }
            }),
            vscode.commands.registerCommand('neonLocal.refresh', async () => {
                try {
                    await this.updateViewData();
                    await this.webviewService.postMessage({ command: 'refresh' });
                } catch (error) {
                    this.handleError(error);
                }
            })
        );
    }

    private registerViews() {
        const signInProvider = new SignInWebviewProvider(this.context.extensionUri);
        const connectProvider = new ConnectViewProvider(this.context.extensionUri, this);
        const databaseProvider = new DatabaseViewProvider(this.context.extensionUri, this);
        const actionsProvider = new ActionsViewProvider(this.context.extensionUri, this);

        this.context.subscriptions.push(
            vscode.window.registerWebviewViewProvider(VIEW_TYPES.SIGN_IN, signInProvider),
            vscode.window.registerWebviewViewProvider(VIEW_TYPES.CONNECT, connectProvider),
            vscode.window.registerWebviewViewProvider(VIEW_TYPES.DATABASE, databaseProvider),
            vscode.window.registerWebviewViewProvider(VIEW_TYPES.ACTIONS, actionsProvider)
        );
    }

    private startStatusCheck() {
        this.statusCheckInterval = setInterval(() => {
            this.checkContainerStatus();
        }, 5000);
    }

    private async checkContainerStatus() {
        const isRunning = await this.dockerService.checkContainerStatus();
        
        if (this.stateService.isProxyRunning !== isRunning) {
            if (isRunning) {
                // Get the current branch ID from the .branches file
                const currentlyConnectedBranch = await this.stateService.currentlyConnectedBranch;
                
                // If we have a branch ID but no project/branch info, try to restore from the .branches file
                if (currentlyConnectedBranch) {
                    // Get the current driver from the container
                    const driver = await this.dockerService.getCurrentDriver();
                    await this.stateService.setSelectedDriver(driver === 'serverless' ? 'serverless' : 'postgres');
                    
                    // Set the proxy as running
                    await this.stateService.setIsProxyRunning(true);
                    
                    // Fetch databases and roles since we're connected
                    await this.fetchDatabasesAndRoles();
                }
            } else {
                // Container is not running, update state accordingly
                await this.stateService.setIsProxyRunning(false);
            }
        }
    }

    private async updateViewData(isExplicitUpdate: boolean = false) {
        try {
            console.log('Fetching organizations and projects...');
            const orgs = await this.apiService.getOrgs();
            console.log('Organizations fetched:', orgs);
            
            // For personal account, currentOrg will be empty string
            // For organization, currentOrg will be the org ID
            const projects = await this.apiService.getProjects(this.stateService.currentOrg);
            console.log('Projects fetched:', projects.length, 'for org:', this.stateService.currentOrg || 'personal account');
            
            // Only fetch branches if we have a current project
            const branches = this.stateService.currentProject ? 
                await this.apiService.getBranches(this.stateService.currentProject) : [];

            // If we're connected, always fetch databases and roles
            if (this.stateService.isProxyRunning) {
                console.log('Proxy is running, fetching databases and roles...');
                await this.fetchDatabasesAndRoles();
            }

            // Get view data with current state
            const viewData = await this.stateService.getViewData(
                orgs,
                projects,
                branches,
                this.stateService.isProxyRunning,
                this.stateService.isStarting,
                this.stateService.selectedDriver,
                this._databases,
                this._roles,
                isExplicitUpdate
            );

            // Log the view data before sending it
            console.log('View data to be sent:', {
                connected: viewData.connected,
                isStarting: viewData.isStarting,
                databases: viewData.databases?.length,
                roles: viewData.roles?.length,
                connectionType: viewData.connectionType,
                isExplicitUpdate: viewData.isExplicitUpdate
            });

            // Update all views with the same data
            await this.webviewService.updateViewData(viewData);
        } catch (error) {
            console.error('Error updating view data:', error);
            this.handleError(error);
        }
    }

    public handleError(error: unknown) {
        const message = error instanceof Error ? error.message : 'An unknown error occurred';
        this.webviewService.showError(message);
        vscode.window.showErrorMessage(message);
    }

    public async configure() {
        await vscode.commands.executeCommand('neonLocalView.focus');
    }

    public showPanel() {
        this.webviewService.showPanel(this.context);
    }

    public async stopProxy() {
        try {
            const config = vscode.workspace.getConfiguration('neonLocal');
            const deleteOnStop = config.get<boolean>('deleteOnStop') ?? false;
            
            // Store the current state before stopping
            const currentConnectionType = this.stateService.connectionType;
            const currentBranch = this.stateService.currentBranch;
            const parentBranchId = this.stateService.parentBranchId;
            const currentlyConnectedBranch = await this.stateService.currentlyConnectedBranch;
            
            await this.dockerService.stopContainer(deleteOnStop);
            await this.stateService.setIsProxyRunning(false);
            
            // Clear only connection-specific data
            this._databases = [];
            this._roles = [];
            await this.stateService.setSelectedDatabase('');
            await this.stateService.setSelectedRole('');
            
            // Restore the connection state
            await this.stateService.setConnectionType(currentConnectionType);
            await this.stateService.setCurrentBranch(currentBranch);
            await this.stateService.setParentBranchId(parentBranchId);
            await this.stateService.setCurrentlyConnectedBranch(currentlyConnectedBranch);
            
            // Show success message
            vscode.window.showInformationMessage('Successfully disconnected from branch');
            
            // Update view data after restoring state
            await this.updateViewData();
        } catch (error) {
            this.handleError(error);
        }
    }

    public async clearAuth() {
        try {
            // Clear API key and refresh token from configuration
            const config = vscode.workspace.getConfiguration('neonLocal');
            await config.update('apiKey', undefined, true);
            await config.update('refreshToken', undefined, true);
            
            // Clear API client
            this.apiService.clearApiClient();
            
            // Stop proxy if running
            if (this.stateService.isProxyRunning) {
                await this.stopProxy();
            }
            
            // Clear all state
            await this.stateService.clearState();
            
            // Clear local data
            this._databases = [];
            this._roles = [];
            
            // Clear webview state
            this.webviewService.postMessage({ command: 'clearState' });
            
            // Update view with cleared data
            await this.updateViewData();
            
            // Show confirmation message
            vscode.window.showInformationMessage('Successfully cleared authentication and all extension data.');
        } catch (error) {
            this.handleError(error);
        }
    }

    public setWebviewView(view: vscode.WebviewView): void {
        this.webviewService.setWebviewView(view);
    }

    public async handleOrgSelection(orgId: string) {
        try {
            console.log('Organization selected:', orgId);
            await this.stateService.setCurrentOrg(orgId);
            await this.updateViewData();
        } catch (error) {
            this.handleError(error);
        }
    }

    public async handleProjectSelection(projectId: string) {
        try {
            await this.stateService.setCurrentProject(projectId);
            await this.updateViewData();
        } catch (error) {
            this.handleError(error);
        }
    }

    public async handleBranchSelection(branchId: string, restartProxy: boolean, driver: string) {
        try {
            await this.stateService.setCurrentBranch(branchId);
            await this.stateService.setSelectedDriver(driver === 'serverless' ? 'serverless' : 'postgres');
            
            if (restartProxy && this.stateService.isProxyRunning) {
                await this.handleStartProxy(driver, true, branchId);
            } else {
                await this.updateViewData();
            }
        } catch (error) {
            this.handleError(error);
        }
    }

    public async handleParentBranchSelection(parentBranchId: string) {
        try {
            await this.stateService.setParentBranchId(parentBranchId);
            await this.updateViewData();
        } catch (error) {
            this.handleError(error);
        }
    }

    public async handleStartProxy(driver: string, isExisting: boolean, branchId?: string, parentBranchId?: string) {
        const selectedBranchId = isExisting ? branchId : parentBranchId;
        if (!selectedBranchId) {
            throw new Error('No branch selected');
        }

        try {
            // Show notification that we're starting
            vscode.window.showInformationMessage('Connecting to Neon database...');

            // Store current project before starting
            const currentProject = this.stateService.currentProject;
            if (!currentProject) {
                throw new Error('No project selected');
            }

            await this.stateService.setIsStarting(true);
            
            // Store current state before starting
            const currentOrg = this.stateService.currentOrg;
            const currentConnectionType = this.stateService.connectionType;
            
            // Clear any existing selections when starting
            this._databases = [];
            this._roles = [];
            await this.stateService.setSelectedDatabase('');
            await this.stateService.setSelectedRole('');
            
            // Only update connection type if it's different from current state
            const newConnectionType = isExisting ? 'existing' : 'new';
            if (currentConnectionType !== newConnectionType) {
                await this.stateService.setConnectionType(newConnectionType);
            }
            
            // Set the appropriate branch ID based on connection type
            if (isExisting) {
                await this.stateService.setCurrentBranch(selectedBranchId);
                await this.stateService.setParentBranchId(''); // Clear parent branch ID for existing connections
                // For existing branches, currentlyConnectedBranch should match currentBranch
                await this.stateService.setCurrentlyConnectedBranch(selectedBranchId);
            } else {
                // For new branches, set both parent branch ID and clear current branch
                await this.stateService.setParentBranchId(selectedBranchId);
                await this.stateService.setCurrentBranch('');
                // For new branches, currentlyConnectedBranch will be set when reading from .branches file
                await this.stateService.setCurrentlyConnectedBranch('');
            }
            
            // Restore org and project
            await this.stateService.setCurrentOrg(currentOrg || '');
            await this.stateService.setCurrentProject(currentProject);
            
            console.log('Branch IDs set:', {
                isExisting,
                currentBranch: this.stateService.currentBranch,
                parentBranchId: this.stateService.parentBranchId,
                selectedBranchId,
                currentOrg,
                currentProject
            });
            
            console.log(`Setting initial driver to: ${driver}`);
            await this.stateService.setSelectedDriver(driver === 'serverless' ? 'serverless' : 'postgres');

            console.log('Starting container...');
            // Start container first
            await this.dockerService.startContainer({
                branchId: selectedBranchId,
                driver,
                isExisting,
                context: this.context,
                projectId: this.stateService.currentProject
            });
            console.log('Container started successfully');

            // After container starts, read the branch ID from the file to ensure we have the correct one
            const connectedBranchId = await this.stateService.getBranchIdFromFile();
            if (connectedBranchId) {
                await this.stateService.setCurrentlyConnectedBranch(connectedBranchId);
            }

            // Update proxy running state after successful container start
            await this.stateService.setIsProxyRunning(true);
            await this.stateService.setIsStarting(false);

            // Fetch databases and roles since we're connected
            await this.fetchDatabasesAndRoles();

            // Update view data with the new state
            await this.updateViewData(true);

            // Show success message
            vscode.window.showInformationMessage(`Successfully connected to ${isExisting ? 'existing' : 'new'} branch`);
        } catch (error) {
            this.handleError(error);
            await this.stateService.setIsStarting(false);
            await this.stateService.setIsProxyRunning(false);
            throw error;
        }
    }

    public async handleDatabaseSelection(database: string): Promise<void> {
        await this.stateService.setSelectedDatabase(database);
        // Don't clear the connection info, just update the view
        await this.updateViewData();
    }

    public async handleRoleSelection(role: string): Promise<void> {
        await this.stateService.setSelectedRole(role);

        // Only generate connection string if both database and role are selected
        const selectedDatabase = this.stateService.selectedDatabase;
        if (selectedDatabase && role) {
            const projectId = this.stateService.currentProject;
            if (!projectId) {
                console.error('No project ID available');
                this.handleError(new Error('No project selected'));
                return;
            }

            try {
                const branchId = await this.getCurrentBranchId();
                
                // Get the role password
                const password = await this.apiService.getRolePassword(projectId, branchId, role);
                
                // Generate the connection string
                const connectionString = `postgresql://${role}:${password}@localhost:5432/${selectedDatabase}?sslmode=require`;
                
                // Update the state with the new connection string
                await this.stateService.setConnectionInfo(connectionString);
            } catch (error) {
                console.error('Error getting role password:', error);
                this.handleError(error);
            }
        }

        await this.updateViewData();
    }

    private async fetchDatabasesAndRoles(): Promise<void> {
        const projectId = this.stateService.currentProject;
        let branchId: string;
        
        // For new branches, use currentlyConnectedBranch
        // For existing branches, use currentBranch
        if (this.stateService.connectionType === 'new') {
            branchId = await this.stateService.currentlyConnectedBranch;
        } else {
            branchId = this.stateService.currentBranch;
        }
        
        console.log('X projectId:', projectId);
        console.log('X branchId:', branchId);
        console.log('X connectionType:', this.stateService.connectionType);
        
        // Clear existing data before proceeding
        this._databases = [];
        this._roles = [];
        
        if (!projectId || !branchId) {
            console.log('Missing projectId or branchId - skipping database and role fetch');
            await this.stateService.setSelectedDatabase('');
            await this.stateService.setSelectedRole('');
            return;
        }
        
        try {
            // Fetch databases and roles in parallel
            const [databases, roles] = await Promise.all([
                this.apiService.getDatabases(projectId, branchId),
                this.apiService.getRoles(projectId, branchId)
            ]);
            
            this._databases = databases;
            console.log('X databases:', this._databases);
            this._roles = roles;
            console.log('X roles:', this._roles);

            // If we have databases and roles but none are selected, select the first ones
            if (databases.length > 0 && !this.stateService.selectedDatabase) {
                await this.handleDatabaseSelection(databases[0].name);
            }
            if (roles.length > 0 && !this.stateService.selectedRole) {
                await this.handleRoleSelection(roles[0].name);
            }
        } catch (error) {
            console.error('Error fetching databases and roles:', error);
            await this.stateService.setSelectedDatabase('');
            await this.stateService.setSelectedRole('');
        }
    }

    public async getViewData(): Promise<ViewData> {
        const orgs = await this.apiService.getOrgs();
        const projectId = this.stateService.currentProject;
        const orgId = this.stateService.currentOrg;
        
        // Always fetch projects if we have an org ID
        const projects = orgId ? await this.apiService.getProjects(orgId) : [];
        const branches = projectId ? await this.apiService.getBranches(projectId) : [];
        
        // Use the stored proxy state instead of checking container
        const isProxyRunning = this.stateService.isProxyRunning;
        if (isProxyRunning) {
            console.log('X fetching databases and roles');
            await this.fetchDatabasesAndRoles();
        }

        // Get view data without connection type
        const viewData = await this.stateService.getViewData(
            orgs,
            projects,
            branches,
            isProxyRunning,
            false, // isStarting is not implemented in DockerService
            undefined,
            this._databases,
            this._roles
        );

        // Log the view data being sent
        console.log('Extension: Sending view data:', {
            orgsCount: viewData.orgs?.length,
            selectedOrgId: viewData.selectedOrgId,
            currentConnectionType: this.stateService.connectionType,
            // Don't include connection type in regular updates
            isExplicitUpdate: false
        });

        return viewData;
    }

    public async handleStopProxy(): Promise<void> {
        await this.stopProxy();
    }

    private handleWebviewMessage(message: any) {
        console.log('Received message from webview:', message);
        switch (message.command) {
            case 'selectOrg':
                this.handleOrgSelection(message.orgId);
                break;
            case 'selectProject':
                this.handleProjectSelection(message.projectId);
                break;
            case 'selectBranch':
                this.handleBranchSelection(message.branchId, message.restartProxy, message.driver);
                break;
            case 'selectParentBranch':
                this.handleParentBranchSelection(message.parentBranchId);
                break;
            case 'startProxy':
                this.handleStartProxy(message.driver, message.isExisting, message.branchId, message.parentBranchId);
                break;
            case 'stopProxy':
                this.stopProxy();
                break;
            case 'showError':
                vscode.window.showErrorMessage(message.text);
                break;
            case 'updateConnectionType':
                console.log('Handling connection type update:', message.connectionType);
                this.handleConnectionTypeChange(message.connectionType).catch(error => {
                    console.error('Error updating connection type:', error);
                    vscode.window.showErrorMessage('Failed to update connection type');
                });
                break;
            case 'selectDriver':
                console.log('Handling driver selection:', message.driver);
                this.stateService.setSelectedDriver(message.driver).then(() => {
                    // After updating driver, refresh the view data
                    this.updateViewData();
                }).catch(error => {
                    console.error('Error updating driver:', error);
                    vscode.window.showErrorMessage('Failed to update driver');
                });
                break;
            default:
                console.warn('Unknown command:', message.command);
        }
    }

    public async handleConnectionTypeChange(connectionType: 'existing' | 'new'): Promise<void> {
        console.log('Setting connection type:', {
            newType: connectionType,
            currentType: this.stateService.connectionType,
            isExplicitUpdate: true
        });

        await this.stateService.setConnectionType(connectionType);
        await this.stateService.setParentBranchId('');

        // Get current state
        const orgs = await this.apiService.getOrgs();
        const projects = await this.apiService.getProjects(this.stateService.currentOrg);
        const branches = this.stateService.currentProject ? await this.apiService.getBranches(this.stateService.currentProject) : [];

        // Get view data with explicit update flag
        const viewData = await this.stateService.getViewData(
            orgs,
            projects,
            branches,
            this.stateService.isProxyRunning,
            this.stateService.isStarting,
            this.stateService.selectedDriver,
            this._databases,
            this._roles,
            true // Set isExplicitUpdate to true for connection type changes
        );

        // Send the view data update
        await this.webviewService.updateViewData(viewData);
    }

    // Helper function to ensure string values
    private ensureString(value: string | undefined, defaultValue: string = ''): string {
        return value ?? defaultValue;
    }

    // Helper function to get branch ID
    private async getCurrentBranchId(): Promise<string> {
        if (this.stateService.connectionType === 'new') {
            const branchId = await this.stateService.currentlyConnectedBranch;
            if (!branchId) {
                throw new Error('Could not determine branch ID. Please wait for the connection to be established.');
            }
            return branchId;
        } else {
            const branchId = this.stateService.currentBranch;
            if (!branchId) {
                throw new Error('No branch selected.');
            }
            return branchId;
        }
    }
}

let extension: NeonLocalExtension | undefined;

export async function activate(context: vscode.ExtensionContext) {
    extension = new NeonLocalExtension(context);
    await extension.activate();
}

export function deactivate() {
    extension?.deactivate();
} 