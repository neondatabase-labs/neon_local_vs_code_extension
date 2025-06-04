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
    connectionInfo: string;
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
            currentlyConnectedBranch: '',
            connectionInfo: ''
        };

        this.loadState();
    }

    private async loadState() {
        // Load all state properties from persistent storage with proper defaults
        this._state = {
            currentOrg: this.state.get('neonLocal.currentOrg', ''),
            currentProject: this.state.get('neonLocal.currentProject', ''),
            currentBranch: this.state.get('neonLocal.currentBranch', ''),
            parentBranchId: this.state.get('neonLocal.parentBranchId', ''),
            connectionType: this.state.get('neonLocal.connectionType', 'existing'),
            isProxyRunning: this.state.get('neonLocal.isProxyRunning', false),
            isStarting: false, // Always start with not starting
            selectedDriver: this.state.get('neonLocal.selectedDriver', 'postgres'),
            selectedDatabase: this.state.get('neonLocal.selectedDatabase', ''),
            selectedRole: this.state.get('neonLocal.selectedRole', ''),
            currentlyConnectedBranch: this.state.get('neonLocal.currentlyConnectedBranch', ''),
            connectionInfo: this.state.get('neonLocal.connectionInfo', '')
        };

        // Validate state consistency
        if (!this._state.currentProject) {
            // If no project is selected, clear branch-related state
            this._state.currentBranch = '';
            this._state.parentBranchId = '';
            this._state.currentlyConnectedBranch = '';
            this._state.selectedDatabase = '';
            this._state.selectedRole = '';
        }

        // Save the validated state
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
            this.state.update('neonLocal.selectedRole', this._state.selectedRole),
            this.state.update('neonLocal.currentlyConnectedBranch', this._state.currentlyConnectedBranch),
            this.state.update('neonLocal.connectionInfo', this._state.connectionInfo)
        ]);
    }

    private async updateState(updates: Partial<NeonLocalState>) {
        // Validate state transitions
        const newState = {
            ...this._state,
            ...updates
        };

        // Validate project and branch relationships
        if (newState.isProxyRunning) {
            if (!newState.currentProject) {
                throw new Error('Cannot set proxy running without a project');
            }
            if (newState.connectionType === 'existing' && !newState.currentBranch) {
                throw new Error('Cannot set proxy running for existing connection without a branch');
            }
            if (newState.connectionType === 'new' && !newState.parentBranchId) {
                throw new Error('Cannot set proxy running for new connection without a parent branch');
            }
        }

        // Update local state
        this._state = newState;

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
    get connectionInfo(): string { return this._state.connectionInfo; }

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

    async setConnectionInfo(value: string) {
        await this.updateState({
            connectionInfo: value || ''
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
            currentlyConnectedBranch: '',
            connectionInfo: ''
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
        // Ensure orgs is always an array
        const validOrgs = Array.isArray(orgs) ? orgs : [];
        
        // Find the selected org
        const selectedOrg = validOrgs.find(org => org.id === this._state.currentOrg);
        const selectedOrgName = selectedOrg?.name || '';

        // Find the selected project
        const validProjects = Array.isArray(projects) ? projects : [];
        const selectedProject = validProjects.find(project => project.id === this._state.currentProject);

        // Find the selected branch and parent branch
        const validBranches = Array.isArray(branches) ? branches : [];
        
        // Get the currently connected branch ID when connected
        const connectedBranchId = isProxyRunning ? await this.currentlyConnectedBranch : '';
        
        // Find branch info based on connection state and type
        let selectedBranch: NeonBranch | undefined;
        if (isProxyRunning) {
            // When connected, use the currently connected branch from the .branches file
            selectedBranch = validBranches.find(branch => branch.id === connectedBranchId);
        } else {
            // When not connected, use the selected branch based on connection type
            const branchId = this._state.connectionType === 'existing' ? this._state.currentBranch : this._state.parentBranchId;
            selectedBranch = validBranches.find(branch => branch.id === branchId);
        }
        
        const parentBranch = validBranches.find(branch => branch.id === this._state.parentBranchId);

        // Update the selected driver if one is provided and we're running
        if (driver && isProxyRunning) {
            await this.setSelectedDriver(driver);
        }

        // Determine active branch ID based on connection state and type
        const activeBranchId = isProxyRunning ? connectedBranchId : (
            this._state.connectionType === 'existing' ? this._state.currentBranch : this._state.parentBranchId
        );

        // Log connection status
        console.log('StateService: Connection status:', {
            isProxyRunning,
            isStarting,
            connectionInfo: this._state.connectionInfo,
            currentlyConnectedBranch: connectedBranchId,
            selectedBranch: selectedBranch?.name
        });

        const viewData: ViewData = {
            orgs: validOrgs,
            projects: validProjects,
            branches: validBranches,
            databases,
            roles,
            selectedOrgId: this._state.currentOrg,
            selectedOrgName,
            selectedProjectId: this._state.currentProject,
            selectedProjectName: selectedProject?.name || '',
            selectedBranchId: activeBranchId,
            selectedBranchName: selectedBranch?.name || '',
            parentBranchId: this._state.parentBranchId,
            parentBranchName: parentBranch?.name || '',
            selectedDriver: this._state.selectedDriver,
            selectedDatabase: this._state.selectedDatabase,
            selectedRole: this._state.selectedRole,
            connected: isProxyRunning,
            isStarting,
            connectionType: this._state.connectionType,
            connectionInfo: this._state.connectionInfo
        };

        console.log('Generated view data:', {
            ...viewData,
            connected: viewData.connected,
            isStarting: viewData.isStarting,
            connectionInfo: viewData.connectionInfo,
            selectedBranchName: viewData.selectedBranchName
        });
        return viewData;
    }

    public async getBranchIdFromFile(): Promise<string> {
        // If we're connecting to an existing branch, return the selected branch ID
        if (this._state.connectionType === 'existing' && this._state.currentBranch) {
            return this._state.currentBranch;
        }

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