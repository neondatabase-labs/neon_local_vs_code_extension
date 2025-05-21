import axios, { AxiosInstance } from 'axios';
import * as vscode from 'vscode';
import { NeonBranch, NeonOrg, NeonProject, NeonDatabase, NeonRole } from '../types';
import { refreshToken } from '../auth';

export class NeonApiService {
    private apiClient: AxiosInstance | null = null;

    private async createApiClient(apiKey: string): Promise<AxiosInstance> {
        const instance = axios.create({
            baseURL: 'https://console.neon.tech/api/v2',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            },
            timeout: 10000,
            validateStatus: status => status >= 200 && status < 300,
            maxRedirects: 5,
            proxy: false
        });

        // Add retry interceptor for DNS issues and token refresh
        instance.interceptors.response.use(undefined, async (error) => {
            if (error.code === 'ENOTFOUND') {
                throw new Error('Cannot connect to Neon API. Please check your internet connection.');
            }
            if (error.code === 'ECONNREFUSED') {
                throw new Error('Cannot connect to Neon API. The service might be temporarily unavailable.');
            }

            // Handle token expiration
            if (error.response?.status === 401) {
                const config = vscode.workspace.getConfiguration('neonLocal');
                const refreshTokenStr = config.get<string>('refreshToken');
                
                if (refreshTokenStr) {
                    try {
                        // Get new access token
                        const newAccessToken = await refreshToken(refreshTokenStr);
                        
                        // Update the failed request's authorization header
                        error.config.headers['Authorization'] = `Bearer ${newAccessToken}`;
                        
                        // Update the API client's default authorization header
                        instance.defaults.headers['Authorization'] = `Bearer ${newAccessToken}`;
                        
                        // Update stored API key
                        await config.update('apiKey', newAccessToken, true);
                        
                        // Retry the failed request with the new token
                        return instance(error.config);
                    } catch (refreshError) {
                        // If refresh fails, clear tokens and require re-authentication
                        await config.update('apiKey', undefined, true);
                        await config.update('refreshToken', undefined, true);
                        this.clearApiClient();
                        throw new Error('Session expired. Please sign in again.');
                    }
                } else {
                    // No refresh token available
                    await config.update('apiKey', undefined, true);
                    this.clearApiClient();
                    throw new Error('Session expired. Please sign in again.');
                }
            }
            throw error;
        });

        return instance;
    }

    private async ensureApiClient(): Promise<AxiosInstance> {
        if (this.apiClient) {
            return this.apiClient;
        }

        const config = vscode.workspace.getConfiguration('neonLocal');
        const apiKey = config.get<string>('apiKey');
        
        if (!apiKey) {
            throw new Error('Authentication required. Please sign in.');
        }

        this.apiClient = await this.createApiClient(apiKey);
        return this.apiClient;
    }

    public clearApiClient(): void {
        this.apiClient = null;
    }

    public async getOrgs(): Promise<NeonOrg[]> {
        try {
            const client = await this.ensureApiClient();
            const response = await client.get('/users/me/organizations');
            // Ensure we return an array of organizations
            const orgs = Array.isArray(response.data) ? response.data : response.data.organizations || [];
            
            // Add Personal account as the first option
            return [
                { id: '', name: 'Personal account' },
                ...orgs
            ];
        } catch (error) {
            throw new Error(`Failed to fetch organizations: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    public async getProjects(orgId?: string): Promise<NeonProject[]> {
        try {
            const client = await this.ensureApiClient();
            // For personal account (empty or undefined orgId), don't include the org_id parameter
            const url = orgId && orgId.length > 0 ? `/projects?org_id=${orgId}` : '/projects';
            console.log('Fetching projects from URL:', url);
            const response = await client.get(url);
            // Ensure we return an array of projects
            const projects = Array.isArray(response.data) ? response.data : response.data.projects || [];
            console.log('Received projects:', projects);
            return projects;
        } catch (error) {
            console.error('Error fetching projects:', error);
            throw new Error(`Failed to fetch projects: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    public async getBranches(projectId: string): Promise<NeonBranch[]> {
        try {
            const client = await this.ensureApiClient();
            const response = await client.get(`/projects/${projectId}/branches`);
            // Ensure we return an array of branches
            return Array.isArray(response.data) ? response.data : response.data.branches || [];
        } catch (error) {
            throw new Error(`Failed to fetch branches: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    public async createBranch(projectId: string, options: {
        name: string;
        parentId?: string;
    }): Promise<NeonBranch> {
        try {
            const client = await this.ensureApiClient();
            const response = await client.post(`/projects/${projectId}/branches`, {
                branch: {
                    name: options.name,
                    parent_id: options.parentId
                }
            });
            return response.data;
        } catch (error) {
            throw new Error(`Failed to create branch: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    public async getDatabases(projectId: string, branchId: string): Promise<NeonDatabase[]> {
        try {
            const client = await this.ensureApiClient();
            const response = await client.get(`/projects/${projectId}/branches/${branchId}/databases`);
            // Ensure we return an array of databases
            return Array.isArray(response.data) ? response.data : response.data.databases || [];
        } catch (error) {
            throw new Error(`Failed to fetch databases: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    public async getRoles(projectId: string, branchId: string): Promise<NeonRole[]> {
        try {
            const client = await this.ensureApiClient();
            const response = await client.get(`/projects/${projectId}/branches/${branchId}/roles`);
            // Ensure we return an array of roles
            return Array.isArray(response.data) ? response.data : response.data.roles || [];
        } catch (error) {
            throw new Error(`Failed to fetch roles: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    public async resetBranchToParent(projectId: string, branchId: string): Promise<void> {
        try {
            const client = await this.ensureApiClient();
            await client.post(`/projects/${projectId}/branches/${branchId}/reset_to_parent`);
        } catch (error) {
            throw new Error(`Failed to reset branch to parent: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }
} 