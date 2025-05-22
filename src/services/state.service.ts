import * as vscode from 'vscode';
import { ViewData, NeonBranch, NeonOrg, NeonProject, NeonDatabase, NeonRole } from '../types';
import { FileService } from '../services/file.service';
import * as path from 'path';
import * as fs from 'fs';

export class StateService {
    private context: vscode.ExtensionContext;
    private state: vscode.Memento;
    private _isProxyRunning: boolean = false;
    private _isStarting: boolean = false;
    private _currentOrg = '';
    private _currentProject = '';
    private _currentBranch = '';
    private _parentBranchId = '';
    private _branches: NeonBranch[] = [];
    private _connectionType: 'existing' | 'new' = 'existing';
    private _selectedDriver = 'postgres';
    private _selectedDatabase: string = '';
    private _selectedRole: string = '';
    private _currentlyConnectedBranch: string = '';
    private fileService: FileService;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
        this.state = context.globalState;
        this.fileService = new FileService(context);
        this.loadState();
        this._connectionType = context.globalState.get('connectionType') || 'existing';
    }

    private async loadState() {
        this._currentOrg = this.state.get('neonLocal.currentOrg') || '';
        this._currentProject = this.state.get('neonLocal.currentProject') || '';
        this._currentBranch = this.state.get('neonLocal.currentBranch') || '';
        this._parentBranchId = this.state.get('neonLocal.parentBranchId') || '';
        this._connectionType = this.state.get('neonLocal.connectionType') || 'existing';
        this._isProxyRunning = this.state.get('neonLocal.isProxyRunning') || false;
        this._selectedDriver = this.state.get('neonLocal.selectedDriver') || 'postgres';
        this._selectedDatabase = this.state.get('neonLocal.selectedDatabase') || '';
        this._selectedRole = this.state.get('neonLocal.selectedRole') || '';
        
        // Load currently connected branch from .branches file
        console.log('Loading state - Current connection type:', this._connectionType);
        console.log('Loading state - Is proxy running:', this._isProxyRunning);
        
        const branchId = await this.getBranchIdFromFile();
        console.log('Loading state - Branch ID from file:', branchId);
        this._currentlyConnectedBranch = branchId || '';
        console.log('Loading state - Set currently connected branch to:', this._currentlyConnectedBranch);
    }

    private getBranchIdFromFile(): string | undefined {
        try {
            const neonLocalPath = path.join(this.context.globalStorageUri.fsPath, '.neon_local');
            const branchesPath = path.join(neonLocalPath, '.branches');
            console.log('Read .branches file at path:', branchesPath);

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
                console.log('No branch ID found in branches file. Data structure:', JSON.stringify(data));
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

    public async saveState() {
        await this.state.update('neonLocal.currentOrg', this._currentOrg);
        await this.state.update('neonLocal.currentProject', this._currentProject);
        await this.state.update('neonLocal.currentBranch', this._currentBranch);
        await this.state.update('neonLocal.parentBranchId', this._parentBranchId);
        await this.state.update('neonLocal.connectionType', this._connectionType);
        await this.state.update('neonLocal.isProxyRunning', this._isProxyRunning);
        await this.state.update('neonLocal.selectedDriver', this._selectedDriver);
        await this.state.update('neonLocal.selectedDatabase', this._selectedDatabase);
        await this.state.update('neonLocal.selectedRole', this._selectedRole);

        console.log('Saving state - Current connection type:', this._connectionType);
        console.log('Saving state - Is proxy running:', this._isProxyRunning);
        console.log('Saving state - Current branch:', this._currentBranch);

        // Update the currently connected branch based on connection type
        if (this._isProxyRunning) {
            if (this._connectionType === 'new') {
                // For new branches, always read from the .branches file
                const branchId = await this.getBranchIdFromFile();
                console.log('Saving state - Branch ID from file for new connection:', branchId);
                if (branchId) {
                    this._currentlyConnectedBranch = branchId;
                    console.log('Saving state - Updated currently connected branch from file:', this._currentlyConnectedBranch);
                } else {
                    console.warn('Could not read branch ID from .branches file');
                    console.log('Saving state - Current value of connected branch:', this._currentlyConnectedBranch);
                }
            } else {
                // For existing branches, use the selected branch ID
                this._currentlyConnectedBranch = this._currentBranch;
                console.log('Saving state - Updated currently connected branch from selection:', this._currentlyConnectedBranch);
            }
        } else {
            this._currentlyConnectedBranch = '';
            console.log('Saving state - Cleared currently connected branch as proxy is not running');
        }
    }

    // Proxy status
    get isProxyRunning(): boolean {
        return this._isProxyRunning;
    }

    set isProxyRunning(value: boolean) {
        this._isProxyRunning = value;
        this.saveState();
    }

    get isStarting(): boolean {
        return this._isStarting;
    }

    set isStarting(value: boolean) {
        this._isStarting = value;
    }

    // Organization
    get currentOrg(): string | undefined {
        return this._currentOrg;
    }

    set currentOrg(value: string | undefined) {
        this._currentOrg = value || '';
        this.saveState();
    }

    // Project
    get currentProject(): string | undefined {
        return this._currentProject;
    }

    set currentProject(value: string | undefined) {
        this._currentProject = value || '';
        this.saveState();
    }

    // Branch
    get currentBranch(): string | undefined {
        return this._currentBranch;
    }

    set currentBranch(value: string | undefined) {
        this._currentBranch = value || '';
        this.saveState();
    }

    get parentBranchId(): string | undefined {
        return this._parentBranchId;
    }

    set parentBranchId(value: string | undefined) {
        this._parentBranchId = value || '';
        this.saveState();
    }

    get branches(): NeonBranch[] {
        return this._branches;
    }

    set branches(value: NeonBranch[]) {
        this._branches = value;
    }

    get connectionType(): 'existing' | 'new' {
        return this._connectionType;
    }

    set connectionType(value: 'existing' | 'new') {
        this._connectionType = value;
        this.context.globalState.update('connectionType', value);
    }

    // Driver
    get selectedDriver(): string {
        return this._selectedDriver;
    }

    set selectedDriver(value: string) {
        this._selectedDriver = value;
        this.saveState();
    }

    public getViewData(
        orgs: NeonOrg[],
        projects: NeonProject[],
        branches: NeonBranch[],
        isProxyRunning: boolean,
        isStarting: boolean,
        driver?: string,
        databases: NeonDatabase[] = [],
        roles: NeonRole[] = []
    ): ViewData {
        // Update the selected driver if one is provided and we're running
        if (driver && isProxyRunning) {
            this._selectedDriver = driver;
            this.saveState();
        }

        console.log('Getting view data with currentOrg:', this._currentOrg);
        console.log('Projects received:', projects);
        console.log('Current driver:', this._selectedDriver);
        
        // Find the selected org name, handling the personal account case
        const selectedOrg = this._currentOrg && this._currentOrg.length > 0 ? 
            orgs.find(org => org.id === this._currentOrg) : null;
        const selectedOrgName = selectedOrg?.name || 'Personal account';

        // Find the selected project and branch
        const selectedProject = this._currentProject ? 
            projects.find(project => project.id === this._currentProject) : null;
            
        // For branch selection, use currentlyConnectedBranch logic
        const activeBranchId = this._isProxyRunning ? this.currentlyConnectedBranch : this._currentBranch;
        let selectedBranch = activeBranchId ? 
            branches.find(branch => branch.id === activeBranchId) : null;

        // Find the parent branch
        const parentBranch = this._parentBranchId ? 
            branches.find(branch => branch.id === this._parentBranchId) : null;

        // If we're connected and using a new branch, but couldn't find the branch in the list,
        // use the parent branch name with " (New)" appended
        if (this._isProxyRunning && this._connectionType === 'new' && !selectedBranch) {
            selectedBranch = {
                ...parentBranch!,
                id: activeBranchId || '',
                name: `${parentBranch?.name || ''} (New)`
            };
        }

        console.log('Selected org:', selectedOrg);
        console.log('Selected project:', selectedProject);
        console.log('Selected branch:', selectedBranch);
        console.log('Parent branch:', parentBranch);
        console.log('Active branch ID:', activeBranchId);
        console.log('Projects to display:', projects);

        // Generate connection info based on driver and active branch
        const connectionInfo = isProxyRunning ? 
            `postgres://neon:npg@localhost:5432/${this._selectedDatabase || 'neondb'}${this._selectedRole ? `_${this._selectedRole}` : ''}?sslmode=require` :
            undefined;

        const viewData = {
            orgs,
            projects,
            branches,
            databases,
            roles,
            selectedOrgId: this._currentOrg || '',
            selectedOrgName,
            selectedProjectId: this._currentProject,
            selectedProjectName: selectedProject?.name,
            selectedBranchId: activeBranchId || '',
            selectedBranchName: selectedBranch?.name,
            parentBranchName: parentBranch?.name,
            selectedDriver: this._selectedDriver,
            selectedDatabase: this._selectedDatabase,
            selectedRole: this._selectedRole,
            connected: isProxyRunning,
            isStarting,
            connectionType: this._connectionType,
            connectionInfo
        };

        console.log('Returning view data:', viewData);
        return viewData;
    }

    public clearState() {
        this._currentOrg = '';
        this._currentProject = '';
        this._currentBranch = '';
        this._parentBranchId = '';
        this._branches = [];
        this.saveState();
    }

    public setSelectedDatabase(database: string): void {
        this._selectedDatabase = database;
        this.saveState();
    }

    public setSelectedRole(role: string): void {
        this._selectedRole = role;
        this.state.update('neonLocal.selectedRole', role);
    }

    // Add getter for currently connected branch
    public get currentlyConnectedBranch(): string {
        console.log('Getting currently connected branch:', this._currentlyConnectedBranch);
        console.log('Current connection type:', this._connectionType);
        console.log('Current proxy running state:', this._isProxyRunning);
        return this._currentlyConnectedBranch;
    }
} 