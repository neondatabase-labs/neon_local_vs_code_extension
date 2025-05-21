import * as vscode from 'vscode';
import { DockerService } from './services/docker.service';
import { NeonApiService } from './services/api.service';
import { StateService } from './services/state.service';
import { WebViewService } from './services/webview.service';
import { SignInWebviewProvider } from './signInView';
import { NeonLocalViewProvider } from './neonLocalView';
import { NeonLocalManager, ViewData } from './types';

export class NeonLocalExtension implements NeonLocalManager {
    private dockerService: DockerService;
    private apiService: NeonApiService;
    private stateService: StateService;
    private webviewService: WebViewService;
    private statusCheckInterval?: NodeJS.Timeout;

    constructor(private context: vscode.ExtensionContext) {
        this.dockerService = new DockerService();
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
            vscode.commands.registerCommand('neon-local.clearAuth', () => this.clearAuth())
        );
    }

    private registerViews() {
        const signInProvider = new SignInWebviewProvider(this.context.extensionUri);
        const neonLocalProvider = new NeonLocalViewProvider(this.context.extensionUri, this);

        this.context.subscriptions.push(
            vscode.window.registerWebviewViewProvider('neonLocalView', neonLocalProvider)
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
            await this.updateViewData();
        }
    }

    private async updateViewData() {
        try {
            console.log('Fetching organizations...');
            const orgs = await this.apiService.getOrgs();
            console.log('Organizations:', orgs);

            console.log('Current org:', this.stateService.currentOrg);
            // Always fetch projects if we're updating the view
            const projects = await this.apiService.getProjects(this.stateService.currentOrg);
            console.log('Projects:', projects);

            const branches = this.stateService.currentProject ? 
                await this.apiService.getBranches(this.stateService.currentProject) : [];
            console.log('Branches:', branches);

            // Get the current driver from the container if it's running
            if (this.stateService.isProxyRunning) {
                const containerDriver = await this.dockerService.getCurrentDriver();
                // Only update if different to avoid race conditions
                if (containerDriver !== this.stateService.selectedDriver) {
                    console.log(`Driver mismatch - container: ${containerDriver}, selected: ${this.stateService.selectedDriver}`);
                    this.stateService.selectedDriver = containerDriver;
                }
            }

            const viewData = await this.stateService.getViewData(
                orgs,
                projects,
                branches,
                this.stateService.isProxyRunning,
                this.stateService.isStarting,
                this.stateService.selectedDriver
            );
            console.log('View data:', viewData);

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

    public async handleStartProxy(driver: string, isExisting: boolean, branchId?: string, parentBranchId?: string) {
        const selectedBranchId = isExisting ? branchId : parentBranchId;
        if (!selectedBranchId) {
            throw new Error('No branch selected');
        }

        try {
            this.stateService.isStarting = true;
            // Set the driver in state service before starting the container
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
            await this.updateViewData();
        } catch (error) {
            this.stateService.isStarting = false;
            this.handleError(error);
        }
    }

    public async getViewData(): Promise<ViewData> {
        const orgs = await this.apiService.getOrgs();
        const projects = this.stateService.currentOrg ? 
            await this.apiService.getProjects(this.stateService.currentOrg) : [];
        const branches = this.stateService.currentProject ? 
            await this.apiService.getBranches(this.stateService.currentProject) : [];

        return this.stateService.getViewData(
            orgs,
            projects,
            branches,
            this.stateService.isProxyRunning,
            this.stateService.isStarting,
            this.stateService.selectedDriver
        );
    }

    public async handleStopProxy(): Promise<void> {
        await this.stopProxy();
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