import { ViewData } from '../types';
import { getStyles } from './styles';

export const getMainHtml = (data: ViewData): string => {
    const isConnected = data.connected || !!data.connectionInfo;
    const organizations = Array.isArray(data.orgs) ? data.orgs : [];
    const projects = Array.isArray(data.projects) ? data.projects : [];
    const branches = Array.isArray(data.branches) ? data.branches : [];

    return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Neon Local</title>
        ${getStyles()}
    </head>
    <body>
        <div id="app">
            ${isConnected ? getConnectedView(data) : getFormView(data, organizations, projects, branches)}
            <div class="section proxy-buttons">
                ${getProxyButtons(data, isConnected)}
            </div>
        </div>
        ${getClientScript(data)}
    </body>
    </html>
    `;
};

const getConnectedView = (data: ViewData): string => `
    <div class="connection-status">
        <div class="status-indicator connected">
            <span class="status-dot"></span>
            Connected
        </div>
    </div>

    <div class="connection-details">
        <div class="detail-row">
            <div class="detail-label">Organization</div>
            <div class="detail-value">${data.selectedOrgName || 'Not selected'}</div>
        </div>
        <div class="detail-row">
            <div class="detail-label">Project</div>
            <div class="detail-value">${data.selectedProjectName || 'Not selected'}</div>
        </div>
        <div class="detail-row">
            <div class="detail-label">Parent Branch</div>
            <div class="detail-value">${data.selectedBranchName || 'Not selected'}</div>
        </div>
        <div class="detail-row">
            <div class="detail-label">Driver</div>
            <div class="detail-value">${data.selectedDriver === 'neon' ? 'Neon Serverless' : 'PostgreSQL'}</div>
        </div>
        ${data.connectionInfo ? getConnectionInfoSection(data.connectionInfo) : ''}
    </div>
`;

const getConnectionInfoSection = (connectionInfo: string): string => `
    <div class="detail-row">
        <div class="detail-label-container">
            <div class="detail-label">Connection Info</div>
            <button class="copy-button" title="Copy connection string">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M10.75 1.75H4.25C3.97386 1.75 3.75 1.97386 3.75 2.25V11.25C3.75 11.5261 3.97386 11.75 4.25 11.75H10.75C11.0261 11.75 11.25 11.5261 11.25 11.25V2.25C11.25 1.97386 11.0261 1.75 10.75 1.75Z" stroke="currentColor" stroke-width="1.5"/>
                    <path d="M12.25 4.25H13.75V13.75H5.75V12.25" stroke="currentColor" stroke-width="1.5"/>
                </svg>
                <span class="copy-success">Copied!</span>
            </button>
        </div>
        <div class="detail-value connection-string-container">
            <div class="connection-string">${connectionInfo}</div>
        </div>
    </div>
`;

const getFormView = (
    data: ViewData,
    organizations: Array<{ id: string; name: string }>,
    projects: Array<{ id: string; name: string }>,
    branches: Array<{ id: string; name: string }>
): string => `
    <div class="form-content">
        <div class="section">
            <label for="connection-type-select">Connection Type</label>
            <select id="connection-type-select">
                <option value="existing" ${data.connectionType === 'existing' ? 'selected' : ''}>Connect to existing branch</option>
                <option value="new" ${data.connectionType === 'new' ? 'selected' : ''}>Connect to new branch</option>
            </select>
        </div>

        <div class="section">
            <label for="org-select">Organization</label>
            <select id="org-select">
                <option value="">Select Organization</option>
                ${organizations.map((org) => `
                    <option value="${org.id}" ${org.id === data.selectedOrgId ? 'selected' : ''}>
                        ${org.name}
                    </option>
                `).join('')}
            </select>
        </div>

        <div class="section">
            <label for="project-select">Project</label>
            <select id="project-select" ${!data.selectedOrgId ? 'disabled' : ''}>
                <option value="">Select Project</option>
                ${projects.map((project) => `
                    <option value="${project.id}" ${project.id === data.selectedProjectId ? 'selected' : ''}>
                        ${project.name}
                    </option>
                `).join('')}
            </select>
        </div>

        <div class="section branch-dropdown existing-branch" style="display: ${data.connectionType === 'existing' ? 'block' : 'none'}">
            <label for="branch-select">Branch</label>
            <select id="branch-select" ${!data.selectedProjectId ? 'disabled' : ''}>
                <option value="">Select Branch</option>
                ${branches.map((branch) => `
                    <option value="${branch.id}" ${branch.id === data.selectedBranchId ? 'selected' : ''}>
                        ${branch.name}
                    </option>
                `).join('')}
            </select>
        </div>

        <div class="section branch-dropdown new-branch" style="display: ${data.connectionType === 'new' ? 'block' : 'none'}">
            <label for="parent-branch-select">Parent Branch</label>
            <select id="parent-branch-select" ${!data.selectedProjectId ? 'disabled' : ''}>
                <option value="">Select Parent Branch</option>
                ${branches.map((branch) => `
                    <option value="${branch.id}" ${branch.id === data.selectedBranchId ? 'selected' : ''}>
                        ${branch.name}
                    </option>
                `).join('')}
            </select>
        </div>

        <div class="section">
            <label for="driver-select">Driver</label>
            <select id="driver-select" ${!data.selectedBranchId ? 'disabled' : ''}>
                <option value="neon" ${data.selectedDriver === 'neon' ? 'selected' : ''}>Neon Serverless</option>
                <option value="postgres" ${(!data.selectedDriver || data.selectedDriver === 'postgres') ? 'selected' : ''}>PostgreSQL</option>
            </select>
        </div>
    </div>
`;

const getProxyButtons = (data: ViewData, isConnected: boolean): string => {
    if (isConnected) {
        return `
            <button id="stopProxy" class="stop-button">Disconnect</button>
            <button id="resetFromParent" class="reset-button">Reset from parent</button>
            <button id="openSqlEditor" class="sql-editor-button">Sql editor</button>
            ${data.selectedDriver === 'postgres' ? '<button id="launchPsql" class="psql-button">psql</button>' : ''}
        `;
    }
    return `
        <button id="startProxy" ${!data.selectedBranch ? 'disabled' : ''}>
            ${!data.connectionType || data.connectionType === 'existing' ? 'Connect' : 'Create'}
        </button>
    `;
};

const getClientScript = (data: ViewData): string => `
    <script>
        const vscode = acquireVsCodeApi();
        
        // Initialize state from VS Code's stored state or from data
        let currentState = vscode.getState() || {
            organizations: ${JSON.stringify(data.orgs || [])},
            projects: ${JSON.stringify(data.projects || [])},
            branches: ${JSON.stringify(data.branches || [])},
            selectedOrgId: ${JSON.stringify(data.selectedOrgId)},
            selectedProjectId: ${JSON.stringify(data.selectedProjectId)},
            selectedBranchId: ${JSON.stringify(data.selectedBranchId)},
            selectedDriver: ${JSON.stringify(data.selectedDriver || 'postgres')},
            connected: ${JSON.stringify(data.connected)},
            connectionInfo: ${JSON.stringify(data.connectionInfo)},
            connectionType: ${JSON.stringify(data.connectionType || 'existing')}
        };

        // Update state with any new data while preserving selections
        currentState = {
            ...currentState,
            organizations: ${JSON.stringify(data.orgs || [])},
            projects: ${JSON.stringify(data.projects || [])},
            branches: ${JSON.stringify(data.branches || [])},
            connected: ${JSON.stringify(data.connected)},
            connectionInfo: ${JSON.stringify(data.connectionInfo)},
            // Preserve selections from either current state or new data
            selectedOrgId: currentState.selectedOrgId || ${JSON.stringify(data.selectedOrgId)},
            selectedProjectId: currentState.selectedProjectId || ${JSON.stringify(data.selectedProjectId)},
            selectedBranchId: currentState.selectedBranchId || ${JSON.stringify(data.selectedBranchId)},
            selectedDriver: currentState.selectedDriver || ${JSON.stringify(data.selectedDriver || 'postgres')},
            connectionType: currentState.connectionType || ${JSON.stringify(data.connectionType || 'existing')}
        };

        // Save initial state
        vscode.setState(currentState);

        function saveState() {
            vscode.setState(currentState);
        }

        function updateStartProxyButton() {
            const startButton = document.getElementById('startProxy');
            if (!startButton) return;

            const orgSelect = document.getElementById('org-select');
            const projectSelect = document.getElementById('project-select');
            const branchSelect = document.getElementById('branch-select');
            const parentBranchSelect = document.getElementById('parent-branch-select');
            const driverSelect = document.getElementById('driver-select');
            const connectionTypeSelect = document.getElementById('connection-type-select');

            const isExisting = connectionTypeSelect.value === 'existing';
            const branchValue = isExisting ? branchSelect?.value : parentBranchSelect?.value;

            const allSelected = orgSelect?.value && 
                              projectSelect?.value && 
                              branchValue && 
                              driverSelect?.value &&
                              connectionTypeSelect?.value;

            startButton.disabled = !allSelected;
        }

        function initializeDropdowns() {
            // Setup connection type dropdown
            const connectionTypeSelect = document.getElementById('connection-type-select');
            if (connectionTypeSelect) {
                connectionTypeSelect.value = currentState.connectionType || 'existing';
                connectionTypeSelect.addEventListener('change', function() {
                    currentState.connectionType = this.value;
                    saveState();
                    
                    const isExisting = this.value === 'existing';
                    document.querySelector('.branch-dropdown.existing-branch').style.display = isExisting ? 'block' : 'none';
                    document.querySelector('.branch-dropdown.new-branch').style.display = isExisting ? 'none' : 'block';
                    
                    const startButton = document.getElementById('startProxy');
                    if (startButton) {
                        startButton.textContent = isExisting ? 'Connect' : 'Create';
                    }
                    
                    updateStartProxyButton();
                    
                    vscode.postMessage({
                        command: 'updateConnectionType',
                        connectionType: this.value
                    });
                });
            }

            // Setup organization dropdown
            const orgSelect = document.getElementById('org-select');
            if (orgSelect) {
                orgSelect.value = currentState.selectedOrgId || '';
                orgSelect.addEventListener('change', function() {
                    currentState.selectedOrgId = this.value;
                    saveState();
                    
                    const projectSelect = document.getElementById('project-select');
                    const branchSelect = document.getElementById('branch-select');
                    const parentBranchSelect = document.getElementById('parent-branch-select');
                    const driverSelect = document.getElementById('driver-select');
                    
                    if (projectSelect) {
                        projectSelect.value = '';
                        projectSelect.disabled = !this.value;
                        currentState.selectedProjectId = '';
                    }
                    if (branchSelect) {
                        branchSelect.value = '';
                        branchSelect.disabled = true;
                    }
                    if (parentBranchSelect) {
                        parentBranchSelect.value = '';
                        parentBranchSelect.disabled = true;
                    }
                    if (driverSelect) {
                        driverSelect.value = 'postgres';
                        driverSelect.disabled = true;
                        currentState.selectedDriver = 'postgres';
                    }
                    
                    saveState();
                    updateStartProxyButton();
                    
                    vscode.postMessage({
                        command: 'selectOrg',
                        orgId: this.value
                    });
                });
            }

            // Setup project dropdown
            const projectSelect = document.getElementById('project-select');
            if (projectSelect) {
                projectSelect.value = currentState.selectedProjectId || '';
                projectSelect.disabled = !currentState.selectedOrgId;
                projectSelect.addEventListener('change', function() {
                    currentState.selectedProjectId = this.value;
                    saveState();
                    
                    const branchSelect = document.getElementById('branch-select');
                    const parentBranchSelect = document.getElementById('parent-branch-select');
                    const driverSelect = document.getElementById('driver-select');
                    
                    if (branchSelect) {
                        branchSelect.value = '';
                        branchSelect.disabled = !this.value;
                    }
                    if (parentBranchSelect) {
                        parentBranchSelect.value = '';
                        parentBranchSelect.disabled = !this.value;
                    }
                    if (driverSelect) {
                        driverSelect.value = 'postgres';
                        driverSelect.disabled = true;
                        currentState.selectedDriver = 'postgres';
                    }
                    
                    saveState();
                    updateStartProxyButton();
                    
                    vscode.postMessage({
                        command: 'selectProject',
                        projectId: this.value
                    });
                });
            }

            // Setup branch dropdowns
            const branchSelect = document.getElementById('branch-select');
            const parentBranchSelect = document.getElementById('parent-branch-select');
            
            if (branchSelect) {
                branchSelect.value = currentState.selectedBranchId || '';
                branchSelect.disabled = !currentState.selectedProjectId;
                branchSelect.addEventListener('change', function() {
                    currentState.selectedBranchId = this.value;
                    saveState();
                    
                    if (parentBranchSelect) {
                        parentBranchSelect.value = this.value;
                    }
                    
                    const driverSelect = document.getElementById('driver-select');
                    if (driverSelect) {
                        driverSelect.disabled = !this.value;
                    }
                    
                    updateStartProxyButton();
                    
                    vscode.postMessage({
                        command: 'selectBranch',
                        branchId: this.value,
                        restartProxy: false,
                        driver: driverSelect?.value || 'postgres'
                    });
                });
            }

            if (parentBranchSelect) {
                parentBranchSelect.value = currentState.selectedBranchId || '';
                parentBranchSelect.disabled = !currentState.selectedProjectId;
                parentBranchSelect.addEventListener('change', function() {
                    currentState.selectedBranchId = this.value;
                    saveState();
                    
                    if (branchSelect) {
                        branchSelect.value = this.value;
                    }
                    
                    const driverSelect = document.getElementById('driver-select');
                    if (driverSelect) {
                        driverSelect.disabled = !this.value;
                    }
                    
                    updateStartProxyButton();
                    
                    vscode.postMessage({
                        command: 'selectParentBranch',
                        parentBranchId: this.value
                    });
                });
            }

            // Setup driver dropdown
            const driverSelect = document.getElementById('driver-select');
            if (driverSelect) {
                driverSelect.value = currentState.selectedDriver || 'postgres';
                driverSelect.disabled = !currentState.selectedBranchId;
                driverSelect.addEventListener('change', function() {
                    currentState.selectedDriver = this.value;
                    saveState();
                    updateStartProxyButton();
                });
            }

            // Setup proxy buttons
            const startButton = document.getElementById('startProxy');
            if (startButton) {
                startButton.addEventListener('click', function() {
                    this.disabled = true;
                    this.textContent = 'Creating...';
                    
                    const connectionTypeSelect = document.getElementById('connection-type-select');
                    const driverSelect = document.getElementById('driver-select');
                    const isExisting = connectionTypeSelect.value === 'existing';
                    
                    const branchSelect = document.getElementById('branch-select');
                    const parentBranchSelect = document.getElementById('parent-branch-select');
                    
                    const branchId = isExisting ? branchSelect?.value : undefined;
                    const parentBranchId = !isExisting ? parentBranchSelect?.value : undefined;
                    
                    vscode.postMessage({
                        command: 'startProxy',
                        driver: driverSelect?.value || 'postgres',
                        isExisting,
                        branchId,
                        parentBranchId
                    });
                });
            }

            const stopButton = document.getElementById('stopProxy');
            if (stopButton) {
                stopButton.addEventListener('click', function() {
                    this.disabled = true;
                    this.textContent = 'Disconnecting...';
                    vscode.postMessage({ command: 'stopProxy' });
                });
            }

            // Setup copy button
            const copyButton = document.querySelector('.copy-button');
            if (copyButton) {
                copyButton.addEventListener('click', () => {
                    const connectionString = document.querySelector('.connection-string')?.textContent;
                    if (connectionString) {
                        navigator.clipboard.writeText(connectionString).then(() => {
                            const successMessage = document.querySelector('.copy-success');
                            if (successMessage) {
                                successMessage.classList.add('visible');
                                setTimeout(() => {
                                    successMessage.classList.remove('visible');
                                }, 2000);
                            }
                        });
                    }
                });
            }

            // Setup additional buttons
            const resetButton = document.getElementById('resetFromParent');
            if (resetButton) {
                resetButton.addEventListener('click', () => {
                    vscode.postMessage({ command: 'resetFromParent' });
                });
            }

            const sqlEditorButton = document.getElementById('openSqlEditor');
            if (sqlEditorButton) {
                sqlEditorButton.addEventListener('click', () => {
                    vscode.postMessage({ command: 'openSqlEditor' });
                });
            }

            const launchPsqlButton = document.getElementById('launchPsql');
            if (launchPsqlButton) {
                launchPsqlButton.addEventListener('click', () => {
                    vscode.postMessage({ command: 'launchPsql' });
                });
            }

            updateStartProxyButton();
        }

        // Handle all incoming messages
        window.addEventListener('message', event => {
            const message = event.data;
            
            switch (message.command) {
                case 'updateStatus':
                    currentState.connected = message.connected;
                    currentState.connectionInfo = message.connectionInfo;
                    saveState();
                    if (currentState.connected !== message.connected) {
                        vscode.postMessage({ command: 'refresh' });
                    }
                    break;
                    
                case 'updateProjects':
                    currentState.projects = message.projects;
                    saveState();
                    const projectSelect = document.getElementById('project-select');
                    if (projectSelect) {
                        while (projectSelect.options.length > 1) {
                            projectSelect.remove(1);
                        }
                        message.projects.forEach(project => {
                            const option = document.createElement('option');
                            option.value = project.id;
                            option.text = project.name;
                            option.selected = project.id === currentState.selectedProjectId;
                            projectSelect.add(option);
                        });
                        projectSelect.disabled = !currentState.selectedOrgId;
                    }
                    break;
                    
                case 'updateBranches':
                    currentState.branches = message.branches;
                    saveState();
                    const branchSelect = document.getElementById('branch-select');
                    const parentBranchSelect = document.getElementById('parent-branch-select');
                    if (branchSelect && parentBranchSelect) {
                        [branchSelect, parentBranchSelect].forEach(select => {
                            while (select.options.length > 1) {
                                select.remove(1);
                            }
                            message.branches.forEach(branch => {
                                const option = document.createElement('option');
                                option.value = branch.id;
                                option.text = branch.name;
                                option.selected = branch.id === currentState.selectedBranchId;
                                select.add(option);
                            });
                            select.disabled = !currentState.selectedProjectId;
                        });
                    }
                    break;
            }
        });

        // Initialize dropdowns when the DOM is loaded
        document.addEventListener('DOMContentLoaded', initializeDropdowns);
    </script>
`; 