import React, { useState } from 'react';
import { useStateService } from '../context/StateContext';
import { NeonDatabase, NeonRole } from '../../types';

interface DatabaseViewProps {
  vscode: any;
}

export const DatabaseView: React.FC<DatabaseViewProps> = ({ vscode }) => {
  const { state } = useStateService();
  const [copySuccess, setCopySuccess] = useState<string | null>(null);

  const handleDatabaseChange = (value: string) => {
    vscode.postMessage({
      command: 'selectDatabase',
      database: value
    });
  };

  const handleRoleChange = (value: string) => {
    vscode.postMessage({
      command: 'selectRole',
      role: value
    });
  };

  const handleCopy = async (text: string | undefined, type: string) => {
    try {
      const textToCopy = type === 'connection' ? (state.connectionInfo || '') : (text || '');
      await navigator.clipboard.writeText(textToCopy);
      setCopySuccess(type);
      setTimeout(() => setCopySuccess(null), 2000);
    } catch (err) {
      console.error('Failed to copy text: ', err);
    }
  };

  if (!state.connected) {
    return (
      <div className="not-connected">
        <p>Connect to a database to see its local connection string.</p>
      </div>
    );
  }

  return (
    <div className="connection-details">
      <p className="description">
        Select a database to see its local connection string.
      </p>
      
      <div className="section">
        <label htmlFor="database">Database</label>
        <select
          id="database"
          value={state.selectedDatabase || ''}
          onChange={(e) => handleDatabaseChange(e.target.value)}
        >
          <option value="">Select a database</option>
          {state.databases?.map((db: NeonDatabase) => (
            <option key={db.name} value={db.name}>
              {db.name}
            </option>
          ))}
        </select>
      </div>

      {/* Role dropdown section - temporarily commented out
      <div className="section">
        <label htmlFor="role">Role</label>
        <select
          id="role"
          value={state.selectedRole || ''}
          onChange={(e) => handleRoleChange(e.target.value)}
        >
          <option value="">Select a role</option>
          {state.roles?.map((role: NeonRole) => (
            <option key={role.name} value={role.name}>
              {role.name}
            </option>
          ))}
        </select>
      </div>
      */}

      {state.connectionInfo && (
        <div>
          <div className="detail-row">
            <div className="detail-label-container">
              <div className="detail-label">Local Connection String</div>
              <button
                className="copy-button"
                title="Copy connection string"
                onClick={() => handleCopy(state.connectionInfo, 'connection')}
              >
                {copySuccess === 'connection' ? (
                  <span>✓</span>
                ) : (
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M10.75 1.75H4.25C3.97386 1.75 3.75 1.97386 3.75 2.25V11.25C3.75 11.5261 3.97386 11.75 4.25 11.75H10.75C11.0261 11.75 11.25 11.5261 11.25 11.25V2.25C11.25 1.97386 11.0261 1.75 10.75 1.75Z" stroke="currentColor" strokeWidth="1.5"/>
                    <path d="M12.25 4.25H13.75V13.75H5.75V12.25" stroke="currentColor" strokeWidth="1.5"/>
                </svg>
                )}
              </button>
            </div>
            <div className="detail-value connection-string-container">
              <div className="connection-string">{state.connectionInfo}</div>
            </div>
          </div>
        </div>
      )}

      <div>
        <div className="detail-row">
          <div className="detail-label-container">
            <div className="detail-label" title="When connecting to your database's local connection string with the Neon serverless driver, you must also set the local fetch endpoint in your app's Neon config.">Local Fetch Endpoint</div>
            <button
              className="copy-button"
              title="Copy fetch endpoint configuration"
              onClick={() => handleCopy(`import { neonConfig } from '@neondatabase/serverless';\n\nneonConfig.fetchEndpoint = 'http://localhost:${state.port}/sql';`, 'endpoint')}
            >
              {copySuccess === 'endpoint' ? (
                <span>✓</span>
              ) : (
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M10.75 1.75H4.25C3.97386 1.75 3.75 1.97386 3.75 2.25V11.25C3.75 11.5261 3.97386 11.75 4.25 11.75H10.75C11.0261 11.75 11.25 11.5261 11.25 11.25V2.25C11.25 1.97386 11.0261 1.75 10.75 1.75Z" stroke="currentColor" strokeWidth="1.5"/>
                  <path d="M12.25 4.25H13.75V13.75H5.75V12.25" stroke="currentColor" strokeWidth="1.5"/>
                </svg>
              )}
            </button>
          </div>
          <div className="detail-value connection-string-container">
            <div className="connection-string">
              import {'{'} neonConfig {'}'} from '@neondatabase/serverless';<br /><br />
              neonConfig.fetchEndpoint = 'http://localhost:{state.port}/sql';
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}; 