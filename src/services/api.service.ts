import axios, { AxiosInstance } from 'axios';
import * as vscode from 'vscode';
import { NeonBranch, NeonOrg, NeonProject, NeonDatabase, NeonRole } from '../types';
import { refreshToken } from './auth.service';

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
                
                if (!refreshTokenStr) {
                    await config.update('apiKey', undefined, true);
                    this.clearApiClient();
                    throw new Error('Session expired. Please sign in again.');
                }

                try {
                    console.log('Token expired, attempting refresh...');
                    // Get new access token
                    const newAccessToken = await refreshToken(refreshTokenStr);
                    console.log('Successfully refreshed token');
                    
                    // Update stored API key
                    await config.update('apiKey', newAccessToken, true);
                    
                    // Create a new request with the updated token
                    const retryConfig = {
                        ...error.config,
                        headers: {
                            ...error.config.headers,
                            'Authorization': `Bearer ${newAccessToken}`
                        }
                    };
                    
                    // Create a new instance with the updated token and update the current instance
                    this.apiClient = await this.createApiClient(newAccessToken);
                    instance.defaults.headers['Authorization'] = `Bearer ${newAccessToken}`;
                    
                    // Retry the failed request with the new token
                    return axios(retryConfig);
                } catch (refreshError) {
                    console.error('Token refresh failed:', refreshError);
                    // If refresh fails, clear tokens and require re-authentication
                    await config.update('apiKey', undefined, true);
                    await config.update('refreshToken', undefined, true);
                    this.clearApiClient();
                    throw new Error('Session expired. Please sign in again.');
                }
            }
            throw error;
        });

        return instance;
    }

    private async ensureApiClient(forNewBranch: boolean = false): Promise<AxiosInstance> {
        if (this.apiClient && !forNewBranch) {
            return this.apiClient;
        }

        const config = vscode.workspace.getConfiguration('neonLocal');
        const persistentApiToken = config.get<string>('persistentApiToken');
        const apiKey = config.get<string>('apiKey');
        
        // If persistent token exists, use it for all operations
        if (persistentApiToken) {
            this.apiClient = await this.createApiClient(persistentApiToken);
            return this.apiClient;
        }

        // For new branches, we require persistent token
        if (forNewBranch) {
            throw new Error('Persistent API token required for creating new branches.');
        }

        // For other operations, require OAuth token
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
            console.log('Fetching organizations...');
            const client = await this.ensureApiClient();
            const response = await client.get('/users/me/organizations');
            console.log('Raw organizations response:', JSON.stringify(response.data, null, 2));

            // Ensure we return an array of organizations
            let orgs = Array.isArray(response.data) ? response.data : response.data.organizations || [];
            console.log('Organizations array before processing:', JSON.stringify(orgs, null, 2));
            
            // Add Personal account as the first option
            orgs = [
                { id: 'personal_account', name: 'Personal account' },
                ...orgs
            ];

            console.log('Final processed organizations:', JSON.stringify(orgs, null, 2));
            return orgs;
        } catch (error) {
            console.error('Error fetching organizations:', error);
            throw new Error(`Failed to fetch organizations: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    public async getProjects(orgId?: string): Promise<NeonProject[]> {
        try {
            const client = await this.ensureApiClient();
            // For personal account (empty, undefined, or personal_account), don't include the org_id parameter
            const url = orgId && orgId.length > 0 && orgId !== 'personal_account' ? `/projects?org_id=${orgId}` : '/projects';
            console.log('Fetching projects from URL:', url, 'for orgId:', orgId || 'personal account');

            // Add retry logic
            let retryCount = 0;
            const maxRetries = 3;
            let lastError: any;

            while (retryCount < maxRetries) {
                try {
                    const response = await client.get(url);
                    console.log('Raw API response:', response.data);
                    console.log('Response data type:', typeof response.data);
                    console.log('Is array?', Array.isArray(response.data));
                    console.log('Has projects array?', response.data.projects && Array.isArray(response.data.projects));
                    console.log('Has single project?', response.data.project);

                    // Handle both array and object responses
                    let projects: NeonProject[] = [];
                    if (Array.isArray(response.data)) {
                        projects = response.data;
                    } else if (response.data.projects && Array.isArray(response.data.projects)) {
                        projects = response.data.projects;
                    } else if (response.data.project) {
                        // Handle case where response has a single project under 'project' key
                        projects = [response.data.project];
                    } else if (typeof response.data === 'object' && !Array.isArray(response.data)) {
                        // If it's a single project object at the root level
                        projects = [response.data];
                    }

                    // Ensure each project has the correct org_id
                    projects = projects.map(project => ({
                        ...project,
                        org_id: orgId || ''  // Use empty string for personal account
                    }));

                    // If we got an empty array but we know there should be projects, retry
                    if (projects.length === 0 && retryCount < maxRetries - 1) {
                        console.log('Received empty projects array, retrying...');
                        retryCount++;
                        await new Promise(resolve => setTimeout(resolve, 1000 * retryCount)); // Exponential backoff
                        continue;
                    }

                    console.log('Final processed projects:', JSON.stringify(projects, null, 2));
                    return projects;
                } catch (error) {
                    lastError = error;
                    console.error(`Attempt ${retryCount + 1} failed:`, error);
                    retryCount++;
                    if (retryCount < maxRetries) {
                        await new Promise(resolve => setTimeout(resolve, 1000 * retryCount)); // Exponential backoff
                    }
                }
            }

            throw lastError || new Error('Failed to fetch projects after multiple attempts');
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

    public async createBranch(projectId: string, parentBranchId: string, branchName: string): Promise<NeonBranch> {
        const client = await this.ensureApiClient(true);
        const response = await client.post(`/projects/${projectId}/branches`, {
            branch: {
                name: branchName,
                parent_id: parentBranchId
            },
            annotation_value: {
                vscode_create: "true"
            },
            endpoints: [
                {
                    type: "read_write"
                }
            ]
        });
        return response.data;
    }

    public async getDatabases(projectId: string, branchId: string): Promise<NeonDatabase[]> {
        console.log('Getting databases for projectId:', projectId, 'and branchId:', branchId);
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

    public async getBranchEndpoint(projectId: string, branchId: string): Promise<string> {
        try {
            const client = await this.ensureApiClient();
            const response = await client.get(`/projects/${projectId}/branches/${branchId}/endpoints`);
            const endpoints = response.data.endpoints || [];
            const readWriteEndpoint = endpoints.find((endpoint: any) => endpoint.type === 'read_write');
            if (!readWriteEndpoint) {
                throw new Error('No read_write endpoint found for branch');
            }
            return readWriteEndpoint.host;
        } catch (error) {
            throw new Error(`Failed to fetch branch endpoint: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    public async getRolePassword(projectId: string, branchId: string, roleName: string): Promise<string> {
        try {
            const client = await this.ensureApiClient();
            const response = await client.get(`/projects/${projectId}/branches/${branchId}/roles/${roleName}/reveal_password`);
            return response.data.password;
        } catch (error) {
            throw new Error(`Failed to get role password: ${error instanceof Error ? error.message : 'Unknown error'}`);
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