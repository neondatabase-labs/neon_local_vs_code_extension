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
  isLoading: false,
  currentlyConnectedBranch: undefined,
  loadingStates: {
    orgs: false,
    projects: false,
    branches: false
  }
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
        currentState: {
          selectedOrgId: state.selectedOrgId,
          selectedProjectId: state.selectedProjectId,
          selectedBranchId: state.selectedBranchId,
          selectedBranchName: state.selectedBranchName,
          currentlyConnectedBranch: state.currentlyConnectedBranch,
          connectionType: state.connectionType
        },
        incomingData: {
          selectedOrgId: data.selectedOrgId,
          selectedProjectId: data.selectedProjectId,
          selectedBranchId: data.selectedBranchId,
          selectedBranchName: data.selectedBranchName,
          currentlyConnectedBranch: data.currentlyConnectedBranch,
          connectionType: data.connectionType
        }
      });

      // Create new state object, preserving existing values if not in new data
      const newState = {
        ...state,
        // Only update arrays if they are non-empty in the new data
        orgs: Array.isArray(data.orgs) && data.orgs.length > 0 ? data.orgs : state.orgs,
        projects: Array.isArray(data.projects) && data.projects.length > 0 ? data.projects : state.projects,
        branches: Array.isArray(data.branches) && data.branches.length > 0 ? data.branches : state.branches,
        databases: Array.isArray(data.databases) ? data.databases : state.databases,
        roles: Array.isArray(data.roles) ? data.roles : state.roles,
        connected: data.connected,
        connectionInfo: data.connectionInfo ?? state.connectionInfo,
        // Preserve selection state unless explicitly provided in new data
        selectedOrgId: data.selectedOrgId ?? state.selectedOrgId,
        selectedOrgName: data.selectedOrgName ?? state.selectedOrgName,
        selectedProjectId: data.selectedProjectId ?? state.selectedProjectId,
        selectedProjectName: data.selectedProjectName ?? state.selectedProjectName,
        // For new connections, always use currentlyConnectedBranch if available
        selectedBranchId: data.selectedBranchId ?? state.selectedBranchId,
        selectedBranchName: data.selectedBranchName ?? state.selectedBranchName,
        currentlyConnectedBranch: data.currentlyConnectedBranch ?? state.currentlyConnectedBranch,
        parentBranchId: data.parentBranchId ?? state.parentBranchId,
        parentBranchName: data.parentBranchName ?? state.parentBranchName,
        selectedDriver: data.selectedDriver ?? state.selectedDriver,
        selectedDatabase: data.selectedDatabase ?? state.selectedDatabase,
        selectedRole: data.selectedRole ?? state.selectedRole,
        isStarting: data.isStarting || false,
        loadingStates: {
          orgs: false,
          projects: Boolean(data.selectedOrgId) && (!data.projects || data.projects.length === 0),
          branches: Boolean(data.selectedProjectId) && (!data.branches || data.branches.length === 0)
        },
        isLoading: false,
        // Ensure we preserve the connection type
        connectionType: data.connectionType ?? state.connectionType
      };

      // Log the final state update
      console.log('Redux store: Final state after update:', {
        connectionType: newState.connectionType,
        selectedOrgId: newState.selectedOrgId,
        selectedProjectId: newState.selectedProjectId,
        selectedBranchId: newState.selectedBranchId,
        selectedBranchName: newState.selectedBranchName,
        currentlyConnectedBranch: newState.currentlyConnectedBranch,
        isExplicitUpdate: data.isExplicitUpdate
      });

      return newState;
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
  updateParentBranch
} = appSlice.actions; 