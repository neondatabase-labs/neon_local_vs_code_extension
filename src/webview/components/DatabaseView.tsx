import React, { useState } from 'react';
import { useSelector } from 'react-redux';
import { RootState } from '../store';

interface DatabaseViewProps {
  vscode: any;
}

export const DatabaseView: React.FC<DatabaseViewProps> = ({ vscode }) => {
  const state = useSelector((state: RootState) => state);
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

  const handleCopy = async (text: string, type: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopySuccess(type);
      setTimeout(() => setCopySuccess(null), 2000);
    } catch (err) {
      console.error('Failed to copy text: ', err);
    }
  };

  if (!state.connected) {
    return (
      <div className="not-connected">
        <p>Connect to a Neon database to see connection strings.</p>
      </div>
    );
  }

  return (
    <div className="database-content">
      <p className="description">
        Select a database and role to see your database's local connection string.
      </p>
      
      <div className="section">
        <label htmlFor="database">Database</label>
        <select
          id="database"
          value={state.selectedDatabase || ''}
          onChange={(e) => handleDatabaseChange(e.target.value)}
        >
          <option value="">Select Database</option>
          {state.databases.map((db) => (
            <option key={db.name} value={db.name}>
              {db.name}
            </option>
          ))}
        </select>
      </div>

      <div className="section">
        <label htmlFor="role">Role</label>
        <select
          id="role"
          value={state.selectedRole || ''}
          onChange={(e) => handleRoleChange(e.target.value)}
        >
          <option value="">Select Role</option>
          {state.roles.map((role) => (
            <option key={role.name} value={role.name}>
              {role.name}
            </option>
          ))}
        </select>
      </div>

      {state.connectionInfo && (
        <div className="detail-row">
          <div className="detail-label-container">
            <div className="detail-label">Local Connection String</div>
            <button
              className="copy-button"
              title="Copy connection string"
              onClick={() => handleCopy(state.connectionInfo, 'connection')}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M10.75 1.75H4.25C3.97386 1.75 3.75 1.97386 3.75 2.25V11.25C3.75 11.5261 3.97386 11.75 4.25 11.75H10.75C11.0261 11.75 11.25 11.5261 11.25 11.25V2.25C11.25 1.97386 11.0261 1.75 10.75 1.75Z" stroke="currentColor" strokeWidth="1.5"/>
                <path d="M12.25 4.25H13.75V13.75H5.75V12.25" stroke="currentColor" strokeWidth="1.5"/>
              </svg>
              <span className={`copy-success ${copySuccess === 'connection' ? 'visible' : ''}`}>
                Copied!
              </span>
            </button>
          </div>
          <div className="detail-value connection-string-container">
            <div className="connection-string">{state.connectionInfo}</div>
          </div>
        </div>
      )}

      {state.selectedDriver === 'serverless' && (
        <div className="detail-row">
          <div className="detail-label-container">
            <div className="detail-label">Fetch Endpoint</div>
            <button
              className="copy-button"
              title="Copy fetch endpoint configuration"
              onClick={() => handleCopy("import { neonConfig } from '@neondatabase/serverless';\n\nneonConfig.fetchEndpoint = 'http://localhost:5432/sql';", 'endpoint')}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M10.75 1.75H4.25C3.97386 1.75 3.75 1.97386 3.75 2.25V11.25C3.75 11.5261 3.97386 11.75 4.25 11.75H10.75C11.0261 11.75 11.25 11.5261 11.25 11.25V2.25C11.25 1.97386 11.0261 1.75 10.75 1.75Z" stroke="currentColor" strokeWidth="1.5"/>
                <path d="M12.25 4.25H13.75V13.75H5.75V12.25" stroke="currentColor" strokeWidth="1.5"/>
              </svg>
              <span className={`copy-success ${copySuccess === 'endpoint' ? 'visible' : ''}`}>
                Copied!
              </span>
            </button>
          </div>
          <div className="detail-value connection-string-container">
            <div className="connection-string">
              import {'{'} neonConfig {'}'} from '@neondatabase/serverless';<br /><br />
              neonConfig.fetchEndpoint = 'http://localhost:5432/sql';
            </div>
          </div>
        </div>
      )}
    </div>
  );
}; 