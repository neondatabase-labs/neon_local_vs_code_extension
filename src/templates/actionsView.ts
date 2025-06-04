import { ViewData } from '../types';
import { getStyles } from './styles';

export const getActionsHtml = (data: ViewData): string => {
    return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>DatabaseActions</title>
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

const getActionsContent = (data: ViewData): string => {
    // Log the state when rendering
    console.log('ActionsView: Rendering actions content with data:', {
        connected: data.connected,
        connectionType: data.connectionType,
        isStarting: data.isStarting,
        selectedBranchId: data.selectedBranchId,
        parentBranchId: data.parentBranchId
    });
    
    // Only show buttons when connected
    if (!data.connected) {
        return `
            <div class="not-connected">
                <p>Connect to a Neon database to see available actions.</p>
            </div>
        `;
    }
    
    return `
        <div class="actions-content">
            ${data.connectionType === 'new' ? `
                <button id="resetFromParent" class="action-button">
                    Reset from Parent Branch
                </button>
            ` : ''}
            <button id="openSqlEditor" class="action-button">
                Open SQL Editor
            </button>
            <button id="openTableView" class="action-button">
                Open Table View
            </button>
            <button id="launchPsql" class="action-button">
                Launch PSQL
            </button>
        </div>
    `;
};

const getNotConnectedContent = (): string => `
    <div class="not-connected">
        <p>Connect to a Neon database to see available actions.</p>
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
                const data = message.data;
                console.log('ActionsView updating content with data:', {
                    connected: data.connected,
                    connectionType: data.connectionType,
                    isStarting: data.isStarting,
                    selectedBranchId: data.selectedBranchId,
                    parentBranchId: data.parentBranchId
                });
                
                // Get the container element
                const container = document.querySelector('.container');
                if (!container) {
                    console.error('Container element not found');
                    return;
                }

                // Only show buttons when connected
                if (!data.connected) {
                    container.innerHTML = \`
                        <div class="not-connected">
                            <p>Connect to a Neon database to see available actions.</p>
                        </div>
                    \`;
                    return;
                }

                // Update the container content
                container.innerHTML = \`
                    <div class="actions-content">
                        \${data.connectionType === 'new' ? \`
                            <button id="resetFromParent" class="action-button">
                                Reset from Parent Branch
                            </button>
                        \` : ''}
                        <button id="openSqlEditor" class="action-button">
                            Open SQL Editor
                        </button>
                        <button id="openTableView" class="action-button">
                            Open Table View
                        </button>
                        <button id="launchPsql" class="action-button">
                            Launch PSQL
                        </button>
                    </div>
                \`;

                // Re-attach event listeners
                setupEventListeners();
            }
        });

        function setupEventListeners() {
            // Remove any existing listeners first
            document.querySelectorAll('.action-button').forEach(button => {
                button.replaceWith(button.cloneNode(true));
            });

            // Setup action buttons
            document.querySelectorAll('.action-button').forEach(button => {
                button.addEventListener('click', (e) => {
                    const id = e.target.id;
                    if (!id) return;

                    switch(id) {
                        case 'resetFromParent':
                            vscode.postMessage({ command: 'resetFromParent' });
                            break;
                        case 'openSqlEditor':
                            vscode.postMessage({ command: 'openSqlEditor' });
                            break;
                        case 'openTableView':
                            vscode.postMessage({ command: 'openTableView' });
                            break;
                        case 'launchPsql':
                            vscode.postMessage({ command: 'launchPsql' });
                            break;
                    }
                });
            });
        }

        // Initial setup of event listeners
        setupEventListeners();
    </script>
`; 