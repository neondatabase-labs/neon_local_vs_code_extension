import * as vscode from 'vscode';
import { DockerService } from './services/docker.service';
import { NeonApiService } from './services/api.service';
import { StateService } from './services/state.service';
import { WebViewService } from './services/webview.service';
import { SignInWebviewProvider } from './signInView';
import { NeonLocalManager, ViewData, NeonDatabase, NeonRole } from './types';
import { ConnectViewProvider } from './connectView';
import { DatabaseViewProvider } from './databaseView';
import { ActionsViewProvider } from './actionsView';

export class NeonLocalExtension implements NeonLocalManager {
    private dockerService: DockerService;
    private apiService: NeonApiService;
    private stateService: StateService;
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

        // Initial container status check
        await this.checkContainerStatus();

        // Initial view data update
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

                // Get list of databases
                const databases = this._databases.map(db => db.name);
                if (databases.length === 0) {
                    vscode.window.showErrorMessage('No databases available.');
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

                // Get list of databases
                const databases = this._databases.map(db => db.name);
                if (databases.length === 0) {
                    vscode.window.showErrorMessage('No databases available.');
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
            })
        );
    }

    private registerViews() {
        const signInProvider = new SignInWebviewProvider(this.context.extensionUri);
        const connectProvider = new ConnectViewProvider(this.context.extensionUri, this);
        const databaseProvider = new DatabaseViewProvider(this.context.extensionUri, this);
        const actionsProvider = new ActionsViewProvider(this.context.extensionUri, this);

        this.context.subscriptions.push(
            vscode.window.registerWebviewViewProvider('neonLocalConnect', connectProvider),
            vscode.window.registerWebviewViewProvider('neonLocalDatabase', databaseProvider),
            vscode.window.registerWebviewViewProvider('neonLocalActions', actionsProvider)
        );
    }

    private startStatusCheck() {
        this.statusCheckInterval = setInterval(() => {
            this.checkContainerStatus();
        }, 5000);
    }

    private async checkContainerStatus() {
        const isRunning = await this.dockerService.checkContainerStatus();
        
        if (this.stateService.isProxyRunning !== isRunning && !this.stateService.isStarting) {
            this.stateService.isProxyRunning = isRunning;
            if (!isRunning) {
                // Clear databases and roles when disconnected
                this._databases = [];
                this._roles = [];
                this.stateService.setSelectedDatabase('');
                this.stateService.setSelectedRole('');
            }
            await this.updateViewData();
        }
    }

    private async updateViewData() {
        try {
            const orgs = await this.apiService.getOrgs();
            const projects = this.stateService.currentOrg !== undefined ? 
                await this.apiService.getProjects(this.stateService.currentOrg) : [];
            const branches = this.stateService.currentProject ? 
                await this.apiService.getBranches(this.stateService.currentProject) : [];

            // Check container status and update driver if running
            const isProxyRunning = await this.dockerService.checkContainerStatus();
            if (isProxyRunning) {
                const containerDriver = await this.dockerService.getCurrentDriver();
                if (containerDriver !== this.stateService.selectedDriver) {
                    console.log(`Updating driver from ${this.stateService.selectedDriver} to ${containerDriver}`);
                    this.stateService.selectedDriver = containerDriver;
                }
            } else {
                // Clear databases and roles when disconnected
                this._databases = [];
                this._roles = [];
                this.stateService.setSelectedDatabase('');
                this.stateService.setSelectedRole('');
            }

            // If we're connected, fetch databases and roles
            if (isProxyRunning) {
                await this.fetchDatabasesAndRoles();
            }

            const viewData = await this.stateService.getViewData(
                orgs,
                projects,
                branches,
                isProxyRunning,
                this.stateService.isStarting,
                this.stateService.selectedDriver,
                this._databases,
                this._roles
            );
            console.log('View data:', viewData);

            // Update all views with the same data
            this.webviewService.updateViewData(viewData);
        } catch (error) {
            this.handleError(error);
        }
    }

    private handleError(error: unknown) {
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
            
            await this.dockerService.stopContainer(deleteOnStop);
            this.stateService.isProxyRunning = false;
            // Clear databases and roles when stopping
            this._databases = [];
            this._roles = [];
            this.stateService.setSelectedDatabase('');
            this.stateService.setSelectedRole('');
            await this.updateViewData();
        } catch (error) {
            this.handleError(error);
        }
    }

    public async clearAuth() {
        const config = vscode.workspace.getConfiguration('neonLocal');
        await config.update('apiKey', undefined, true);
        await config.update('refreshToken', undefined, true);
        this.apiService.clearApiClient();
        this.stateService.clearState();
        await this.updateViewData();
    }

    public setWebviewView(view: vscode.WebviewView): void {
        this.webviewService.setWebviewView(view);
    }

    public async handleOrgSelection(orgId: string) {
        try {
            console.log('Organization selected:', orgId);
            // For personal account, orgId will be an empty string
            this.stateService.currentOrg = orgId;
            this.stateService.currentProject = undefined;
            this.stateService.currentBranch = undefined;

            // Update the view data which will fetch and display the projects
            await this.updateViewData();
        } catch (error) {
            this.handleError(error);
        }
    }

    public async handleProjectSelection(projectId: string) {
        try {
            this.stateService.currentProject = projectId;
            this.stateService.currentBranch = undefined;
            await this.updateViewData();
        } catch (error) {
            this.handleError(error);
        }
    }

    public async handleBranchSelection(branchId: string, restartProxy: boolean, driver: string) {
        try {
            // Set the current branch in state service
            this.stateService.currentBranch = branchId;
            // Update the driver in state service
            this.stateService.selectedDriver = driver;
            if (restartProxy) {
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
            this.stateService.parentBranchId = parentBranchId;
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
            this.stateService.isStarting = true;
            // Clear any existing selections when starting
            this._databases = [];
            this._roles = [];
            this.stateService.setSelectedDatabase('');
            this.stateService.setSelectedRole('');
            
            // Set the connection type and driver in state service before starting the container
            this.stateService.connectionType = isExisting ? 'existing' : 'new';
            if (isExisting) {
                this.stateService.currentBranch = branchId;
            } else if (parentBranchId) {
                this.stateService.parentBranchId = parentBranchId;
            }
            console.log(`Setting initial driver to: ${driver}`);
            this.stateService.selectedDriver = driver;
            await this.updateViewData();

            await this.dockerService.startContainer({
                branchId: selectedBranchId,
                driver,
                isExisting,
                context: this.context,
                projectId: this.stateService.currentProject || ''
            });

            this.stateService.isProxyRunning = true;
            // Update the driver again after container is running to ensure it matches
            const containerDriver = await this.dockerService.getCurrentDriver();
            console.log(`Container started with driver: ${containerDriver}`);
            this.stateService.selectedDriver = containerDriver;
            this.stateService.isStarting = false;

            // For new branches, refresh the branch list to get the new branch
            if (!isExisting && this.stateService.currentProject) {
                const branches = await this.apiService.getBranches(this.stateService.currentProject);
                this.stateService.branches = branches;
            }

            await this.updateViewData();
        } catch (error) {
            this.stateService.isStarting = false;
            this.handleError(error);
        }
    }

    public async handleDatabaseSelection(database: string): Promise<void> {
        this.stateService.setSelectedDatabase(database);
    }

    public async handleRoleSelection(role: string): Promise<void> {
        this.stateService.setSelectedRole(role);
        await this.updateViewData();
    }

    private async fetchDatabasesAndRoles(): Promise<void> {
        const projectId = this.stateService.currentProject;
        //const branchId = this.stateService.currentBranch;
        const branchId = this.stateService.currentlyConnectedBranch;
        const connectedBranch = this.stateService.currentlyConnectedBranch;
        console.log('X projectId:', projectId);
        console.log('X branchId:', branchId);
        console.log('X connectedBranch:', connectedBranch);
        if (projectId && branchId) {
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
            } catch (error) {
                console.error('Error fetching databases and roles:', error);
                this._databases = [];
                this._roles = [];
            }
        } else {
            this._databases = [];
            this._roles = [];
        }
    }

    public async getViewData(): Promise<ViewData> {
        const orgs = await this.apiService.getOrgs();
        const projectId = this.stateService.currentProject;
        const orgId = this.stateService.currentOrg;
        
        const projects = projectId ? await this.apiService.getProjects(orgId) : [];
        const branches = projectId ? await this.apiService.getBranches(projectId) : [];
        
        // If we're connected, fetch databases and roles
        const isProxyRunning = await this.dockerService.checkContainerStatus();
        console.log('X isProxyRunning:', isProxyRunning);
        if (isProxyRunning) {
            console.log('X fetching databases and roles');
            await this.fetchDatabasesAndRoles();
        }

        return this.stateService.getViewData(
            orgs,
            projects,
            branches,
            isProxyRunning,
            false, // isStarting is not implemented in DockerService
            undefined,
            this._databases,
            this._roles
        );
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
                this.stateService.connectionType = message.connectionType;
                break;
            default:
                console.warn('Unknown command:', message.command);
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