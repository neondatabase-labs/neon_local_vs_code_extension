import * as vscode from 'vscode';
import { IStateService } from './services/state.service';

export interface NeonBranch {
    id: string;
    name: string;
    project_id: string;
    parent_id: string | null;
}

export interface NeonProject {
    id: string;
    name: string;
    org_id: string;
}

export interface NeonOrg {
    id: string;
    name: string;
}

export interface NeonDatabase {
    name: string;
    owner_name: string;
    created_at: string;
    size_bytes?: number;
}

export interface NeonRole {
    name: string;
    protected: boolean;
    created_at: string;
    updated_at: string;
}

export interface ViewData {
    orgs: Array<{ id: string; name: string }>;
    projects: Array<{ id: string; name: string }>;
    branches: Array<{ id: string; name: string }>;
    databases: Array<{ name: string }>;
    roles: Array<{ name: string }>;
    selectedOrgId: string;
    selectedOrgName: string;
    selectedProjectId?: string;
    selectedProjectName?: string;
    selectedBranchId?: string;
    selectedBranchName?: string;
    parentBranchId?: string;
    parentBranchName?: string;
    selectedDriver: 'serverless' | 'postgres';
    selectedDatabase?: string;
    selectedRole?: string;
    connected: boolean;
    isStarting: boolean;
    connectionType: 'existing' | 'new';
    connectionInfo?: string;
    isExplicitUpdate?: boolean;
    currentlyConnectedBranch?: string;
}

export interface WebviewMessage {
    command: string;
    [key: string]: any;
}

export type WebviewCommand = 
    | 'signIn'
    | 'selectOrg'
    | 'selectProject'
    | 'selectBranch'
    | 'selectDatabase'
    | 'selectRole'
    | 'startProxy'
    | 'stopProxy'
    | 'updateConnectionType'
    | 'showLoading'
    | 'signInSuccess'
    | 'resetSignIn'
    | 'refresh'
    | 'resetFromParent'
    | 'openSqlEditor'
    | 'launchPsql'
    | 'requestInitialData'
    | 'openTableView';

export interface NeonLocalManager {
    getViewData(): Promise<ViewData>;
    setWebviewView(view: any): void;
    stateService: IStateService;
    handleDatabaseSelection(database: string): Promise<void>;
    handleRoleSelection(role: string): Promise<void>;
    handleStartProxy(driver: string, isExisting: boolean, branchId?: string, parentBranchId?: string): Promise<void>;
    handleError(error: any): void;
    clearAuth(): Promise<void>;
    handleBranchSelection(branchId: string, restartProxy: boolean, driver: string): Promise<void>;
    handleOrgSelection(orgId: string): Promise<void>;
    handleProjectSelection(projectId: string): Promise<void>;
    handleParentBranchSelection(parentBranchId: string): Promise<void>;
    handleConnectionTypeChange(connectionType: 'existing' | 'new'): Promise<void>;
    handleStopProxy(): Promise<void>;
    activate(): Promise<void>;
    deactivate(): void;
    configure(): Promise<void>;
    showPanel(): void;
    stopProxy(): Promise<void>;
}

export interface NeonConfiguration {
    apiKey?: string;
    refreshToken?: string;
    projectId?: string;
    driver?: 'postgres' | 'serverless';
    deleteOnStop?: boolean;
    connectionType?: 'existing' | 'new';
}

export interface DockerConfig {
    image: string;
    containerName: string;
    ports: { [key: string]: string };
    environment: { [key: string]: string };
    volumes?: { [key: string]: string };
    deleteOnStop?: boolean;
    connectionType?: 'existing' | 'new';
} 