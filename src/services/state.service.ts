import * as vscode from 'vscode';
import { ViewData, NeonBranch, NeonOrg, NeonProject, NeonDatabase, NeonRole } from '../types';
import { FileService } from './file.service';

interface ConnectionState {
    connected: boolean;
    isStarting: boolean;
    type: 'existing' | 'new';
    driver: 'serverless' | 'postgres';
    connectionInfo: string;
    currentlyConnectedBranch: string;
    selectedDatabase: string;
    selectedRole: string;
    databases: NeonDatabase[];
    roles: NeonRole[];
}

interface SelectionState {
    orgs: NeonOrg[];
    projects: NeonProject[];
    branches: NeonBranch[];
    selectedOrgId: string;
    selectedOrgName: string;
    selectedProjectId?: string;
    selectedProjectName?: string;
    selectedBranchId?: string;
    selectedBranchName?: string;
    parentBranchId?: string;
    parentBranchName?: string;
}

interface LoadingState {
    orgs: boolean;
    projects: boolean;
    branches: boolean;
}

interface State {
    connection: ConnectionState;
    selection: SelectionState;
    loading: LoadingState;
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
    setConnectionInfo(value: { connectionInfo: string; selectedDatabase: string }): Promise<void>;
    clearState(): Promise<void>;
    getViewData(): Promise<ViewData>;
    getBranchIdFromFile(): Promise<string>;
    updateDatabase(database: string): Promise<void>;
    updateRole(role: string): Promise<void>;
    setOrganizations(orgs: NeonOrg[]): Promise<void>;
    setProjects(projects: NeonProject[]): Promise<void>;
    setBranches(branches: NeonBranch[]): Promise<void>;
    clearAuth(): Promise<void>;
    getCurrentBranchId(): Promise<string | undefined>;
    getCurrentProjectId(): Promise<string | undefined>;
    getDatabases(): Promise<NeonDatabase[]>;
    setDatabases(databases: NeonDatabase[]): Promise<void>;
    setRoles(roles: NeonRole[]): Promise<void>;
}

