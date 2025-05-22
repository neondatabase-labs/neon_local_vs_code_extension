import * as vscode from 'vscode';
import { ViewData, NeonBranch, NeonOrg, NeonProject, NeonDatabase, NeonRole } from '../types';
import { FileService } from '../services/file.service';
import * as path from 'path';
import * as fs from 'fs';

interface NeonLocalState {
    currentOrg: string;
    currentProject: string;
    currentBranch: string;
    parentBranchId: string;
    connectionType: 'existing' | 'new';
    isProxyRunning: boolean;
    isStarting: boolean;
    selectedDriver: string;
    selectedDatabase: string;
    selectedRole: string;
    currentlyConnectedBranch: string;
}

export class StateService {
    private context: vscode.ExtensionContext;
    private state: vscode.Memento;
    private fileService: FileService;
    private _state: NeonLocalState;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
        this.state = context.globalState;
        this.fileService = new FileService(context);
        
        // Initialize state with default values
        this._state = {
            currentOrg: '',
            currentProject: '',
            currentBranch: '',
            parentBranchId: '',
            connectionType: 'existing',
            isProxyRunning: false,
            isStarting: false,
            selectedDriver: 'postgres',
            selectedDatabase: '',
            selectedRole: '',
            currentlyConnectedBranch: ''
        };

