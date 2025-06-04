import * as React from 'react';
import { ViewState } from './state/ViewState';
import { ViewData } from '../types';

declare const acquireVsCodeApi: () => {
    postMessage: (message: any) => void;
    setState: (state: any) => void;
    getState: () => any;
};

const vscode = acquireVsCodeApi();
const viewState = new ViewState(vscode);

export function App() {
    const [state, setState] = React.useState(viewState.getState());

    React.useEffect(() => {
        // Subscribe to state changes
        const unsubscribe = viewState.subscribe(setState);
        
        // Handle messages from the extension
        const messageHandler = (event: MessageEvent) => {
            const message = event.data;
            
            switch (message.command) {
                case 'updateViewData':
                    viewState.processViewData(message.data);
                    break;
                case 'clearState':
                    viewState.clearState();
                    window.location.reload();
                    break;
            }
        };
        
        window.addEventListener('message', messageHandler);
        
        return () => {
            unsubscribe();
            window.removeEventListener('message', messageHandler);
        };
    }, []);

    const handleConnectionTypeChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
        const type = event.target.value as 'existing' | 'new';
        viewState.updateConnectionType(type);
        vscode.postMessage({
            command: 'updateConnectionType',
            connectionType: type
        });
    };

    const handleOrgSelect = (event: React.ChangeEvent<HTMLSelectElement>) => {
        const orgId = event.target.value;
        viewState.selectOrg(orgId);
        vscode.postMessage({
            command: 'selectOrg',
            orgId
        });
    };

    const handleProjectSelect = (event: React.ChangeEvent<HTMLSelectElement>) => {
        const projectId = event.target.value;
        viewState.selectProject(projectId);
        vscode.postMessage({
            command: 'selectProject',
            projectId
        });
    };

    const handleBranchSelect = (event: React.ChangeEvent<HTMLSelectElement>) => {
        const branchId = event.target.value;
        viewState.selectBranch(branchId);
        
        if (state.connectionType === 'existing') {
            vscode.postMessage({
                command: 'selectBranch',
                branchId,
                restartProxy: false,
                driver: state.selectedDriver
            });
        } else {
            vscode.postMessage({
                command: 'selectParentBranch',
                parentBranchId: branchId
            });
        }
    };

    const handleDriverSelect = (event: React.ChangeEvent<HTMLSelectElement>) => {
        const driver = event.target.value;
        viewState.selectDriver(driver);
        vscode.postMessage({
            command: 'selectBranch',
            branchId: state.selectedBranchId,
            restartProxy: false,
            driver
        });
    };

    const handleStartProxy = () => {
        vscode.postMessage({
            command: 'startProxy',
            driver: state.selectedDriver,
            isExisting: state.connectionType === 'existing',
            branchId: state.connectionType === 'existing' ? state.selectedBranchId : undefined,
            parentBranchId: state.connectionType === 'new' ? state.parentBranchId : undefined
        });
    };

    const handleStopProxy = () => {
        vscode.postMessage({ command: 'stopProxy' });
    };

    return (
        <div className="app">
            {state.connected ? (
                <>
                    <div className="connection-status">
                        <div className="status-indicator connected">
                            <span className="status-dot"></span>
                            Connected to {state.connectionType === 'new' ? 'new' : 'existing'} branch
                        </div>
                    </div>

                    <div className="connection-details">
                        <div className="detail-row">
                            <div className="detail-label">Organization</div>
                            <div className="detail-value">{state.selectedOrgName || 'Loading...'}</div>
                        </div>
                        <div className="detail-row">
                            <div className="detail-label">Project</div>
                            <div className="detail-value">{state.selectedProjectName || 'Loading...'}</div>
                        </div>
                        <div className="detail-row">
                            <div className="detail-label">Branch</div>
                            <div className="detail-value">{state.selectedBranchName || state.selectedBranchId || 'Not selected'}</div>
                        </div>
                        {state.connectionType === 'new' && (
                            <div className="detail-row">
                                <div className="detail-label">Parent Branch</div>
                                <div className="detail-value">{state.parentBranchName || state.parentBranchId || 'Not selected'}</div>
                            </div>
                        )}
                        <div className="detail-row">
                            <div className="detail-label">Driver</div>
                            <div className="detail-value">{state.selectedDriver === 'serverless' ? 'Neon Serverless' : 'PostgreSQL'}</div>
                        </div>
                    </div>

                    <div className="section proxy-buttons">
                        <button onClick={handleStopProxy} className="stop-button">Disconnect</button>
                    </div>
                </>
            ) : (
                <>
                    <div className="form-content">
                        <div className="section">
                            <label htmlFor="connection-type">Connection Type</label>
                            <select
                                id="connection-type"
                                value={state.connectionType}
                                onChange={handleConnectionTypeChange}
                            >
                                <option value="existing">Connect to existing branch</option>
                                <option value="new">Connect to new branch</option>
                            </select>
                        </div>

                        <div className="section">
                            <label htmlFor="org">Organization</label>
                            <select
                                id="org"
                                value={state.selectedOrgId}
                                onChange={handleOrgSelect}
                            >
                                <option value="">Select Organization</option>
                                {state.organizations.map((org) => (
                                    <option key={org.id} value={org.id}>
                                        {org.name}
                                    </option>
                                ))}
                            </select>
                        </div>

                        <div className="section">
                            <label htmlFor="project">Project</label>
                            <select
                                id="project"
                                value={state.selectedProjectId}
                                onChange={handleProjectSelect}
                                disabled={!state.selectedOrgId}
                            >
                                <option value="">Select Project</option>
                                {state.projects.map((project) => (
                                    <option key={project.id} value={project.id}>
                                        {project.name}
                                    </option>
                                ))}
                            </select>
                        </div>

                        {state.connectionType === 'existing' ? (
                            <div className="section">
                                <label htmlFor="branch">Branch</label>
                                <select
                                    id="branch"
                                    value={state.selectedBranchId}
                                    onChange={handleBranchSelect}
                                    disabled={!state.selectedProjectId}
                                >
                                    <option value="">Select Branch</option>
                                    {state.branches.map((branch) => (
                                        <option key={branch.id} value={branch.id}>
                                            {branch.name}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        ) : (
                            <div className="section">
                                <label htmlFor="parent-branch">Parent Branch</label>
                                <select
                                    id="parent-branch"
                                    value={state.parentBranchId}
                                    onChange={handleBranchSelect}
                                    disabled={!state.selectedProjectId}
                                >
                                    <option value="">Select Parent Branch</option>
                                    {state.branches.map((branch) => (
                                        <option key={branch.id} value={branch.id}>
                                            {branch.name}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        )}

                        <div className="section">
                            <label htmlFor="driver">Driver</label>
                            <select
                                id="driver"
                                value={state.selectedDriver}
                                onChange={handleDriverSelect}
                            >
                                <option value="serverless">Neon Serverless</option>
                                <option value="postgres">PostgreSQL</option>
                            </select>
                        </div>
                    </div>

                    <div className="section proxy-buttons">
                        <button
                            onClick={handleStartProxy}
                            disabled={!state.selectedProjectId || !(state.selectedBranchId || state.parentBranchId)}
                        >
                            {state.connectionType === 'existing' ? 'Connect' : 'Create'}
                        </button>
                    </div>
                </>
            )}
        </div>
    );
} 