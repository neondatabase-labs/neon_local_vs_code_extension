import { configureStore, createSlice, PayloadAction } from '@reduxjs/toolkit';
import { ViewData, NeonOrg, NeonProject, NeonBranch } from '../../types';

interface AppState extends ViewData {
  isLoading: boolean;
  loadingStates: {
    orgs: boolean;
    projects: boolean;
    branches: boolean;
  };
  currentlyConnectedBranch?: string;
  displayConnectionInfo?: string;
}

const initialState: AppState = {
  orgs: [],
  projects: [],
  branches: [],
  databases: [],
  roles: [],
  selectedOrgId: '',
  selectedOrgName: '',
  selectedProjectId: '',
  selectedProjectName: '',
  selectedBranchId: '',
  selectedBranchName: '',
  parentBranchId: '',
  parentBranchName: '',
  selectedDriver: 'postgres',
  selectedDatabase: '',
  selectedRole: '',
  connected: false,
  isStarting: false,
  connectionType: 'existing',
  connectionInfo: '',
  displayConnectionInfo: '',
  isLoading: false,
  currentlyConnectedBranch: undefined,
  loadingStates: {
    orgs: false,
    projects: false,
    branches: false
  }
};

// Helper function to create display connection string
const createDisplayConnectionString = (connectionInfo: string, selectedDatabase: string) => {
  if (!connectionInfo) return '';
  
  // Extract the database name and query parameters from the connection string
  const dbNameMatch = connectionInfo.match(/\/([^/?]+)\?/);
  const queryParams = connectionInfo.split('?')[1] || '';
  
  if (!dbNameMatch) return connectionInfo;
  
  // Create a new connection string with hardcoded credentials
  return `postgresql://neon:npg@localhost:5432/${selectedDatabase}?${queryParams}`;
};

const appSlice = createSlice({
  name: 'app',
  initialState,
  reducers: {
    updateViewData: (state, action: PayloadAction<ViewData>) => {
      const data = action.payload;
      console.log('Redux store: Processing view data update:', {
        currentConnectionType: state.connectionType,
        incomingConnectionType: data.connectionType,
        isExplicitUpdate: data.isExplicitUpdate,
        connected: data.connected,
        isStarting: data.isStarting,
        databases: data.databases?.length,
        roles: data.roles?.length,
        currentState: {
          selectedOrgId: state.selectedOrgId,
          selectedProjectId: state.selectedProjectId,
          selectedBranchId: state.selectedBranchId,
          selectedBranchName: state.selectedBranchName,
          selectedDatabase: state.selectedDatabase,
          selectedRole: state.selectedRole,
          connectionType: state.connectionType
        },
        incomingData: {
          selectedOrgId: data.selectedOrgId,
          selectedProjectId: data.selectedProjectId,
          selectedBranchId: data.selectedBranchId,
          selectedBranchName: data.selectedBranchName,
          selectedDatabase: data.selectedDatabase,
          selectedRole: data.selectedRole,
          connectionType: data.connectionType
        }
      });

      // Update all state properties from the incoming data
      Object.assign(state, {
        ...data,
        isLoading: false, // Always reset loading state on update
        loadingStates: {
          ...state.loadingStates,
          orgs: false,
          projects: false,
          branches: false
        }
      });

      // Create display connection string if we have a real connection string
      if (data.connectionInfo && data.selectedDatabase) {
        state.displayConnectionInfo = createDisplayConnectionString(data.connectionInfo, data.selectedDatabase);
      } else {
        state.displayConnectionInfo = '';
      }

      console.log('Redux store: Final state after update:', {
        connected: state.connected,
        isStarting: state.isStarting,
        databases: state.databases?.length,
        roles: state.roles?.length,
        selectedDatabase: state.selectedDatabase,
        selectedRole: state.selectedRole,
        connectionType: state.connectionType,
        hasConnectionInfo: Boolean(state.connectionInfo),
        hasDisplayConnectionInfo: Boolean(state.displayConnectionInfo)
      });
    },
    selectOrg: (state, action: PayloadAction<string>) => {
      console.log('Selecting organization:', action.payload);
      state.selectedOrgId = action.payload;
      state.selectedProjectId = '';
      state.selectedBranchId = '';
      state.projects = [];
      state.branches = [];
    },
    selectProject: (state, action: PayloadAction<string>) => {
      console.log('Selecting project:', action.payload);
      state.selectedProjectId = action.payload;
      state.selectedBranchId = '';
      state.branches = [];
    },
    selectBranch: (state, action: PayloadAction<string>) => {
      console.log('Selecting branch:', action.payload);
      state.selectedBranchId = action.payload;
    },
    updateConnectionType: (state, action: PayloadAction<'existing' | 'new'>) => {
      console.log('Redux store: Updating connection type:', {
        from: state.connectionType,
        to: action.payload
      });
      
      // Store current values
      const currentBranchId = state.selectedBranchId;
      const currentBranchName = state.selectedBranchName;
      const currentParentBranchId = state.parentBranchId;
      const currentParentBranchName = state.parentBranchName;
      
      // Update connection type
      state.connectionType = action.payload;
      
      // Preserve appropriate branch information based on new connection type
      if (action.payload === 'new') {
        state.parentBranchId = currentParentBranchId || currentBranchId || '';
        state.parentBranchName = currentParentBranchName || currentBranchName || '';
        state.selectedBranchId = '';
        state.selectedBranchName = '';
      } else {
        state.selectedBranchId = currentBranchId || currentParentBranchId || '';
        state.selectedBranchName = currentBranchName || currentParentBranchName || '';
        state.parentBranchId = '';
        state.parentBranchName = '';
      }
    },
    updateDriver: (state, action: PayloadAction<'serverless' | 'postgres'>) => {
      console.log('Updating driver:', action.payload);
      state.selectedDriver = action.payload;
    },
    setLoading: (state, action: PayloadAction<{ type: 'orgs' | 'projects' | 'branches'; loading: boolean }>) => {
      state.loadingStates[action.payload.type] = action.payload.loading;
    },
    updateParentBranch: (state, action: PayloadAction<string>) => {
      state.parentBranchId = action.payload;
    },
    selectDatabase: (state, action: PayloadAction<string>) => {
      console.log('Selecting database:', action.payload);
      state.selectedDatabase = action.payload;
    },
    selectRole: (state, action: PayloadAction<string>) => {
      console.log('Selecting role:', action.payload);
      state.selectedRole = action.payload;
    }
  }
});

export const store = configureStore({
  reducer: appSlice.reducer
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;

export const {
  updateViewData,
  selectOrg,
  selectProject,
  selectBranch,
  updateConnectionType,
  updateDriver,
  setLoading,
  updateParentBranch,
  selectDatabase,
  selectRole
} = appSlice.actions; 