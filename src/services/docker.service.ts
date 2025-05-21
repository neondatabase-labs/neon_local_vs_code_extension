import * as vscode from 'vscode';
import Dockerode from 'dockerode';
import * as path from 'path';
import * as fs from 'fs';

export class DockerService {
    private docker: Dockerode;
    private containerName = 'neon_local_vscode';

    constructor() {
        this.docker = new Dockerode();
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
            // Get API key from configuration
            const config = vscode.workspace.getConfiguration('neonLocal');
            const apiKey = config.get<string>('apiKey');

            if (!apiKey) {
                throw new Error('API key is not configured. Please set your Neon API key in the settings.');
            }

            if (!projectId) {
                throw new Error('Project ID is required to start the container.');
            }

            // Check for and remove existing container
            try {
                const existingContainer = await this.docker.getContainer(this.containerName);
                await existingContainer.stop().catch(() => {}); // Ignore error if container is not running
                await existingContainer.remove().catch(() => {}); // Ignore error if container doesn't exist
            } catch (error) {
                // Container doesn't exist, which is fine
            }

            // Create container configuration
            const containerConfig = {
                Image: 'neondatabase/neon_local:latest',
                name: this.containerName,
                Env: [
                    // Ensure driver is exactly 'postgres' or 'serverless'
                    `DRIVER=${driver === 'serverless' ? 'serverless' : 'postgres'}`,
                    `NEON_API_KEY=${apiKey}`,
                    `NEON_PROJECT_ID=${projectId}`,
                    // Conditionally add either BRANCH_ID or PARENT_BRANCH_ID
                    ...(isExisting ? [`BRANCH_ID=${branchId}`] : [`PARENT_BRANCH_ID=${branchId}`])
                ],
                HostConfig: {
                    PortBindings: {
                        '5432/tcp': [{ HostPort: '5432' }]
                    }
                }
            };

            // Pull image if not exists
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

            // Create and start container
            const container = await this.docker.createContainer(containerConfig);
            await container.start();

        } catch (error) {
            throw new Error(`Failed to start container: ${error instanceof Error ? error.message : 'Unknown error'}`);
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
} 