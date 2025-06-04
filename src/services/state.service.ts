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
    selectedDriver: 'postgres' | 'serverless';
    selectedDatabase: string;
    selectedRole: string;
    currentlyConnectedBranch: string;
    connectionInfo: string;
}

export interface IStateService {
    setConnectionType(value: 'existing' | 'new'): Promise<void>;
    getConnectionType(): 'existing' | 'new';
    currentProject: string;
    currentOrg: string;
    currentBranch: string;
    currentlyConnectedBranch: Promise<string>;
    parentBranchId: string;
    setSelectedDatabase(value: string): Promise<void>;
    setSelectedRole(value: string): Promise<void>;
    isProxyRunning: boolean;
    isStarting: boolean;
    selectedDriver: 'postgres' | 'serverless';
    selectedDatabase: string;
    selectedRole: string;
    connectionType: 'existing' | 'new';
    setSelectedDriver(value: 'postgres' | 'serverless'): Promise<void>;
    setIsProxyRunning(value: boolean): Promise<void>;
    setIsStarting(value: boolean): Promise<void>;
    setCurrentBranch(value: string): Promise<void>;
    setCurrentOrg(value: string): Promise<void>;
    setCurrentProject(value: string): Promise<void>;
    setParentBranchId(value: string): Promise<void>;
    setCurrentlyConnectedBranch(value: string): Promise<void>;
    setConnectionInfo(value: string): Promise<void>;
    clearState(): Promise<void>;
    getViewData(
        orgs: NeonOrg[],
        projects: NeonProject[],
        branches: NeonBranch[],
        isProxyRunning: boolean,
        isStarting: boolean,
        driver?: string,
        databases?: NeonDatabase[],
        roles?: NeonRole[],
        isExplicitUpdate?: boolean
    ): Promise<ViewData>;
    getBranchIdFromFile(): Promise<string>;
}

export class StateService implements IStateService {
    private context: vscode.ExtensionContext;
    private state: vscode.Memento;
    private fileService: FileService;
    private _state: NeonLocalState;
    private _connectionType: 'existing' | 'new' = 'existing';
    private _isProxyRunning = false;
    private _isStarting = false;
    private _selectedDriver: 'postgres' | 'serverless' = 'postgres';
    private _currentOrg?: string;
    private _currentProject?: string;
    private _currentBranch?: string;
    private _currentlyConnectedBranch?: string;
    private _parentBranchId?: string;
    private _selectedDatabase?: string;
    private _selectedRole?: string;

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
    get selectedDriver(): 'postgres' | 'serverless' { return this._state.selectedDriver; }
    get selectedDatabase(): string { return this._state.selectedDatabase; }
    get selectedRole(): string { return this._state.selectedRole; }
    get connectionInfo(): string { return this._state.connectionInfo; }

    get currentlyConnectedBranch(): Promise<string> { 
        console.log('StateService: Getting currentlyConnectedBranch', {
            cachedValue: this._state.currentlyConnectedBranch,
            isProxyRunning: this._state.isProxyRunning
        });
        
        // If we have a cached value and we're connected, use it
        if (this._state.currentlyConnectedBranch && this._state.isProxyRunning) {
            console.log('StateService: Using cached branch ID:', this._state.currentlyConnectedBranch);
            return Promise.resolve(this._state.currentlyConnectedBranch);
        }
        // Otherwise read from file
        console.log('StateService: Reading branch ID from file');
        return this.getBranchIdFromFile(); 
    }

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
        console.log('Setting parent branch ID:', {
            value,
            currentConnectionType: this._state.connectionType
        });
        
