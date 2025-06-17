import * as vscode from 'vscode';
import Docker from 'dockerode';
import * as path from 'path';
import * as fs from 'fs';
import { StateService } from './state.service';
import { AuthManager } from '../auth/authManager';

export class DockerService {
    private docker: Docker;
    private containerName = 'neon_local_vscode';
    private context: vscode.ExtensionContext;
    private stateService: StateService;
    private statusCheckInterval: NodeJS.Timeout | null = null;

    constructor(context: vscode.ExtensionContext, stateService: StateService) {
        this.docker = new Docker();
        this.context = context;
        this.stateService = stateService;
    }

    async checkContainerStatus(): Promise<boolean> {
        try {
            const container = await this.docker.getContainer(this.containerName);
            const containerInfo = await container.inspect();
            return containerInfo.State.Running;
        } catch (error) {
            return false;
        }
    }

    async getCurrentDriver(): Promise<'postgres' | 'serverless'> {
        try {
            const container = await this.docker.getContainer(this.containerName);
            const containerInfo = await container.inspect();
            
            // Find the DRIVER environment variable
            const driverEnv = containerInfo.Config.Env.find((env: string) => env.startsWith('DRIVER='));
            if (!driverEnv) {
                return 'postgres'; // Default to postgres if not found
            }
            
            const driver = driverEnv.split('=')[1];
            return driver === 'serverless' ? 'serverless' : 'postgres';
        } catch (error) {
            console.error('Error getting current driver:', error);
            return 'postgres'; // Default to postgres on error
        }
    }

    public async startStatusCheck(): Promise<void> {
        // Clear any existing interval
        if (this.statusCheckInterval) {
            clearInterval(this.statusCheckInterval);
        }

        // Start periodic status check every 5 seconds
        this.statusCheckInterval = setInterval(async () => {
            try {
                const isRunning = await this.checkContainerStatus();
                if (!isRunning) {
                    console.log('Container is no longer running, updating state...');
                    await this.stateService.setIsProxyRunning(false);
                    this.stopStatusCheck();
                }
            } catch (error) {
                console.error('Error checking container status:', error);
            }
        }, 5000);
    }

    private stopStatusCheck(): void {
        if (this.statusCheckInterval) {
            clearInterval(this.statusCheckInterval);
            this.statusCheckInterval = null;
        }
    }

    public async startContainer(options: {
        branchId: string;
        driver: string;
        isExisting: boolean;
        context: vscode.ExtensionContext;
        projectId: string;
    }): Promise<void> {
        try {
            console.log('Starting container with options:', options);
            
            // Create the .neon_local directory if it doesn't exist
            const neonLocalPath = path.join(options.context.globalStorageUri.fsPath, '.neon_local');
            if (!fs.existsSync(neonLocalPath)) {
                await fs.promises.mkdir(neonLocalPath, { recursive: true });
            }

            // Start the container
            await this.startProxy(options);

            // Wait for container to be ready
            await this.waitForContainer();

            // For new branches, we need to wait for the .branches file to be populated
            if (!options.isExisting) {
                // Give a longer delay for the .branches file to be written
                await new Promise(resolve => setTimeout(resolve, 5000));
                
                // Check if the .branches file is properly populated
                const branchId = await this.checkBranchesFile(options.context);
                if (!branchId) {
                    console.log('Branches file not populated or no branch ID found');
                }
            } else {
                // For existing branches, check if we have a branch ID in the file
                const branchId = await this.checkBranchesFile(options.context);
                if (branchId) {
                    console.log('Using existing branch ID from .branches file:', branchId);
                }
            }

            // Set proxy running state
            await this.stateService.setIsProxyRunning(true);
            await this.stateService.setIsStarting(false);

            console.log('Container started successfully');
        } catch (error) {
            console.error('Error starting container:', error);
            await this.stateService.setIsStarting(false);
            throw error;
        }
    }

    async stopContainer(): Promise<void> {
        try {
            const container = await this.docker.getContainer(this.containerName);
            await container.stop();
            await container.remove();

            // Clear connection-related state but preserve branch selection
            await this.stateService.setIsProxyRunning(false);
            await this.stateService.setConnectionInfo({
                connectionInfo: '',
                selectedDatabase: ''
            });
            await this.stateService.setCurrentlyConnectedBranch('');
            await this.stateService.setDatabases([]);
            await this.stateService.setRoles([]);
            
            // Stop periodic status check
            this.stopStatusCheck();
            
            console.log('Container stopped successfully');
        } catch (error) {
            // If the container doesn't exist, that's fine - just update the state
            if ((error as any).statusCode === 404) {
                await this.stateService.setIsProxyRunning(false);
                await this.stateService.setConnectionInfo({
                    connectionInfo: '',
                    selectedDatabase: ''
                });
                await this.stateService.setCurrentlyConnectedBranch('');
                await this.stateService.setDatabases([]);
                await this.stateService.setRoles([]);
                this.stopStatusCheck();
                return;
            }
            console.error('Error stopping container:', error);
            throw error;
        }
    }

