import * as vscode from 'vscode';

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

export interface ViewData {
    orgs: NeonOrg[];
    projects: NeonProject[];
    branches: NeonBranch[];
    selectedOrgId?: string;
    selectedOrgName?: string;
    selectedProjectId?: string;
    selectedProjectName?: string;
    selectedBranchId?: string;
    selectedBranchName?: string;
    selectedDriver?: string;
    connected: boolean;
    isStarting: boolean;
    connectionType?: 'existing' | 'new';
    connectionInfo?: string;
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
    | 'startProxy'
    | 'stopProxy'
    | 'updateConnectionType'
    | 'showLoading'
    | 'signInSuccess'
    | 'resetSignIn'
    | 'refresh'
    | 'resetFromParent'
    | 'openSqlEditor'
    | 'launchPsql';

export interface NeonLocalManager {
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