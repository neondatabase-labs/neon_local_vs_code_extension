import * as vscode from 'vscode';
import Dockerode from 'dockerode';
import axios from 'axios';
import * as path from 'path';
import * as fs from 'fs';
import { authenticate, refreshToken } from './auth';
import { SignInWebviewProvider } from './signInView';
import { NeonLocalViewProvider } from './neonLocalView';

interface NeonBranch {
    id: string;
    name: string;
    project_id: string;
    parent_id: string | null;
}

interface NeonProject {
    id: string;
    name: string;
    org_id: string;
}

interface NeonOrg {
    id: string;
    name: string;
}

interface ViewData {
    orgs: { id: string; name: string }[];
    projects: { id: string; name: string }[];
    branches: { id: string; name: string }[];
    selectedOrg: string | undefined;
    selectedProject: string | undefined;
    selectedBranch: string | undefined;
    selectedOrgName: string | undefined;
    selectedProjectName: string | undefined;
    selectedBranchName: string | undefined;
    connected: boolean;
    loading: boolean;
    connectionInfo: string | undefined;
}

export class NeonLocalManager {
    private docker: Dockerode;
    private context: vscode.ExtensionContext;
    private statusBarItem: vscode.StatusBarItem;
    public currentBranch: string | undefined;
    private webviewPanel: vscode.WebviewPanel | undefined;
    public currentOrg: string | undefined;
    public currentProject: string | undefined;
    private webviewView: vscode.WebviewView | undefined;
    private state: vscode.Memento;
    private isProxyRunning: boolean = false;
    private statusCheckInterval: NodeJS.Timeout | undefined;
    private _parentBranchId?: string;
    private branches: NeonBranch[] = [];
    private _isStarting: boolean = false;

    constructor(context: vscode.ExtensionContext) {
        this.docker = new Dockerode();
        this.context = context;
        this.state = context.globalState;
        this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
        this.statusBarItem.show();
        this.updateStatusBar();

        // Restore state from memento
        this.currentOrg = this.state.get('neonLocal.currentOrg');
        this.currentProject = this.state.get('neonLocal.currentProject');
        this.currentBranch = this.state.get('neonLocal.currentBranch');

        // Check initial container status
        this.checkContainerStatus();
    }

    private async checkContainerStatus() {
        try {
            const container = await this.docker.getContainer('neon_local_vscode');
            const containerInfo = await container.inspect();
            const wasRunning = this.isProxyRunning;
            this.isProxyRunning = containerInfo.State.Running;
            
            // Only update UI if status changed and we're not in the process of starting
            if (wasRunning !== this.isProxyRunning && !this._isStarting) {
                console.log('Container status changed:', { wasRunning, isRunning: this.isProxyRunning });
                await this.updateViewData();
            }
        } catch (error) {
            // If we get an error, the container doesn't exist or isn't running
            const wasRunning = this.isProxyRunning;
            this.isProxyRunning = false;
            
            // Only update UI if status changed and we're not in the process of starting
            if (wasRunning !== this.isProxyRunning && !this._isStarting) {
                console.log('Container not found or error:', error);
                console.log('Container status changed:', { wasRunning, isRunning: this.isProxyRunning });
                await this.updateViewData();
            }
            // Delete .branches file if it exists (not connected state)
            try {
                const neonLocalDir = path.join(this.context.globalStorageUri.fsPath, '.neon_local');
                const branchesFile = path.join(neonLocalDir, '.branches');
                if (fs.existsSync(branchesFile)) {
                    fs.unlinkSync(branchesFile);
                }
            } catch (err) {
                console.error('Failed to delete .branches file on not connected state:', err);
            }
        }
    }

    private async saveState() {
        await this.state.update('neonLocal.currentOrg', this.currentOrg);
        await this.state.update('neonLocal.currentProject', this.currentProject);
        await this.state.update('neonLocal.currentBranch', this.currentBranch);
    }

    private async ensureAuthenticated(): Promise<string> {
        const config = vscode.workspace.getConfiguration('neonLocal');
        let apiKey = config.get<string>('apiKey');
        const storedRefreshToken = config.get<string>('refreshToken');
        
        if (!apiKey && storedRefreshToken) {
            try {
                // Try to refresh the token
                apiKey = await refreshToken(storedRefreshToken);
                if (apiKey) {
                    await config.update('apiKey', apiKey, true);
                }
            } catch (error) {
                console.error('Token refresh failed:', error);
                // If refresh fails, clear tokens and throw error
                await config.update('apiKey', undefined, true);
                await config.update('refreshToken', undefined, true);
                throw new Error('Authentication expired. Please sign in again.');
            }
        }
        
        if (!apiKey) {
            throw new Error('Authentication required. Please sign in.');
        }
        
        return apiKey;
    }

