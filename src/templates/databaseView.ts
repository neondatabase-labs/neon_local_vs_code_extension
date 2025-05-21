import { ViewData } from '../types';
import { getStyles } from './styles';

export const getDatabaseHtml = (data: ViewData): string => {
    return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Database</title>
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
        <p class="description">Select a database and role to see your database's connection string.</p>
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
        
        <div class="detail-row">
            <div class="detail-label-container">
                <div class="detail-label">Connection String</div>
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
    </div>
`;

const getNotConnectedContent = (): string => `
    <div class="not-connected">
        <p>Please connect to a database in the Connect view first.</p>
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
                // Reload the entire view with new data
                vscode.postMessage({ command: 'refresh' });
            }
        });

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
        });
    </script>
`; 