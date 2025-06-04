import { ViewData, NeonOrg, NeonProject, NeonBranch } from '../../types';

interface UIState {
    organizations: NeonOrg[];
    projects: NeonProject[];
    branches: NeonBranch[];
    selectedOrgId: string;
    selectedOrgName: string;
    selectedProjectId: string;
    selectedProjectName: string;
    selectedBranchId: string;
    selectedBranchName: string;
    parentBranchId: string;
    parentBranchName: string;
    selectedDriver: string;
    connected: boolean;
    connectionType: 'existing' | 'new';
}

export class ViewState {
    private vscode: any;
    private state: UIState;
    private listeners: Array<(state: UIState) => void>;

    constructor(vscode: any) {
        this.vscode = vscode;
        this.listeners = [];
        
        // Initialize with stored state or defaults
        const storedState = this.vscode.getState();
        this.state = {
            organizations: [],
            projects: [],
            branches: [],
            selectedOrgId: '',
            selectedOrgName: '',
            selectedProjectId: '',
            selectedProjectName: '',
            selectedBranchId: '',
            selectedBranchName: '',
            parentBranchId: '',
            parentBranchName: '',
            selectedDriver: 'postgres',
            connected: false,
            connectionType: 'existing',
            ...storedState
        };
    }

    private setState(updates: Partial<UIState>) {
        const newState = {
            ...this.state,
            ...updates
        };

        // Only update if something actually changed
        if (JSON.stringify(newState) !== JSON.stringify(this.state)) {
            this.state = newState;
            this.vscode.setState(this.state);
            this.notifyListeners();
        }
    }

    private notifyListeners() {
        this.listeners.forEach(listener => listener(this.state));
    }

    public subscribe(listener: (state: UIState) => void) {
        this.listeners.push(listener);
        // Immediately notify with current state
        listener(this.state);
        
        // Return unsubscribe function
        return () => {
            const index = this.listeners.indexOf(listener);
            if (index > -1) {
                this.listeners.splice(index, 1);
            }
        };
    }

    public processViewData(viewData: ViewData) {
        console.log('Processing view data update:', viewData);
        
        // Find org and project from lists if not already in viewData
        const selectedOrg = viewData.orgs?.find(org => org.id === (viewData.selectedOrgId || this.state.selectedOrgId));
        const selectedProject = viewData.projects?.find(project => project.id === (viewData.selectedProjectId || this.state.selectedProjectId));
        
        // Prepare updates while preserving existing values if not in new data
        const updates: Partial<UIState> = {
            // Preserve arrays if they exist in viewData, otherwise keep current state
            organizations: viewData.orgs || this.state.organizations,
            projects: viewData.projects || this.state.projects,
            branches: viewData.branches || this.state.branches,
            connected: viewData.connected,
            connectionType: viewData.isExplicitUpdate ? viewData.connectionType : this.state.connectionType,
            
            // Preserve IDs and names, using new data if available, otherwise keep current state
            selectedOrgId: viewData.selectedOrgId || this.state.selectedOrgId,
            selectedOrgName: selectedOrg?.name || viewData.selectedOrgName || this.state.selectedOrgName,
            selectedProjectId: viewData.selectedProjectId || this.state.selectedProjectId,
            selectedProjectName: selectedProject?.name || viewData.selectedProjectName || this.state.selectedProjectName,
            
            // For branch selection, use the provided branch info when connected
            selectedBranchId: viewData.connected ? viewData.selectedBranchId : (viewData.selectedBranchId || this.state.selectedBranchId),
            selectedBranchName: viewData.connected ? viewData.selectedBranchName : (viewData.selectedBranchName || this.state.selectedBranchName),
            
            // Always preserve parent branch info unless explicitly cleared
            parentBranchId: viewData.parentBranchId !== undefined ? viewData.parentBranchId : this.state.parentBranchId,
            parentBranchName: viewData.parentBranchName !== undefined ? viewData.parentBranchName : this.state.parentBranchName,
            
            selectedDriver: viewData.selectedDriver || this.state.selectedDriver
        };

        // Only update state if something has actually changed
        const hasChanges = Object.entries(updates).some(([key, value]) => {
            if (Array.isArray(value)) {
                return JSON.stringify(value) !== JSON.stringify(this.state[key as keyof UIState]);
            }
            return value !== this.state[key as keyof UIState];
        });

        if (hasChanges) {
            this.setState(updates);
        }
    }

    public clearState() {
        // Preserve only connection type
        const connectionType = this.state.connectionType;
        
        this.setState({
            organizations: [],
            projects: [],
            branches: [],
            selectedOrgId: '',
            selectedOrgName: '',
            selectedProjectId: '',
            selectedProjectName: '',
            selectedBranchId: '',
            selectedBranchName: '',
            parentBranchId: '',
            parentBranchName: '',
            selectedDriver: 'postgres',
            connected: false,
            connectionType
        });
    }

    public updateConnectionType(type: 'existing' | 'new') {
        console.log('ViewState: Updating connection type:', {
            from: this.state.connectionType,
            to: type,
            currentState: {
                selectedBranchId: this.state.selectedBranchId,
                selectedBranchName: this.state.selectedBranchName,
                parentBranchId: this.state.parentBranchId,
                parentBranchName: this.state.parentBranchName
            }
        });

        const updates: Partial<UIState> = {
            connectionType: type
        };

        // When switching to new, preserve branch info as parent branch
        if (type === 'new') {
            updates.parentBranchId = this.state.parentBranchId || this.state.selectedBranchId || '';
            updates.parentBranchName = this.state.parentBranchName || this.state.selectedBranchName || '';
            updates.selectedBranchId = '';
            updates.selectedBranchName = '';
        } else {
            // When switching to existing, preserve parent branch info as selected branch
            updates.selectedBranchId = this.state.selectedBranchId || this.state.parentBranchId || '';
            updates.selectedBranchName = this.state.selectedBranchName || this.state.parentBranchName || '';
            updates.parentBranchId = '';
            updates.parentBranchName = '';
        }

        this.setState(updates);

        console.log('ViewState: Connection type updated:', {
            newType: type,
            updates,
            newState: this.state
        });
    }

    public selectOrg(orgId: string) {
        const org = this.state.organizations.find(o => o.id === orgId);
        this.setState({
            selectedOrgId: orgId,
            selectedOrgName: org?.name || '',
            // Clear dependent selections
            selectedProjectId: '',
            selectedProjectName: '',
            selectedBranchId: '',
            selectedBranchName: '',
            parentBranchId: '',
            parentBranchName: ''
        });
    }

    public selectProject(projectId: string) {
        const project = this.state.projects.find(p => p.id === projectId);
        this.setState({
            selectedProjectId: projectId,
            selectedProjectName: project?.name || '',
            // Clear dependent selections
            selectedBranchId: '',
            selectedBranchName: '',
            parentBranchId: '',
            parentBranchName: ''
        });
    }

    public selectBranch(branchId: string) {
        const branch = this.state.branches.find(b => b.id === branchId);
        if (this.state.connectionType === 'existing') {
            this.setState({
                selectedBranchId: branchId,
                selectedBranchName: branch?.name || ''
            });
        } else {
            this.setState({
                parentBranchId: branchId,
                parentBranchName: branch?.name || ''
            });
        }
    }

    public selectDriver(driver: string) {
        this.setState({ selectedDriver: driver });
    }

    public getState(): UIState {
        return { ...this.state };
    }
} 