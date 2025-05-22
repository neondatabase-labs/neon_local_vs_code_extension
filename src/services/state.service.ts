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
        // Load state from persistent storage
        this._state = {
            currentOrg: this.state.get('neonLocal.currentOrg', ''),
            currentProject: this.state.get('neonLocal.currentProject', ''),
            currentBranch: this.state.get('neonLocal.currentBranch', ''),
            parentBranchId: this.state.get('neonLocal.parentBranchId', ''),
            connectionType: this.state.get('neonLocal.connectionType', 'existing'),
            isProxyRunning: this.state.get('neonLocal.isProxyRunning', false),
            isStarting: false,
            selectedDriver: this.state.get('neonLocal.selectedDriver', 'postgres'),
            selectedDatabase: this.state.get('neonLocal.selectedDatabase', ''),
            selectedRole: this.state.get('neonLocal.selectedRole', ''),
            currentlyConnectedBranch: ''
        };

        // Load currently connected branch from .branches file
        console.log('Loading state:', this._state);
        const branchId = await this.getBranchIdFromFile();
        this.updateState({ currentlyConnectedBranch: branchId || '' });
    }

    public getBranchIdFromFile(): string | undefined {
        try {
            const neonLocalPath = path.join(this.context.globalStorageUri.fsPath, '.neon_local');
            const branchesPath = path.join(neonLocalPath, '.branches');
            console.log('Reading .branches file at path:', branchesPath);

            if (!fs.existsSync(branchesPath)) {
                return undefined;
            }

            const content = fs.readFileSync(branchesPath, 'utf-8');
            console.log('Raw .branches file content:', content);

            const data = JSON.parse(content);
            console.log('Parsed .branches file data:', JSON.stringify(data, null, 2));

            // Find the first key that has a branch_id
            const branchKey = Object.keys(data).find(key => 
                data[key] && typeof data[key] === 'object' && 'branch_id' in data[key]
            );

            if (!branchKey) {
                console.log('No branch ID found in branches file');
                return undefined;
            }

            const branchId = data[branchKey].branch_id;
            console.log('Found branch ID in file:', branchId);
            return branchId;
        } catch (error) {
            console.error('Error reading branch ID from file:', error);
            return undefined;
        }
    }

    private async updateState(partialState: Partial<NeonLocalState>) {
        // Update state immutably
        this._state = {
            ...this._state,
            ...partialState
        };

        // Save changes to persistent storage
        await this.saveState();
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
            this.state.update('neonLocal.selectedRole', this._state.selectedRole)
        ]);

        // Clear currently connected branch if proxy is not running
        if (!this._state.isProxyRunning) {
            this._state.currentlyConnectedBranch = '';
        }
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
    get currentlyConnectedBranch(): string { return this._state.currentlyConnectedBranch; }

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
        }

        await this.updateState(updates);
    }

    async setCurrentProject(value: string) {
        const updates: Partial<NeonLocalState> = {
            currentProject: value || '',
            currentBranch: '',
            parentBranchId: ''
        };
        await this.updateState(updates);
    }

    async setCurrentBranch(value: string) {
        await this.updateState({ currentBranch: value || '' });
    }

    async setParentBranchId(value: string) {
        await this.updateState({ parentBranchId: value || '' });
    }

    async setConnectionType(value: 'existing' | 'new') {
        await this.updateState({ connectionType: value });
    }

    async setIsProxyRunning(value: boolean) {
        await this.updateState({ isProxyRunning: value });
    }

    async setIsStarting(value: boolean) {
        await this.updateState({ isStarting: value });
    }

    async setSelectedDriver(value: string) {
        await this.updateState({ selectedDriver: value });
    }

    async setSelectedDatabase(value: string) {
        await this.updateState({ selectedDatabase: value });
    }

    async setSelectedRole(value: string) {
        await this.updateState({ selectedRole: value });
    }

    async setCurrentlyConnectedBranch(value: string) {
        await this.updateState({ currentlyConnectedBranch: value || '' });
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

        // Find the selected org, handling the personal account case
        const selectedOrg = this._state.currentOrg ? 
            orgs.find(org => org.id === this._state.currentOrg) : null;
        const selectedOrgName = selectedOrg?.name || 'Personal account';

        // Find the selected project
        const selectedProject = this._state.currentProject ? 
            projects.find(project => project.id === this._state.currentProject) : null;

        // For new branches, always use currentlyConnectedBranch when proxy is running
        // For existing branches, use currentBranch
        const activeBranchId = (this._state.isProxyRunning && this._state.connectionType === 'new') ? 
            this._state.currentlyConnectedBranch : this._state.currentBranch;

        console.log('Active branch selection:', {
            isProxyRunning: this._state.isProxyRunning,
            connectionType: this._state.connectionType,
            currentlyConnectedBranch: this._state.currentlyConnectedBranch,
            currentBranch: this._state.currentBranch,
            activeBranchId
        });

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
            this._state.currentlyConnectedBranch) {
            selectedBranch = {
                id: this._state.currentlyConnectedBranch,
                name: parentBranch ? `${parentBranch.name} (New)` : 'New Branch',
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
} 