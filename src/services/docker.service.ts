import * as vscode from 'vscode';
import Dockerode from 'dockerode';
import * as path from 'path';
import * as fs from 'fs';
import { StateService } from './state.service';

export class DockerService {
    private docker: Dockerode;
    private containerName = 'neon_local_vscode';
    private context: vscode.ExtensionContext;
    private stateService: StateService;
    private statusCheckInterval: NodeJS.Timeout | null = null;

    constructor(context: vscode.ExtensionContext, stateService: StateService) {
        this.docker = new Dockerode();
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

    async startContainer(options: {
        branchId: string;
        driver: string;
        isExisting: boolean;
        context: vscode.ExtensionContext;
        projectId: string;
    }): Promise<void> {
        const { branchId, driver, isExisting, context, projectId } = options;

        try {
            // Get API key and refresh token from configuration
            const config = vscode.workspace.getConfiguration('neonLocal');
            const apiKey = config.get<string>('apiKey');
            const refreshToken = config.get<string>('refreshToken');
            const persistentApiToken = config.get<string>('persistentApiToken');

            if (!apiKey) {
                throw new Error('API key not found. Please sign in first.');
            }

            if (!refreshToken) {
                throw new Error('Refresh token not found. Please sign in again.');
            }

            if (!isExisting && !persistentApiToken) {
                throw new Error('Persistent API token required for creating new branches.');
            }

            // Pull the latest image
            await this.pullImage();

            // Create container configuration
            const containerConfig: any = {
                Image: 'neondatabase/neon_local:latest',
                name: this.containerName,
                Env: [
                    // Ensure driver is exactly 'postgres' or 'serverless'
                    `DRIVER=${driver === 'serverless' ? 'serverless' : 'postgres'}`,
                    `NEON_API_KEY=${isExisting ? apiKey : persistentApiToken}`,
                    `NEON_REFRESH_TOKEN=${refreshToken}`,
                    `NEON_PROJECT_ID=${projectId}`,
                    'CLIENT=vscode',
                    // Conditionally add either BRANCH_ID or PARENT_BRANCH_ID
                    ...(isExisting ? [`BRANCH_ID=${branchId}`] : [`PARENT_BRANCH_ID=${branchId}`])
                ],
                HostConfig: {
                    PortBindings: {
                        '5432/tcp': [{ HostPort: '5432' }]
                    }
                }
            };

            // Create .neon_local directory in global storage if it doesn't exist
            const neonLocalPath = path.join(context.globalStorageUri.fsPath, '.neon_local');
            if (!fs.existsSync(neonLocalPath)) {
                fs.mkdirSync(neonLocalPath, { recursive: true });
            }
            
            // Add volume binding using global storage path
            containerConfig.HostConfig.Binds = [`${neonLocalPath}:/tmp/.neon_local`];

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


            // Wait for container to be running and ready
            await this.waitForContainer();

            // Get container info to update state
            const containerInfo = await this.getContainerInfo();
            if (containerInfo) {
                // Update state with the correct branch information
                await this.stateService.setCurrentlyConnectedBranch(containerInfo.branchId);

                // Set the connection string based on the driver
                const connectionString = containerInfo.driver === 'serverless'
                    ? 'http://localhost:5432/sql'
                    : 'postgres://neon:npg@localhost:5432/neondb?sslmode=require';
                await this.stateService.setConnectionInfo({
                    connectionInfo: connectionString,
                    selectedDatabase: 'neondb'
                });
            }
            
            // Update state to indicate proxy is running
            await this.stateService.setIsProxyRunning(true);
            
            // Start periodic status check
            await this.startStatusCheck();
            
            console.log('Container started successfully');
        } catch (error) {
            console.error('Error starting container:', error);
            // Ensure we set proxy state to not running if there was an error
            await this.stateService.setIsProxyRunning(false);
            this.stopStatusCheck();
            throw error;
        }
    }

    async stopContainer(): Promise<void> {
        try {
            const container = await this.docker.getContainer(this.containerName);
            await container.stop();
            await container.remove();

            // Clear all branch-related state
            await this.stateService.setIsProxyRunning(false);
            await this.stateService.setConnectionInfo({
                connectionInfo: '',
                selectedDatabase: ''
            });
            await this.stateService.setCurrentlyConnectedBranch('');
            await this.stateService.setCurrentBranch('');
            await this.stateService.setParentBranchId('');
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
                await this.stateService.setCurrentBranch('');
                await this.stateService.setParentBranchId('');
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

    private async checkBranchesFile(context: vscode.ExtensionContext): Promise<boolean> {
        try {
            const neonLocalPath = path.join(context.globalStorageUri.fsPath, '.neon_local');
            const branchesPath = path.join(neonLocalPath, '.branches');
            
            if (!fs.existsSync(branchesPath)) {
                console.log('Branches file does not exist yet');
                return false;
            }
            
            const content = await fs.promises.readFile(branchesPath, 'utf-8');
            console.log('Read .branches file content:', content);
            
            const data = JSON.parse(content);
            console.log('Parsed .branches file data:', JSON.stringify(data, null, 2));
            
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
            return true;
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
                        
                        // Get the environment variables to check if this is a new branch
                        const envVars = containerInfo.Config.Env;
                        const isNewBranch = envVars.some(env => env.startsWith('PARENT_BRANCH_ID='));
                        
                        if (isNewBranch) {
                            // Only check branches file for new branches
                            console.log('New branch creation detected, checking branches file...');
                            // Give a small delay for the .branches file to be written
                            await new Promise(resolve => setTimeout(resolve, 2000));
                            
                            // Check if the .branches file is properly populated
                            if (await this.checkBranchesFile(this.context)) {
                                console.log('Container is fully ready with populated branches file');
                                return;
                            } else {
                                console.log('Branches file not yet populated, continuing to wait...');
                            }
                        } else {
                            // For existing branches, we don't need to wait for the .branches file
                            console.log('Existing branch connection, container is ready');
                            return;
                        }
                    } else {
                        console.log('Container not yet ready, waiting for ready message...');
                    }
                } else if (containerInfo.State.ExitCode !== 0) {
                    console.error('Container exited with error code:', containerInfo.State.ExitCode);
                    throw new Error(`Container exited with error code ${containerInfo.State.ExitCode}`);
                } else {
                    console.log('Container not yet running...');
                }
            } catch (error) {
                // Log the error but continue waiting unless it's a critical error
                console.error('Error while waiting for container:', error);
                if (error instanceof Error && 
                    (error.message.includes('Container exited with error') || 
                     error.message.includes('Container reported an error'))) {
                    throw error;
                }
            }
            
            // Increment attempts and wait before next try
            attempts++;
            if (attempts < maxAttempts) {
                await new Promise(resolve => setTimeout(resolve, 1000));
            } else {
                console.error('Container failed to become ready after', maxAttempts, 'seconds');
                throw new Error('Timeout waiting for container to be ready');
            }
        }
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
} 