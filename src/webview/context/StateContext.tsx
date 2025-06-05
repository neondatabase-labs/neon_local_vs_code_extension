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
      parentBranchName: undefined
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
          break;
          
        case 'clearState':
          window.location.reload();
          break;
      }
    };

    window.addEventListener('message', messageHandler);
    
    // Request initial data
    vscode.postMessage({
      command: 'requestInitialData'
    });

    return () => {
      window.removeEventListener('message', messageHandler);
    };
  }, [vscode]);

  const updateState = (newState: Partial<ViewData>) => {
    setState(prevState => ({
      ...prevState,
      ...newState,
      connection: {
        ...prevState.connection,
        ...(newState.connection || {})
      }
    }));
  };

  return (
    <StateContext.Provider value={{ state, updateState }}>
      {children}
    </StateContext.Provider>
  );
} 