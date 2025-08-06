import * as vscode from 'vscode';
import { TableDataService, TableDataResult, TableRow, ColumnDefinition, InsertRowData, UpdateRowData } from './services/tableData.service';
import { StateService } from './services/state.service';

export class TableDataPanel {
    public static currentPanels = new Map<string, TableDataPanel>();
    private readonly panel: vscode.WebviewPanel;
    private disposables: vscode.Disposable[] = [];
    private currentPage = 0;
    private pageSize = 100;
    private tableData: TableDataResult | null = null;

    public static createOrShow(
        context: vscode.ExtensionContext,
        stateService: StateService,
        schema: string,
        tableName: string,
        database?: string
    ) {
        const key = `${database || 'default'}.${schema}.${tableName}`;
        
        // If we already have a panel for this table, show it
        if (TableDataPanel.currentPanels.has(key)) {
            const existingPanel = TableDataPanel.currentPanels.get(key)!;
            existingPanel.panel.reveal();
            return;
        }

        // Otherwise, create a new panel
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        const panel = vscode.window.createWebviewPanel(
            'tableData',
            `${schema}.${tableName}`,
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                enableFindWidget: true,
                retainContextWhenHidden: true,
                localResourceRoots: [context.extensionUri]
            }
        );

        TableDataPanel.currentPanels.set(key, new TableDataPanel(panel, context, stateService, schema, tableName, database));
    }

    private constructor(
        panel: vscode.WebviewPanel,
        private context: vscode.ExtensionContext,
        private stateService: StateService,
        private schema: string,
        private tableName: string,
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

        // Load initial data
        this.loadTableData();
    }

    private async handleMessage(message: any) {
        const tableDataService = new TableDataService(this.stateService, this.context);
        
        switch (message.command) {
            case 'loadPage':
                this.currentPage = message.page;
                await this.loadTableData();
                break;

            case 'changeLimitSize':
                this.pageSize = message.limit;
                this.currentPage = 0; // Reset to first page when changing limit
                await this.loadTableData();
                break;

            case 'insertRow':
                try {
                    const newRow = await tableDataService.insertRow(
                        this.schema, 
                        this.tableName, 
                        message.rowData as InsertRowData,
                        this.database
                    );
                    
                    this.sendMessage({
                        command: 'rowInserted',
                        row: newRow,
                        success: true
                    });

                    // Refresh data to show the new row in the correct position
                    await this.loadTableData();
                } catch (error) {
                    this.sendMessage({
                        command: 'rowInserted',
                        error: error instanceof Error ? error.message : 'Unknown error',
                        success: false
                    });
                }
                break;

            case 'updateRow':
                try {
                    const updateData: UpdateRowData = {
                        primaryKeyValues: message.primaryKeyValues,
                        newValues: message.newValues
                    };
                    
                    const updatedRow = await tableDataService.updateRow(
                        this.schema, 
                        this.tableName, 
                        updateData,
                        this.database
                    );
                    
                    this.sendMessage({
                        command: 'rowUpdated',
                        row: updatedRow,
                        success: true
                    });

                    // Refresh data to show the updated row
                    await this.loadTableData();
                } catch (error) {
                    this.sendMessage({
                        command: 'rowUpdated',
                        error: error instanceof Error ? error.message : 'Unknown error',
                        success: false
                    });
                }
                break;

            case 'deleteRow':
                try {
                    await tableDataService.deleteRow(
                        this.schema, 
                        this.tableName, 
                        message.primaryKeyValues,
                        this.database
                    );
                    
                    this.sendMessage({
                        command: 'rowDeleted',
                        success: true
                    });

                    // Refresh data to remove the deleted row
                    await this.loadTableData();
                } catch (error) {
                    this.sendMessage({
                        command: 'rowDeleted',
                        error: error instanceof Error ? error.message : 'Unknown error',
                        success: false
                    });
                }
                break;

            case 'validateRow':
                try {
                    const validation = tableDataService.validateRowData(message.rowData, this.tableData?.columns || []);
                    this.sendMessage({
                        command: 'validationResult',
                        validation
                    });
                } catch (error) {
                    this.sendMessage({
                        command: 'validationResult',
                        validation: { isValid: false, errors: ['Validation failed'] }
                    });
                }
                break;

            case 'openNeonConsole':
                try {
                    await this.openNeonConsole();
                } catch (error) {
                    this.sendMessage({
                        command: 'error',
                        error: error instanceof Error ? error.message : 'Failed to open Neon console'
                    });
                }
                break;

            case 'refresh':
                await this.loadTableData();
                break;
        }
    }

    private async loadTableData() {
        try {
            this.sendMessage({ command: 'loading', loading: true });
            
            const tableDataService = new TableDataService(this.stateService, this.context);
            this.tableData = await tableDataService.getTableData(
                this.schema, 
                this.tableName, 
                this.currentPage * this.pageSize, 
                this.pageSize,
                this.database
            );

            this.sendMessage({
                command: 'dataLoaded',
                data: this.tableData,
                page: this.currentPage,
                pageSize: this.pageSize
            });
        } catch (error) {
            this.sendMessage({
                command: 'error',
                error: error instanceof Error ? error.message : 'Failed to load table data'
            });
        } finally {
            this.sendMessage({ command: 'loading', loading: false });
        }
    }

    private sendMessage(message: any) {
        this.panel.webview.postMessage(message);
    }

    private async openNeonConsole(): Promise<void> {
        try {
            // Get the current project and branch IDs
            const viewData = await this.stateService.getViewData();
            const projectId = viewData.connection?.selectedProjectId;
            const branchId = viewData.connectionType === 'new' ? 
                viewData.currentlyConnectedBranch : 
                viewData.connection?.selectedBranchId;
            
            if (!projectId || !branchId) {
                throw new Error('Project ID or Branch ID not found');
            }

            // Use the database from the table data panel context
            const database = this.database || viewData.selectedDatabase || 'postgres';
            
            // Construct the Neon console URL for the specific table
            // The URL pattern might be different for specific tables, using the general tables view with filters
            const tableViewUrl = `https://console.neon.tech/app/projects/${projectId}/branches/${branchId}/tables?database=${database}&schema=${this.schema}&table=${this.tableName}`;
            
            // Open in external browser
            await vscode.env.openExternal(vscode.Uri.parse(tableViewUrl));
        } catch (error) {
            console.error('Error opening Neon console:', error);
            throw error;
        }
    }

    private getWebviewContent(): string {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Table Data: ${this.schema}.${this.tableName}</title>
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
            justify-content: space-between;
            padding: 8px 16px;
            background-color: var(--vscode-toolbar-activeBackground, var(--vscode-tab-activeBackground));
            border-bottom: 1px solid var(--vscode-panel-border);
            flex-shrink: 0;
        }

        .toolbar-left {
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .toolbar-right {
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .table-indicator {
            display: flex;
            align-items: center;
            padding: 4px 8px;
            background-color: var(--vscode-toolbar-activeBackground, var(--vscode-tab-activeBackground));
            color: var(--vscode-badge-foreground);
            border: 1px solid var(--vscode-badge-background);
            border-radius: 12px;
            font-size: 11px;
            font-weight: 500;
            margin-right: 8px;
            white-space: nowrap;
            min-width: 0;
        }

        .table-indicator .table-icon {
            width: 12px;
            height: 12px;
            margin-right: 4px;
            flex-shrink: 0;
        }

        .table-indicator .table-icon svg {
            width: 100%;
            height: 100%;
            color: var(--vscode-badge-foreground);
        }

        .btn {
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 6px 12px;
            border-radius: 3px;
            cursor: pointer;
            font-size: 13px;
        }

        .btn:hover {
            background-color: var(--vscode-button-hoverBackground);
        }

        .btn:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }

        .btn-secondary {
            background-color: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
        }

        .btn-secondary:hover {
            background-color: var(--vscode-button-secondaryHoverBackground);
        }

        .btn-danger {
            background-color: var(--vscode-errorForeground);
            color: var(--vscode-editor-background);
        }

        .table-container {
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
            border-right: 1px solid var(--vscode-panel-border);
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            max-width: 200px;
            position: relative;
        }

        th {
            background-color: var(--vscode-list-headerBackground, var(--vscode-editor-background));
            font-weight: 600;
            position: sticky;
            top: 0;
            z-index: 10;
            opacity: 1;
            backdrop-filter: blur(0px);
        }

        th:first-child {
            z-index: 11;
            background-color: var(--vscode-list-headerBackground, var(--vscode-editor-background));
            opacity: 1;
        }

        .row-number {
            background-color: var(--vscode-list-headerBackground, var(--vscode-editor-background));
            position: sticky;
            left: 0;
            z-index: 9;
            font-weight: bold;
            text-align: center;
            width: 60px;
            min-width: 60px;
            max-width: 60px;
            opacity: 1;
        }

        .actions-cell {
            position: sticky;
            right: 0;
            background-color: var(--vscode-editor-background);
            z-index: 9;
            text-align: center;
            width: 60px;
            min-width: 60px;
            max-width: 60px;
        }

        .actions-header {
            position: sticky;
            right: 0;
            background-color: var(--vscode-list-headerBackground, var(--vscode-editor-background));
            z-index: 11;
            width: 60px;
            min-width: 60px;
            max-width: 60px;
            opacity: 1;
        }

        tr:hover {
            background-color: var(--vscode-list-hoverBackground);
        }

        tr:hover .actions-cell {
            background-color: var(--vscode-list-hoverBackground);
        }

        .editable-cell {
            cursor: pointer;
        }

        .editable-cell:hover {
            background-color: var(--vscode-list-activeSelectionBackground);
        }

        .cell-editor {
            width: 100%;
            background-color: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            padding: 4px;
            font-size: inherit;
            font-family: inherit;
        }

        .page-info {
            color: var(--vscode-statusBar-foreground);
            font-size: 12px;
        }

        .pagination-controls {
            display: flex;
            align-items: center;
            gap: 8px;
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

        .no-data {
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 32px;
            color: var(--vscode-descriptionForeground);
        }



        .action-btn {
            color: var(--vscode-foreground);
            background: none;
            border: none;
            cursor: pointer;
            padding: 4px;
            border-radius: 2px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            margin: 0 2px;
        }

        .action-btn:hover {
            background-color: var(--vscode-toolbar-hoverBackground);
        }

        .action-btn svg {
            width: 14px;
            height: 14px;
            fill: currentColor;
        }

        .edit-btn:hover {
            color: var(--vscode-charts-blue);
        }

        .delete-btn:hover {
            color: var(--vscode-errorForeground);
        }

        .save-btn:hover {
            color: var(--vscode-charts-green);
        }

        .cancel-btn:hover {
            color: var(--vscode-charts-orange);
        }

        .row-editing .editable-cell {
            background-color: var(--vscode-input-background);
            border: 1px solid var(--vscode-input-border);
            cursor: pointer;
        }

        .row-editing .editable-cell:hover {
            background-color: var(--vscode-list-activeSelectionBackground);
        }

        .primary-key {
            font-weight: bold;
            color: var(--vscode-charts-yellow);
        }

        .foreign-key {
            color: var(--vscode-charts-blue);
        }

        .null-value {
            color: var(--vscode-descriptionForeground);
            font-style: italic;
        }

        /* Modal styles */
        .modal {
            display: none;
            position: fixed;
            z-index: 1000;
            left: 0;
            top: 0;
            width: 100%;
            height: 100%;
            background-color: rgba(0, 0, 0, 0.5);
        }

        .modal-content {
            background-color: var(--vscode-editor-background);
            margin: 10% auto;
            padding: 20px;
            border: 1px solid var(--vscode-panel-border);
            width: 80%;
            max-width: 600px;
            border-radius: 3px;
        }

        .modal-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 20px;
            padding-bottom: 10px;
            border-bottom: 1px solid var(--vscode-panel-border);
        }

        .modal-title {
            font-size: 16px;
            font-weight: bold;
        }

        .close {
            color: var(--vscode-foreground);
            font-size: 28px;
            font-weight: bold;
            cursor: pointer;
        }

        .close:hover {
            color: var(--vscode-errorForeground);
        }

        .form-group {
            margin-bottom: 15px;
        }

        .form-label {
            display: block;
            margin-bottom: 5px;
            font-weight: bold;
        }

        .form-input {
            width: 100%;
            background-color: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            padding: 8px;
            border-radius: 3px;
            font-size: 13px;
            font-family: inherit;
        }

        .form-actions {
            display: flex;
            justify-content: flex-end;
            gap: 8px;
            margin-top: 20px;
            padding-top: 15px;
            border-top: 1px solid var(--vscode-panel-border);
        }

        .required {
            color: var(--vscode-errorForeground);
        }

        .column-info {
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
            margin-top: 2px;
        }

        /* Confirmation Dialog */
        .confirm-dialog {
            display: none;
            position: fixed;
            z-index: 2000;
            left: 0;
            top: 0;
            width: 100%;
            height: 100%;
            background-color: rgba(0, 0, 0, 0.6);
        }

        .confirm-content {
            background-color: var(--vscode-editor-background);
            margin: 20% auto;
            padding: 20px;
            border: 1px solid var(--vscode-panel-border);
            width: 400px;
            max-width: 80%;
            border-radius: 3px;
            text-align: center;
        }

        .confirm-message {
            margin-bottom: 20px;
            font-size: 14px;
            line-height: 1.4;
        }

        .confirm-actions {
            display: flex;
            justify-content: center;
            gap: 12px;
        }

        /* Limit Selector */
        .status-bar {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 8px 16px;
            background-color: var(--vscode-statusBar-background);
            color: var(--vscode-statusBar-foreground);
            border-top: 1px solid var(--vscode-panel-border);
            font-size: 12px;
            flex-shrink: 0;
        }

        .status-left {
            display: flex;
            align-items: center;
            gap: 8px;
            flex: 1;
        }

        .status-center {
            display: flex;
            align-items: center;
            gap: 8px;
            justify-content: center;
            flex: 0 0 auto;
        }

        .status-right {
            display: flex;
            align-items: center;
            gap: 8px;
            flex: 1;
            justify-content: flex-end;
        }

        .limit-selector {
            display: flex;
            align-items: center;
            gap: 6px;
        }

        .limit-select {
            background-color: var(--vscode-dropdown-background);
            color: var(--vscode-dropdown-foreground);
            border: 1px solid var(--vscode-dropdown-border);
            border-radius: 3px;
            padding: 2px 6px;
            font-size: 12px;
            cursor: pointer;
        }

        .limit-select:focus {
            outline: 1px solid var(--vscode-focusBorder);
        }
    </style>
</head>
<body>
    <div class="toolbar">
        <div class="toolbar-left">
            <button class="btn" id="addRowBtn">Add Row</button>
            <button class="btn btn-secondary" id="refreshBtn">Refresh</button>
            <span class="table-indicator" title="Current table">
                <span class="table-icon">
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M1 3.5A2.5 2.5 0 0 1 3.5 1h9A2.5 2.5 0 0 1 15 3.5v9a2.5 2.5 0 0 1-2.5 2.5h-9A2.5 2.5 0 0 1 1 12.5v-9Z" stroke="currentColor" stroke-width="1" fill="none"/>
                        <path d="M1 6h14M1 10h14M6 1v14" stroke="currentColor" stroke-width="1"/>
                    </svg>
                </span>
                <span>${this.schema}.${this.tableName}</span>
            </span>
        </div>
        <div class="toolbar-right">
            <button class="btn btn-secondary" id="openNeonConsoleBtn" title="Open this table in Neon console">Open in Neon console</button>
        </div>
    </div>
    
    <div class="table-container" id="tableContainer">
        <div class="loading">Loading table data...</div>
    </div>
    
    <div class="status-bar" id="statusBar">
        <div class="status-left">
            <span id="statusText">Loading...</span>
        </div>
        <div class="status-center">
            <div class="pagination-controls" id="pagination" style="display: none;">
                <button class="btn btn-secondary" id="prevPageBtn" disabled>Previous</button>
                <span class="page-info" id="pageInfo">Page 1</span>
                <button class="btn btn-secondary" id="nextPageBtn" disabled>Next</button>
            </div>
        </div>
        <div class="status-right">
            <div class="limit-selector">
                <label for="limitSelect">Rows per page:</label>
                <select id="limitSelect" class="limit-select">
                    <option value="25">25</option>
                    <option value="50">50</option>
                    <option value="100" selected>100</option>
                    <option value="200">200</option>
                    <option value="500">500</option>
                    <option value="1000">1000</option>
                </select>
            </div>
        </div>
    </div>

    <!-- Add Row Modal -->
    <div id="addRowModal" class="modal">
        <div class="modal-content">
            <div class="modal-header">
                <span class="modal-title">Add New Row</span>
                <span class="close" id="closeAddModal">&times;</span>
            </div>
            <form id="addRowForm">
                <div id="addRowFields"></div>
                <div class="form-actions">
                    <button type="button" class="btn btn-secondary" id="cancelAddBtn">Cancel</button>
                    <button type="submit" class="btn">Add Row</button>
                </div>
            </form>
        </div>
    </div>

    <!-- Confirmation Dialog -->
    <div id="confirmDialog" class="confirm-dialog">
        <div class="confirm-content">
            <div class="confirm-message" id="confirmMessage">
                Are you sure you want to delete this row?
            </div>
            <div class="confirm-actions">
                <button class="btn btn-secondary" id="confirmCancel">Cancel</button>
                <button class="btn btn-danger" id="confirmDelete">Delete</button>
            </div>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        
        let currentData = null;
        let currentPage = 0;
        let pageSize = 100;
        let editingCell = null;
        let columns = [];
        let pendingDeleteRow = null;
        let editingRowIndex = -1;
        
        // Elements
        const tableContainer = document.getElementById('tableContainer');
        const pagination = document.getElementById('pagination');
        const statusBar = document.getElementById('statusBar');
        const statusText = document.getElementById('statusText');
        const addRowBtn = document.getElementById('addRowBtn');
        const refreshBtn = document.getElementById('refreshBtn');
        const openNeonConsoleBtn = document.getElementById('openNeonConsoleBtn');
        const prevPageBtn = document.getElementById('prevPageBtn');
        const nextPageBtn = document.getElementById('nextPageBtn');
        const pageInfo = document.getElementById('pageInfo');
        const limitSelect = document.getElementById('limitSelect');
        
        // Modal elements
        const addRowModal = document.getElementById('addRowModal');
        const closeAddModal = document.getElementById('closeAddModal');
        const cancelAddBtn = document.getElementById('cancelAddBtn');
        const addRowForm = document.getElementById('addRowForm');
        const addRowFields = document.getElementById('addRowFields');
        
        // Confirmation dialog elements
        const confirmDialog = document.getElementById('confirmDialog');
        const confirmMessage = document.getElementById('confirmMessage');
        const confirmCancel = document.getElementById('confirmCancel');
        const confirmDelete = document.getElementById('confirmDelete');
        
        // Event listeners
        addRowBtn.addEventListener('click', showAddRowModal);
        refreshBtn.addEventListener('click', refresh);
        openNeonConsoleBtn.addEventListener('click', openNeonConsole);
        prevPageBtn.addEventListener('click', () => loadPage(currentPage - 1));
        nextPageBtn.addEventListener('click', () => loadPage(currentPage + 1));
        limitSelect.addEventListener('change', changeLimitSize);
        closeAddModal.addEventListener('click', hideAddRowModal);
        cancelAddBtn.addEventListener('click', hideAddRowModal);
        addRowForm.addEventListener('submit', submitAddRow);
        
        // Confirmation dialog event listeners
        confirmCancel.addEventListener('click', hideConfirmDialog);
        confirmDelete.addEventListener('click', confirmDeleteRow);
        
        // Modal click outside to close
        window.addEventListener('click', (e) => {
            if (e.target === addRowModal) {
                hideAddRowModal();
            } else if (e.target === confirmDialog) {
                hideConfirmDialog();
            }
        });
        
        // Message handling
        window.addEventListener('message', (event) => {
            const message = event.data;
            
            switch (message.command) {
                case 'dataLoaded':
                    handleDataLoaded(message);
                    break;
                    
                case 'loading':
                    handleLoading(message.loading);
                    break;
                    
                case 'error':
                    handleError(message.error);
                    break;
                    
                case 'rowInserted':
                case 'rowUpdated':
                case 'rowDeleted':
                    handleRowOperation(message);
                    break;
                    
                case 'validationResult':
                    handleValidation(message.validation);
                    break;
            }
        });
        
        function handleDataLoaded(message) {
            currentData = message.data;
            currentPage = message.page;
            pageSize = message.pageSize;
            columns = currentData.columns;
            
            // Update the limit selector to match the current pageSize
            limitSelect.value = pageSize.toString();
            
            displayTable(currentData);
            updatePagination();
            updateStatus(\`Showing \${currentData.rows.length} of \${currentData.totalCount} rows\`);
        }
        
        function loadPage(page) {
            vscode.postMessage({
                command: 'loadPage',
                page: page
            });
        }
        
        function handleLoading(loading) {
            if (loading) {
                tableContainer.innerHTML = '<div class="loading">Loading...</div>';
                updateStatus('Loading...');
            }
        }
        
        function handleError(error) {
            tableContainer.innerHTML = \`<div class="error">Error: \${error}</div>\`;
            updateStatus('Error');
        }
        
        function handleRowOperation(message) {
            if (message.success) {
                updateStatus('Operation completed successfully');
                hideAddRowModal();
            } else {
                updateStatus(\`Error: \${message.error}\`);
                showErrorMessage(\`Error: \${message.error}\`);
            }
        }
        
        function handleValidation(validation) {
            if (!validation.isValid) {
                showErrorMessage('Validation errors:\\n' + validation.errors.join('\\n'));
            }
        }
        
        function displayTable(data) {
            if (!data || data.rows.length === 0) {
                tableContainer.innerHTML = '<div class="no-data">No data to display</div>';
                return;
            }
            
            const table = document.createElement('table');
            
            // Create header
            const thead = document.createElement('thead');
            const headerRow = document.createElement('tr');
            
            // Row number header
            const rowNumHeader = document.createElement('th');
            rowNumHeader.className = 'row-number';
            rowNumHeader.textContent = '#';
            headerRow.appendChild(rowNumHeader);
            
            // Column headers
            data.columns.forEach(col => {
                const th = document.createElement('th');
                th.textContent = col.name;
                th.title = \`\${col.type}\${col.nullable ? '' : ' (NOT NULL)'}\${col.isPrimaryKey ? ' (PK)' : ''}\${col.isForeignKey ? ' (FK)' : ''}\`;
                
                if (col.isPrimaryKey) {
                    th.classList.add('primary-key');
                } else if (col.isForeignKey) {
                    th.classList.add('foreign-key');
                }
                
                headerRow.appendChild(th);
            });
            
            // Actions header
            const actionsHeader = document.createElement('th');
            actionsHeader.className = 'actions-header';
            actionsHeader.innerHTML = '';
            actionsHeader.title = 'Actions';
            headerRow.appendChild(actionsHeader);
            
            thead.appendChild(headerRow);
            table.appendChild(thead);
            
            // Create body
            const tbody = document.createElement('tbody');
            data.rows.forEach((row, index) => {
                const tr = document.createElement('tr');
                tr.dataset.rowIndex = index;
                
                if (editingRowIndex === index) {
                    tr.classList.add('row-editing');
                }
                
                // Row number
                const rowNumCell = document.createElement('td');
                rowNumCell.className = 'row-number';
                rowNumCell.textContent = (currentPage * pageSize) + index + 1;
                tr.appendChild(rowNumCell);
                
                // Data cells
                data.columns.forEach(col => {
                    const td = document.createElement('td');
                    const value = row[col.name];
                    
                    if (value === null || value === undefined) {
                        td.textContent = 'NULL';
                        td.classList.add('null-value');
                    } else {
                        td.textContent = String(value);
                    }
                    
                    td.title = td.textContent;
                    td.classList.add('editable-cell');
                    td.dataset.column = col.name;
                    
                    // Only add click handler if row is in editing mode
                    if (editingRowIndex === index) {
                        td.addEventListener('click', () => startCellEdit(td, row, col));
                    }
                    
                    if (col.isPrimaryKey) {
                        td.classList.add('primary-key');
                    } else if (col.isForeignKey) {
                        td.classList.add('foreign-key');
                    }
                    
                    tr.appendChild(td);
                });
                
                // Actions cell
                const actionsCell = document.createElement('td');
                actionsCell.className = 'actions-cell';
                actionsCell.innerHTML = editingRowIndex === index 
                    ? \`
                        <button class="action-btn save-btn" onclick="saveRowEdit(\${index})" title="Save changes">
                            <svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
                                <path d="M13.854 3.646a.5.5 0 0 1 0 .708l-7 7a.5.5 0 0 1-.708 0l-3.5-3.5a.5.5 0 1 1 .708-.708L6.5 10.293l6.646-6.647a.5.5 0 0 1 .708 0z"/>
                            </svg>
                        </button>
                        <button class="action-btn cancel-btn" onclick="cancelRowEdit(\${index})" title="Cancel changes">
                            <svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
                                <path d="M4.646 4.646a.5.5 0 0 1 .708 0L8 7.293l2.646-2.647a.5.5 0 0 1 .708.708L8.707 8l2.647 2.646a.5.5 0 0 1-.708.708L8 8.707l-2.646 2.647a.5.5 0 0 1-.708-.708L7.293 8 4.646 5.354a.5.5 0 0 1 0-.708z"/>
                            </svg>
                        </button>
                    \`
                    : \`
                        <button class="action-btn edit-btn" onclick="startRowEdit(\${index})" title="Edit row">
                            <svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
                                <path d="M15.502 1.94a.5.5 0 0 1 0 .706L14.459 3.69l-2-2L13.502.646a.5.5 0 0 1 .707 0l1.293 1.293zm-1.75 2.456-2-2L4.939 9.21a.5.5 0 0 0-.121.196l-.805 2.414a.25.25 0 0 0 .316.316l2.414-.805a.5.5 0 0 0 .196-.12l6.813-6.814z"/>
                                <path fill-rule="evenodd" d="M1 13.5A1.5 1.5 0 0 0 2.5 15h11a1.5 1.5 0 0 0 1.5-1.5v-6a.5.5 0 0 0-1 0v6a.5.5 0 0 1-.5.5h-11a.5.5 0 0 1-.5-.5v-11a.5.5 0 0 1 .5-.5H9a.5.5 0 0 0 0-1H2.5A1.5 1.5 0 0 0 1 2.5v11z"/>
                            </svg>
                        </button>
                        <button class="action-btn delete-btn" onclick="deleteRow(\${index})" title="Delete row">
                            <svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
                                <path d="M6.5 1h3a.5.5 0 0 1 .5.5v1H6v-1a.5.5 0 0 1 .5-.5ZM11 2.5v-1A1.5 1.5 0 0 0 9.5 0h-3A1.5 1.5 0 0 0 5 1.5v1H2.506a.5.5 0 0 0 0 1h.5v10A1.5 1.5 0 0 0 4.5 15h7a1.5 1.5 0 0 0 1.5-1.5v-10h.5a.5.5 0 0 0 0-1H11ZM4.5 4a.5.5 0 0 1 .5.5v8a.5.5 0 0 1-1 0v-8a.5.5 0 0 1 .5-.5ZM8 4a.5.5 0 0 1 .5.5v8a.5.5 0 0 1-1 0v-8A.5.5 0 0 1 8 4Zm3.5 0a.5.5 0 0 1 .5.5v8a.5.5 0 0 1-1 0v-8a.5.5 0 0 1 .5-.5Z"/>
                            </svg>
                        </button>
                    \`;
                tr.appendChild(actionsCell);
                
                tbody.appendChild(tr);
            });
            table.appendChild(tbody);
            
            tableContainer.innerHTML = '';
            tableContainer.appendChild(table);
        }
        
        function startRowEdit(index) {
            // Cancel any existing edit
            if (editingRowIndex !== -1) {
                cancelRowEdit(editingRowIndex);
            }
            
            editingRowIndex = index;
            
            // Re-render the table to show edit mode
            displayTable(currentData);
            
            // Convert all cells in this row to input fields
            setTimeout(() => {
                convertRowToInputs(index);
            }, 0);
        }
        
        function convertRowToInputs(index) {
            const rowElement = document.querySelector('tr[data-row-index="' + index + '"]');
            if (!rowElement) return;
            
            const editableCells = rowElement.querySelectorAll('.editable-cell');
            const row = currentData.rows[index];
            
            editableCells.forEach(cell => {
                const columnName = cell.dataset.column;
                const column = columns.find(col => col.name === columnName);
                if (!column) return;
                
                const input = document.createElement('input');
                input.className = 'cell-editor';
                input.value = row[column.name] === null ? '' : String(row[column.name]);
                input.type = getInputType(column.type);
                input.dataset.column = column.name;
                
                // Add keyboard navigation
                input.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        // Move to next cell in the row
                        const nextCell = findNextEditableCell(cell);
                        if (nextCell) {
                            const nextInput = nextCell.cell.querySelector('.cell-editor');
                            if (nextInput) {
                                nextInput.focus();
                                nextInput.select();
                            }
                        } else {
                            // If no next cell, save the row
                            saveRowEdit(index);
                        }
                    } else if (e.key === 'Escape') {
                        cancelRowEdit(index);
                    } else if (e.key === 'Tab') {
                        e.preventDefault();
                        const nextCell = e.shiftKey 
                            ? findPreviousEditableCell(cell)
                            : findNextEditableCell(cell);
                        if (nextCell) {
                            const nextInput = nextCell.cell.querySelector('.cell-editor');
                            if (nextInput) {
                                nextInput.focus();
                                nextInput.select();
                            }
                        }
                    }
                });
                
                // Replace cell content with input
                cell.innerHTML = '';
                cell.appendChild(input);
            });
            
            // Focus the first input
            const firstInput = rowElement.querySelector('.cell-editor');
            if (firstInput) {
                firstInput.focus();
                firstInput.select();
            }
        }

        function saveRowEdit(index) {
            if (editingRowIndex !== index) return;
            
            const row = currentData.rows[index];
            const primaryKeyValues = getPrimaryKeyValues(row);
            const changes = {};
            let hasChanges = false;
            
            // Collect all changes from the row
            const rowElement = document.querySelector(\`tr[data-row-index="\${index}"]\`);
            const inputs = rowElement.querySelectorAll('.cell-editor');
            
            inputs.forEach(input => {
                const columnName = input.dataset.column;
                const newValue = input.value.trim() === '' ? null : input.value;
                const originalValue = row[columnName];
                
                if (newValue !== originalValue) {
                    changes[columnName] = newValue;
                    hasChanges = true;
                }
            });
            
            if (hasChanges) {
                vscode.postMessage({
                    command: 'updateRow',
                    primaryKeyValues,
                    newValues: changes
                });
            }
            
            editingRowIndex = -1;
            displayTable(currentData);
        }

        function cancelRowEdit(index) {
            if (editingRowIndex !== index) return;
            
            editingRowIndex = -1;
            displayTable(currentData);
        }
        
        function startCellEdit(cell, row, column) {
            // Only allow editing if the row is in edit mode
            if (editingRowIndex === -1) return;
            
            // If the cell already has an input, just focus it
            const existingInput = cell.querySelector('.cell-editor');
            if (existingInput) {
                existingInput.focus();
                existingInput.select();
                return;
            }
            
            // This function is now mainly for focusing existing inputs
            // since convertRowToInputs handles the initial conversion
        }
        
        function findNextEditableCell(currentCell) {
            const row = currentCell.closest('tr');
            const cells = Array.from(row.querySelectorAll('.editable-cell'));
            const currentIndex = cells.indexOf(currentCell);
            
            if (currentIndex < cells.length - 1) {
                const nextCell = cells[currentIndex + 1];
                const rowData = currentData.rows[parseInt(row.dataset.rowIndex)];
                const columnName = nextCell.dataset.column;
                const column = columns.find(col => col.name === columnName);
                
                return { cell: nextCell, row: rowData, column };
            }
            
            return null;
        }
        
        function findPreviousEditableCell(currentCell) {
            const row = currentCell.closest('tr');
            const cells = Array.from(row.querySelectorAll('.editable-cell'));
            const currentIndex = cells.indexOf(currentCell);
            
            if (currentIndex > 0) {
                const prevCell = cells[currentIndex - 1];
                const rowData = currentData.rows[parseInt(row.dataset.rowIndex)];
                const columnName = prevCell.dataset.column;
                const column = columns.find(col => col.name === columnName);
                
                return { cell: prevCell, row: rowData, column };
            }
            
            return null;
        }
        
        function saveCellEdit() {
            if (!editingCell) return;
            
            const { cell, row, column } = editingCell;
            const input = cell.querySelector('.cell-editor');
            const newValue = input.value.trim() === '' ? null : input.value;
            
            if (newValue !== editingCell.originalValue) {
                const primaryKeyValues = getPrimaryKeyValues(row);
                const newValues = { [column.name]: newValue };
                
                vscode.postMessage({
                    command: 'updateRow',
                    primaryKeyValues,
                    newValues
                });
            }
            
            editingCell = null;
        }
        
        function cancelCellEdit() {
            if (!editingCell) return;
            
            const { cell, originalValue } = editingCell;
            
            if (originalValue === null) {
                cell.textContent = 'NULL';
                cell.classList.add('null-value');
            } else {
                cell.textContent = String(originalValue);
                cell.classList.remove('null-value');
            }
            
            editingCell = null;
        }
        
        function deleteRow(index) {
            if (!currentData || !currentData.rows[index]) return;
            
            const row = currentData.rows[index];
            const primaryKeyValues = getPrimaryKeyValues(row);
            
            if (Object.keys(primaryKeyValues).length === 0) {
                showErrorMessage('Cannot delete row: No primary key found');
                return;
            }
            
            // Store the row to delete and show confirmation dialog
            pendingDeleteRow = { index, primaryKeyValues };
            showConfirmDialog('Are you sure you want to delete this row?');
        }
        
        function showConfirmDialog(message) {
            confirmMessage.textContent = message;
            confirmDialog.style.display = 'block';
        }
        
        function hideConfirmDialog() {
            confirmDialog.style.display = 'none';
            pendingDeleteRow = null;
            // Reset dialog state
            confirmDelete.style.display = 'inline-block';
            confirmCancel.textContent = 'Cancel';
        }
        
        function confirmDeleteRow() {
            if (pendingDeleteRow) {
                vscode.postMessage({
                    command: 'deleteRow',
                    primaryKeyValues: pendingDeleteRow.primaryKeyValues
                });
                hideConfirmDialog();
            }
        }
        
        function getPrimaryKeyValues(row) {
            const pkValues = {};
            columns.filter(col => col.isPrimaryKey).forEach(col => {
                pkValues[col.name] = row[col.name];
            });
            return pkValues;
        }
        
        function showAddRowModal() {
            // Build form fields
            addRowFields.innerHTML = '';
            columns.forEach(col => {
                const group = document.createElement('div');
                group.className = 'form-group';
                
                const label = document.createElement('label');
                label.className = 'form-label';
                label.htmlFor = \`field_\${col.name}\`;
                label.innerHTML = \`\${col.name}\${col.nullable ? '' : ' <span class="required">*</span>'}\`;
                
                const input = document.createElement('input');
                input.id = \`field_\${col.name}\`;
                input.name = col.name;
                input.className = 'form-input';
                input.type = getInputType(col.type);
                input.placeholder = col.defaultValue ? \`Default: \${col.defaultValue}\` : '';
                input.required = !col.nullable;
                
                const info = document.createElement('div');
                info.className = 'column-info';
                info.textContent = \`Type: \${col.type}\${col.maxLength ? \` (max \${col.maxLength})\` : ''}\`;
                
                group.appendChild(label);
                group.appendChild(input);
                group.appendChild(info);
                addRowFields.appendChild(group);
            });
            
            addRowModal.style.display = 'block';
        }
        
        function hideAddRowModal() {
            addRowModal.style.display = 'none';
            addRowForm.reset();
        }
        
        function submitAddRow(e) {
            e.preventDefault();
            
            const formData = new FormData(addRowForm);
            const rowData = {};
            
            columns.forEach(col => {
                const value = formData.get(col.name);
                if (value !== null && value !== '') {
                    rowData[col.name] = value;
                }
            });
            
            vscode.postMessage({
                command: 'insertRow',
                rowData
            });
        }
        
        function getInputType(dataType) {
            const type = dataType.toLowerCase();
            if (type.includes('int') || type.includes('serial')) return 'number';
            if (type.includes('numeric') || type.includes('decimal') || type.includes('float') || type.includes('double')) return 'number';
            if (type.includes('bool')) return 'checkbox';
            // Treat all date/time types as text to preserve original formatting
            // This prevents datetime-local inputs from showing placeholder text
            return 'text';
        }
        
        function loadPage(page) {
            vscode.postMessage({
                command: 'loadPage',
                page: page
            });
        }
        
        function refresh() {
            vscode.postMessage({
                command: 'refresh'
            });
        }
        
        function openNeonConsole() {
            vscode.postMessage({
                command: 'openNeonConsole'
            });
        }
        
        function updatePagination() {
            if (!currentData) return;
            
            const hasPages = currentData.totalCount > pageSize;
            pagination.style.display = hasPages ? 'flex' : 'none';
            
            if (hasPages) {
                const totalPages = Math.ceil(currentData.totalCount / pageSize);
                pageInfo.textContent = \`Page \${currentPage + 1} of \${totalPages}\`;
                prevPageBtn.disabled = currentPage === 0;
                nextPageBtn.disabled = !currentData.hasMore;
            }
        }
        
        function updateStatus(text) {
            statusText.textContent = text;
        }
        
        function changeLimitSize() {
            const newLimit = parseInt(limitSelect.value);
            pageSize = newLimit;
            
            vscode.postMessage({
                command: 'changeLimitSize',
                limit: newLimit
            });
        }
        
        function showErrorMessage(message) {
            // Use the confirm dialog to show error messages
            confirmMessage.textContent = message;
            confirmDelete.style.display = 'none';
            confirmCancel.textContent = 'OK';
            confirmDialog.style.display = 'block';
            
            // Reset the dialog when closed
            const resetDialog = () => {
                confirmDelete.style.display = 'inline-block';
                confirmCancel.textContent = 'Cancel';
                confirmCancel.removeEventListener('click', resetDialog);
            };
            confirmCancel.addEventListener('click', resetDialog);
        }
    </script>
</body>
</html>`;
    }

    private getKey(): string {
        return `${this.database || 'default'}.${this.schema}.${this.tableName}`;
    }

    public dispose() {
        const key = this.getKey();
        TableDataPanel.currentPanels.delete(key);

        this.panel.dispose();

        while (this.disposables.length) {
            const disposable = this.disposables.pop();
            if (disposable) {
                disposable.dispose();
            }
        }
    }
}