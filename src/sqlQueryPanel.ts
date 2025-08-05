import * as vscode from 'vscode';
import * as os from 'os';
import { SqlQueryService, QueryResult, QueryError } from './services/sqlQuery.service';
import { StateService } from './services/state.service';

export class SqlQueryPanel {
    public static currentPanel: SqlQueryPanel | undefined;
    private readonly panel: vscode.WebviewPanel;
    private disposables: vscode.Disposable[] = [];

    public static createOrShow(
        context: vscode.ExtensionContext,
        stateService: StateService,
        initialQuery?: string,
        database?: string
    ) {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        // If we already have a panel, show it
        if (SqlQueryPanel.currentPanel) {
            SqlQueryPanel.currentPanel.panel.reveal(column);
            if (initialQuery) {
                SqlQueryPanel.currentPanel.setQuery(initialQuery);
            }
            // Update the database context if provided
            if (database) {
                SqlQueryPanel.currentPanel.database = database;
                SqlQueryPanel.currentPanel.sendMessage({
                    command: 'updateDatabase',
                    database: database
                });
            }
            return;
        }

        // Otherwise, create a new panel
        const panel = vscode.window.createWebviewPanel(
            'sqlQuery',
            'SQL Query',
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                enableFindWidget: true,
                retainContextWhenHidden: true,
                localResourceRoots: [context.extensionUri]
            }
        );

