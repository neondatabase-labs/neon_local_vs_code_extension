import { ViewData } from '../types';
import { getStyles } from './styles';

export const getDatabaseHtml = (data: ViewData): string => {
    return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Database connection string</title>
        ${getStyles()}
    </head>
    <body>
        <div id="app">
            ${data.connected ? getDatabaseContent(data) : getNotConnectedContent()}
        </div>
        ${getClientScript()}
    </body>
    </html>
    `;
};

const getDatabaseContent = (data: ViewData): string => `
    <div class="database-content">
        <p class="description">Select a database and role to see your database's local connection string.</p>
        <div class="section">
            <label for="database">Database</label>
            <select id="database">
                <option value="">Select Database</option>
                ${data.databases.map(db => `
                    <option value="${db.name}" ${db.name === data.selectedDatabase ? 'selected' : ''}>
                        ${db.name}
                    </option>
                `).join('')}
            </select>
        </div>
        <div class="section">
            <label for="role">Role</label>
            <select id="role">
                <option value="">Select Role</option>
                ${data.roles.map(role => `
                    <option value="${role.name}" ${role.name === data.selectedRole ? 'selected' : ''}>
                        ${role.name}
                    </option>
                `).join('')}
            </select>
        </div>
        
        ${data.connectionInfo ? `
        <div class="detail-row">
            <div class="detail-label-container">
                <div class="detail-label">Local Connection String</div>
                <button class="copy-button" title="Copy connection string">
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M10.75 1.75H4.25C3.97386 1.75 3.75 1.97386 3.75 2.25V11.25C3.75 11.5261 3.97386 11.75 4.25 11.75H10.75C11.0261 11.75 11.25 11.5261 11.25 11.25V2.25C11.25 1.97386 11.0261 1.75 10.75 1.75Z" stroke="currentColor" stroke-width="1.5"/>
                        <path d="M12.25 4.25H13.75V13.75H5.75V12.25" stroke="currentColor" stroke-width="1.5"/>
                    </svg>
                    <span class="copy-success">Copied!</span>
                </button>
            </div>
            <div class="detail-value connection-string-container">
                <div class="connection-string">${data.connectionInfo}</div>
            </div>
        </div>
        ` : ''}
        
        ${data.selectedDriver === 'serverless' ? `
        <div class="detail-row">
            <div class="detail-label-container">
                <div class="detail-label">Fetch Endpoint</div>
                <button class="copy-button" title="Copy fetch endpoint configuration">
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M10.75 1.75H4.25C3.97386 1.75 3.75 1.97386 3.75 2.25V11.25C3.75 11.5261 3.97386 11.75 4.25 11.75H10.75C11.0261 11.75 11.25 11.5261 11.25 11.25V2.25C11.25 1.97386 11.0261 1.75 10.75 1.75Z" stroke="currentColor" stroke-width="1.5"/>
                        <path d="M12.25 4.25H13.75V13.75H5.75V12.25" stroke="currentColor" stroke-width="1.5"/>
                    </svg>
                    <span class="copy-success">Copied!</span>
                </button>
            </div>
            <div class="detail-value connection-string-container">
                <div class="connection-string">import { neonConfig } from '@neondatabase/serverless';</br></br>neonConfig.fetchEndpoint = 'http://localhost:5432/sql';</div>
            </div>
        </div>
        ` : ''}
    </div>
`;

const getNotConnectedContent = (): string => `
    <div class="not-connected">
        <p>Connect to a Neon database to see connection strings.</p>
    </div>
`;

const getClientScript = (): string => `
    <script>
        const vscode = acquireVsCodeApi();

        // Handle incoming messages
        window.addEventListener('message', event => {
            const message = event.data;
            console.log('DatabaseView received message:', message);
            
            if (message.command === 'updateViewData') {
                const data = message.data;
                updateViewContent(data);
            }
        });

        function updateViewContent(data) {
            try {
                const container = document.getElementById('app');
                if (!container) {
                    console.warn('Container element not found');
                    return;
                }

                // Update the container content based on connection status
                if (data.connected) {
                    // Update database dropdown
                    const databaseSelect = document.getElementById('database');
                    if (databaseSelect) {
                        const currentValue = databaseSelect.value;
                        databaseSelect.innerHTML = \`
                            <option value="">Select Database</option>
                            \${data.databases.map(db => \`
                                <option value="\${db.name}" \${db.name === data.selectedDatabase ? 'selected' : ''}>
                                    \${db.name}
                                </option>
                            \`).join('')}
                        \`;
                        // Only trigger change if value actually changed
                        if (currentValue !== databaseSelect.value) {
                            databaseSelect.dispatchEvent(new Event('change'));
                        }
                    }

                    // Update role dropdown
                    const roleSelect = document.getElementById('role');
                    if (roleSelect) {
                        const currentValue = roleSelect.value;
                        roleSelect.innerHTML = \`
                            <option value="">Select Role</option>
                            \${data.roles.map(role => \`
                                <option value="\${role.name}" \${role.name === data.selectedRole ? 'selected' : ''}>
                                    \${role.name}
                                </option>
                            \`).join('')}
                        \`;
                        // Only trigger change if value actually changed
                        if (currentValue !== roleSelect.value) {
                            roleSelect.dispatchEvent(new Event('change'));
                        }
                    }

                    // Update connection string if it exists
                    const connectionStringContainer = document.querySelector('.connection-string');
                    if (connectionStringContainer && data.connectionInfo) {
                        connectionStringContainer.textContent = data.connectionInfo;
                    }

                    // Update fetch endpoint if needed
                    if (data.selectedDriver === 'serverless') {
                        const fetchEndpointContainer = document.querySelector('.fetch-endpoint .connection-string');
                        if (fetchEndpointContainer) {
                            fetchEndpointContainer.innerHTML = 'import { neonConfig } from \'@neondatabase/serverless\';</br></br>neonConfig.fetchEndpoint = \'http://localhost:5432/sql\';';
                        }
                    }
                }
            } catch (error) {
                console.error('Error updating view content:', error);
            }
        }

        document.addEventListener('DOMContentLoaded', () => {
            // Setup database dropdown
            const databaseSelect = document.getElementById('database');
            if (databaseSelect) {
                databaseSelect.addEventListener('change', () => {
                    vscode.postMessage({
                        command: 'selectDatabase',
                        database: databaseSelect.value
                    });
                });
            }

            // Setup role dropdown
            const roleSelect = document.getElementById('role');
            if (roleSelect) {
                roleSelect.addEventListener('change', () => {
                    vscode.postMessage({
                        command: 'selectRole',
                        role: roleSelect.value
                    });
                });
            }

            // Setup copy buttons
            document.addEventListener('click', (e) => {
                const button = e.target.closest('.copy-button');
                if (button) {
                    const detailRow = button.closest('.detail-row');
                    const connectionString = detailRow?.querySelector('.connection-string')?.textContent;
                    if (connectionString) {
                        navigator.clipboard.writeText(connectionString).then(() => {
                            const successMessage = button.querySelector('.copy-success');
                            if (successMessage) {
                                successMessage.classList.add('visible');
                                setTimeout(() => {
                                    successMessage.classList.remove('visible');
                                }, 2000);
                            }
                        });
                    }
                }
            });
        });
    </script>
`; 