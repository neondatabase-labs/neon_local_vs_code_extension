import React from 'react';
import { createRoot } from 'react-dom/client';
import { Provider } from 'react-redux';
import { App } from './components/App';
import { ActionsView } from './components/ActionsView';
import { DatabaseView } from './components/DatabaseView';
import { store } from './store';
import './styles.css';

// Get VS Code API using singleton pattern
declare global {
  interface Window {
    acquireVsCodeApi(): any;
    vscodeApi?: any;
    initialState?: any;
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

// Get the view type from the HTML
const viewType = document.body.dataset.viewType;

// Create the root element
const container = document.getElementById('root');
if (!container) {
  throw new Error('Root element not found');
}
const root = createRoot(container);

// Set up message handler for view data updates
window.addEventListener('message', event => {
  const message = event.data;
  if (message.command === 'updateViewData') {
    store.dispatch({ type: 'app/updateViewData', payload: message.data });
  }
});

// Render the appropriate component based on view type
const renderComponent = () => {
  const component = (() => {
    switch (viewType) {
      case 'neonLocalActions':
        return <ActionsView vscode={window.vscodeApi} />;
      case 'neonLocalDatabase':
        return <DatabaseView vscode={window.vscodeApi} />;
      default:
        return <App vscode={window.vscodeApi} initialState={window.initialState} />;
    }
  })();

  return (
    <Provider store={store}>
      {component}
    </Provider>
  );
};

// Render the component
root.render(renderComponent()); 