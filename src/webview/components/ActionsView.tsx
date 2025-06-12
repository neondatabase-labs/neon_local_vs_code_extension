import React from 'react';
import { useStateService } from '../context/StateContext';

interface ActionsViewProps {
  vscode: any;
}

export const ActionsView: React.FC<ActionsViewProps> = ({ vscode }) => {
  const { state } = useStateService();

  const handleAction = (command: string) => {
    vscode.postMessage({ command });
  };

  if (!state.connected) {
    return (
      <div className="not-connected">
        <p>Connect to a Neon database to see available actions.</p>
      </div>
    );
  }

  return (
    <div className="actions-content">
      <button
        className="action-button"
        onClick={() => handleAction('resetFromParent')}
      >
        Reset from Parent Branch
      </button>
      <button
        className="action-button"
        onClick={() => handleAction('openSqlEditor')}
      >
        Open SQL Editor
      </button>
      <button
        className="action-button"
        onClick={() => handleAction('openTableView')}
      >
        Open Table View
      </button>
      <button
        className="action-button"
        onClick={() => handleAction('launchPsql')}
      >
        Launch PSQL
      </button>
    </div>
  );
}; 