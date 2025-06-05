import { NeonOrg, NeonProject } from '../../types';

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

export const handleOrgSelect = (
  orgId: string,
  orgs: NeonOrg[],
  setSelection: (update: (prev: SelectionState) => SelectionState) => void,
  setLoading: (update: (prev: { orgs: boolean; projects: boolean; branches: boolean; }) => { orgs: boolean; projects: boolean; branches: boolean; }) => void,
  vscode: any
) => {
  setLoading(prev => ({ ...prev, projects: true }));
  const selectedOrg = orgs.find((org: NeonOrg) => org.id === orgId);
  if (selectedOrg) {
    // Update local state
    setSelection(prev => ({
      ...prev,
      selectedOrgId: selectedOrg.id,
      selectedOrgName: selectedOrg.name,
      projects: [],
      branches: [],
      selectedProjectId: undefined,
      selectedProjectName: undefined,
      selectedBranchId: undefined,
      selectedBranchName: undefined,
      parentBranchId: undefined,
      parentBranchName: undefined
    }));
    // Notify the extension
    vscode.postMessage({
      command: 'selectOrg',
      orgId,
      orgName: selectedOrg.name
    });
  }
};

export const handleProjectSelect = (
  projectId: string,
  projects: NeonProject[],
  selectedOrgId: string,
  setSelection: (update: (prev: SelectionState) => SelectionState) => void,
  setLoading: (update: (prev: { orgs: boolean; projects: boolean; branches: boolean; }) => { orgs: boolean; projects: boolean; branches: boolean; }) => void,
  vscode: any
) => {
  setLoading(prev => ({ ...prev, branches: true }));
  const selectedProject = projects.find(project => project.id === projectId);
  if (selectedProject) {
    setSelection(prev => ({
      ...prev,
      selectedProjectId: selectedProject.id,
      selectedProjectName: selectedProject.name,
      branches: [],
      selectedBranchId: undefined,
      selectedBranchName: undefined,
      parentBranchId: undefined,
      parentBranchName: undefined
    }));
    vscode.postMessage({
      command: 'selectProject',
      projectId,
      projectName: selectedProject.name
    });
  }
};

export const handleBranchSelect = (
  branchId: string,
  connectionType: 'existing' | 'new',
  driver: string,
  selectedProjectId: string,
  setSelection: (update: (prev: SelectionState) => SelectionState) => void,
  vscode: any
) => {
  if (connectionType === 'existing') {
    setSelection(prev => ({
      ...prev,
      selectedBranchId: branchId,
      selectedBranchName: undefined // Name will be updated when we get the updateViewData message
    }));
    vscode.postMessage({
      command: 'selectBranch',
      branchId,
      restartProxy: false,
      driver
    });
  } else {
    setSelection(prev => ({
      ...prev,
      parentBranchId: branchId,
      parentBranchName: undefined // Name will be updated when we get the updateViewData message
    }));
    vscode.postMessage({
      command: 'selectParentBranch',
      parentBranchId: branchId
    });
  }
}; 