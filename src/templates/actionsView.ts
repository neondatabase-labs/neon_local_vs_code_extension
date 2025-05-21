import { ViewData } from '../types';
import { getStyles } from './styles';

export const getActionsHtml = (data: ViewData): string => {
    return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Actions</title>
        ${getStyles()}
    </head>
    <body>
        <div class="container">
            ${data.connected ? getActionsContent(data) : getNotConnectedContent()}
        </div>
        ${getClientScript()}
    </body>
    </html>
    `;
};

const getActionsContent = (data: ViewData): string => `
    <div class="actions-container">
        <div class="action-group">
            <button id="resetFromParent" class="action-button" ${!data.selectedBranchId ? 'disabled' : ''}>
                Reset from Parent
            </button>
            <button id="openSqlEditor" class="action-button">
                Open SQL Editor
            </button>
            ${data.selectedDriver === 'postgres' ? `
                <button id="launchPsql" class="action-button">
                    Launch PSQL
                </button>
            ` : ''}
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
            console.log('ActionsView received message:', message);
            
            if (message.command === 'updateViewData') {
                // Reload the entire view with new data
                vscode.postMessage({ command: 'refresh' });
            }
        });

        document.addEventListener('DOMContentLoaded', () => {
            // Setup action buttons
            document.addEventListener('click', (e) => {
                if (e.target.id === 'resetFromParent') {
                    vscode.postMessage({ command: 'resetFromParent' });
                } else if (e.target.id === 'openSqlEditor') {
                    vscode.postMessage({ command: 'openSqlEditor' });
                } else if (e.target.id === 'launchPsql') {
                    vscode.postMessage({ command: 'launchPsql' });
                }
            });
        });
    </script>
`; 