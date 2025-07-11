import * as vscode from 'vscode';
import { NeonBranch, NeonOrg, NeonProject, NeonDatabase, NeonRole } from '../types';
import { AuthManager } from '../auth/authManager';
import * as https from 'https';

interface NetworkError extends Error {
    code?: string;
}

interface NeonEndpoint {
  host: string;
  id: string;
  project_id: string;
  branch_id: string;
  type: string;
  current_state: string;
  pooler_enabled: boolean;
  pooler_mode: string;
  disabled: boolean;
  passwordless_access: boolean;
  last_active: string;
  creation_source: string;
  created_at: string;
  updated_at: string;
  suspended_at: string;
  proxy_host: string;
  suspend_timeout_seconds: number;
  provisioner: string;
}

interface EndpointsResponse {
  endpoints: NeonEndpoint[];
}

export class NeonApiService {
    private readonly authManager: AuthManager;
    private readonly baseUrl = 'console.neon.tech';

    constructor(context: vscode.ExtensionContext) {
        this.authManager = AuthManager.getInstance(context);
    }

    private async getToken(): Promise<string | null> {
        const persistentApiToken = await this.authManager.getPersistentApiToken();
        const apiKey = this.authManager.tokenSet?.access_token;
        
        if (!persistentApiToken && !apiKey) {
            throw new Error('Authentication required. Please sign in.');
        }

        return persistentApiToken || apiKey || null;
    }