    private async getNeonApiClient() {
        const apiKey = await this.ensureAuthenticated();
        console.log('Creating API client with key available:', !!apiKey);
        
        return axios.create({
            baseURL: 'https://console.neon.tech/api/v2',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            }
        });
    }

    private async getOrgs(): Promise<NeonOrg[]> {
        try {
            const client = await this.getNeonApiClient();
            console.log('Fetching user info and organizations...');
            
            // Get user info first
            const userResponse = await client.get('/users/me');
            console.log('User response:', JSON.stringify(userResponse.data, null, 2));
            
            if (!userResponse.data) {
                throw new Error('No data in user response');
            }
            
            // Get organizations
            const orgsResponse = await client.get('/users/me/organizations');
            console.log('Organizations response:', JSON.stringify(orgsResponse.data, null, 2));
            
            if (!orgsResponse.data || !orgsResponse.data.organizations) {
                throw new Error('No organizations data in response');
            }
            
            const organizations = orgsResponse.data.organizations;
            
            // Create personal account entry
            const personalAccount = {
                id: `user-${userResponse.data.id}`,
                name: 'Personal Account'
            };
            
            // Combine personal account with organizations
            console.log('Combined response:', JSON.stringify([personalAccount, ...organizations], null, 2));
            return [personalAccount, ...organizations];
        } catch (error: any) {
            console.error('Error fetching organizations:', error);
            if (error.response) {
                console.error('API Error Response:', {
                    status: error.response.status,
                    data: error.response.data
                });
            }
            throw error;
        }
    }

    private async getProjects(orgId: string): Promise<NeonProject[]> {
        try {
            const client = await this.getNeonApiClient();
            console.log('Fetching projects for org:', orgId);
            
            // For personal account, don't include organization_id
            if (orgId.startsWith('user-')) {
                console.log('Fetching personal projects...');
                const response = await client.get('/projects');
                console.log('Personal projects response:', JSON.stringify(response.data, null, 2));
                return response.data.projects || [];
            }
            
            // For organizations, include organization_id
            console.log('Fetching organization projects...');
            const response = await client.get('/projects', {
                params: {
                    org_id: orgId
                }
            });
            console.log('Organization projects response:', JSON.stringify(response.data, null, 2));
            
            // Ensure we have projects in the response
            if (!response.data || !response.data.projects) {
                console.log('No projects found in response');
                return [];
            }
            
            // Map the projects to the expected format
            const projects = response.data.projects.map((project: any) => ({
                id: project.id,
                name: project.name,
                org_id: orgId
            }));
            console.log('Mapped projects:', JSON.stringify(projects, null, 2));
            return projects;
        } catch (error: any) {
            console.error('Error fetching projects:', error);
            if (error.response) {
                console.error('API Error Response:', {
                    status: error.response.status,
                    data: error.response.data
                });
            }
            throw error;
        }
    }

    private async getBranches(projectId: string): Promise<NeonBranch[]> {
        try {
            const client = await this.getNeonApiClient();
            console.log('Fetching branches for project:', projectId);
            const response = await client.get(`/projects/${projectId}/branches`);
            console.log('Branches response:', response.data);
            
            if (!response.data || !response.data.branches) {
                console.log('No branches found in response');
                return [];
            }
            
            // Map the branches to the expected format
            const branches = response.data.branches.map((branch: any) => ({
                id: branch.id,
                name: branch.name,
                project_id: projectId,
                parent_id: branch.parent_id
            }));
            
            console.log('Mapped branches:', JSON.stringify(branches, null, 2));
            this.branches = branches;
            return branches;
        } catch (error: any) {
            console.error('Error fetching branches:', error);
            if (error.response) {
                console.error('API Error Response:', {
                    status: error.response.status,
                    data: error.response.data
                });
            }
            throw error;
        }
    }

    private updateStatusBar() {
        if (this.currentBranch) {
            this.statusBarItem.text = `$(database) Neon: ${this.currentBranch}`;
        } else {
            this.statusBarItem.text = '$(database) Neon: Not Connected';
        }
    }

    private getActiveWebview(): vscode.Webview | undefined {
        return this.webviewView?.webview || this.webviewPanel?.webview;
    }

    public setWebviewView(webviewView: vscode.WebviewView) {
        this.webviewView = webviewView;
        this.webviewView.webview.onDidReceiveMessage(async (message) => {
            console.log('Received message:', message);
            switch (message.command) {
                case 'selectOrg':
                    await this.handleOrgSelection(message.orgId);
                    break;
                case 'selectProject':
                    await this.handleProjectSelection(message.projectId);
                    break;
                case 'selectBranch':
                    await this.handleBranchSelection(message.branchId, message.restartProxy, message.driver);
                    break;
                case 'stopProxy':
                    await this.handleStopProxy();
                    break;
                case 'showError':
                    vscode.window.showErrorMessage(message.text);
                    break;
                case 'showInfo':
                    vscode.window.showInformationMessage(message.text);
                    break;
                case 'resetFromParent':
                    await this.handleResetFromParent();
                    break;
                case 'openSqlEditor':
                    await this.handleOpenSqlEditor();
                    break;
            }
        });
    }

    public async updateViewData() {
        const webview = this.getActiveWebview();
        if (!webview) return;

        try {
            // Ensure we're authenticated before proceeding
            await this.ensureAuthenticated();

            // Update organizations
            const orgs = await this.getOrgs();
            webview.postMessage({
                command: 'updateOrgs',
                orgs: orgs.map(org => ({ id: org.id, name: org.name })),
                selectedOrg: this.currentOrg
            });

            // If we have a selected org, update projects
            if (this.currentOrg) {
                const projects = await this.getProjects(this.currentOrg);
                webview.postMessage({
                    command: 'updateProjects',
                    projects: projects.map(project => ({ id: project.id, name: project.name })),
                    selectedProject: this.currentProject
                });

                // If we have a selected project, update branches
                if (this.currentProject) {
                    const branches = await this.getBranches(this.currentProject);
                    webview.postMessage({
                        command: 'updateBranches',
                        branches: branches.map(branch => ({ id: branch.id, name: branch.name })),
                        selectedBranch: this.currentBranch
                    });
                }
            }

            // Update connection status
            if (this.isProxyRunning && this.currentBranch) {
                const config = vscode.workspace.getConfiguration('neonLocal');
                const driver = config.get<string>('driver') || 'postgres';
                
                const connectionInfo = driver === 'postgres' 
                    ? 'postgres://neon:npg@localhost:5432/<database_name>?sslmode=require'
                    : 'postgres://neon:npg@localhost:5432/<database_name>?sslmode=no-verify\n\n' +
                      'For serverless driver, also set:\n' +
                      'neonConfig.fetchEndpoint = \'http://localhost:5432/sql\'';

                webview.postMessage({
                    command: 'updateStatus',
                    connected: true,
                    branch: this.currentBranch,
                    loading: false,
                    connectionInfo: connectionInfo
                });
            } else {
                webview.postMessage({
                    command: 'updateStatus',
                    connected: false,
                    branch: undefined,
                    loading: false
                });
            }
        } catch (error) {
            if (error instanceof Error && error.message.includes('Authentication')) {
                throw error;
            }
            console.error('Failed to update view data:', error);
            webview.postMessage({
                command: 'updateStatus',
                connected: false,
                branch: undefined,
                loading: false,
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }

    private startStatusCheck() {
        // Clear any existing interval
        this.stopStatusCheck();
        
        // Start checking container status every 2 seconds
        this.statusCheckInterval = setInterval(async () => {
            await this.checkContainerStatus();
        }, 2000);
    }

    private stopStatusCheck() {
        if (this.statusCheckInterval) {
            clearInterval(this.statusCheckInterval);
            this.statusCheckInterval = undefined;
        }
    }

    public async startContainer(branchId: string, driver: string, isExisting: boolean): Promise<void> {
        console.log('Starting container for branch:', branchId, 'with driver:', driver, 'isExisting:', isExisting);
        
        try {
            this._isStarting = true;
            this.stopStatusCheck();
            const apiKey = await this.ensureAuthenticated();
            console.log('Authentication successful');
            if (!this.currentProject) {
                throw new Error('No project selected');
            }

            // Check if Docker is running
            try {
                await this.docker.ping();
                console.log('Docker is running');
            } catch (error) {
                console.error('Docker ping failed:', error);
                throw new Error('Docker is not running. Please start Docker and try again.');
            }

            // Check if port 5432 is available
            try {
                const containers = await this.docker.listContainers();
                const portInUse = containers.some(container => 
                    container.Ports?.some(port => port.PublicPort === 5432)
                );
                if (portInUse) {
                    throw new Error('Port 5432 is already in use. Please stop any other services using this port.');
                }
            } catch (error) {
                console.error('Port check failed:', error);
                if (error instanceof Error) {
                    throw error;
                }
                throw new Error('Failed to check port availability');
            }

            // Ensure any existing container is stopped and removed
            try {
                const existingContainer = await this.docker.getContainer('neon_local_vscode');
                try {
                    await existingContainer.stop();
                    console.log('Stopped existing container');
                } catch (error) {
                    console.log('Container was not running');
                }
                await existingContainer.remove({ force: true });
                console.log('Removed existing container');
                // Wait a moment to ensure cleanup is complete
                await new Promise(resolve => setTimeout(resolve, 1000));
            } catch (error) {
                if (!(error instanceof Error && error.message.includes('No such container'))) {
                    console.error('Error during container cleanup:', error);
                    throw error;
                }
                console.log('No existing container to remove');
            }

            // Prepare volume mount for branch metadata
            const neonLocalDir = path.join(this.context.globalStorageUri.fsPath, '.neon_local');
            if (!fs.existsSync(neonLocalDir)) {
                fs.mkdirSync(neonLocalDir, { recursive: true });
            }
            const volumeArg = `${neonLocalDir}:/tmp/.neon_local`;

            console.log("isExisting", isExisting);
            const containerConfig = {
                Image: 'neondatabase/neon_local:latest',
                name: 'neon_local_vscode',
                Env: [
                    `NEON_API_KEY=${apiKey}`,
                    `NEON_PROJECT_ID=${this.currentProject}`,
                    isExisting ? `BRANCH_ID=${branchId}` : `PARENT_BRANCH_ID=${branchId}`,
                    `DRIVER=${driver}`
                ],
                HostConfig: {
                    PortBindings: {
                        '5432/tcp': [{ HostPort: '5432' }]
                    },
                    AutoRemove: true,
                    Binds: [volumeArg]
                },
                AttachStdin: false,
                AttachStdout: true,
                AttachStderr: true,
                Tty: true,
                OpenStdin: false,
                StdinOnce: false
            };

            console.log('Container config:', JSON.stringify(containerConfig, null, 2));

            console.log('Creating new container...');
            const container = await this.docker.createContainer(containerConfig);
            console.log('Container created, starting...');
            await container.start();
            console.log('Container started successfully');

            // Attach to container logs
            const logStream = await container.logs({
                follow: true,
                stdout: true,
                stderr: true
            });

            logStream.on('data', (chunk) => {
                console.log('Container log:', chunk.toString('utf8'));
            });

            // Update state and UI in a single operation
            this.currentBranch = branchId;
            this.isProxyRunning = true;
            this.updateStatusBar();
            
            // Update the webview with all necessary data at once
            const webview = this.getActiveWebview();
            if (webview) {
                const config = vscode.workspace.getConfiguration('neonLocal');
                const connectionInfo = config.get<string>('driver') === 'postgres' 
                    ? 'postgres://neon:npg@localhost:5432/<database_name>?sslmode=require'
                    : 'postgres://neon:npg@localhost:5432/<database_name>?sslmode=no-verify\n\n' +
                      'For serverless driver, also set:\n' +
                      'neonConfig.fetchEndpoint = \'http://localhost:5432/sql\'';

                webview.postMessage({
                    command: 'updateStatus',
                    connected: true,
                    branch: this.currentBranch,
                    loading: false,
                    connectionInfo: connectionInfo
                });
            }
            
            vscode.window.showInformationMessage('Neon Local proxy started successfully');
            
            // Restart status check after container is started
            this.startStatusCheck();
        } catch (error) {
            console.error('Failed to start container:', error);
            this.isProxyRunning = false;
            this.updateStatusBar();
            
            // Update the webview with error state
            const webview = this.getActiveWebview();
            if (webview) {
                webview.postMessage({
                    command: 'updateStatus',
                    connected: false,
                    branch: undefined,
                    loading: false
                });
            }
            
            const errorMessage = error instanceof Error ? error.message : String(error);
            if (errorMessage.includes('container name "/neon_local_vscode" is already in use')) {
                // If we get this error, try one more time after a delay
                await new Promise(resolve => setTimeout(resolve, 2000));
                try {
                    const existingContainer = await this.docker.getContainer('neon_local_vscode');
                    await existingContainer.remove({ force: true });
                    console.log('Removed conflicting container');
                    // Retry the operation
                    return this.startContainer(branchId, driver, isExisting);
                } catch (retryError) {
                    console.error('Failed to remove conflicting container:', retryError);
                    throw new Error('Failed to start proxy: Container name conflict could not be resolved');
                }
            }
            throw new Error(`Failed to start proxy: ${errorMessage}`);
        } finally {
            this._isStarting = false;
        }
    }

    public getWebviewContent() {
        const htmlPath = path.join(this.context.extensionPath, 'src', 'webview', 'index.html');
        const htmlContent = fs.readFileSync(htmlPath, 'utf-8');
        return htmlContent;
    }

    public showPanel() {
        if (this.webviewPanel) {
            this.webviewPanel.reveal();
            // Force a refresh of all data when showing the panel
            this.updateViewData();
            return;
        }

        try {
            // Create the webview panel
            this.webviewPanel = vscode.window.createWebviewPanel(
                'neonLocal',
                'Neon Local',
                vscode.ViewColumn.One,
                {
                    enableScripts: true,
                    localResourceRoots: [vscode.Uri.file(path.join(this.context.extensionPath, 'src', 'webview'))]
                }
            );

            this.webviewPanel.webview.html = this.getWebviewContent();

            // Set up message handling
            this.webviewPanel.webview.onDidReceiveMessage(async message => {
                try {
                    switch (message.command) {
                        case 'selectOrg':
                            await this.handleOrgSelection(message.orgId);
                            break;
                        case 'selectProject':
                            await this.handleProjectSelection(message.projectId);
                            break;
                        case 'selectBranch':
                            await this.handleBranchSelection(message.branchId, message.restartProxy, message.driver);
                            break;
                        case 'stopProxy':
                            await this.handleStopProxy();
                            break;
                        case 'showInfo':
                            vscode.window.showInformationMessage(message.text);
                            break;
                        case 'showError':
                            vscode.window.showErrorMessage(message.text);
                            break;
                        case 'selectParentBranch':
                            console.log('Parent branch selected:', message.parentBranchId);
                            this.setParentBranchId(message.parentBranchId);
                            break;
                    }
                } catch (error) {
                    vscode.window.showErrorMessage(`Error: ${error}`);
                    if (this.webviewPanel) {
                        this.webviewPanel.webview.postMessage({
                            command: 'updateStatus',
                            connected: false,
                            branch: undefined
                        });
                    }
                }
            });

            this.webviewPanel.onDidDispose(() => {
                this.webviewPanel = undefined;
                this.stopStatusCheck();
            });

            // Start status checking
            this.startStatusCheck();

            // Initial data load
            this.updateViewData();
            
            // Reveal the panel in case it's not visible
            this.webviewPanel.reveal();
        } catch (error) {
            vscode.window.showErrorMessage(`Error: ${error}`);
        }
    }

    async configure() {
        try {
            const apiKey = await authenticate();
            const config = vscode.workspace.getConfiguration('neonLocal');
            await config.update('apiKey', apiKey, true);
            vscode.window.showInformationMessage('Successfully authenticated with Neon');
            await this.showPanel();
        } catch (error) {
            vscode.window.showErrorMessage(`Authentication failed: ${error}`);
        }
    }

    public async stopProxy() {
        let stoppedSuccessfully = false;
        try {
            const container = await this.docker.getContainer('neon_local_vscode');
            await container.stop();
            await container.remove();
            stoppedSuccessfully = true;
            this.isProxyRunning = false;
            this.updateStatusBar();
            await this.updateViewData();
            // Delete .branches file only if stop was successful
            try {
                if (stoppedSuccessfully) {
                    const neonLocalDir = path.join(this.context.globalStorageUri.fsPath, '.neon_local');
                    const branchesFile = path.join(neonLocalDir, '.branches');
                    if (fs.existsSync(branchesFile)) {
                        fs.unlinkSync(branchesFile);
                    }
                }
            } catch (err) {
                console.error('Failed to delete .branches file on stopProxy:', err);
            }
            vscode.window.showInformationMessage('Neon Local proxy stopped');
        } catch (error) {
            this.isProxyRunning = false;
            // Check if the error is about the container already being removed
            const errorMessage = error instanceof Error ? error.message : String(error);
            if (errorMessage.includes('removal of container') && errorMessage.includes('is already in progress')) {
                // Container is already being removed, just wait a moment and update the UI
                await new Promise(resolve => setTimeout(resolve, 1000));
                await this.updateViewData();
                // Delete .branches file only if stop was successful
                try {
                    if (stoppedSuccessfully) {
                        const neonLocalDir = path.join(this.context.globalStorageUri.fsPath, '.neon_local');
                        const branchesFile = path.join(neonLocalDir, '.branches');
                        if (fs.existsSync(branchesFile)) {
                            fs.unlinkSync(branchesFile);
                        }
                    }
                } catch (err) {
                    console.error('Failed to delete .branches file on stopProxy:', err);
                }
                vscode.window.showInformationMessage('Neon Local proxy stopped');
            } else {
                // For other errors, show the error message
                vscode.window.showErrorMessage(`Failed to stop proxy: ${errorMessage}`);
                await this.updateViewData();
                // Do not delete .branches file if stop failed
            }
        }
    }

    public async clearAuth() {
        const config = vscode.workspace.getConfiguration('neonLocal');
        await config.update('apiKey', undefined, true);
        await config.update('refreshToken', undefined, true);
        
        // Reset state
        this.currentOrg = undefined;
        this.currentProject = undefined;
        this.currentBranch = undefined;
        await this.saveState();
        
        vscode.window.showInformationMessage('Neon authentication cleared');
    }

    // Add new handler methods for the view
    public async handleOrgSelection(orgId: string) {
        console.log('Selected org:', orgId);
        
        const webview = this.getActiveWebview();
        if (!webview) {
            console.error('No active webview found');
            return;
        }

        try {
            // Update state
            this.currentOrg = orgId;
            this.currentProject = undefined;
            this.currentBranch = undefined;
            await this.saveState();

            console.log('Fetching projects for org:', orgId);
            
            // Fetch projects for the selected org
            const projects = await this.getProjects(orgId);
            console.log('Fetched projects:', projects);
            
            // Send the updates to the webview
            webview.postMessage({
                command: 'updateProjects',
                projects: projects.map(project => ({ id: project.id, name: project.name })),
                selectedProject: undefined
            });

            // Clear branches since no project is selected
            webview.postMessage({
                command: 'updateBranches',
                branches: [],
                selectedBranch: undefined
            });

            // Update status
            webview.postMessage({
                command: 'updateStatus',
                connected: this.isProxyRunning,
                branch: undefined,
                connectionInfo: undefined
            });
        } catch (error) {
            console.error('Error handling org selection:', error);
            vscode.window.showErrorMessage(`Failed to load projects: ${error instanceof Error ? error.message : String(error)}`);
            
            // Reset the UI state on error
            webview.postMessage({
                command: 'updateProjects',
                projects: [],
                selectedProject: undefined
            });
            webview.postMessage({
                command: 'updateBranches',
                branches: [],
                selectedBranch: undefined
            });
            webview.postMessage({
                command: 'updateStatus',
                connected: false,
                branch: undefined,
                connectionInfo: undefined
            });
        }
    }

    public async handleProjectSelection(projectId: string) {
        this.currentProject = projectId;
        await this.saveState();

        const webview = this.getActiveWebview();
        if (webview) {
            try {
                // Fetch and update branches for the selected project
                const branches = await this.getBranches(projectId);
                webview.postMessage({
                    command: 'updateBranches',
                    branches: branches.map(branch => ({ id: branch.id, name: branch.name })),
                    selectedBranch: undefined
                });

                // Update status
                webview.postMessage({
                    command: 'updateStatus',
                    connected: this.isProxyRunning,
                    branch: this.currentBranch
                });
            } catch (error) {
                console.error('Error loading branches:', error);
                vscode.window.showErrorMessage(`Failed to load branches: ${error}`);
            }
        }
    }

    public async handleBranchSelection(branchId: string, restartProxy: boolean, driver: string) {
        this.currentBranch = branchId;
        await this.saveState();
        await this.checkContainerStatus();
        if (restartProxy) {
            await this.startContainer(branchId, driver, true);
        }
    }

    public async handleStartProxy(driver: string, isExisting: boolean, branchId?: string, parentBranchId?: string) {
        try {
            if (!this.currentProject) {
                vscode.window.showErrorMessage('Please select a project first');
                return;
            }

            if (!isExisting && !parentBranchId) {
                vscode.window.showErrorMessage('Please select a parent branch before starting the proxy');
                return;
            }

            if (isExisting && !branchId) {
                vscode.window.showErrorMessage('Please select a branch');
                return;
            }

            // For existing branches, use the branchId directly
            // For new branches, use the parentBranchId
            const selectedBranchId = isExisting ? branchId : parentBranchId;

            if (!selectedBranchId) {
                vscode.window.showErrorMessage('No branch selected');
                return;
            }

            console.log('Starting proxy with connection type:', isExisting ? 'existing' : 'new', 'branch:', selectedBranchId);
            await this.startContainer(selectedBranchId, driver, isExisting);
        } catch (error) {
            console.error('Error in handleStartProxy:', error);
            vscode.window.showErrorMessage(`Failed to start proxy: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    public async handleStopProxy() {
        await this.stopProxy();
    }

    public async getMainViewHtml() {
        return this.getWebviewContent();
    }

    public async getViewData(): Promise<ViewData> {
        try {
            // Ensure we're authenticated before proceeding
            await this.ensureAuthenticated();

            const data: ViewData = {
                orgs: [],
                projects: [],
                branches: [],
                selectedOrg: this.currentOrg,
                selectedProject: this.currentProject,
                selectedBranch: this.currentBranch,
                selectedOrgName: undefined,
                selectedProjectName: undefined,
                selectedBranchName: undefined,
                connected: this.isProxyRunning,
                loading: false,
                connectionInfo: undefined
            };

            // Get organizations
            const orgs = await this.getOrgs();
            data.orgs = orgs.map(org => ({ id: org.id, name: org.name }));
            // Set selected org name
            if (this.currentOrg) {
                const selectedOrg = orgs.find(org => org.id === this.currentOrg);
                if (selectedOrg) {
                    data.selectedOrgName = selectedOrg.name;
                }

                // If we have a selected org, get projects
                const projects = await this.getProjects(this.currentOrg);
                data.projects = projects.map(project => ({ id: project.id, name: project.name }));
                
                // Set selected project name
                if (this.currentProject) {
                    const selectedProject = projects.find(project => project.id === this.currentProject);
                    if (selectedProject) {
                        data.selectedProjectName = selectedProject.name;
                    }

                    // If we have a selected project, get branches
                    const branches = await this.getBranches(this.currentProject);
                    data.branches = branches.map(branch => ({ id: branch.id, name: branch.name }));
                    
                    // Set selected branch name
                    if (this.currentBranch) {
                        const selectedBranch = branches.find(branch => branch.id === this.currentBranch);
                        if (selectedBranch) {
                            data.selectedBranchName = selectedBranch.name;
                        }
                    }
                }
            }

            // Add connection info if proxy is running
            if (this.isProxyRunning && this.currentBranch) {
                const config = vscode.workspace.getConfiguration('neonLocal');
                const driver = config.get<string>('driver') || 'postgres';
                
                data.connectionInfo = driver === 'postgres' 
                    ? 'postgres://neon:npg@localhost:5432/<database_name>?sslmode=require'
                    : 'postgres://neon:npg@localhost:5432/<database_name>?sslmode=no-verify\n\n' +
                      'For serverless driver, also set:\n' +
                      'neonConfig.fetchEndpoint = \'http://localhost:5432/sql\'';
            }

            return data;
        } catch (error) {
            if (error instanceof Error && error.message.includes('Authentication')) {
                throw error;
            }
            throw new Error(`Failed to get view data: ${error}`);
        }
    }

    public setParentBranchId(parentBranchId: string | undefined) {
        this._parentBranchId = parentBranchId;
    }

    public getParentBranchId(): string | undefined {
        return this._parentBranchId;
    }

    private async handleResetFromParent() {
        if (!this.currentProject) {
            vscode.window.showErrorMessage('No project selected.');
            return;
        }
        // Confirmation dialog
        const confirm = await vscode.window.showWarningMessage(
            'Are you sure you want to reset this branch from its parent? This operation cannot be undone.',
            { modal: true },
            'Reset'
        );
        if (confirm !== 'Reset') {
            return;
        }
        let branchIdToReset: string | undefined = this.currentBranch;
        try {
            // Check if the proxy was started with PARENT_BRANCH_ID by looking for a .branches file
            const neonLocalDir = path.join(this.context.globalStorageUri.fsPath, '.neon_local');
            const branchesFile = path.join(neonLocalDir, '.branches');
            if (fs.existsSync(branchesFile)) {
                const fileContent = fs.readFileSync(branchesFile, 'utf-8').trim();
                if (fileContent) {
                    try {
                        const branchesJson = JSON.parse(fileContent);
                        // Use the first branch_id found in the object
                        const first = Object.values(branchesJson)[0] as { branch_id?: string };
                        if (first && typeof first === 'object' && first.branch_id) {
                            branchIdToReset = first.branch_id;
                        }
                    } catch (err) {
                        console.error('Failed to parse .branches JSON:', err);
                    }
                }
            }
        } catch (err) {
            console.error('Error reading .branches file:', err);
        }
        if (!branchIdToReset) {
            vscode.window.showErrorMessage('No branch ID found to reset.');
            return;
        }
        try {
            const client = await this.getNeonApiClient();
            const url = `/projects/${this.currentProject}/branches/${branchIdToReset}/reset_to_parent`;
            await client.post(url);
            vscode.window.showInformationMessage('Branch reset successfully.');
        } catch (error: any) {
            console.error('Failed to reset branch to parent:', error);
            vscode.window.showErrorMessage('Failed to reset branch to parent: ' + (error?.response?.data?.message || error.message || error.toString()));
        }
    }

    private async handleOpenSqlEditor() {
        if (!this.currentProject) {
            vscode.window.showErrorMessage('No project selected.');
            return;
        }
        let branchIdToOpen: string | undefined = this.currentBranch;
        try {
            const neonLocalDir = path.join(this.context.globalStorageUri.fsPath, '.neon_local');
            const branchesFile = path.join(neonLocalDir, '.branches');
            if (fs.existsSync(branchesFile)) {
                const fileContent = fs.readFileSync(branchesFile, 'utf-8').trim();
                if (fileContent) {
                    try {
                        const branchesJson = JSON.parse(fileContent);
                        // Use the first branch_id found in the object
                        const branchIds = Object.values(branchesJson)
                            .map((v: any) => v && typeof v === 'object' ? v.branch_id : undefined)
                            .filter((id: any) => typeof id === 'string');
                        if (branchIds.length > 0) {
                            branchIdToOpen = branchIds[0];
                        }
                    } catch (err) {
                        console.error('Failed to parse .branches JSON:', err);
                    }
                }
            }
        } catch (err) {
            console.error('Error reading .branches file:', err);
        }
        if (!branchIdToOpen) {
            vscode.window.showErrorMessage('No branch ID found to open SQL editor.');
            return;
        }
        const url = `https://console.neon.tech/app/projects/${this.currentProject}/branches/${branchIdToOpen}/sql-editor`;
        try {
            // Use opener to open the URL in the user's default browser
            const opener = require('opener');
            opener(url);
        } catch (err) {
            let msg = 'Failed to open SQL editor.';
            if (err && typeof err === 'object' && 'message' in err) {
                msg += ' ' + (err as any).message;
            } else if (typeof err === 'string') {
                msg += ' ' + err;
            }
            vscode.window.showErrorMessage(msg);
        }
    }
}

export async function activate(context: vscode.ExtensionContext) {
    // If running in test mode, run the test suite and return
    if (process.env.VSCODE_TEST_MODE) {
        // Dynamically import the test runner and run it
        try {
            const testRunner = await import('./test/suite/index');
            await testRunner.run();
        } catch (err) {
            console.error('Failed to run test suite:', err);
        }
        return;
    }

    const neonLocal = new NeonLocalManager(context);

    // Register commands
    let disposable = vscode.commands.registerCommand('neon-local.configure', () => {
        neonLocal.configure();
    });
    context.subscriptions.push(disposable);

    disposable = vscode.commands.registerCommand('neon-local.showPanel', () => {
        neonLocal.showPanel();
    });
    context.subscriptions.push(disposable);

    disposable = vscode.commands.registerCommand('neon-local.stopProxy', () => {
        neonLocal.stopProxy();
    });
    context.subscriptions.push(disposable);

    disposable = vscode.commands.registerCommand('neon-local.clearAuth', async () => {
        await neonLocal.clearAuth();
        // The view will update automatically due to the configuration change listener
    });
    context.subscriptions.push(disposable);

    // Register the unified view provider
    const viewProvider = new NeonLocalViewProvider(context.extensionUri, neonLocal);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(NeonLocalViewProvider.viewType, viewProvider),
        viewProvider // Add the provider itself to disposables to clean up the configuration listener
    );

    // Register the sign-in webview provider
    const signInProvider = new SignInWebviewProvider(context.extensionUri);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(SignInWebviewProvider.viewType, signInProvider)
    );

    // Register a command to show the sign-in view
    let signInCommand = vscode.commands.registerCommand('neonLocal.signIn', async () => {
        await vscode.commands.executeCommand('workbench.view.extension.neon-local');
        await vscode.commands.executeCommand('neonLocal.signIn.focus');
    });

    context.subscriptions.push(signInCommand);
}

export function deactivate() {
    // Clean up resources
} 