        this.loadState();
    }

    private async loadState() {
        // Load all state properties from persistent storage
        this._state = {
            currentOrg: this.state.get('neonLocal.currentOrg', ''),
            currentProject: this.state.get('neonLocal.currentProject', ''),
            currentBranch: this.state.get('neonLocal.currentBranch', ''),
            parentBranchId: this.state.get('neonLocal.parentBranchId', ''),
            connectionType: this.state.get('neonLocal.connectionType', 'existing'),
            isProxyRunning: this.state.get('neonLocal.isProxyRunning', false),
            isStarting: this.state.get('neonLocal.isStarting', false),
            selectedDriver: this.state.get('neonLocal.selectedDriver', 'postgres'),
            selectedDatabase: this.state.get('neonLocal.selectedDatabase', ''),
            selectedRole: this.state.get('neonLocal.selectedRole', ''),
            currentlyConnectedBranch: this.state.get('neonLocal.currentlyConnectedBranch', '')
        };
    }

    private async saveState() {
        console.log('Saving state:', this._state);
        
        // Save all state properties to persistent storage
        await Promise.all([
            this.state.update('neonLocal.currentOrg', this._state.currentOrg),
            this.state.update('neonLocal.currentProject', this._state.currentProject),
            this.state.update('neonLocal.currentBranch', this._state.currentBranch),
            this.state.update('neonLocal.parentBranchId', this._state.parentBranchId),
            this.state.update('neonLocal.connectionType', this._state.connectionType),
            this.state.update('neonLocal.isProxyRunning', this._state.isProxyRunning),
            this.state.update('neonLocal.selectedDriver', this._state.selectedDriver),
            this.state.update('neonLocal.selectedDatabase', this._state.selectedDatabase),
            this.state.update('neonLocal.selectedRole', this._state.selectedRole),
            this.state.update('neonLocal.currentlyConnectedBranch', this._state.currentlyConnectedBranch)
        ]);
    }

    private async updateState(updates: Partial<NeonLocalState>) {
        // Update local state
        this._state = {
            ...this._state,
            ...updates
        };

        // Save to persistent storage
        await this.saveState();
    }

    // Getters
    get currentOrg(): string { return this._state.currentOrg; }
    get currentProject(): string { return this._state.currentProject; }
    get currentBranch(): string { return this._state.currentBranch; }
    get parentBranchId(): string { return this._state.parentBranchId; }
    get connectionType(): 'existing' | 'new' { return this._state.connectionType; }
    get isProxyRunning(): boolean { return this._state.isProxyRunning; }
    get isStarting(): boolean { return this._state.isStarting; }
    get selectedDriver(): string { return this._state.selectedDriver; }
    get selectedDatabase(): string { return this._state.selectedDatabase; }
    get selectedRole(): string { return this._state.selectedRole; }
    get currentlyConnectedBranch(): Promise<string> { return this.getBranchIdFromFile(); }

    // Setters with state updates
    async setCurrentOrg(value: string) {
        const updates: Partial<NeonLocalState> = {
            currentOrg: value || ''
        };

        // Only clear related state if org actually changed
        if (this._state.currentOrg !== value) {
            updates.currentProject = '';
            updates.currentBranch = '';
            updates.parentBranchId = '';
            updates.selectedDatabase = '';
            updates.selectedRole = '';
        }

        await this.updateState(updates);
    }

    async setCurrentProject(value: string) {
        const updates: Partial<NeonLocalState> = {
            currentProject: value || ''
        };

        // Only clear related state if project actually changed
        if (this._state.currentProject !== value) {
            updates.currentBranch = '';
            updates.parentBranchId = '';
            updates.selectedDatabase = '';
            updates.selectedRole = '';
        }

        await this.updateState(updates);
    }

    async setCurrentBranch(value: string) {
        await this.updateState({
            currentBranch: value || ''
        });
    }

    async setParentBranchId(value: string) {
        await this.updateState({
            parentBranchId: value || ''
        });
    }

    async setConnectionType(value: 'existing' | 'new') {
        await this.updateState({
            connectionType: value
        });
    }

    async setIsProxyRunning(value: boolean) {
        const updates: Partial<NeonLocalState> = {
            isProxyRunning: value
        };

        // Clear only connection-specific state when proxy is stopped
        if (!value) {
            updates.selectedDatabase = '';
            updates.selectedRole = '';
            // Don't clear currentlyConnectedBranch as it might be needed for reconnection
        }

        await this.updateState(updates);
    }

    async setIsStarting(value: boolean) {
        await this.updateState({
            isStarting: value
        });
    }

    async setSelectedDriver(value: string) {
        await this.updateState({
            selectedDriver: value || 'postgres'
        });
    }

    async setSelectedDatabase(value: string) {
        await this.updateState({
            selectedDatabase: value || ''
        });
    }

    async setSelectedRole(value: string) {
        await this.updateState({
            selectedRole: value || ''
        });
    }

    async setCurrentlyConnectedBranch(value: string) {
        await this.updateState({
            currentlyConnectedBranch: value || ''
        });
    }

    async clearState() {
        await this.updateState({
            currentOrg: '',
            currentProject: '',
            currentBranch: '',
            parentBranchId: '',
            connectionType: 'existing',
            isProxyRunning: false,
            isStarting: false,
            selectedDriver: 'postgres',
            selectedDatabase: '',
            selectedRole: '',
            currentlyConnectedBranch: ''
        });
    }

    public async getViewData(
        orgs: NeonOrg[],
        projects: NeonProject[],
        branches: NeonBranch[],
        isProxyRunning: boolean,
        isStarting: boolean,
        driver?: string,
        databases: NeonDatabase[] = [],
        roles: NeonRole[] = []
    ): Promise<ViewData> {
        // Update the selected driver if one is provided and we're running
        if (driver && isProxyRunning) {
            await this.setSelectedDriver(driver);
        }

        // Update proxy running state if it changed
        if (this._state.isProxyRunning !== isProxyRunning) {
            await this.setIsProxyRunning(isProxyRunning);
        }

        // Update starting state if it changed
        if (this._state.isStarting !== isStarting) {
            await this.setIsStarting(isStarting);
        }

        // Find the selected org, handling the personal account case
        const selectedOrg = this._state.currentOrg ? 
            orgs.find(org => org.id === this._state.currentOrg) : null;
        const selectedOrgName = selectedOrg?.name || 'Personal account';

        // Find the selected project
        const selectedProject = this._state.currentProject ? 
            projects.find(project => project.id === this._state.currentProject) : null;

        // If selected project no longer exists, clear project-related state
        if (this._state.currentProject && !selectedProject) {
            await this.setCurrentProject('');
        }

        // For new branches, always use currentlyConnectedBranch when proxy is running
        // For existing branches, use currentBranch
        let activeBranchId: string;
        if (this._state.isProxyRunning && this._state.connectionType === 'new') {
            // For new branches that are connected, get the branch ID from the file
            activeBranchId = await this.getBranchIdFromFile() || '';
            // Update the currentlyConnectedBranch in state
            if (activeBranchId) {
                await this.setCurrentlyConnectedBranch(activeBranchId);
            }
        } else {
            activeBranchId = this._state.currentBranch;
        }

        // Find the selected branch
        let selectedBranch = activeBranchId ? 
            branches.find(branch => branch.id === activeBranchId) : null;

        // Find the parent branch
        const parentBranch = this._state.parentBranchId ? 
            branches.find(branch => branch.id === this._state.parentBranchId) : null;

        // For new branches that are connected but not in the branches list yet,
        // create a new branch object with the connected branch ID
        if (this._state.isProxyRunning && 
            this._state.connectionType === 'new' && 
            !selectedBranch && 
            activeBranchId) {
            selectedBranch = {
                id: activeBranchId,
                name: `New Branch (${activeBranchId})`,
                project_id: this._state.currentProject,
                parent_id: this._state.parentBranchId
            };
        }

        // Generate connection info
        const connectionInfo = isProxyRunning ? 
            `postgres://neon:npg@localhost:5432/${this._state.selectedDatabase || 'neondb'}${this._state.selectedRole ? `_${this._state.selectedRole}` : ''}?sslmode=require` :
            undefined;

        const viewData: ViewData = {
            orgs,
            projects,
            branches,
            databases,
            roles,
            selectedOrgId: this._state.currentOrg,
            selectedOrgName,
            selectedProjectId: this._state.currentProject,
            selectedProjectName: selectedProject?.name,
            selectedBranchId: activeBranchId,
            selectedBranchName: selectedBranch?.name,
            parentBranchId: this._state.parentBranchId,
            parentBranchName: parentBranch?.name,
            selectedDriver: this._state.selectedDriver,
            selectedDatabase: this._state.selectedDatabase,
            selectedRole: this._state.selectedRole,
            connected: isProxyRunning,
            isStarting,
            connectionType: this._state.connectionType,
            connectionInfo
        };

        console.log('Generated view data:', viewData);
        return viewData;
    }

    public async getBranchIdFromFile(): Promise<string> {
        try {
            console.log('Reading .branches file at path:', this.fileService.branchesFilePath);
            const content = await fs.promises.readFile(this.fileService.branchesFilePath, 'utf8');
            console.log('Raw .branches file content:', content);
            
            const data = JSON.parse(content);
            console.log('Parsed .branches file data:', data);
            
            // First try to get branch ID using project ID
            let branchId = data[this._state.currentProject]?.branch_id;
            
            // If not found, try to get it from the "None" key
            if (!branchId && data['None']?.branch_id) {
                branchId = data['None'].branch_id;
            }
            
            if (!branchId) {
                console.log('No branch ID found in branches file');
                return '';
            }
            
            return branchId;
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
                console.log('No .branches file found');
                return '';
            }
            console.error('Error reading branch ID from file:', error);
            return '';
        }
    }
} 