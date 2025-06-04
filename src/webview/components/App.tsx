import React, { useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { RootState, updateViewData, setLoading } from '../store';
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
        dispatch(setLoading(true));
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
    vscode.postMessage({
      command: 'updateConnectionType',
      connectionType: value
    });
  };

  const handleOrgChange = (value: string) => {
    console.log('App.tsx: Organization dropdown changed:', {
      newValue: value,
      availableOrgs: state.orgs,
      currentOrgs: state.orgs
    });
    dispatch(setLoading(true));
    const selectedOrg = state.orgs.find((org: NeonOrg) => org.id === value);
    vscode.postMessage({
      command: 'selectOrg',
      orgId: value,
      orgName: selectedOrg?.name
    });
  };

  const handleProjectChange = (value: string) => {
    dispatch(setLoading(true));
    const selectedProject = state.projects.find((project: NeonProject) => project.id === value);
    vscode.postMessage({
      command: 'selectProject',
      projectId: value,
      projectName: selectedProject?.name
    });
  };

  const handleBranchChange = (value: string) => {
    dispatch(setLoading(true));
    const selectedBranch = state.branches.find((branch: NeonBranch) => branch.id === value);
    vscode.postMessage({
      command: 'selectBranch',
      branchId: value,
      branchName: selectedBranch?.name
    });
  };

  const handleDriverChange = (value: 'serverless' | 'postgres') => {
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
      branchId: state.selectedBranchId,
      parentBranchId: state.connectionType === 'new' ? state.selectedBranchId : undefined
    });
  };

  const handleStopProxy = () => {
    vscode.postMessage({
      command: 'stopProxy'
    });
  };

  if (state.isLoading) {
    return <div className="loading">Loading...</div>;
  }

  // Helper function to check if dropdown should be disabled
  const isDropdownDisabled = (type: 'project' | 'branch') => {
    if (type === 'project') return !state.selectedOrgId || state.orgs.length === 0;
    if (type === 'branch') return !state.selectedProjectId || state.projects.length === 0;
    return false;
  };

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
              <div className="detail-value">{state.selectedBranchName || 'Not selected'}</div>
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

          <button className="button danger" onClick={handleStopProxy}>
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

          <div className="section">
            <label htmlFor="org">Organization</label>
            <select
              id="org"
              value={state.selectedOrgId || ''}
              onChange={(e) => {
                console.log('Organization dropdown changed:', {
                  newValue: e.target.value,
                  availableOrgs: state.orgs,
                  currentOrgs: state.orgs
                });
                handleOrgChange(e.target.value);
              }}
            >
              <option value="">Select Organization</option>
              {Array.isArray(state.orgs) && state.orgs.length > 0 ? (
                state.orgs.map((org: NeonOrg) => (
                  <option key={org.id} value={org.id}>{org.name || 'Unknown Organization'}</option>
                ))
              ) : (
                <option value="" disabled>No organizations available</option>
              )}
            </select>
          </div>

          <div className="section">
            <label htmlFor="project">Project</label>
            <select
              id="project"
              value={state.selectedProjectId || ''}
              onChange={(e) => handleProjectChange(e.target.value)}
              disabled={isDropdownDisabled('project')}
            >
              <option value="">Select Project</option>
              {state.projects && state.projects.map((project: NeonProject) => (
                <option key={project.id} value={project.id}>{project.name}</option>
              ))}
            </select>
          </div>

          {state.connectionType === 'existing' ? (
            <div className="section">
              <label htmlFor="branch">Branch</label>
              <select
                id="branch"
                value={state.selectedBranchId || ''}
                onChange={(e) => handleBranchChange(e.target.value)}
                disabled={isDropdownDisabled('branch')}
              >
                <option value="">Select Branch</option>
                {state.branches && state.branches.map((branch: NeonBranch) => (
                  <option key={branch.id} value={branch.id}>{branch.name}</option>
                ))}
              </select>
            </div>
          ) : (
            <div className="section">
              <label htmlFor="parent-branch">Parent Branch</label>
              <select
                id="parent-branch"
                value={state.selectedBranchId || ''}
                onChange={(e) => handleBranchChange(e.target.value)}
                disabled={isDropdownDisabled('branch')}
              >
                <option value="">Select Parent Branch</option>
                {state.branches && state.branches.map((branch: NeonBranch) => (
                  <option key={branch.id} value={branch.id}>{branch.name}</option>
                ))}
              </select>
            </div>
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
            className="button primary"
            onClick={handleStartProxy}
            disabled={!state.selectedBranchId}
          >
            {state.connectionType === 'existing' ? 'Connect' : 'Create'}
          </button>
        </div>
      )}
    </div>
  );
}; 