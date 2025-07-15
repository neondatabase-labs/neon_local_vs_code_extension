import React, { createContext, useContext, useEffect, useState, useRef, useCallback } from 'react';
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
      persistentApiToken: undefined,
      port: 5432
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
    port: 5432,
    loading: {
      orgs: false,
      projects: false,
      branches: false
    }
  });

  const [hasReceivedInitialData, setHasReceivedInitialData] = useState(false);
  const messageHandlerRef = useRef<((event: MessageEvent) => void) | null>(null);
  const isInitializedRef = useRef(false);
  const lastStateUpdateRef = useRef<number>(0);

  // Create a stable message handler using useCallback
  const messageHandler = useCallback((event: MessageEvent) => {
    const message = event.data;
    const timestamp = Date.now();
    
    console.log('StateContext: Received message from extension:', {
      command: message.command,
      timestamp: new Date(timestamp).toISOString(),
      timeSinceLastUpdate: timestamp - lastStateUpdateRef.current
    });
    
    switch (message.command) {
      case 'updateViewData':
        console.log('StateContext: Processing updateViewData message:', {
          connected: message.data?.connected,
          isStarting: message.data?.isStarting,
          connectionType: message.data?.connectionType,
          hasConnectionData: !!message.data?.connection,
          databaseCount: message.data?.databases?.length || 0,
          roleCount: message.data?.roles?.length || 0
        });
        
        setState(prevState => {
          const newState = {
            ...prevState,
            ...message.data,
            connection: {
              ...prevState.connection,
              ...message.data.connection
            }
          };
          
          console.log('StateContext: State updated:', {
            previousConnected: prevState.connected,
            newConnected: newState.connected,
            previousIsStarting: prevState.isStarting,
            newIsStarting: newState.isStarting,
            stateChanged: JSON.stringify(prevState) !== JSON.stringify(newState)
          });
          
          return newState;
        });
        
        setHasReceivedInitialData(true);
        lastStateUpdateRef.current = timestamp;
        break;
        
      case 'clearState':
        console.log('StateContext: Processing clearState message - reloading window');
        window.location.reload();
        break;
        
      default:
        console.log('StateContext: Received unknown message command:', message.command);
    }
  }, []);

  // Set up message event listener with proper cleanup
  useEffect(() => {
    console.log('StateContext: Setting up message event listener');
    
    if (messageHandlerRef.current) {
      console.log('StateContext: Removing existing message handler');
      window.removeEventListener('message', messageHandlerRef.current);
    }
    
    messageHandlerRef.current = messageHandler;
    window.addEventListener('message', messageHandler);
    
    console.log('StateContext: Message event listener attached');
    
    return () => {
      console.log('StateContext: Cleaning up message event listener');
      if (messageHandlerRef.current) {
        window.removeEventListener('message', messageHandlerRef.current);
        messageHandlerRef.current = null;
      }
    };
  }, [messageHandler]);

  // Handle initial data request
  useEffect(() => {
    if (!hasReceivedInitialData && !isInitializedRef.current) {
      console.log('StateContext: Requesting initial data from extension');
      isInitializedRef.current = true;
      
      try {
        vscode.postMessage({
          command: 'requestInitialData'
        });
        console.log('StateContext: Initial data request sent');
      } catch (error) {
        console.error('StateContext: Error requesting initial data:', error);
      }
    }
  }, [vscode, hasReceivedInitialData]);

  // Log when component mounts/unmounts
  useEffect(() => {
    console.log('StateContext: StateProvider mounted');
    
    return () => {
      console.log('StateContext: StateProvider unmounting');
    };
  }, []);

  // Create a stable updateState function
  const updateState = useCallback((newState: Partial<ViewData>) => {
    console.log('StateContext: Local state update requested:', {
      hasConnectionUpdate: !!newState.connection,
      connected: newState.connected,
      isStarting: newState.isStarting,
      updateKeys: Object.keys(newState)
    });
    
    setState(prevState => {
      const updatedState = {
        ...prevState,
        ...newState,
        connection: {
          ...prevState.connection,
          ...(newState.connection || {}),
          databases: newState.databases || prevState.connection.databases || [],
          roles: newState.roles || prevState.connection.roles || []
        }
      };
      
      console.log('StateContext: Local state updated:', {
        stateChanged: JSON.stringify(prevState) !== JSON.stringify(updatedState),
        connected: updatedState.connected,
        isStarting: updatedState.isStarting
      });
      
      return updatedState;
    });
  }, []);

  // Log state changes for debugging
  useEffect(() => {
    console.log('StateContext: State changed:', {
      connected: state.connected,
      isStarting: state.isStarting,
      connectionType: state.connectionType,
      hasConnectionInfo: !!state.connectionInfo,
      databaseCount: state.databases?.length || 0,
      timestamp: new Date().toISOString()
    });
  }, [state.connected, state.isStarting, state.connectionType, state.connectionInfo, state.databases?.length]);

  return (
    <StateContext.Provider value={{ state, updateState }}>
      {children}
    </StateContext.Provider>
  );
} 