    private async makeRequest<T>(path: string, method: string = 'GET', data?: any): Promise<T> {
        try {
            const token = await this.getToken();
            if (!token) {
                throw new Error('No authentication token available');
            }

            const options: https.RequestOptions = {
                hostname: 'console.neon.tech',
                path: `/api/v2${path}`,
                method: method,
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                }
            };

            console.log('Making request:', {
                method,
                path: `/api/v2${path}`,
                headers: options.headers,
                data
            });

            return new Promise((resolve, reject) => {
                const req = https.request(options, async (res) => {
                    let responseData = '';
                    res.on('data', (chunk) => {
                        responseData += chunk;
                    });

                    res.on('end', async () => {
                        console.log('Response received:', {
                            statusCode: res.statusCode,
                            headers: res.headers,
                            data: responseData
                        });

                        if (res.statusCode === 401) {
                            try {
                                console.log('Token expired, attempting refresh...');
                                const success = await this.authManager.refreshTokenIfNeeded();
                                
                                if (!success) {
                                    await this.authManager.signOut();
                                    reject(new Error('Session expired. Please sign in again.'));
                                    return;
                                }

                                const newToken = await this.getToken();
                                if (!newToken) {
                                    await this.authManager.signOut();
                                    reject(new Error('Session expired. Please sign in again.'));
                                    return;
                                }

                                // Retry the request with the new token
                                try {
                                    const result = await this.makeRequest<T>(path, method, data);
                                    resolve(result);
                                } catch (error) {
                                    reject(error);
                                }
                            } catch (refreshError) {
                                console.error('Token refresh failed:', refreshError);
                                await this.authManager.signOut();
                                reject(new Error('Session expired. Please sign in again.'));
                            }
                            return;
                        }

                        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                            try {
                                const parsedData = responseData ? JSON.parse(responseData) : null;
                                resolve(parsedData as T);
                            } catch (error) {
                                reject(new Error(`Failed to parse response: ${error instanceof Error ? error.message : 'Unknown error'}`));
                            }
                        } else {
                            reject(new Error(`Request failed with status ${res.statusCode}: ${responseData}`));
                        }
                    });
                });

                req.on('error', (error) => {
                    console.error('Request error:', error);
                    reject(new Error(`Request failed: ${error.message}`));
                });

                if (data) {
                    const jsonData = JSON.stringify(data);
                    console.log('Sending request body:', jsonData);
                    req.write(jsonData);
                }
                req.end();
            });
        } catch (error) {
            console.error('Error in makeRequest:', error);
            throw error;
        }
    }

    public async getOrgs(): Promise<NeonOrg[]> {
        try {
            console.log('Fetching organizations...');
            const response = await this.makeRequest<any>('/users/me/organizations');
            console.log('Raw organizations response:', JSON.stringify(response, null, 2));

            // Ensure we return an array of organizations
            let orgs = Array.isArray(response) ? response : response.organizations || [];
            console.log('Organizations array before processing:', JSON.stringify(orgs, null, 2));
            
            // Check if user has access to personal account by attempting to get projects
            try {
                await this.getProjects('personal_account');
                // If successful, add Personal account as the first option
                orgs = [
                    { id: 'personal_account', name: 'Personal account' },
                    ...orgs
                ];
            } catch (error) {
                // If we get the specific error about org_id being required, don't add personal account
                if (error instanceof Error && error.message.includes('org_id is required')) {
                    console.log('User does not have access to personal account, skipping...');
                } else {
                    // For other errors, still add personal account as it might be a temporary issue
                    orgs = [
                        { id: 'personal_account', name: 'Personal account' },
                        ...orgs
                    ];
                }
            }

            console.log('Final processed organizations:', JSON.stringify(orgs, null, 2));
            return orgs;
        } catch (error: unknown) {
            console.error('Error fetching organizations:', error);
            throw new Error(`Failed to fetch organizations: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    public async getProjects(orgId: string): Promise<NeonProject[]> {
        console.log(`Fetching projects from URL: /projects for orgId: ${orgId}`);
        let retryCount = 0;
        const maxRetries = 3;
        const retryDelay = 1000;

        while (retryCount < maxRetries) {
            try {
                // For personal account, don't include org_id parameter
                const path = orgId === 'personal_account' ? '/projects' : `/projects?org_id=${orgId}`;
                console.log(`Fetching projects from path: ${path}`);
                
                const response = await this.makeRequest<any>(path);
                console.log('Raw API response:', response);

                // Handle different response formats
                let projects: NeonProject[] = [];
                if (Array.isArray(response)) {
                    projects = response;
                } else if (response.projects && Array.isArray(response.projects)) {
                    projects = response.projects;
                } else if (response.project) {
                    projects = [response.project];
                } else if (typeof response === 'object' && !Array.isArray(response)) {
                    projects = [response];
                }

                console.log('Processed projects:', projects);
                return projects;
            } catch (error) {
                retryCount++;
                console.log(`Attempt ${retryCount} failed: ${error}`);
                
                if (retryCount === maxRetries) {
                    throw new Error(`Failed to fetch projects: ${error}`);
                }
                
                await new Promise(resolve => setTimeout(resolve, retryDelay));
            }
        }

        throw new Error('Failed to fetch projects after maximum retries');
    }

    public async getBranches(projectId: string): Promise<NeonBranch[]> {
        try {
            console.log(`🔍 API Request - getBranches: projectId="${projectId}"`);
            console.log(`📡 Making API request to: /projects/${projectId}/branches`);
            
            const response = await this.makeRequest<any>(`/projects/${projectId}/branches`);
            console.log(`✅ getBranches response:`, response);
            
            // Ensure we return an array of branches
            const branches = Array.isArray(response) ? response : response.branches || [];
            console.log(`🌿 Processed branches (${branches.length} items):`, branches.map((b: any) => ({ id: b.id, name: b.name })));
            
            return branches;
        } catch (error: unknown) {
            console.error(`❌ Error fetching branches for project="${projectId}":`, error);
            throw new Error(`Failed to fetch branches: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    public async getDatabases(projectId: string, branchId: string): Promise<NeonDatabase[]> {
        try {
            console.log(`🔍 API Request - getDatabases: projectId="${projectId}", branchId="${branchId}"`);
            console.log(`📡 Making API request to: /projects/${projectId}/branches/${branchId}/databases`);
            
            const response = await this.makeRequest<any>(`/projects/${projectId}/branches/${branchId}/databases`);
            console.log(`✅ getDatabases response:`, response);
            
            // Ensure we return an array of databases
            const databases = Array.isArray(response) ? response : response.databases || [];
            console.log(`📊 Processed databases (${databases.length} items):`, databases);
            
            return databases;
        } catch (error: unknown) {
            console.error(`❌ Error fetching databases for project="${projectId}", branch="${branchId}":`, error);
            throw new Error(`Failed to fetch databases: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    public async getRoles(projectId: string, branchId: string): Promise<NeonRole[]> {
        try {
            console.log(`🔍 API Request - getRoles: projectId="${projectId}", branchId="${branchId}"`);
            console.log(`📡 Making API request to: /projects/${projectId}/branches/${branchId}/roles`);
            
            const response = await this.makeRequest<any>(`/projects/${projectId}/branches/${branchId}/roles`);
            console.log(`✅ getRoles response:`, response);
            
            // Ensure we return an array of roles
            const roles = Array.isArray(response) ? response : response.roles || [];
            console.log(`👥 Processed roles (${roles.length} items):`, roles);
            
            return roles;
        } catch (error: unknown) {
            console.error(`❌ Error fetching roles for project="${projectId}", branch="${branchId}":`, error);
            throw new Error(`Failed to fetch roles: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    public async getRolePassword(projectId: string, branchId: string, roleName: string): Promise<string> {
        try {
            const response = await this.makeRequest<{ password: string }>(`/projects/${projectId}/branches/${branchId}/roles/${roleName}/reveal_password`);
            return response.password;
        } catch (error: unknown) {
            console.error('Error getting role password:', error);
            throw new Error(`Failed to get role password: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    public async getBranchEndpoint(projectId: string, branchId: string): Promise<string> {
        try {
            const response = await this.makeRequest<EndpointsResponse>(`/projects/${projectId}/branches/${branchId}/endpoints`);
            console.log('Branch endpoints response:', response);
            
            if (!response.endpoints || !Array.isArray(response.endpoints) || response.endpoints.length === 0) {
                console.error('No endpoints found in response:', response);
                throw new Error('No endpoints found for branch');
            }

            // Find the read_write endpoint
            const readWriteEndpoint = response.endpoints.find(endpoint => endpoint.type === 'read_write');
            if (!readWriteEndpoint) {
                console.error('No read_write endpoint found in response:', response.endpoints);
                throw new Error('No read_write endpoint found for branch');
            }

            const endpoint = readWriteEndpoint.host;
            if (!endpoint) {
                console.error('Endpoint host not found in response:', readWriteEndpoint);
                throw new Error('Endpoint host not found in response');
            }
            
            return endpoint;
        } catch (error: unknown) {
            console.error('Error getting branch endpoint:', error);
            throw new Error(`Failed to get branch endpoint: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    public async resetBranchToParent(projectId: string, branchId: string): Promise<void> {
        try {
            console.log(`Resetting branch ${branchId} in project ${projectId} to parent state`);
            await this.makeRequest<void>(
                `/projects/${projectId}/branches/${branchId}/reset_to_parent`,
                'POST'
            );
        } catch (error: unknown) {
            console.error('Error resetting branch:', error);
            throw new Error(`Failed to reset branch: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    public async getBranchDetails(projectId: string, branchId: string): Promise<{ parent_id: string | null }> {
        try {
            const response = await this.makeRequest<any>(`/projects/${projectId}/branches/${branchId}`);
            return {
                parent_id: response.branch?.parent_id || null
            };
        } catch (error: unknown) {
            console.error('Error fetching branch details:', error);
            throw new Error(`Failed to fetch branch details: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    public async createBranch(projectId: string, parentBranchId: string, branchName: string): Promise<NeonBranch> {
        try {
            const payload = {
                branch: {
                    name: branchName,
                    parent_id: parentBranchId
                },
                endpoints: [{
                    type: 'read_write',
                }],
                annotation_value: {
                    vscode: 'true'
                }
            };

            const response = await this.makeRequest<any>(`/projects/${projectId}/branches`, 'POST', payload);
            return response.branch;
        } catch (error: unknown) {
            console.error('Error creating branch:', error);
            throw new Error(`Failed to create branch: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }
}