export class StateService implements IStateService {
    private readonly context: vscode.ExtensionContext;
    private state: vscode.Memento;
    private fileService: FileService;
    private _state: State = {
        connection: {
            connected: false,
            isStarting: false,
            type: 'existing',
            driver: 'postgres',
            connectionInfo: '',
            currentlyConnectedBranch: '',
            selectedDatabase: '',
            selectedRole: '',
            databases: [],
            roles: []
        },
        selection: {
            orgs: [],
            projects: [],
            branches: [],
            selectedOrgId: '',
            selectedOrgName: '',
            selectedProjectId: undefined,
            selectedProjectName: undefined,
            selectedBranchId: undefined,
            selectedBranchName: undefined,
            parentBranchId: undefined,
            parentBranchName: undefined
        },
        loading: {
            orgs: false,
            projects: false,
            branches: false
        }
    };

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
        this.state = context.globalState;
        this.fileService = new FileService(context);
        this.loadState().catch(error => {
            console.error('Error loading initial state:', error);
        });
    }

    private async loadState() {
        this._state.loading = {
            orgs: true,
            projects: true,
            branches: true
        };

        const connectionType = this.state.get('neonLocal.connectionType', 'existing');
        const selectedDriver = this.state.get('neonLocal.selectedDriver', 'postgres');
        const selectedDatabase = this.state.get('neonLocal.selectedDatabase', '');
        const selectedRole = this.state.get('neonLocal.selectedRole', '');
        const currentlyConnectedBranch = this.state.get('neonLocal.currentlyConnectedBranch', '');
        const connectionInfo = this.state.get('neonLocal.connectionInfo', '');
        const selectedOrgId = this.state.get('neonLocal.currentOrg', '');
        const selectedProjectId = this.state.get('neonLocal.currentProject', '');
        const selectedBranchId = this.state.get('neonLocal.currentBranch', '');
        const parentBranchId = this.state.get('neonLocal.parentBranchId', '');

        this._state = {
            connection: {
                connected: false,
                isStarting: false,
                type: connectionType as 'existing' | 'new',
                driver: selectedDriver as 'postgres' | 'serverless',
                connectionInfo,
                currentlyConnectedBranch,
                selectedDatabase,
                selectedRole,
                databases: [],
                roles: []
            },
            selection: {
                orgs: [],
                projects: [],
                branches: [],
                selectedOrgId,
                selectedOrgName: this.state.get('selectedOrgName') || '',
                selectedProjectId: selectedProjectId || undefined,
                selectedProjectName: this.state.get('selectedProjectName') || undefined,
                selectedBranchId: selectedBranchId || undefined,
                selectedBranchName: undefined,
                parentBranchId: parentBranchId || undefined,
                parentBranchName: undefined
            },
            loading: {
                orgs: false,
                projects: false,
                branches: false
            }
        };

        await this.saveState();
    }

    private async saveState() {
        await Promise.all([
            this.state.update('neonLocal.currentOrg', this._state.selection.selectedOrgId),
            this.state.update('neonLocal.currentProject', this._state.selection.selectedProjectId),
            this.state.update('neonLocal.currentBranch', this._state.selection.selectedBranchId),
            this.state.update('neonLocal.parentBranchId', this._state.selection.parentBranchId),
            this.state.update('neonLocal.connectionType', this._state.connection.type),
            this.state.update('neonLocal.selectedDriver', this._state.connection.driver),
            this.state.update('neonLocal.selectedDatabase', this._state.connection.selectedDatabase),
            this.state.update('neonLocal.selectedRole', this._state.connection.selectedRole),
            this.state.update('neonLocal.currentlyConnectedBranch', this._state.connection.currentlyConnectedBranch),
            this.state.update('neonLocal.connectionInfo', this._state.connection.connectionInfo)
        ]);
    }

    get currentOrg(): string { return this._state.selection.selectedOrgId; }
    get currentProject(): string { return this._state.selection.selectedProjectId || ''; }
    get currentBranch(): string { return this._state.selection.selectedBranchId || ''; }
    get parentBranchId(): string { return this._state.selection.parentBranchId || ''; }
    get isProxyRunning(): boolean { return this._state.connection.connected; }
    get isStarting(): boolean { return this._state.connection.isStarting; }
    get selectedDriver(): 'postgres' | 'serverless' { return this._state.connection.driver; }
    get selectedDatabase(): string { return this._state.connection.selectedDatabase; }
    get selectedRole(): string { return this._state.connection.selectedRole; }
    get connectionType(): 'existing' | 'new' { return this._state.connection.type; }
    get connectionInfo(): string { return this._state.connection.connectionInfo; }
    get currentlyConnectedBranch(): Promise<string> { return Promise.resolve(this._state.connection.currentlyConnectedBranch); }

    async setConnectionType(value: 'existing' | 'new'): Promise<void> {
        await this.updateState({
            connection: {
                ...this._state.connection,
                type: value
            }
        });
    }

    async setSelectedDriver(value: 'postgres' | 'serverless'): Promise<void> {
        await this.updateState({
            connection: {
                ...this._state.connection,
                driver: value
            }
        });
    }

    async setSelectedDatabase(value: string): Promise<void> {
        await this.updateState({
            connection: {
                ...this._state.connection,
                selectedDatabase: value
            }
        });
    }

    async setSelectedRole(value: string): Promise<void> {
        await this.updateState({
            connection: {
                ...this._state.connection,
                selectedRole: value
            }
        });
    }

    async setConnectionInfo(value: { connectionInfo: string; selectedDatabase: string }): Promise<void> {
        await this.updateState({
            connection: {
                ...this._state.connection,
                connectionInfo: value.connectionInfo,
                selectedDatabase: value.selectedDatabase
            }
        });
    }

    async setIsProxyRunning(value: boolean): Promise<void> {
        await this.updateState({
            connection: {
                ...this._state.connection,
                connected: value,
                selectedDatabase: value ? this._state.connection.selectedDatabase : '',
                selectedRole: value ? this._state.connection.selectedRole : ''
            }
        });
    }

    async setIsStarting(value: boolean): Promise<void> {
        await this.updateState({
            connection: {
                ...this._state.connection,
                isStarting: value
            }
        });
    }

    async setCurrentBranch(value: string): Promise<void> {
        await this.updateState({
            selection: {
                ...this._state.selection,
                selectedBranchId: value
            }
        });
    }

    async setCurrentOrg(value: string): Promise<void> {
        await this.updateState({
            selection: {
                ...this._state.selection,
                selectedOrgId: value,
                selectedOrgName: this._state.selection.orgs.find(org => org.id === value)?.name || ''
            }
        });
    }

    async setCurrentProject(value: string): Promise<void> {
        await this.updateState({
            selection: {
                ...this._state.selection,
                selectedProjectId: value,
                selectedProjectName: this._state.selection.projects.find(project => project.id === value)?.name || ''
            }
        });
    }

    async setParentBranchId(value: string): Promise<void> {
        await this.updateState({
            selection: {
                ...this._state.selection,
                parentBranchId: value
            }
        });
    }

    async setCurrentlyConnectedBranch(value: string): Promise<void> {
        await this.updateState({
            connection: {
                ...this._state.connection,
                currentlyConnectedBranch: value
            }
        });
    }

    async clearState(): Promise<void> {
        this._state = {
            connection: {
                connected: false,
                isStarting: false,
                type: 'existing',
                driver: 'postgres',
                connectionInfo: '',
                currentlyConnectedBranch: '',
                selectedDatabase: '',
                selectedRole: '',
                databases: [],
                roles: []
            },
            selection: {
                orgs: [],
                projects: [],
                branches: [],
                selectedOrgId: '',
                selectedOrgName: '',
                selectedProjectId: undefined,
                selectedProjectName: undefined,
                selectedBranchId: undefined,
                selectedBranchName: undefined,
                parentBranchId: undefined,
                parentBranchName: undefined
            },
            loading: {
                orgs: false,
                projects: false,
                branches: false
            }
        };
        await this.saveState();
    }

    public async getViewData(): Promise<ViewData> {
        const viewData: ViewData = {
            connected: this._state.connection.connected,
            isStarting: this._state.connection.isStarting,
            connectionType: this._state.connection.type,
            selectedDriver: this._state.connection.driver,
            connectionInfo: this._state.connection.connectionInfo,
            selectedDatabase: this._state.connection.selectedDatabase,
            selectedRole: this._state.connection.selectedRole,
            currentlyConnectedBranch: this._state.connection.currentlyConnectedBranch,
            databases: this._state.connection.databases,
            roles: this._state.connection.roles,
            orgs: this._state.selection.orgs,
            projects: this._state.selection.projects,
            branches: this._state.selection.branches,
            selectedOrgId: this._state.selection.selectedOrgId,
            selectedOrgName: this._state.selection.selectedOrgName,
            selectedProjectId: this._state.selection.selectedProjectId,
            selectedProjectName: this._state.selection.selectedProjectName,
            selectedBranchId: this._state.selection.selectedBranchId,
            selectedBranchName: this._state.selection.selectedBranchName,
            parentBranchId: this._state.selection.parentBranchId,
            parentBranchName: this._state.selection.parentBranchName,
            loading: this._state.loading,
            isExplicitUpdate: false,
            connection: {
                ...this._state.connection,
                selectedOrgId: this._state.selection.selectedOrgId,
                selectedOrgName: this._state.selection.selectedOrgName,
                selectedProjectId: this._state.selection.selectedProjectId,
                selectedProjectName: this._state.selection.selectedProjectName,
                selectedBranchId: this._state.selection.selectedBranchId,
                selectedBranchName: this._state.selection.selectedBranchName,
                parentBranchId: this._state.selection.parentBranchId,
                parentBranchName: this._state.selection.parentBranchName
            }
        };
        return viewData;
    }

    public async getBranchIdFromFile(): Promise<string> {
        return this._state.selection.selectedBranchId || '';
    }

    async updateDatabase(database: string): Promise<void> {
        await this.updateState({
            connection: {
                ...this._state.connection,
                selectedDatabase: database
            }
        });
    }

    async updateRole(role: string): Promise<void> {
        await this.updateState({
            connection: {
                ...this._state.connection,
                selectedRole: role
            }
        });
    }

    async setDatabases(databases: NeonDatabase[]): Promise<void> {
        await this.updateState({
            connection: {
                ...this._state.connection,
                databases
            }
        });
    }

    async setRoles(roles: NeonRole[]): Promise<void> {
        await this.updateState({
            connection: {
                ...this._state.connection,
                roles
            }
        });
    }

    public async updateState(newState: Partial<State>): Promise<void> {
        console.log('Updating state:', {
            current: this._state,
            updates: newState
        });
        this._state = {
            ...this._state,
            ...newState
        };
        await this.saveState();
        await this.updateViewData();
        console.log('State updated:', this._state);
    }

    getConnectionType(): 'existing' | 'new' {
        return this._state.connection.type;
    }

    public async setOrganizations(orgs: NeonOrg[]): Promise<void> {
        this._state.selection.orgs = orgs;
        await this.saveState();
    }

    public async setProjects(projects: NeonProject[]): Promise<void> {
        await this.updateState({
            selection: {
                ...this._state.selection,
                projects
            }
        });
    }

    public async setBranches(branches: NeonBranch[]): Promise<void> {
        await this.updateState({
            selection: {
                ...this._state.selection,
                branches
            }
        });
    }

    public async updateLoadingState(loading: { orgs?: boolean; projects?: boolean; branches?: boolean }): Promise<void> {
        await this.updateState({
            loading: {
                ...this._state.loading,
                ...loading
            }
        });
    }

    public async clearAuth(): Promise<void> {
        const config = vscode.workspace.getConfiguration('neonLocal');
        await config.update('apiKey', undefined, true);
        await config.update('refreshToken', undefined, true);
        await config.update('projectId', undefined, true);
        await this.setIsProxyRunning(false);
        await this.clearState();
    }

    public async getCurrentBranchId(): Promise<string | undefined> {
        return this._state.selection.selectedBranchId;
    }

    public async getCurrentProjectId(): Promise<string | undefined> {
        return this._state.selection.selectedProjectId;
    }

    public async getDatabases(): Promise<NeonDatabase[]> {
        return this._state.connection.databases;
    }

    private async updateViewData(): Promise<void> {
        // Notify any listeners that the view data has changed
        const viewData = await this.getViewData();
        await vscode.commands.executeCommand('neonLocal.viewDataChanged', viewData);
    }
} 