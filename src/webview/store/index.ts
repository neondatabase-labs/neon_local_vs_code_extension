import { configureStore, createSlice, PayloadAction } from '@reduxjs/toolkit';
import { ViewData, NeonOrg, NeonProject, NeonBranch } from '../../types';

interface AppState extends ViewData {
  isLoading: boolean;
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
  isLoading: false
};

const appSlice = createSlice({
  name: 'app',
  initialState,
  reducers: {
    updateViewData: (state, action: PayloadAction<ViewData>) => {
      const data = action.payload;
      console.log('Redux store: Updating view data:', {
        orgsCount: data.orgs?.length,
        orgs: data.orgs,
        selectedOrgId: data.selectedOrgId,
        selectedOrgName: data.selectedOrgName,
        connectionType: data.connectionType,
        connected: data.connected,
        isStarting: data.isStarting
      });

      // Ensure arrays are initialized and properly typed
      const orgs = Array.isArray(data.orgs) ? data.orgs : [];
      const projects = Array.isArray(data.projects) ? data.projects : [];
      const branches = Array.isArray(data.branches) ? data.branches : [];
      
      // Use the proxy running state directly from the backend
      const isConnected = data.connected;
      
      // Reset dependent fields when parent selection changes
      let updatedData = { ...data };
      if (data.selectedOrgId !== state.selectedOrgId) {
        console.log('Redux store: Organization selection changed:', {
          from: state.selectedOrgId,
          to: data.selectedOrgId,
          orgsAvailable: orgs.length,
          orgs: orgs
        });
        updatedData = {
          ...updatedData,
          selectedProjectId: '',
          selectedProjectName: '',
          selectedBranchId: '',
          selectedBranchName: '',
          projects: [],
          branches: [],
          orgs: orgs // Preserve the organizations array
        };
      }
      
      if (data.selectedProjectId !== state.selectedProjectId) {
        updatedData = {
          ...updatedData,
          selectedBranchId: '',
          selectedBranchName: '',
          branches: []
        };
      }

      // Preserve connectionType if not explicitly set in the update
      const connectionType = data.connectionType !== undefined ? data.connectionType : state.connectionType;

      // Preserve connection info if not explicitly changed
      const connectionInfo = data.connectionInfo !== undefined ? data.connectionInfo : state.connectionInfo;

      const newState = {
        ...state,
        ...updatedData,
        orgs, // Always ensure orgs is preserved
        projects,
        branches,
        connected: isConnected,
        isLoading: false,
        connectionType, // Ensure connectionType is always set
        connectionInfo // Preserve connection info
      };

      console.log('Redux store: Final state:', {
        orgsCount: newState.orgs.length,
        orgs: newState.orgs,
        selectedOrgId: newState.selectedOrgId,
        selectedOrgName: newState.selectedOrgName,
        connectionType: newState.connectionType,
        connected: newState.connected,
        connectionInfo: newState.connectionInfo
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
      console.log('Updating connection type:', action.payload);
      state.connectionType = action.payload;
      state.selectedBranchId = '';
    },
    updateDriver: (state, action: PayloadAction<'serverless' | 'postgres'>) => {
      console.log('Updating driver:', action.payload);
      state.selectedDriver = action.payload;
    },
    setLoading: (state, action: PayloadAction<boolean>) => {
      state.isLoading = action.payload;
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
  setLoading
} = appSlice.actions; 