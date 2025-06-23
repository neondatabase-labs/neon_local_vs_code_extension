import React, { createContext, useContext, useEffect, useState } from 'react';
import { ViewData } from '../../types';

interface StateContextType {
  state: ViewData;
  updateState: (newState: Partial<ViewData>) => void;
}

const StateContext = createContext<StateContextType | undefined>(undefined);

export function useStateService() {
  const context = useContext(StateContext);
  if (!context) {
    throw new Error('useStateService must be used within a StateProvider');
  }
  return context;
}

interface StateProviderProps {
  children: React.ReactNode;
  vscode: any;
}

export function StateProvider({ children, vscode }: StateProviderProps) {
  const [state, setState] = useState<ViewData>({
    connection: {
      connected: false,
      isStarting: false,
      type: 'existing',
      driver: 'postgres',
      connectionInfo: '',
      currentlyConnectedBranch: '',
      selectedDatabase: '',
      selectedRole: '',
      databases: [],
      roles: [],
      selectedOrgId: '',
      selectedOrgName: '',
      selectedProjectId: undefined,
      selectedProjectName: undefined,
      selectedBranchId: undefined,
      selectedBranchName: undefined,
      parentBranchId: undefined,
      parentBranchName: undefined,
      persistentApiToken: undefined
    },
    connected: false,
    isStarting: false,
    connectionType: 'existing',
    selectedDriver: 'postgres',
    connectionInfo: '',
    selectedDatabase: '',
    selectedRole: '',
    currentlyConnectedBranch: '',
    databases: [],
    roles: [],
    orgs: [],
    projects: [],
    branches: [],
    selectedOrgId: '',
    selectedOrgName: '',
    selectedProjectId: undefined,
    selectedProjectName: undefined,
    selectedBranchId: undefined,
    selectedBranchName: undefined,
    parentBranchId: undefined,
    parentBranchName: undefined,
    loading: {
      orgs: false,
      projects: false,
      branches: false
    }
  });

  const [hasReceivedInitialData, setHasReceivedInitialData] = useState(false);

  useEffect(() => {
    const messageHandler = (event: MessageEvent) => {
      const message = event.data;
      
      switch (message.command) {
        case 'updateViewData':
          setState(prevState => ({
            ...prevState,
            ...message.data,
            connection: {
              ...prevState.connection,
              ...message.data.connection
            }
          }));
          setHasReceivedInitialData(true);
          break;
          
        case 'clearState':
          window.location.reload();
          break;
      }
    };

    window.addEventListener('message', messageHandler);
    
    // Request initial data only if we haven't received it yet
    if (!hasReceivedInitialData) {
      vscode.postMessage({
        command: 'requestInitialData'
      });
    }

    return () => {
      window.removeEventListener('message', messageHandler);
    };
  }, [vscode, hasReceivedInitialData]);

  const updateState = (newState: Partial<ViewData>) => {
    setState(prevState => ({
      ...prevState,
      ...newState,
      connection: {
        ...prevState.connection,
        ...(newState.connection || {}),
        databases: newState.databases || prevState.connection.databases || [],
        roles: newState.roles || prevState.connection.roles || []
      }
    }));
  };

  return (
    <StateContext.Provider value={{ state, updateState }}>
      {children}
    </StateContext.Provider>
  );
} 