        SqlQueryPanel.currentPanel = new SqlQueryPanel(panel, context, stateService, initialQuery, database);
    }

    private constructor(
        panel: vscode.WebviewPanel,
        private context: vscode.ExtensionContext,
        private stateService: StateService,
        initialQuery?: string,
        private database?: string
    ) {
        this.panel = panel;
        this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
        this.panel.webview.html = this.getWebviewContent();

        // Set up message handling
        this.panel.webview.onDidReceiveMessage(
            async (message) => {
                await this.handleMessage(message);
            },
            null,
            this.disposables
        );

        // Send initial data
        setTimeout(() => {
            this.sendMessage({
                command: 'initialize',
                query: initialQuery || '',
                database: this.database
            });
        }, 100);
    }

    private async handleMessage(message: any) {
        const sqlService = new SqlQueryService(this.stateService, this.context);
        
        switch (message.command) {
            case 'executeQuery':
                try {
                    const result = await sqlService.executeQuery(message.query, this.database);
                    this.sendMessage({
                        command: 'queryResult',
                        result,
                        success: true
                    });
                } catch (error) {
                    this.sendMessage({
                        command: 'queryResult',
                        error: error as QueryError,
                        success: false
                    });
                }
                break;

            case 'validateQuery':
                const validation = sqlService.validateSql(message.query);
                this.sendMessage({
                    command: 'validationResult',
                    validation
                });
                break;

            case 'showExportDialog':
                await this.showExportDialog(message.data);
                break;

            case 'exportResults':
                await this.exportResults(message.data, message.format);
                break;
        }
    }

    private sendMessage(message: any) {
        this.panel.webview.postMessage(message);
    }

    public setQuery(query: string) {
        this.sendMessage({
            command: 'setQuery',
            query
        });
    }

    private async showExportDialog(data: any[]) {
        // Show quick pick for format selection
        const format = await vscode.window.showQuickPick(
            [
                { label: 'CSV', value: 'csv', description: 'Comma-separated values' },
                { label: 'JSON', value: 'json', description: 'JavaScript Object Notation' }
            ],
            {
                placeHolder: 'Select export format',
                title: 'Export Results'
            }
        );

        if (format) {
            await this.exportResults(data, format.value as 'csv' | 'json');
        }
    }

    private async exportResults(data: any[], format: 'csv' | 'json') {
        try {
            // Use workspace folder as default, or user's home directory if no workspace
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri;
            const defaultDir = workspaceFolder || vscode.Uri.file(os.homedir());
            const defaultUri = vscode.Uri.joinPath(defaultDir, `results.${format}`);

            const uri = await vscode.window.showSaveDialog({
                defaultUri: defaultUri,
                filters: format === 'csv' 
                    ? { 'CSV Files': ['csv'], 'All Files': ['*'] }
                    : { 'JSON Files': ['json'], 'All Files': ['*'] }
            });

            if (uri) {
                let content: string;
                if (format === 'csv') {
                    // Convert to CSV
                    if (data.length === 0) {
                        content = '';
                    } else {
                        const headers = Object.keys(data[0]).join(',');
                        const rows = data.map(row => 
                            Object.values(row).map(value => 
                                typeof value === 'string' && value.includes(',') 
                                    ? `"${value.replace(/"/g, '""')}"` 
                                    : String(value)
                            ).join(',')
                        );
                        content = [headers, ...rows].join('\n');
                    }
                } else {
                    // Convert to JSON
                    content = JSON.stringify(data, null, 2);
                }

                await vscode.workspace.fs.writeFile(uri, Buffer.from(content, 'utf8'));
                vscode.window.showInformationMessage(`Results exported to ${uri.fsPath}`);
            }
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to export results: ${error}`);
        }
    }

    private getWebviewContent(): string {
        // Note: We use inline styles instead of external CSS files

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>SQL Query</title>
    <style>
        body {
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            background-color: var(--vscode-editor-background);
            color: var(--vscode-editor-foreground);
            margin: 0;
            padding: 0;
            height: 100vh;
            display: flex;
            flex-direction: column;
        }

        .toolbar {
            display: flex;
            align-items: center;
            padding: 8px 16px;
            background-color: var(--vscode-toolbar-activeBackground, var(--vscode-tab-activeBackground));
            border-bottom: 1px solid var(--vscode-panel-border);
            gap: 8px;
            flex-shrink: 0;
        }

        .toolbar button {
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 6px 12px;
            border-radius: 3px;
            cursor: pointer;
            font-size: 13px;
        }

        .toolbar button:hover {
            background-color: var(--vscode-button-hoverBackground);
        }

        .toolbar button:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }

        .query-editor {
            flex: 1;
            min-height: 200px;
            font-family: var(--vscode-editor-font-family);
            font-size: var(--vscode-editor-font-size);
            background-color: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            padding: 12px;
            resize: vertical;
            outline: none;
        }

        .results-section {
            flex: 1;
            display: flex;
            flex-direction: column;
            min-height: 200px;
        }

        .results-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 8px 16px;
            background-color: var(--vscode-titleBar-activeBackground);
            border-bottom: 1px solid var(--vscode-panel-border);
            font-weight: 600;
        }

        .results-table {
            flex: 1;
            overflow: auto;
            background-color: var(--vscode-editor-background);
        }

        table {
            width: 100%;
            border-collapse: collapse;
            font-size: 13px;
        }

        th, td {
            text-align: left;
            padding: 8px 12px;
            border-bottom: 1px solid var(--vscode-panel-border);
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            max-width: 200px;
        }

        th {
            background-color: var(--vscode-list-headerBackground);
            font-weight: 600;
            position: sticky;
            top: 0;
            z-index: 1;
        }

        tr:hover {
            background-color: var(--vscode-list-hoverBackground);
        }

        .status-bar {
            padding: 4px 16px;
            background-color: var(--vscode-statusBar-background);
            color: var(--vscode-statusBar-foreground);
            font-size: 12px;
            border-top: 1px solid var(--vscode-panel-border);
            flex-shrink: 0;
        }

        .error {
            color: var(--vscode-errorForeground);
            padding: 16px;
            background-color: var(--vscode-inputValidation-errorBackground);
            border: 1px solid var(--vscode-inputValidation-errorBorder);
            margin: 16px;
            border-radius: 3px;
            white-space: pre-wrap;
        }

        .loading {
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 32px;
            font-style: italic;
        }

        .no-results {
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 32px;
            color: var(--vscode-descriptionForeground);
        }

        .splitter {
            height: 4px;
            background-color: var(--vscode-panel-border);
            cursor: row-resize;
            flex-shrink: 0;
        }

        .splitter:hover {
            background-color: var(--vscode-focusBorder);
        }
    </style>
</head>
<body>
    <div class="toolbar">
        <button id="executeBtn">Run Query</button>
        <button id="exportBtn" disabled>Export Results</button>
        <span id="statusText"></span>
    </div>
    
    <textarea 
        id="queryEditor" 
        class="query-editor" 
        placeholder="Enter your SQL query here..."
        spellcheck="false"
    ></textarea>
    
    <div class="splitter" id="splitter"></div>
    
    <div class="results-section">
        <div class="results-header">
            <span id="resultsTitle">Results</span>
            <span id="resultsInfo"></span>
        </div>
        <div class="results-table" id="resultsContainer">
            <div class="no-results">Execute a query to see results</div>
        </div>
    </div>
    
    <div class="status-bar" id="statusBar">
        Ready
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        
        let currentData = [];
        
        // Elements
        const queryEditor = document.getElementById('queryEditor');
        const executeBtn = document.getElementById('executeBtn');
        const exportBtn = document.getElementById('exportBtn');
        const resultsContainer = document.getElementById('resultsContainer');
        const resultsInfo = document.getElementById('resultsInfo');
        const statusBar = document.getElementById('statusBar');
        const splitter = document.getElementById('splitter');
        
        // Event listeners
        executeBtn.addEventListener('click', executeQuery);
        exportBtn.addEventListener('click', exportResults);
        
        // Keyboard shortcuts
        queryEditor.addEventListener('keydown', (e) => {
            if (e.ctrlKey && e.key === 'Enter') {
                e.preventDefault();
                executeQuery();
            }
        });
        
        // Splitter functionality
        let isDragging = false;
        let startY = 0;
        let startHeight = 0;
        
        splitter.addEventListener('mousedown', (e) => {
            isDragging = true;
            startY = e.clientY;
            startHeight = queryEditor.offsetHeight;
            document.addEventListener('mousemove', handleSplitterDrag);
            document.addEventListener('mouseup', stopSplitterDrag);
        });
        
        function handleSplitterDrag(e) {
            if (!isDragging) return;
            const deltaY = e.clientY - startY;
            const newHeight = Math.max(100, startHeight + deltaY);
            queryEditor.style.height = newHeight + 'px';
        }
        
        function stopSplitterDrag() {
            isDragging = false;
            document.removeEventListener('mousemove', handleSplitterDrag);
            document.removeEventListener('mouseup', stopSplitterDrag);
        }
        
        // Message handling
        window.addEventListener('message', (event) => {
            const message = event.data;
            
            switch (message.command) {
                case 'initialize':
                    if (message.query) {
                        queryEditor.value = message.query;
                    }
                    updateStatus('Ready');
                    break;
                    
                case 'setQuery':
                    queryEditor.value = message.query;
                    break;
                    
                case 'queryResult':
                    handleQueryResult(message);
                    break;
                    
                case 'validationResult':
                    handleValidationResult(message.validation);
                    break;
            }
        });
        
        function executeQuery() {
            const query = queryEditor.value.trim();
            if (!query) return;
            
            updateStatus('Executing query...');
            setButtonsEnabled(false);
            
            vscode.postMessage({
                command: 'executeQuery',
                query: query
            });
        }
        
        function exportResults() {
            if (currentData.length === 0) return;
            
            // Send message to extension to show format selection dialog
            vscode.postMessage({
                command: 'showExportDialog',
                data: currentData
            });
        }
        
        function handleQueryResult(message) {
            setButtonsEnabled(true);
            
            if (message.success) {
                const result = message.result;
                currentData = result.rows;
                displayResults(result);
                updateStatus(\`Query executed in \${result.executionTime}ms - \${result.rowCount} rows\`);
                exportBtn.disabled = result.rowCount === 0;
            } else {
                displayError(message.error);
                updateStatus('Query failed');
                exportBtn.disabled = true;
            }
        }
        
        function displayResults(result) {
            if (result.rowCount === 0) {
                resultsContainer.innerHTML = '<div class="no-results">No results</div>';
                resultsInfo.textContent = 'No rows';
                return;
            }
            
            const table = document.createElement('table');
            
            // Create header
            const thead = document.createElement('thead');
            const headerRow = document.createElement('tr');
            result.columns.forEach(col => {
                const th = document.createElement('th');
                th.textContent = col;
                th.title = col;
                headerRow.appendChild(th);
            });
            thead.appendChild(headerRow);
            table.appendChild(thead);
            
            // Create body
            const tbody = document.createElement('tbody');
            result.rows.forEach(row => {
                const tr = document.createElement('tr');
                result.columns.forEach(col => {
                    const td = document.createElement('td');
                    const value = row[col];
                    td.textContent = value === null ? 'NULL' : String(value);
                    td.title = td.textContent;
                    tr.appendChild(td);
                });
                tbody.appendChild(tr);
            });
            table.appendChild(tbody);
            
            resultsContainer.innerHTML = '';
            resultsContainer.appendChild(table);
            resultsInfo.textContent = \`\${result.rowCount} rows\`;
        }
        
        function displayError(error) {
            const errorDiv = document.createElement('div');
            errorDiv.className = 'error';
            
            let errorText = error.message;
            if (error.line) {
                errorText += \`\\nLine: \${error.line}\`;
            }
            if (error.position) {
                errorText += \`\\nPosition: \${error.position}\`;
            }
            if (error.detail) {
                errorText += \`\\nDetail: \${error.detail}\`;
            }
            
            errorDiv.textContent = errorText;
            resultsContainer.innerHTML = '';
            resultsContainer.appendChild(errorDiv);
            resultsInfo.textContent = 'Error';
        }
        
        function setButtonsEnabled(enabled) {
            executeBtn.disabled = !enabled;
        }
        
        function updateStatus(text) {
            statusBar.textContent = text;
        }
    </script>
</body>
</html>`;
    }

    public dispose() {
        SqlQueryPanel.currentPanel = undefined;

        this.panel.dispose();

        while (this.disposables.length) {
            const disposable = this.disposables.pop();
            if (disposable) {
                disposable.dispose();
            }
        }
    }
}