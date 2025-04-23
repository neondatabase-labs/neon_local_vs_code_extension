import * as vscode from 'vscode';
import * as dockerode from 'dockerode';
import axios from 'axios';
import * as path from 'path';
import * as fs from 'fs';

interface NeonBranch {
    id: string;
    name: string;
    project_id: string;
    parent_id: string | null;
}

export class NeonLocalManager {
    private docker: dockerode;
    private context: vscode.ExtensionContext;
    private statusBarItem: vscode.StatusBarItem;
    private currentBranch: string | undefined;

    constructor(context: vscode.ExtensionContext) {
        this.docker = new dockerode();
        this.context = context;
        this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
        this.statusBarItem.show();
        this.updateStatusBar();
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
            }
        });
    }

    private async getBranches(): Promise<NeonBranch[]> {
        const client = await this.getNeonApiClient();
        const projectId = vscode.workspace.getConfiguration('neonLocal').get<string>('projectId');
        
        if (!projectId) {
            throw new Error('Project ID not configured');
        }

        const response = await client.get(`/projects/${projectId}/branches`);
        return response.data.branches;
    }

    private updateStatusBar() {
        if (this.currentBranch) {
            this.statusBarItem.text = `$(database) Neon: ${this.currentBranch}`;
        } else {
            this.statusBarItem.text = '$(database) Neon: Not Connected';
        }
    }

    private async startContainer(branchId: string) {
        const config = vscode.workspace.getConfiguration('neonLocal');
        const driver = config.get<string>('driver', 'postgres');
        const projectId = config.get<string>('projectId');
        const apiKey = config.get<string>('apiKey');

        // Create container configuration
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
            // Remove existing container if it exists
            const existingContainer = await this.docker.getContainer('neon_local_vscode');
            await existingContainer.remove({ force: true }).catch(() => {});

            // Create and start new container
            const container = await this.docker.createContainer(containerConfig);
            await container.start();

            this.currentBranch = branchId;
            this.updateStatusBar();
            
            vscode.window.showInformationMessage(`Neon Local proxy started with branch ${branchId}`);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to start Neon Local proxy: ${error}`);
        }
    }

    async configure() {
        const apiKey = await vscode.window.showInputBox({
            prompt: 'Enter your Neon API Key',
            password: true
        });

        if (apiKey) {
            const config = vscode.workspace.getConfiguration('neonLocal');
            await config.update('apiKey', apiKey, true);
        }

        const projectId = await vscode.window.showInputBox({
            prompt: 'Enter your Neon Project ID'
        });

        if (projectId) {
            const config = vscode.workspace.getConfiguration('neonLocal');
            await config.update('projectId', projectId, true);
        }

        const driver = await vscode.window.showQuickPick(['postgres', 'serverless'], {
            placeHolder: 'Select driver'
        });

        if (driver) {
            const config = vscode.workspace.getConfiguration('neonLocal');
            await config.update('driver', driver, true);
        }
    }

    async createBranch() {
        try {
            const client = await this.getNeonApiClient();
            const projectId = vscode.workspace.getConfiguration('neonLocal').get<string>('projectId');
            
            const branchName = await vscode.window.showInputBox({
                prompt: 'Enter new branch name'
            });

            if (!branchName) return;

            const response = await client.post(`/projects/${projectId}/branches`, {
                branch: { name: branchName }
            });

            const newBranch = response.data.branch;
            vscode.window.showInformationMessage(`Created branch: ${newBranch.name}`);
            
            const switchToBranch = await vscode.window.showQuickPick(['Yes', 'No'], {
                placeHolder: 'Switch to new branch?'
            });

            if (switchToBranch === 'Yes') {
                await this.startContainer(newBranch.id);
            }
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to create branch: ${error}`);
        }
    }

    async switchBranch() {
        try {
            const branches = await this.getBranches();
            const branchItems = branches.map(b => ({
                label: b.name,
                description: b.id,
                branch: b
            }));

            const selected = await vscode.window.showQuickPick(branchItems, {
                placeHolder: 'Select branch to switch to'
            });

            if (selected) {
                await this.startContainer(selected.branch.id);
            }
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to switch branch: ${error}`);
        }
    }

    async deleteBranch() {
        try {
            const branches = await this.getBranches();
            const branchItems = branches.map(b => ({
                label: b.name,
                description: b.id,
                branch: b
            }));

            const selected = await vscode.window.showQuickPick(branchItems, {
                placeHolder: 'Select branch to delete'
            });

            if (selected) {
                const client = await this.getNeonApiClient();
                const projectId = vscode.workspace.getConfiguration('neonLocal').get<string>('projectId');
                
                await client.delete(`/projects/${projectId}/branches/${selected.branch.id}`);
                vscode.window.showInformationMessage(`Deleted branch: ${selected.branch.name}`);

                if (this.currentBranch === selected.branch.id) {
                    await this.stopProxy();
                }
            }
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to delete branch: ${error}`);
        }
    }

    async stopProxy() {
        try {
            const container = await this.docker.getContainer('neon_local_vscode');
            await container.stop();
            await container.remove();
            
            this.currentBranch = undefined;
            this.updateStatusBar();
            
            vscode.window.showInformationMessage('Neon Local proxy stopped');
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to stop proxy: ${error}`);
        }
    }
}

export function activate(context: vscode.ExtensionContext) {
    const neonLocal = new NeonLocalManager(context);

    let disposable = vscode.commands.registerCommand('neon-local.configure', () => {
        neonLocal.configure();
    });
    context.subscriptions.push(disposable);

    disposable = vscode.commands.registerCommand('neon-local.startProxy', () => {
        neonLocal.switchBranch();
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

    disposable = vscode.commands.registerCommand('neon-local.switchBranch', () => {
        neonLocal.switchBranch();
    });
    context.subscriptions.push(disposable);

    disposable = vscode.commands.registerCommand('neon-local.deleteBranch', () => {
        neonLocal.deleteBranch();
    });
    context.subscriptions.push(disposable);
}

export function deactivate() {
    // Clean up resources
} 