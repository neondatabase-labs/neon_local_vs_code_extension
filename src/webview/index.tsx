import * as React from 'react';
import { Provider } from 'react-redux';
import { store } from './store';
import { App } from './components/App';
import './styles.css';
import { createRoot } from 'react-dom/client';
import { ViewData } from '../types';

// Get VS Code API using singleton pattern
declare global {
  interface Window {
    acquireVsCodeApi(): any;
    vscodeApi?: any;
  }
}

// Only acquire the API once and store it on the window object
const getVSCodeApi = () => {
  if (!window.vscodeApi) {
    window.vscodeApi = window.acquireVsCodeApi();
  }
  return window.vscodeApi;
};

// Get VS Code API instance
const vscode = getVSCodeApi();

// Initialize React app
const root = createRoot(document.getElementById('root')!);

// Get initial state from VS Code's stored state
const initialState: ViewData = vscode.getState() || {
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
  connectionInfo: ''
};

root.render(
  <Provider store={store}>
    <App vscode={vscode} initialState={initialState} />
  </Provider>
); 