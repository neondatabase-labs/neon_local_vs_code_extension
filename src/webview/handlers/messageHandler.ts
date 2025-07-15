import { ViewData } from '../../types';

interface ConnectionState {
  connected: boolean;
  isStarting: boolean;
  type: 'existing' | 'new';
  driver: 'serverless' | 'postgres';
  connectionInfo: string;
  currentlyConnectedBranch: string;
  selectedDatabase: string;
  selectedRole: string;
  port: number;
}

interface SelectionState {
  orgs: Array<{ id: string; name: string; }>;
  projects: Array<{ id: string; name: string; org_id: string; }>;
  branches: Array<{ id: string; name: string; project_id: string; parent_id: string | null; }>;
  selectedOrgId: string;
  selectedOrgName: string;
  selectedProjectId?: string;
  selectedProjectName?: string;
  selectedBranchId?: string;
  selectedBranchName?: string;
  parentBranchId?: string;
  parentBranchName?: string;
}

export interface MessageHandlerProps {
  data: ViewData;
  setConnection: (update: (prev: ConnectionState) => ConnectionState) => void;
  setSelection: (update: (prev: SelectionState) => SelectionState) => void;
  setLoading: (update: (prev: { orgs: boolean; projects: boolean; branches: boolean; }) => { orgs: boolean; projects: boolean; branches: boolean; }) => void;
  lastConnectedState: React.MutableRefObject<boolean>;
}

export const handleUpdateViewData = ({
  data,
  setConnection,
  setSelection,
  setLoading,
  lastConnectedState
}: MessageHandlerProps) => {
  // Update connection state
  setConnection((prev: ConnectionState) => ({
    ...prev,
    connected: data.connected,
    isStarting: data.isStarting,
    type: data.connectionType,
    driver: data.selectedDriver,
    connectionInfo: data.connectionInfo || prev.connectionInfo,
    currentlyConnectedBranch: data.currentlyConnectedBranch || prev.currentlyConnectedBranch,
    selectedDatabase: data.selectedDatabase || prev.selectedDatabase,
    selectedRole: data.selectedRole || prev.selectedRole,
    port: data.port || prev.port || 5432
  }));

  // Update selection state
  setSelection((prev: SelectionState) => ({
    ...prev,
    orgs: data.orgs || prev.orgs,
    projects: data.projects || prev.projects,
    branches: data.branches || prev.branches,
    selectedOrgId: data.selectedOrgId || prev.selectedOrgId,
    selectedOrgName: data.selectedOrgName || prev.selectedOrgName,
    selectedProjectId: data.selectedProjectId,
    selectedProjectName: data.selectedProjectName,
    selectedBranchId: data.selectedBranchId,
    selectedBranchName: data.selectedBranchName,
    parentBranchId: data.parentBranchId,
    parentBranchName: data.parentBranchName
  }));

  // Update last connected state
  lastConnectedState.current = data.connected;
}; 