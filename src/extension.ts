import * as vscode from 'vscode';
import Dockerode from 'dockerode';
import axios from 'axios';
import * as path from 'path';
import * as fs from 'fs';

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
            
            // Only update UI if status changed
            if (wasRunning !== this.isProxyRunning) {
                console.log('Container status changed:', { wasRunning, isRunning: this.isProxyRunning });
                await this.updateWebview();
            }
        } catch (error) {
            // If we get an error, the container doesn't exist or isn't running
            const wasRunning = this.isProxyRunning;
            this.isProxyRunning = false;
            
            // Only update UI if status changed
            if (wasRunning !== this.isProxyRunning) {
                console.log('Container not found or error:', error);
                console.log('Container status changed:', { wasRunning, isRunning: this.isProxyRunning });
                await this.updateWebview();
            }
        }
    }

    private async saveState() {
        await this.state.update('neonLocal.currentOrg', this.currentOrg);
        await this.state.update('neonLocal.currentProject', this.currentProject);
        await this.state.update('neonLocal.currentBranch', this.currentBranch);
    }

    private async getNeonApiClient() {
        const config = vscode.workspace.getConfiguration('neonLocal');
        const apiKey = config.get<string>('apiKey');
        
        if (!apiKey) {
            throw new Error('Neon API key not configured');
        }

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

    private getWebview() {
        return this.webviewView?.webview || this.webviewPanel?.webview;
    }

    public async updateWebview() {
        const webview = this.getWebview();
        if (!webview) return;

        try {
            // Show loading state for initial load
            webview.postMessage({
                command: 'updateStatus',
                connected: this.isProxyRunning,
                branch: this.currentBranch,
                loading: true
            });

            const orgs = await this.getOrgs();
            webview.postMessage({
                command: 'updateOrgs',
                orgs: orgs.map(org => ({ id: org.id, name: org.name })),
                selectedOrg: this.currentOrg
            });

            if (this.currentOrg) {
                console.log('Fetching projects for current org:', this.currentOrg);
                const projects = await this.getProjects(this.currentOrg);
                console.log('Projects fetched:', projects);
                
                webview.postMessage({
                    command: 'updateProjects',
                    projects: projects.map(project => ({ id: project.id, name: project.name })),
                    selectedProject: this.currentProject
                });

                if (this.currentProject) {
                    console.log('Fetching branches for current project:', this.currentProject);
                    const branches = await this.getBranches(this.currentProject);
                    console.log('Branches fetched:', branches);
                    
                    webview.postMessage({
                        command: 'updateBranches',
                        branches: branches.map(branch => ({ id: branch.id, name: branch.name })),
                        selectedBranch: this.currentBranch
                    });
                }
            }

            // Update status and connection info if proxy is running
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
            vscode.window.showErrorMessage(`Failed to update webview: ${error}`);
            if (webview) {
                webview.postMessage({
                    command: 'updateStatus',
                    connected: false,
                    branch: undefined,
                    loading: false,
                    error: error instanceof Error ? error.message : String(error)
                });
            }
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

    public setWebviewView(webviewView: vscode.WebviewView) {
        this.webviewView = webviewView;
        
        // Set up message handling
        webviewView.webview.onDidReceiveMessage(async message => {
            try {
                switch (message.command) {
                    case 'selectOrg':
                        console.log('Selected org:', message.orgId);
                        this.currentOrg = message.orgId;
                        this.currentProject = undefined;
                        this.currentBranch = undefined;
                        await this.saveState();
                        await this.updateWebview();
                        break;
                    case 'selectProject':
                        this.currentProject = message.projectId;
                        await this.saveState();
                        await this.updateWebview();
                        break;
                    case 'selectBranch':
                        this.currentBranch = message.branchId;
                        await this.saveState();
                        await this.checkContainerStatus();
                        // If we should restart the proxy
                        if (message.restartProxy) {
                            await this.startContainer(message.branchId, message.driver);
                        }
                        break;
                    case 'startProxy':
                        if (this.currentBranch) {
                            await this.startContainer(this.currentBranch, message.driver);
                        }
                        break;
                    case 'stopProxy':
                        await this.stopProxy();
                        break;
                    case 'createBranch':
                        await this.createBranch();
                        break;
                    case 'showInfo':
                        vscode.window.showInformationMessage(message.text);
                        break;
                    case 'showError':
                        vscode.window.showErrorMessage(message.text);
                        break;
                }
            } catch (error) {
                vscode.window.showErrorMessage(`Error: ${error}`);
                webviewView.webview.postMessage({
                    command: 'updateStatus',
                    connected: false,
                    branch: undefined
                });
            }
        });

        // Handle visibility changes
        webviewView.onDidChangeVisibility(() => {
            if (webviewView.visible) {
                this.startStatusCheck();
                this.updateWebview(); // Use updateWebview instead of checkContainerStatus for initial load
            } else {
                this.stopStatusCheck();
            }
        });

        // Initial update
        this.updateWebview(); // Use updateWebview for initial load
    }

    public async startContainer(branchId: string, driver: string) {
        const config = vscode.workspace.getConfiguration('neonLocal');
        const projectId = config.get<string>('projectId');
        const apiKey = config.get<string>('apiKey');

        const containerConfig = {
            Image: 'neondatabase/neon_local:latest',
            name: 'neon_local_vscode',
            Env: [
                `NEON_API_KEY=${apiKey}`,
                `NEON_PROJECT_ID=${projectId}`,
                `PARENT_BRANCH_ID=${branchId}`,
                `DRIVER=${driver}`
            ],
            HostConfig: {
                PortBindings: {
                    '5432/tcp': [{ HostPort: '5432' }]
                }
            }
        };

        try {
            const existingContainer = await this.docker.getContainer('neon_local_vscode');
            await existingContainer.remove({ force: true }).catch(() => {});

            const container = await this.docker.createContainer(containerConfig);
            await container.start();

            this.currentBranch = branchId;
            this.isProxyRunning = true;
            this.updateStatusBar();
            await this.updateWebview();
            
            vscode.window.showInformationMessage('Neon Local proxy started successfully');
        } catch (error) {
            this.isProxyRunning = false;
            vscode.window.showErrorMessage(`Failed to start Neon Local proxy: ${error}`);
            await this.updateWebview();
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
            this.updateWebview(); // Use updateWebview instead of checkContainerStatus for initial load
            return;
        }

        // Check if API key is configured
        const config = vscode.workspace.getConfiguration('neonLocal');
        const apiKey = config.get<string>('apiKey');
        
        if (!apiKey) {
            vscode.window.showErrorMessage('Please configure your Neon API key first');
            this.configure();
            return;
        }

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

        this.webviewPanel.webview.onDidReceiveMessage(async message => {
            try {
                switch (message.command) {
                    case 'selectOrg':
                        console.log('Selected org:', message.orgId);
                        this.currentOrg = message.orgId;
                        this.currentProject = undefined;
                        this.currentBranch = undefined;
                        await this.saveState();
                        await this.updateWebview();
                        break;
                    case 'selectProject':
                        this.currentProject = message.projectId;
                        await this.saveState();
                        await this.updateWebview();
                        break;
                    case 'selectBranch':
                        this.currentBranch = message.branchId;
                        await this.saveState();
                        await this.checkContainerStatus();
                        // If we should restart the proxy
                        if (message.restartProxy) {
                            await this.startContainer(message.branchId, message.driver);
                        }
                        break;
                    case 'startProxy':
                        if (this.currentBranch) {
                            await this.startContainer(this.currentBranch, message.driver);
                        }
                        break;
                    case 'stopProxy':
                        await this.stopProxy();
                        break;
                    case 'createBranch':
                        await this.createBranch();
                        break;
                    case 'showInfo':
                        vscode.window.showInformationMessage(message.text);
                        break;
                    case 'showError':
                        vscode.window.showErrorMessage(message.text);
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
        this.updateWebview(); // Use updateWebview for initial load
    }

    async configure() {
        const apiKey = await vscode.window.showInputBox({
            prompt: 'Enter your Neon API Key',
            password: true,
            ignoreFocusOut: true
        });

        if (apiKey) {
            const config = vscode.workspace.getConfiguration('neonLocal');
            await config.update('apiKey', apiKey, true);
            await this.showPanel();
        }
    }

    async createBranch() {
        if (!this.currentProject) {
            vscode.window.showErrorMessage('Please select a project first');
            return;
        }

        try {
            const client = await this.getNeonApiClient();
            
            // Get available branches for parent selection
            const branches = await this.getBranches(this.currentProject);
            const branchOptions = [
                { label: 'No parent branch (create from main)', value: undefined },
                ...branches.map(branch => ({ label: branch.name, value: branch.id }))
            ];

            // Let user select parent branch
            const parentBranch = await vscode.window.showQuickPick(branchOptions, {
                placeHolder: 'Select parent branch (optional)',
                ignoreFocusOut: true
            });

            if (parentBranch === undefined) return; // User cancelled

            const branchName = await vscode.window.showInputBox({
                prompt: 'Enter new branch name',
                ignoreFocusOut: true
            });

            if (!branchName) return;

            const payload: any = {
                branch: { name: branchName },
                endpoints: [{ type: "read_write" }]
            };

            // Add parent_id if a parent branch was selected
            if (parentBranch.value) {
                payload.branch.parent_id = parentBranch.value;
            }

            const response = await client.post(`/projects/${this.currentProject}/branches`, payload);

            const newBranch = response.data.branch;
            vscode.window.showInformationMessage(`Created branch: ${newBranch.name}`);
            
            // Set the current branch to the newly created one
            this.currentBranch = newBranch.id;
            
            // Update the webview to show the new branch and select it
            await this.updateWebview();
            
            // Post a message to select the new branch in the dropdown
            if (this.webviewPanel) {
                this.webviewPanel.webview.postMessage({
                    command: 'updateBranches',
                    branches: (await this.getBranches(this.currentProject)).map(branch => ({ 
                        id: branch.id, 
                        name: branch.name 
                    })),
                    selectedBranch: this.currentBranch
                });
            }
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to create branch: ${error}`);
        }
    }

    public async stopProxy() {
        try {
            const container = await this.docker.getContainer('neon_local_vscode');
            await container.stop();
            await container.remove();
            
            this.isProxyRunning = false;
            this.updateStatusBar();
            await this.updateWebview();
            
            vscode.window.showInformationMessage('Neon Local proxy stopped');
        } catch (error) {
            this.isProxyRunning = false;
            vscode.window.showErrorMessage(`Failed to stop proxy: ${error}`);
            await this.updateWebview();
        }
    }
}

export function activate(context: vscode.ExtensionContext) {
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

    disposable = vscode.commands.registerCommand('neon-local.createBranch', () => {
        neonLocal.createBranch();
    });
    context.subscriptions.push(disposable);

    // Register view
    disposable = vscode.window.registerWebviewViewProvider('neonLocalView', {
        resolveWebviewView: (webviewView: vscode.WebviewView) => {
            webviewView.webview.options = {
                enableScripts: true,
                localResourceRoots: [vscode.Uri.file(path.join(context.extensionPath, 'src', 'webview'))]
            };
            webviewView.webview.html = neonLocal.getWebviewContent();
            
            // Store the webview for later use
            neonLocal.setWebviewView(webviewView);
        }
    });
    context.subscriptions.push(disposable);
}

export function deactivate() {
    // Clean up resources
} 