    private async pullImage(): Promise<void> {
        try {
            await this.docker.getImage('neondatabase/neon_local:latest').inspect();
        } catch {
            await new Promise((resolve, reject) => {
                this.docker.pull('neondatabase/neon_local:latest', {}, (err: any, stream: any) => {
                    if (err) {
                        reject(err);
                        return;
                    }
                    this.docker.modem.followProgress(stream, (err: any) => {
                        if (err) {
                            reject(err);
                            return;
                        }
                        resolve(true);
                    });
                });
            });
        }
    }

    public async checkBranchesFile(context: vscode.ExtensionContext): Promise<string | false> {
        try {
            const neonLocalPath = path.join(context.globalStorageUri.fsPath, '.neon_local');
            const branchesPath = path.join(neonLocalPath, '.branches');
            
            if (!fs.existsSync(branchesPath)) {
                console.log('Branches file does not exist yet');
                return false;
            }
            
            const content = await fs.promises.readFile(branchesPath, 'utf-8');
            console.log('Read .branches file content:', content);
            
            if (!content.trim()) {
                console.log('Branches file is empty');
                return false;
            }
            
            const data = JSON.parse(content);
            console.log('Parsed .branches file data:', JSON.stringify(data, null, 2));
            
            if (!data || Object.keys(data).length === 0) {
                console.log('No data in branches file');
                return false;
            }
            
            // Find the first key that has a branch_id
            const branchKey = Object.keys(data).find(key => 
                data[key] && typeof data[key] === 'object' && 'branch_id' in data[key]
            );
            
            if (!branchKey) {
                console.log('No branch ID found in branches file. Data structure:', JSON.stringify(data));
                return false;
            }
            
            const branchId = data[branchKey].branch_id;
            console.log('Found branch ID in branches file:', branchId);
            
            // Update the state with the branch ID from the .branches file
            await this.stateService.setCurrentlyConnectedBranch(branchId);
            
            return branchId;
        } catch (error) {
            console.error('Error checking branches file:', error);
            return false;
        }
    }

