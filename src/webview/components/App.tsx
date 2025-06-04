import React, { useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { RootState, updateViewData, setLoading, updateConnectionType, selectBranch, updateDriver, updateParentBranch } from '../store';
import { ViewData, NeonOrg, NeonProject, NeonBranch } from '../../types';

interface AppProps {
  vscode: any;
  initialState: ViewData;
}

export const App: React.FC<AppProps> = ({ vscode, initialState }) => {
  const dispatch = useDispatch();
  const state = useSelector((state: RootState) => state);
  
  // Only show connected view if proxy is running AND we have a connection info
  const isConnected = state.connected && !!state.connectionInfo;

  // Initialize state from props
  useEffect(() => {
    if (initialState) {
      console.log('App.tsx: Initializing state with:', {
        orgsCount: initialState.orgs?.length,
        orgs: initialState.orgs,
        selectedOrgId: initialState.selectedOrgId,
        selectedOrgName: initialState.selectedOrgName
      });
      dispatch(updateViewData(initialState));
    }
  }, [dispatch, initialState]);

  // Request initial data when component mounts
  useEffect(() => {
    // Request initial data from the extension
    vscode.postMessage({
      command: 'requestInitialData'
    });
  }, [vscode]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const message = event.data;
      if (message.command === 'updateViewData') {
        console.log('App.tsx: Received view data:', {
          orgsCount: message.data.orgs?.length,
          orgs: message.data.orgs,
          selectedOrgId: message.data.selectedOrgId,
          selectedOrgName: message.data.selectedOrgName
        });
        dispatch(updateViewData(message.data));
        // Store state in VS Code's storage
        vscode.setState(message.data);
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [dispatch, vscode]);

  // Add effect to log state changes
  useEffect(() => {
    console.log('App.tsx state updated:', {
      orgsCount: state.orgs?.length,
      orgs: state.orgs,
      selectedOrgId: state.selectedOrgId,
      selectedOrgName: state.selectedOrgName
    });
  }, [state.orgs, state.selectedOrgId, state.selectedOrgName]);

  const handleConnectionTypeChange = (value: 'existing' | 'new') => {
    console.log('Changing connection type to:', value);
    
    // Update local state first
    dispatch(updateConnectionType(value));
    
    // Then notify the extension
    vscode.postMessage({
        command: 'updateConnectionType',
        connectionType: value
    });

    // Clear only the relevant branch selection when changing connection type
    if (value === 'new') {
        dispatch(selectBranch(''));
    } else {
        // Clear parent branch selection when switching to existing
        vscode.postMessage({
            command: 'selectParentBranch',
            parentBranchId: '',
            branchName: ''
        });
    }
  };

  const handleOrgChange = (value: string) => {
    console.log('App.tsx: Organization dropdown changed:', {
      newValue: value,
      availableOrgs: state.orgs,
      currentOrgs: state.orgs
    });
    dispatch(setLoading({ type: 'projects', loading: true }));
    const selectedOrg = state.orgs.find((org: NeonOrg) => org.id === value);
    vscode.postMessage({
      command: 'selectOrg',
      orgId: value,
      orgName: selectedOrg?.name
    });
  };

  const handleProjectChange = (value: string) => {
    dispatch(setLoading({ type: 'branches', loading: true }));
    const selectedProject = state.projects.find((project: NeonProject) => project.id === value);
    vscode.postMessage({
      command: 'selectProject',
      projectId: value,
      projectName: selectedProject?.name
    });
  };

  const handleBranchChange = (value: string) => {
    const selectedBranch = state.branches.find((branch: NeonBranch) => branch.id === value);
    vscode.postMessage({
      command: 'selectBranch',
      branchId: value,
      branchName: selectedBranch?.name
    });
  };

  const handleParentBranchChange = (value: string) => {
    const selectedBranch = state.branches.find((branch: NeonBranch) => branch.id === value);
    console.log('Selecting parent branch:', {
      value,
      selectedBranch,
      currentState: state
    });
    
    // Update local state first
    dispatch(updateParentBranch(value));
    
    // Then notify the extension
    vscode.postMessage({
      command: 'selectParentBranch',
      parentBranchId: value,
      branchName: selectedBranch?.name
    });
  };

  const handleDriverChange = (value: 'serverless' | 'postgres') => {
    // Update local state first
    dispatch(updateDriver(value));
    // Then notify the extension
    vscode.postMessage({
      command: 'selectDriver',
      driver: value
    });
  };

  const handleStartProxy = () => {
    vscode.postMessage({
      command: 'startProxy',
      driver: state.selectedDriver,
      isExisting: state.connectionType === 'existing',
      branchId: state.connectionType === 'existing' ? state.selectedBranchId : undefined,
      parentBranchId: state.connectionType === 'new' ? state.parentBranchId : undefined
    });
  };

  const handleStopProxy = () => {
    vscode.postMessage({
      command: 'stopProxy'
    });
  };

  // Helper function to check if dropdown should be disabled
  const isDropdownDisabled = (type: 'project' | 'branch') => {
    if (type === 'project') return !state.selectedOrgId || state.orgs.length === 0;
    if (type === 'branch') return !state.selectedProjectId || state.projects.length === 0;
    return false;
  };

  const renderDropdown = (
    id: string,
    label: string,
    value: string,
    options: Array<{ id: string; name: string }>,
    onChange: (value: string) => void,
    disabled: boolean = false,
    loading: boolean = false
  ) => (
    <div className="section">
      <label htmlFor={id}>{label}</label>
      <div className="select-container">
        <select
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled || loading}
        >
          <option value="">{loading ? 'Loading...' : `Select ${label}`}</option>
          {options.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name || 'Unknown'}
            </option>
          ))}
        </select>
        {loading && <div className="loading-spinner" />}
      </div>
    </div>
  );

  return (
    <div className="app">
      {isConnected ? (
        <>
          <div className="connection-status">
            <div className="status-indicator connected">
              <span className="status-dot"></span>
              Connected to {state.connectionType === 'new' ? 'new' : 'existing'} branch
            </div>
          </div>

          <div className="connection-details">
            <div className="detail-row">
              <div className="detail-label">Organization</div>
              <div className="detail-value">{state.selectedOrgName || 'Not selected'}</div>
            </div>
            <div className="detail-row">
              <div className="detail-label">Project</div>
              <div className="detail-value">{state.selectedProjectName || 'Not selected'}</div>
            </div>
            <div className="detail-row">
              <div className="detail-label">Branch</div>
              <div className="detail-value">
                {state.connectionType === 'new' 
                    ? (state.currentlyConnectedBranch || 'Not selected')
                    : (state.selectedBranchName || state.selectedBranchId || 'Not selected')}
              </div>
            </div>
            {state.connectionType === 'new' && (
              <div className="detail-row">
                <div className="detail-label">Parent Branch</div>
                <div className="detail-value">{state.parentBranchName || 'Not selected'}</div>
              </div>
            )}
            <div className="detail-row">
              <div className="detail-label">Driver</div>
              <div className="detail-value">
                {state.selectedDriver === 'serverless' ? 'Neon Serverless' : 'PostgreSQL'}
              </div>
            </div>
          </div>

          <button className="stop-button" onClick={handleStopProxy}>
            Disconnect
          </button>
        </>
      ) : (
        <div className="form-content">
          <div className="section">
            <label htmlFor="connection-type">Connection Type</label>
            <select
              id="connection-type"
              value={state.connectionType}
              onChange={(e) => handleConnectionTypeChange(e.target.value as 'existing' | 'new')}
            >
              <option value="existing">Connect to existing branch</option>
              <option value="new">Connect to new branch</option>
            </select>
          </div>

          {renderDropdown(
            'org',
            'Organization',
            state.selectedOrgId || '',
            state.orgs,
            handleOrgChange,
            false,
            state.loadingStates.orgs
          )}

          {renderDropdown(
            'project',
            'Project',
            state.selectedProjectId || '',
            state.projects,
            handleProjectChange,
            isDropdownDisabled('project'),
            state.loadingStates.projects
          )}

          {state.connectionType === 'new' ? (
            renderDropdown(
              'parent-branch',
              'Parent Branch',
              state.parentBranchId || '',
              state.branches,
              handleParentBranchChange,
              isDropdownDisabled('branch'),
              state.loadingStates.branches
            )
          ) : (
            renderDropdown(
              'branch',
              'Branch',
              state.selectedBranchId || '',
              state.branches,
              handleBranchChange,
              isDropdownDisabled('branch'),
              state.loadingStates.branches
            )
          )}

          <div className="section">
            <label htmlFor="driver">Driver</label>
            <select
              id="driver"
              value={state.selectedDriver}
              onChange={(e) => handleDriverChange(e.target.value as 'serverless' | 'postgres')}
            >
              <option value="postgres">PostgreSQL</option>
              <option value="serverless">Neon Serverless</option>
            </select>
          </div>

          <button
            onClick={handleStartProxy}
            disabled={state.connectionType === 'existing' ? !state.selectedBranchId : !state.parentBranchId}
          >
            {state.connectionType === 'existing' ? 'Connect' : 'Create'}
          </button>
        </div>
      )}
    </div>
  );
}; 