import axios, { AxiosInstance } from 'axios';
import * as vscode from 'vscode';
import { NeonBranch, NeonOrg, NeonProject } from '../types';

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

        // Add retry interceptor for DNS issues
        instance.interceptors.response.use(undefined, async (error) => {
            if (error.code === 'ENOTFOUND') {
                throw new Error('Cannot connect to Neon API. Please check your internet connection.');
            }
            if (error.code === 'ECONNREFUSED') {
                throw new Error('Cannot connect to Neon API. The service might be temporarily unavailable.');
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
} 