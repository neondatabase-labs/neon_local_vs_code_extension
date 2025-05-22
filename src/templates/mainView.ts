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
            Connected to ${data.connectionType === 'new' ? 'new' : 'existing'} branch
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
            <div class="detail-label">Branch</div>
            <div class="detail-value">${data.selectedBranchName || 'Not selected'}</div>
        </div>
        ${data.connectionType === 'new' ? `
        <div class="detail-row">
            <div class="detail-label">Parent Branch</div>
            <div class="detail-value">${data.parentBranchName || 'Not selected'}</div>
        </div>
        ` : ''}
        <div class="detail-row">
            <div class="detail-label">Driver</div>
            <div class="detail-value">${data.selectedDriver === 'serverless' ? 'Neon Serverless' : 'PostgreSQL'}</div>
        </div>
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
            <label for="connection-type">Connection Type</label>
            <select id="connection-type">
                <option value="existing" ${data.connectionType === 'existing' ? 'selected' : ''}>Connect to existing branch</option>
                <option value="new" ${data.connectionType === 'new' ? 'selected' : ''}>Connect to new branch</option>
            </select>
        </div>

        <div class="section">
            <label for="org">Organization</label>
            <select id="org">
                <option value="">Select Organization</option>
                ${organizations.map((org) => `
                    <option value="${org.id}" ${org.id === data.selectedOrgId ? 'selected' : ''}>
                        ${org.name}
                    </option>
                `).join('')}
            </select>
        </div>

        <div class="section">
            <label for="project">Project</label>
            <select id="project" ${!data.selectedOrgId ? 'disabled' : ''}>
                <option value="">Select Project</option>
                ${projects.map((project) => `
                    <option value="${project.id}" ${project.id === data.selectedProjectId ? 'selected' : ''}>
                        ${project.name}
                    </option>
                `).join('')}
            </select>
        </div>

        <div class="section branch-dropdown existing-branch" style="display: ${data.connectionType === 'existing' ? 'block' : 'none'}">
            <label for="branch">Branch</label>
            <select id="branch" ${!data.selectedProjectId ? 'disabled' : ''}>
                <option value="">Select Branch</option>
                ${branches.map((branch) => `
                    <option value="${branch.id}" ${branch.id === data.selectedBranchId ? 'selected' : ''}>
                        ${branch.name}
                    </option>
                `).join('')}
            </select>
        </div>

        <div class="section branch-dropdown new-branch" style="display: ${data.connectionType === 'new' ? 'block' : 'none'}">
            <label for="parent-branch">Parent Branch</label>
            <select id="parent-branch" ${!data.selectedProjectId ? 'disabled' : ''}>
                <option value="">Select Parent Branch</option>
                ${branches.map((branch) => `
                    <option value="${branch.id}" ${branch.id === data.selectedBranchId ? 'selected' : ''}>
                        ${branch.name}
                    </option>
                `).join('')}
            </select>
        </div>

        <div class="section">
            <label for="driver">Driver</label>
            <select id="driver">
                <option value="serverless" ${data.selectedDriver === 'serverless' ? 'selected' : ''}>Neon Serverless</option>
                <option value="postgres" ${(!data.selectedDriver || data.selectedDriver === 'postgres') ? 'selected' : ''}>PostgreSQL</option>
            </select>
        </div>
    </div>
