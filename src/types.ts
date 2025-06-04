import * as vscode from 'vscode';
import { StateService } from './services/state.service';

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
    orgs: NeonOrg[];
    projects: NeonProject[];
    branches: NeonBranch[];
    databases: NeonDatabase[];
    roles: NeonRole[];
    selectedOrgId: string;
    selectedOrgName: string;
    selectedProjectId?: string;
    selectedProjectName?: string;
    selectedBranchId: string;
    selectedBranchName?: string;
    parentBranchId?: string;
    parentBranchName?: string;
    selectedDriver: string;
    selectedDatabase?: string;
    selectedRole?: string;
    connected: boolean;
    isStarting: boolean;
    connectionType?: 'existing' | 'new';
    connectionInfo?: string;
    isExplicitUpdate?: boolean;
    currentlyConnectedBranch?: string;
}

export interface WebviewMessage {
    command: WebviewCommand;
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
    stateService: {
        setConnectionType(value: 'existing' | 'new'): Promise<void>;
        getConnectionType(): 'existing' | 'new';
        currentProject?: string;
        currentOrg?: string;
        isProxyRunning: boolean;
        isStarting: boolean;
        selectedDriver: string;
        connectionType: 'existing' | 'new';
        currentBranch?: string;
        parentBranchId?: string;
    };
    setWebviewView(view: vscode.WebviewView): void;
    handleOrgSelection(orgId: string): Promise<void>;
    handleProjectSelection(projectId: string): Promise<void>;
    handleBranchSelection(branchId: string, restartProxy: boolean, driver: string): Promise<void>;
    handleStartProxy(driver: string, isExisting: boolean, branchId?: string, parentBranchId?: string): Promise<void>;
    handleStopProxy(): Promise<void>;
    getViewData(): Promise<ViewData>;
}

export interface NeonConfiguration {
    apiKey?: string;
    refreshToken?: string;
    projectId?: string;
    driver?: 'postgres' | 'serverless';
    deleteOnStop?: boolean;
    connectionType?: 'existing' | 'new';
} 