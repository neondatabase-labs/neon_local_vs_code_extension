import * as vscode from 'vscode';
import { ViewData, NeonBranch, NeonOrg, NeonProject } from '../types';

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

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
        this.state = context.globalState;
        this.loadState();
        this._connectionType = context.globalState.get('connectionType') || 'existing';
    }

    private loadState() {
        this._currentOrg = this.state.get('neonLocal.currentOrg') || '';
        this._currentProject = this.state.get('neonLocal.currentProject') || '';
        this._currentBranch = this.state.get('neonLocal.currentBranch') || '';
        this._parentBranchId = this.state.get('neonLocal.parentBranchId') || '';
        this._connectionType = this.state.get('neonLocal.connectionType') || 'existing';
        this._isProxyRunning = this.state.get('neonLocal.isProxyRunning') || false;
        this._selectedDriver = this.state.get('neonLocal.selectedDriver') || 'postgres';
    }

    public async saveState() {
        await this.state.update('neonLocal.currentOrg', this._currentOrg);
        await this.state.update('neonLocal.currentProject', this._currentProject);
        await this.state.update('neonLocal.currentBranch', this._currentBranch);
        await this.state.update('neonLocal.parentBranchId', this._parentBranchId);
        await this.state.update('neonLocal.connectionType', this._connectionType);
        await this.state.update('neonLocal.isProxyRunning', this._isProxyRunning);
        await this.state.update('neonLocal.selectedDriver', this._selectedDriver);
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
        driver?: string
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
        const selectedBranch = this._currentBranch ? 
            branches.find(branch => branch.id === this._currentBranch) : null;

        console.log('Selected org:', selectedOrg);
        console.log('Selected project:', selectedProject);
        console.log('Selected branch:', selectedBranch);
        console.log('Projects to display:', projects);

        const viewData = {
            orgs,
            projects,
            branches,
            selectedOrgId: this._currentOrg || '',
            selectedOrgName,
            selectedProjectId: this._currentProject,
            selectedProjectName: selectedProject?.name,
            selectedBranchId: this._currentBranch,
            selectedBranchName: selectedBranch?.name,
            selectedDriver: this._selectedDriver,
            connected: isProxyRunning,
            isStarting,
            connectionType: this._connectionType
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
} 