    private async waitForContainer(): Promise<void> {
        const maxAttempts = 30; // 30 seconds timeout
        let attempts = 0;
        
        while (attempts < maxAttempts) {
            try {
                const container = await this.docker.getContainer(this.containerName);
                const containerInfo = await container.inspect();
                
                if (containerInfo.State.Running) {
                    console.log('Container is running, checking logs for readiness...');
                    // Container is running, now wait for the .branches file to be populated
                    const logs = await container.logs({
                        stdout: true,
                        stderr: true,
                        tail: 50
                    });
                    
                    const logStr = logs.toString();
                    
                    // Check if there are any error messages in the logs
                    if (logStr.includes('Error:') || logStr.includes('error:')) {
                        console.error('Found error in container logs:', logStr);
                        throw new Error('Container reported an error in logs');
                    }
                    
                    // Check if the logs indicate the container is ready
                    if (logStr.includes('Neon Local is ready')) {
                        console.log('Container is ready');
                        return;
                    } else {
                        console.log('Container not yet ready, waiting for ready message...');
                    }
                }
                
                attempts++;
                await new Promise(resolve => setTimeout(resolve, 1000));
            } catch (error) {
                console.error('Error waiting for container:', error);
                attempts++;
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }
        
        throw new Error('Container failed to become ready within timeout period');
    }

    async getContainerInfo(): Promise<{
        branchId: string;
        projectId: string;
        driver: string;
        isParentBranch: boolean;
    } | null> {
        try {
            const container = await this.docker.getContainer(this.containerName);
            const containerInfo = await container.inspect();
            
            // Extract environment variables
            const envVars = containerInfo.Config.Env;
            const getEnvValue = (key: string) => {
                const envVar = envVars.find((env: string) => env.startsWith(`${key}=`));
                return envVar ? envVar.split('=')[1] : '';
            };
            
            // Get branch ID (either from BRANCH_ID or PARENT_BRANCH_ID)
            const branchId = getEnvValue('BRANCH_ID') || getEnvValue('PARENT_BRANCH_ID');
            const projectId = getEnvValue('NEON_PROJECT_ID');
            const driver = getEnvValue('DRIVER');
            const isParentBranch = Boolean(getEnvValue('PARENT_BRANCH_ID'));
            
            if (!branchId || !projectId) {
                console.error('Missing required environment variables in container');
                return null;
            }
            
            return {
                branchId,
                projectId,
                driver: driver || 'postgres',
                isParentBranch
            };
        } catch (error) {
            console.error('Error getting container info:', error);
            return null;
        }
    }

    private async startProxy(options: {
        branchId: string;
        driver: string;
        isExisting: boolean;
        context: vscode.ExtensionContext;
        projectId: string;
    }): Promise<void> {
        // Get API key from configuration
        const config = vscode.workspace.getConfiguration('neonLocal');
        const persistentApiToken = config.get<string>('persistentApiToken');
        const apiKey = config.get<string>('apiKey');

        // If persistent token exists, use it for all operations
        if (persistentApiToken) {
            // Pull the latest image
            await this.pullImage();

            // Create container configuration
            const containerConfig: any = {
                Image: 'neondatabase/neon_local:latest',
                name: this.containerName,
                Env: [
                    `DRIVER=${options.driver === 'serverless' ? 'serverless' : 'postgres'}`,
                    `NEON_API_KEY=${persistentApiToken}`,
                    `NEON_PROJECT_ID=${options.projectId}`,
                    'CLIENT=vscode',
                    options.isExisting ? `BRANCH_ID=${options.branchId}` : `PARENT_BRANCH_ID=${options.branchId}`
                ],
                HostConfig: {
                    PortBindings: {
                        '5432/tcp': [{ HostPort: '5432' }]
                    }
                }
            };

            // Add volume binding using global storage path
            const neonLocalPath = path.join(options.context.globalStorageUri.fsPath, '.neon_local');
            containerConfig.HostConfig.Binds = [`${neonLocalPath}:/tmp/.neon_local`];

            await this.startContainerInternal(containerConfig);
            return;
        }

        // For new branches, require persistent token
        if (!options.isExisting) {
            throw new Error('Persistent API token required for creating new branches.');
        }

        // For existing branches, require OAuth token
        if (!apiKey) {
            throw new Error('Authentication required. Please sign in.');
        }

        // Refresh token if needed before starting container
        const authManager = AuthManager.getInstance(options.context);
        const refreshSuccess = await authManager.refreshTokenIfNeeded();
        if (!refreshSuccess) {
            throw new Error('Failed to refresh authentication token. Please sign in again.');
        }

        // Get the potentially refreshed token
        const refreshedApiKey = vscode.workspace.getConfiguration('neonLocal').get<string>('apiKey');
        if (!refreshedApiKey) {
            throw new Error('No valid authentication token available. Please sign in again.');
        }

        // Pull the latest image
        await this.pullImage();

        // Create container configuration
        const containerConfig: any = {
            Image: 'neondatabase/neon_local:latest',
            name: this.containerName,
            Env: [
                `DRIVER=${options.driver === 'serverless' ? 'serverless' : 'postgres'}`,
                `NEON_API_KEY=${refreshedApiKey}`,
                `NEON_PROJECT_ID=${options.projectId}`,
                'CLIENT=vscode',
                `BRANCH_ID=${options.branchId}`
            ],
            HostConfig: {
                PortBindings: {
                    '5432/tcp': [{ HostPort: '5432' }]
                }
            }
        };

        // Add volume binding using global storage path
        const neonLocalPath = path.join(options.context.globalStorageUri.fsPath, '.neon_local');
        containerConfig.HostConfig.Binds = [`${neonLocalPath}:/tmp/.neon_local`];

        await this.startContainerInternal(containerConfig);
    }

    private async startContainerInternal(containerConfig: any): Promise<void> {
        const containerName = containerConfig.name;

        // Try to find and remove existing container
        try {
            const containers = await this.docker.listContainers({ all: true });
            const existing = containers.find(c => c.Names.includes(`/${containerName}`));

            if (existing) {
                const oldContainer = this.docker.getContainer(existing.Id);
                try {
                    await oldContainer.stop(); // May throw if already stopped
                } catch (_) {
                    // ignore
                }
                await oldContainer.remove({ force: true });
                console.log(`Removed existing container: ${containerName}`);
            }
        } catch (err) {
            console.error('Error checking for existing container:', err);
        }

        // Create and start new container
        const container = await this.docker.createContainer(containerConfig);
        await container.start();
        console.log(`Started new container: ${containerName}`);

        // Set the connection string based on the driver
        const connectionString = `postgres://neon:npg@localhost:5432`;
        await this.stateService.setConnectionInfo({
            connectionInfo: connectionString,
            selectedDatabase: ''
        });
        
        // Start periodic status check
        await this.startStatusCheck();
    }
} 