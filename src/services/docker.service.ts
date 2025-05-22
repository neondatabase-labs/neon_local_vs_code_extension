import * as vscode from 'vscode';
import Dockerode from 'dockerode';
import * as path from 'path';
import * as fs from 'fs';

export class DockerService {
    private docker: Dockerode;
    private containerName = 'neon_local_vscode';
    private context: vscode.ExtensionContext;

    constructor(context: vscode.ExtensionContext) {
        this.docker = new Dockerode();
        this.context = context;
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

    async getCurrentDriver(): Promise<string> {
        try {
            const container = await this.docker.getContainer(this.containerName);
            const containerInfo = await container.inspect();
            const envVars = containerInfo.Config.Env;
            const driverVar = envVars.find(env => env.startsWith('DRIVER='));
            const driver = driverVar ? driverVar.split('=')[1] : 'postgres';
            console.log('Current container driver:', driver);
            return driver;
        } catch (error) {
            console.log('Error getting container driver:', error);
            // If container doesn't exist or can't be inspected, return default
            return 'postgres';
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

            if (!apiKey) {
                throw new Error('API key not found. Please sign in first.');
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
                    `NEON_API_KEY=${apiKey}`,
                    `NEON_PROJECT_ID=${projectId}`,
                    // Add refresh token if available
                    ...(refreshToken ? [`NEON_REFRESH_TOKEN=${refreshToken}`] : []),
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

            // Create and start the container
            const container = await this.docker.createContainer(containerConfig);
            await container.start();

            // Wait for container to be running
            await this.waitForContainer();
        } catch (error) {
            console.error('Error starting container:', error);
            throw error;
        }
    }

    async stopContainer(deleteOnStop: boolean = false): Promise<void> {
        try {
            const container = await this.docker.getContainer(this.containerName);
            await container.stop();
            await container.remove();
        } catch (error) {
            if (error instanceof Error && error.message.includes('no such container')) {
                // Container doesn't exist, which is fine when stopping
                return;
            }
            throw new Error(`Failed to stop container: ${error instanceof Error ? error.message : 'Unknown error'}`);
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
                    console.log('Container logs:', logStr);
                    
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
                            }
                        } else {
                            console.log('Existing branch connection, skipping branches file check');
                            return;
                        }
                    } else {
                        console.log('Container not yet ready');
                    }
                } else {
                    console.log('Container not yet running...');
                }
                
                await new Promise(resolve => setTimeout(resolve, 1000));
                attempts++;
                console.log(`Waiting for container attempt ${attempts}/${maxAttempts}`);
            } catch (error) {
                console.error('Error while waiting for container:', error);
                await new Promise(resolve => setTimeout(resolve, 1000));
                attempts++;
            }
        }
        
        throw new Error('Timeout waiting for container to be ready');
    }
} 