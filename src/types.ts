import * as vscode from 'vscode';

export interface ViewData {
    connected?: boolean;
    connectionInfo?: string;
    orgs?: Array<{ id: string; name: string }>;
    projects?: Array<{ id: string; name: string }>;
    branches?: Array<{ id: string; name: string }>;
    selectedOrgId?: string;
    selectedProjectId?: string;
    selectedBranchId?: string;
    selectedDriver?: string;
    selectedOrgName?: string;
    selectedProjectName?: string;
    selectedBranchName?: string;
    selectedBranch?: any;
    loading?: boolean;
    connectionType?: 'existing' | 'new';
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