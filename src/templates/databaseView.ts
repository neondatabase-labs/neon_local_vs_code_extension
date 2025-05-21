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
        <div class="container">
            <h2>Database Tools</h2>
            ${data.connected ? getDatabaseContent(data) : getNotConnectedContent()}
        </div>
        ${getClientScript()}
    </body>
    </html>
    `;
};

const getDatabaseContent = (data: ViewData): string => `
    <div class="database-content">
        <div class="connection-info">
            <h3>Connection Information</h3>
            <div class="connection-string-container">
                <code class="connection-string">${data.connectionInfo || ''}</code>
                <button class="copy-button">Copy</button>
                <span class="copy-success">Copied!</span>
            </div>
        </div>
        <div class="database-tools">
            <button id="openSqlEditor" class="sql-editor-button">Open SQL Editor</button>
            ${data.selectedDriver === 'postgres' ? '<button id="launchPsql" class="psql-button">Launch PSQL</button>' : ''}
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

        document.addEventListener('DOMContentLoaded', () => {
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

            // Setup database tool buttons
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
        });
    </script>
`; 