        await this.updateState({
            parentBranchId: value || ''
        });
    }

    public async setConnectionType(value: 'existing' | 'new') {
        console.log('Setting connection type:', {
            newValue: value,
            currentValue: this._state.connectionType,
            currentBranch: this._state.currentBranch,
            parentBranchId: this._state.parentBranchId
        });
        
        // Only update if the value is actually changing
        if (this._state.connectionType !== value) {
            // Store current state values before updating
            const currentBranch = this._state.currentBranch;
            const parentBranchId = this._state.parentBranchId;
            
            const updates: Partial<NeonLocalState> = {
                connectionType: value
            };
            
            // When switching to new, preserve parent branch ID if it exists
            if (value === 'new') {
                updates.parentBranchId = parentBranchId || currentBranch || '';
                updates.currentBranch = '';  // Clear current branch when switching to new
            } else {
                // When switching to existing, preserve current branch if it exists
                updates.currentBranch = currentBranch || '';
                updates.parentBranchId = '';  // Clear parent branch when switching to existing
            }
            
            await this.updateState(updates);
            
            console.log('Connection type updated:', {
                newValue: value,
                currentState: this._state
            });
        }
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

    async setSelectedDriver(value: 'postgres' | 'serverless') {
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
        roles: NeonRole[] = [],
        isExplicitUpdate: boolean = false
    ): Promise<ViewData> {
        console.log('StateService: Starting getViewData', {
            isProxyRunning,
            connectionType: this._state.connectionType,
            currentBranch: this._state.currentBranch,
            currentlyConnectedBranch: this._state.currentlyConnectedBranch
        });

        // Ensure orgs and projects are always arrays
        const validOrgs = Array.isArray(orgs) ? orgs : [];
        const validProjects = Array.isArray(projects) ? projects : [];
        const validBranches = Array.isArray(branches) ? branches : [];
        
        // Find the selected org and project - preserve current selections
        const selectedOrg = validOrgs.find(org => org.id === this._state.currentOrg);
        const selectedProject = validProjects.find(project => project.id === this._state.currentProject);

        // Get the currently connected branch ID when connected
        const connectedBranchId = await this.currentlyConnectedBranch;
        console.log('StateService: Retrieved connected branch ID:', {
            connectedBranchId,
            isProxyRunning,
            connectionType: this._state.connectionType
        });
        
        // Find branch info based on connection state and type
        let selectedBranch: NeonBranch | undefined;
        let activeBranchId: string;
        let displayBranchId: string;
        let displayBranchName: string;
        
        if (isProxyRunning) {
            console.log('StateService: Proxy is running, determining branch display');
            // When connected, always use the currently connected branch from the .branches file
            activeBranchId = connectedBranchId;
            
            // For new connections, always use the connected branch ID
            // For existing connections, try to find the branch in the list
            if (this._state.connectionType === 'new') {
                console.log('StateService: New connection, using connected branch ID for display');
                displayBranchId = connectedBranchId;
                displayBranchName = connectedBranchId; // Use raw branch ID for new branches
            } else {
                console.log('StateService: Existing connection, using selected branch');
                // For existing connections, use the selected branch
                selectedBranch = validBranches.find(branch => branch.id === this._state.currentBranch);
                displayBranchId = this._state.currentBranch;
                displayBranchName = selectedBranch?.name || this._state.currentBranch;
            }
        } else {
            // When not connected, use appropriate branch based on connection type
            if (this._state.connectionType === 'existing') {
                activeBranchId = this._state.currentBranch;
                displayBranchId = this._state.currentBranch;
                selectedBranch = validBranches.find(branch => branch.id === this._state.currentBranch);
                displayBranchName = selectedBranch?.name || '';
            } else {
                activeBranchId = this._state.parentBranchId;
                displayBranchId = '';  // Don't show a branch ID for new connections until connected
                selectedBranch = validBranches.find(branch => branch.id === this._state.parentBranchId);
                displayBranchName = '';
            }
        }
        
        // Always find parent branch, even when connected
        const parentBranch = validBranches.find(branch => branch.id === this._state.parentBranchId);

        // Update the selected driver if one is provided and we're running
        if (driver && isProxyRunning) {
            await this.setSelectedDriver(driver as 'postgres' | 'serverless');
        }

        // Create view data with explicit update flag and ensure org/project info is included
        const viewData: ViewData = {
            orgs: validOrgs,
            projects: validProjects,
            branches: validBranches,
            databases,
            roles,
            selectedOrgId: this._state.currentOrg,
            selectedOrgName: selectedOrg?.name || '',
            selectedProjectId: this._state.currentProject,
            selectedProjectName: selectedProject?.name || '',
            selectedBranchId: displayBranchId,
            selectedBranchName: displayBranchName,
            parentBranchId: this._state.parentBranchId,
            parentBranchName: parentBranch?.name || '',
            selectedDriver: this._state.selectedDriver,
            selectedDatabase: this._state.selectedDatabase,
            selectedRole: this._state.selectedRole,
            connected: isProxyRunning,
            isStarting,
            connectionType: this._state.connectionType,
            connectionInfo: this._state.connectionInfo,
            isExplicitUpdate,
            currentlyConnectedBranch: connectedBranchId
        };

        console.log('StateService: Final view data branch values:', {
            selectedBranchId: viewData.selectedBranchId,
            selectedBranchName: viewData.selectedBranchName,
            currentlyConnectedBranch: viewData.currentlyConnectedBranch,
            connectionType: viewData.connectionType,
            connected: viewData.connected
        });

        return viewData;
    }

    public async getBranchIdFromFile(): Promise<string> {
        console.log('StateService: Reading branch ID from .branches file');
        try {
            if (!fs.existsSync(this.fileService.branchesFilePath)) {
                console.log('StateService: No .branches file found at:', this.fileService.branchesFilePath);
                return '';
            }

            const content = await fs.promises.readFile(this.fileService.branchesFilePath, 'utf8');
            console.log('StateService: Read .branches file content:', content);
            
            const data = JSON.parse(content);
            console.log('StateService: Parsed .branches file data:', data);
            
            // Try to get branch ID in order of priority
            let branchId = data[this._state.currentProject]?.branch_id;
            console.log('StateService: Found branch ID from project key:', {
                projectId: this._state.currentProject,
                branchId
            });
            
            if (!branchId && data.main?.branch_id) {
                console.log('StateService: Using main key branch ID:', data.main.branch_id);
                branchId = data.main.branch_id;
            }
            
            if (!branchId && data['None']?.branch_id) {
                console.log('StateService: Using None key branch ID:', data['None'].branch_id);
                branchId = data['None'].branch_id;
            }
            
            // Update the state with the found branch ID
            if (branchId) {
                console.log('StateService: Updating state with branch ID:', branchId);
                await this.setCurrentlyConnectedBranch(branchId);
            }
            
            return branchId || '';
        } catch (error) {
            console.error('StateService: Error reading branch ID from file:', error);
            return '';
        }
    }

    public getConnectionType(): 'existing' | 'new' {
        return this._state.connectionType;
    }
} 