`;

const getProxyButtons = (data: ViewData, isConnected: boolean): string => {
    if (isConnected) {
        return `
            <button id="stopProxy" class="stop-button">Disconnect</button>
        `;
    }
    return `
        <button id="startProxy" ${!data.selectedBranchId ? 'disabled' : ''}>
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
            connectionType: ${JSON.stringify(data.connectionType || 'existing')}
        };

        // Update state with any new data while preserving selections ONLY if we have orgs
        currentState = {
            ...currentState,
            organizations: ${JSON.stringify(data.orgs || [])},
            projects: ${JSON.stringify(data.projects || [])},
            branches: ${JSON.stringify(data.branches || [])},
            connected: ${JSON.stringify(data.connected)},
            // Only preserve selections if we have orgs, otherwise clear them
            selectedOrgId: ${JSON.stringify(data.orgs || [])}.length ? (currentState.selectedOrgId || ${JSON.stringify(data.selectedOrgId)}) : '',
            selectedProjectId: ${JSON.stringify(data.orgs || [])}.length ? (currentState.selectedProjectId || ${JSON.stringify(data.selectedProjectId)}) : '',
            selectedBranchId: ${JSON.stringify(data.orgs || [])}.length ? (currentState.selectedBranchId || ${JSON.stringify(data.selectedBranchId)}) : '',
            selectedDriver: ${JSON.stringify(data.orgs || [])}.length ? (currentState.selectedDriver || ${JSON.stringify(data.selectedDriver || 'postgres')}) : 'postgres',
            connectionType: ${JSON.stringify(data.orgs || [])}.length ? (currentState.connectionType || ${JSON.stringify(data.connectionType || 'existing')}) : 'existing'
        };

        // Save initial state
        vscode.setState(currentState);

        function saveState() {
            vscode.setState(currentState);
        }

        function clearState() {
            currentState = {
                organizations: [],
                projects: [],
                branches: [],
                selectedOrgId: '',
                selectedProjectId: '',
                selectedBranchId: '',
                selectedDriver: 'postgres',
                connected: false,
                connectionType: 'existing'
            };
            vscode.setState(currentState);
            
            // Also reset all dropdowns to their default state
            const orgSelect = document.getElementById('org');
            const projectSelect = document.getElementById('project');
            const branchSelect = document.getElementById('branch');
            const parentBranchSelect = document.getElementById('parent-branch');
            const driverSelect = document.getElementById('driver');
            const connectionTypeSelect = document.getElementById('connection-type');
            
            if (orgSelect) {
                orgSelect.value = '';
                orgSelect.selectedIndex = 0;
            }
            if (projectSelect) {
                projectSelect.value = '';
                projectSelect.selectedIndex = 0;
                projectSelect.disabled = true;
            }
            if (branchSelect) {
                branchSelect.value = '';
                branchSelect.selectedIndex = 0;
                branchSelect.disabled = true;
            }
            if (parentBranchSelect) {
                parentBranchSelect.value = '';
                parentBranchSelect.selectedIndex = 0;
                parentBranchSelect.disabled = true;
            }
            if (driverSelect) {
                driverSelect.value = 'postgres';
            }
            if (connectionTypeSelect) {
                connectionTypeSelect.value = 'existing';
            }
        }

        function updateStartProxyButton() {
            const startButton = document.getElementById('startProxy');
            if (!startButton) return;

            const orgSelect = document.getElementById('org');
            const projectSelect = document.getElementById('project');
            const branchSelect = document.getElementById('branch');
            const parentBranchSelect = document.getElementById('parent-branch');
            const driverSelect = document.getElementById('driver');
            const connectionTypeSelect = document.getElementById('connection-type');

            const isExisting = connectionTypeSelect?.value === 'existing';
            const branchValue = isExisting ? branchSelect?.value : parentBranchSelect?.value;

            // Get the current driver value from the select element or state
            const driverValue = driverSelect?.value || currentState.selectedDriver || 'postgres';

            // Check if all required fields have values
            const allSelected = 
                orgSelect?.value && 
                projectSelect?.value && 
                branchValue && 
                driverValue && // Use the driver value we got above
                connectionTypeSelect?.value;

            startButton.disabled = !allSelected;

            // Update button text based on connection type
            if (connectionTypeSelect) {
                startButton.textContent = connectionTypeSelect.value === 'existing' ? 'Connect' : 'Create';
            }
        }

        function initializeDropdowns() {
            // Setup connection type dropdown
            const connectionTypeSelect = document.getElementById('connection-type');
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
            const orgSelect = document.getElementById('org');
            if (orgSelect) {
                // Only set a value if we have organizations and a selected org
                if (currentState.organizations.length > 0 && currentState.selectedOrgId) {
                    orgSelect.value = currentState.selectedOrgId;
                } else {
                    // Otherwise reset to default state
                    orgSelect.selectedIndex = 0;
                    currentState.selectedOrgId = '';
                    saveState();
                }
                
                orgSelect.addEventListener('change', function() {
                    currentState.selectedOrgId = this.value;
                    saveState();
                    
                    const projectSelect = document.getElementById('project');
                    const branchSelect = document.getElementById('branch');
                    const parentBranchSelect = document.getElementById('parent-branch');
                    
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
                    
                    saveState();
                    updateStartProxyButton();
                    
                    vscode.postMessage({
                        command: 'selectOrg',
                        orgId: this.value
                    });
                });
            }

            // Setup project dropdown
            const projectSelect = document.getElementById('project');
            if (projectSelect) {
                projectSelect.value = currentState.selectedProjectId || '';
                projectSelect.disabled = !currentState.selectedOrgId;
                projectSelect.addEventListener('change', function() {
                    const previousProjectId = currentState.selectedProjectId;
                    currentState.selectedProjectId = this.value;
                    
                    // Clear branch selection if project changed
                    if (previousProjectId !== this.value) {
                        currentState.selectedBranchId = '';
                    }
                    
                    saveState();
                    
                    const branchSelect = document.getElementById('branch');
                    const parentBranchSelect = document.getElementById('parent-branch');
                    
                    if (branchSelect) {
                        branchSelect.value = '';
                        branchSelect.selectedIndex = 0;
                        branchSelect.disabled = !this.value;
                    }
                    if (parentBranchSelect) {
                        parentBranchSelect.value = '';
                        parentBranchSelect.selectedIndex = 0;
                        parentBranchSelect.disabled = !this.value;
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
            const branchSelect = document.getElementById('branch');
            const parentBranchSelect = document.getElementById('parent-branch');
            
            if (branchSelect) {
                // Only set branch value if we have a project selected and branches available
                if (currentState.selectedProjectId && currentState.branches.length > 0) {
                    // Check if the selected branch belongs to the current project
                    const branchExists = currentState.branches.some(branch => 
                        branch.id === currentState.selectedBranchId && 
                        branch.project_id === currentState.selectedProjectId
                    );
                    branchSelect.value = branchExists ? currentState.selectedBranchId : '';
                } else {
                    branchSelect.value = '';
                    branchSelect.selectedIndex = 0;
                }
                branchSelect.disabled = !currentState.selectedProjectId;
                
                branchSelect.addEventListener('change', function() {
                    currentState.selectedBranchId = this.value;
                    saveState();
                    
                    if (parentBranchSelect) {
                        parentBranchSelect.value = this.value;
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
                // Only set parent branch value if we have a project selected and branches available
                if (currentState.selectedProjectId && currentState.branches.length > 0) {
                    // Check if the selected branch belongs to the current project
                    const branchExists = currentState.branches.some(branch => 
                        branch.id === currentState.selectedBranchId && 
                        branch.project_id === currentState.selectedProjectId
                    );
                    parentBranchSelect.value = branchExists ? currentState.selectedBranchId : '';
                } else {
                    parentBranchSelect.value = '';
                    parentBranchSelect.selectedIndex = 0;
                }
                parentBranchSelect.disabled = !currentState.selectedProjectId;
                
                parentBranchSelect.addEventListener('change', function() {
                    currentState.selectedBranchId = this.value;
                    saveState();
                    
                    if (branchSelect) {
                        branchSelect.value = this.value;
                    }
                    
                    updateStartProxyButton();
                    
                    vscode.postMessage({
                        command: 'selectParentBranch',
                        parentBranchId: this.value
                    });
                });
            }

            // Setup driver dropdown
            const driverSelect = document.getElementById('driver');
            if (driverSelect) {
                // Set initial value from state
                driverSelect.value = currentState.selectedDriver || 'postgres';
                currentState.selectedDriver = driverSelect.value; // Ensure state matches the selected value
                saveState();
                
                driverSelect.addEventListener('change', function() {
                    currentState.selectedDriver = this.value;
                    saveState();
                    updateStartProxyButton();
                    
                    vscode.postMessage({
                        command: 'selectBranch',
                        branchId: currentState.selectedBranchId,
                        restartProxy: false,
                        driver: this.value
                    });
                });
            }

            // Setup proxy buttons
            const startButton = document.getElementById('startProxy');
            if (startButton) {
                startButton.addEventListener('click', function() {
                    this.disabled = true;
                    this.textContent = 'Connecting...';
                    
                    const connectionTypeSelect = document.getElementById('connection-type');
                    const driverSelect = document.getElementById('driver');
                    const isExisting = connectionTypeSelect?.value === 'existing';
                    
                    const branchSelect = document.getElementById('branch');
                    const parentBranchSelect = document.getElementById('parent-branch');
                    
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

            // Initial button state update after all dropdowns are initialized
            updateStartProxyButton();
        }

        // Handle all incoming messages
        window.addEventListener('message', event => {
            const message = event.data;
            console.log('Webview received message:', message);
            
            switch (message.command) {
                case 'updateViewData':
                    console.log('Updating view data with:', message.data);
                    const wasConnected = currentState.connected;
                    const previousProjects = currentState.projects || [];
                    
                    // If we're disconnecting, keep the previous projects
                    const updatedProjects = !message.data.connected && wasConnected ? 
                        previousProjects : message.data.projects || [];
                    
                    // Check if auth was cleared (no orgs)
                    const authCleared = !message.data.orgs?.length;
                    
                    currentState = {
                        ...currentState,
                        organizations: message.data.orgs || [],
                        projects: updatedProjects,
                        branches: message.data.branches || [],
                        connected: message.data.connected,
                        connectionType: message.data.connectionType || 'existing',
                        // Clear all selections if auth was cleared
                        selectedOrgId: authCleared ? '' : currentState.selectedOrgId,
                        selectedProjectId: authCleared ? '' : currentState.selectedProjectId,
                        selectedBranchId: authCleared ? '' : currentState.selectedBranchId,
                        selectedDriver: authCleared ? 'postgres' : currentState.selectedDriver
                    };
                    saveState();
                    
                    // If connection status changed or auth was cleared, force a full page refresh
                    if (wasConnected !== message.data.connected || authCleared) {
                        clearState();
                        window.location.reload();
                        break;
                    }
                    
                    // Update dropdowns with new data
                    const orgSelect = document.getElementById('org');
                    const projectSelect = document.getElementById('project');
                    const branchSelect = document.getElementById('branch');
                    const parentBranchSelect = document.getElementById('parent-branch');
                    
                    if (orgSelect) {
                        console.log('Updating org select with:', message.data.orgs);
                        while (orgSelect.options.length > 1) {
                            orgSelect.remove(1);
                        }
                        // If auth was cleared, reset to default state
                        if (authCleared) {
                            orgSelect.selectedIndex = 0;
                        } else {
                            message.data.orgs.forEach(org => {
                                const option = document.createElement('option');
                                option.value = org.id;
                                option.text = org.name;
                                option.selected = org.id === currentState.selectedOrgId;
                                orgSelect.add(option);
                            });
                        }
                    }
                    
                    if (projectSelect) {
                        console.log('Updating project select with:', updatedProjects);
                        while (projectSelect.options.length > 1) {
                            projectSelect.remove(1);
                        }
                        updatedProjects.forEach(project => {
                            const option = document.createElement('option');
                            option.value = project.id;
                            option.text = project.name;
                            option.selected = project.id === currentState.selectedProjectId;
                            projectSelect.appendChild(option);
                        });
                        // Enable project select if we have projects, regardless of org selection
                        projectSelect.disabled = updatedProjects.length === 0;
                        console.log('Project select updated, disabled:', projectSelect.disabled);
                    }
                    
                    if (branchSelect && parentBranchSelect) {
                        console.log('Updating branch selects with:', message.data.branches);
                        [branchSelect, parentBranchSelect].forEach(select => {
                            while (select.options.length > 1) {
                                select.remove(1);
                            }
                            message.data.branches.forEach(branch => {
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
                    
                case 'clearState':
                    clearState();
                    window.location.reload();
                    break;
                    
                case 'updateStatus':
                    console.log('Updating status:', message);
                    currentState.connected = message.connected;
                    saveState();
                    if (currentState.connected !== message.connected) {
                        // Force a full page refresh to update the view
                        window.location.reload();
                    }
                    break;
            }
        });

        // Initialize dropdowns when the DOM is loaded
        document.addEventListener('DOMContentLoaded', initializeDropdowns);
    </script>
`; 