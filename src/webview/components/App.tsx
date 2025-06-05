import React, { useEffect, useRef } from 'react';
import { ViewData, NeonOrg, NeonProject, NeonBranch } from '../../types';
import { useStateService } from '../context/StateContext';

interface MainAppProps {
  vscode: any;
}

export const MainApp: React.FC<MainAppProps> = ({ vscode }) => {
  const { state, updateState } = useStateService();
  const lastConnectedState = useRef<boolean>(false);
  const messageHandlerRef = useRef<((event: MessageEvent) => void) | null>(null);
  
  // Only show connected view if proxy is running AND we have a connection info
  // Add a small delay before showing disconnected state to prevent flicker
  const isConnected = state.connection.connected || (lastConnectedState.current && state.connection.isStarting);

  // Update lastConnectedState when connection state changes
  useEffect(() => {
    lastConnectedState.current = state.connection.connected;
    console.log('Connection state changed:', {
      connected: state.connection.connected,
      isStarting: state.connection.isStarting,
      lastConnectedState: lastConnectedState.current,
      isConnected
    });
  }, [state.connection.connected, state.connection.isStarting]);

  // Handle messages from the extension
  useEffect(() => {
    if (!messageHandlerRef.current) {
      console.log('Setting up message handler');
      messageHandlerRef.current = (event: MessageEvent) => {
        const message = event.data;
        console.log('Received message from extension:', message);
        
        switch (message.command) {
          case 'updateViewData':
            console.log('Handling updateViewData:', message.data);
            updateState(message.data);
            break;
            
          case 'clearState':
            console.log('Clearing state');
            window.location.reload();
            break;
        }
      };
      
      window.addEventListener('message', messageHandlerRef.current);
      
      // Request initial data from the extension
      console.log('Requesting initial data from extension');
      vscode.postMessage({
        command: 'requestInitialData'
      });
    }
    
    return () => {
      if (messageHandlerRef.current) {
        window.removeEventListener('message', messageHandlerRef.current);
      }
    };
  }, [vscode, updateState]);

  const handleConnectionTypeChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const type = event.target.value as 'existing' | 'new';
    updateState({ connection: { ...state.connection, type } });
    vscode.postMessage({
      command: 'updateConnectionType',
      connectionType: type
    });
  };

  const handleOrgSelection = (event: React.ChangeEvent<HTMLSelectElement>) => {
    console.log('Organization selection changed:', event.target.value);
    const orgId = event.target.value;
    const selectedOrg = state.orgs.find(org => org.id === orgId);
    console.log('Found org:', selectedOrg);
    
    // Always update state and notify extension, even for personal account (empty string ID)
    updateState({
      connection: {
        ...state.connection,
        selectedOrgId: orgId,
        selectedOrgName: selectedOrg?.name || 'Personal account'
      },
      projects: [],
      branches: [],  // Clear branches
      selectedProjectId: undefined,
      selectedProjectName: undefined,
      selectedBranchId: undefined,
      selectedBranchName: undefined,
      parentBranchId: undefined,
      parentBranchName: undefined,
      loading: {
        ...state.loading,
        projects: true,
        branches: false  // Reset branches loading state
      }
    });
    
    console.log('Sending message to extension:', {
      command: 'selectOrg',
      orgId,
      orgName: selectedOrg?.name || 'Personal account'
    });
    vscode.postMessage({
      command: 'selectOrg',
      orgId,
      orgName: selectedOrg?.name || 'Personal account'
    });
  };

  const handleProjectSelection = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const projectId = event.target.value;
    
    // Clear branches and reset state when no project is selected
    if (!projectId) {
      updateState({
        connection: {
          ...state.connection,
          selectedProjectId: undefined,
          selectedProjectName: undefined
        },
        branches: [],
        selectedBranchId: undefined,
        selectedBranchName: undefined,
        parentBranchId: undefined,
        parentBranchName: undefined,
        loading: {
          ...state.loading,
          branches: false
        }
      });
      return;
    }

    const selectedProject = state.projects.find(project => project.id === projectId);
    
    if (selectedProject) {
      updateState({
        connection: {
          ...state.connection,
          selectedProjectId: selectedProject.id,
          selectedProjectName: selectedProject.name
        },
        branches: [],
        selectedBranchId: undefined,
        selectedBranchName: undefined,
        parentBranchId: undefined,
        parentBranchName: undefined,
        loading: {
          ...state.loading,
          branches: true
        }
      });
      
      vscode.postMessage({
        command: 'selectProject',
        projectId: selectedProject.id,
        projectName: selectedProject.name
      });
    }
  };

  const handleBranchSelection = (event: React.ChangeEvent<HTMLSelectElement>) => {
    if (!state.connection.selectedProjectId) {
      return;
    }

    const branchId = event.target.value;
    const selectedBranch = state.branches.find(branch => branch.id === branchId);
    
    if (selectedBranch) {
      if (state.connection.type === 'existing') {
        updateState({
          connection: {
            ...state.connection,
            selectedBranchId: selectedBranch.id,
            selectedBranchName: selectedBranch.name
          }
        });
      } else {
        updateState({
          connection: {
            ...state.connection,
            parentBranchId: selectedBranch.id,
            parentBranchName: selectedBranch.name
          }
        });
      }
      
      vscode.postMessage({
        command: 'selectBranch',
        branchId: selectedBranch.id,
        branchName: selectedBranch.name,
        restartProxy: false
      });
    }
  };

  const handleDriverSelect = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const driver = event.target.value as 'serverless' | 'postgres';
    updateState({ connection: { ...state.connection, driver } });
    vscode.postMessage({
      command: 'selectBranch',
      branchId: state.connection.selectedBranchId,
      restartProxy: false,
      driver
    });
  };

  const handleStartProxy = () => {
    vscode.postMessage({
      command: 'startProxy',
      driver: state.connection.driver,
      isExisting: state.connection.type === 'existing',
      branchId: state.connection.selectedBranchId,
      branchName: state.connection.selectedBranchName,
      parentBranchId: state.connection.parentBranchId,
      parentBranchName: state.connection.parentBranchName,
      orgId: state.connection.selectedOrgId,
      orgName: state.connection.selectedOrgName,
      projectId: state.connection.selectedProjectId,
      projectName: state.connection.selectedProjectName
    });
  };

  const handleStopProxy = () => {
    vscode.postMessage({
      command: 'stopProxy'
    });
  };

  console.log('state', state.connection);
  return (
    <div className="app">
      {isConnected ? (
        <>
          <div className="connection-status">
            <div className="status-indicator connected">
              <span className="status-dot"></span>
              Connected to {state.connection.type === 'new' ? 'new' : 'existing'} branch
            </div>
          </div>

          <div className="connection-details">
            <div className="detail-row">
              <div className="detail-label">Organization</div>
              <div className="detail-value">{state.connection.selectedOrgName || 'Loading...'}</div>
            </div>
            <div className="detail-row">
              <div className="detail-label">Project</div>
              <div className="detail-value">{state.connection.selectedProjectName || 'Loading...'}</div>
            </div>
            <div className="detail-row">
              <div className="detail-label">Branch</div>
              <div className="detail-value">
                {state.connection.type === 'new' 
                  ? (state.connection.currentlyConnectedBranch || 'Not selected')
                  : (state.connection.selectedBranchName || state.connection.selectedBranchId || 'Not selected')}
              </div>
            </div>
            {state.connection.type === 'new' && (
              <div className="detail-row">
                <div className="detail-label">Parent Branch</div>
                <div className="detail-value">{state.connection.parentBranchName || state.connection.parentBranchId || 'Not selected'}</div>
              </div>
            )}
            <div className="detail-row">
              <div className="detail-label">Driver</div>
              <div className="detail-value">{state.connection.driver === 'serverless' ? 'Neon Serverless' : 'PostgreSQL'}</div>
            </div>
          </div>

          <div className="section proxy-buttons">
            <button onClick={handleStopProxy} className="stop-button">Disconnect</button>
          </div>
        </>
      ) : (
        <>
          <div className="form-content">
            <div className="section">
              <label htmlFor="connection-type">Connection Type</label>
              <select
                id="connection-type"
                value={state.connection.type}
                onChange={handleConnectionTypeChange}
              >
                <option value="existing">Connect to existing branch</option>
                <option value="new">Connect to new branch</option>
              </select>
            </div>

            <div className="section">
              <label htmlFor="org">Organization</label>
              <select
                id="org"
                value={state.connection.selectedOrgId ?? ''}
                onChange={handleOrgSelection}
              >
                {state.orgs.map((org) => (
                  <option key={org.id} value={org.id}>
                    {org.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="section">
              <label htmlFor="project">Project</label>
              <select
                id="project"
                value={state.connection.selectedProjectId}
                onChange={handleProjectSelection}
                disabled={state.connection.selectedOrgId === undefined}
              >
                <option value="">Select Project</option>
                {state.projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </div>

            {state.connection.type === 'existing' ? (
              <div className="section">
                <label htmlFor="branch">Branch</label>
                <select
                  id="branch"
                  value={state.connection.selectedBranchId}
                  onChange={handleBranchSelection}
                  disabled={!state.connection.selectedProjectId}
                >
                  <option value="">Select Branch</option>
                  {state.branches.map((branch) => (
                    <option key={branch.id} value={branch.id}>
                      {branch.name}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <div className="section">
                <label htmlFor="parent-branch">Parent Branch</label>
                <select
                  id="parent-branch"
                  value={state.connection.parentBranchId}
                  onChange={handleBranchSelection}
                  disabled={!state.connection.selectedProjectId}
                >
                  <option value="">Select Parent Branch</option>
                  {state.branches.map((branch) => (
                    <option key={branch.id} value={branch.id}>
                      {branch.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="section">
              <label htmlFor="driver">Driver</label>
              <select
                id="driver"
                value={state.connection.driver}
                onChange={handleDriverSelect}
              >
                <option value="serverless">Neon Serverless</option>
                <option value="postgres">PostgreSQL</option>
              </select>
            </div>

            <div className="section proxy-buttons">
              <button
                onClick={handleStartProxy}
                disabled={!state.connection.selectedProjectId || (!state.connection.selectedBranchId && !state.connection.parentBranchId)}
                className="start-button"
              >
                Connect
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}; 