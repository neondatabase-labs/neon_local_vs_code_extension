import * as vscode from 'vscode';
import { SchemaService, SchemaItem } from './services/schema.service';
import { StateService } from './services/state.service';
import { AuthManager } from './auth/authManager';
import { SqlQueryPanel } from './sqlQueryPanel';
import { TableDataPanel } from './tableDataPanel';
import { DockerService } from './services/docker.service';

export class SchemaTreeItem extends vscode.TreeItem {
    constructor(
        public readonly item: SchemaItem,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState
    ) {
        super(item.name, collapsibleState);
        
        this.tooltip = this.getTooltip();
        this.description = this.getDescription();
        this.iconPath = this.getIcon();
        this.contextValue = item.type;
        
        // Set command for leaf items
        if (collapsibleState === vscode.TreeItemCollapsibleState.None) {
            this.command = {
                command: 'neonLocal.schema.showDetails',
                title: 'Show Details',
                arguments: [item]
            };
        }
    }

    private getTooltip(): string {
        const { item } = this;
        switch (item.type) {
            case 'connection':
                const connection = item.metadata;
                return `Connected to: ${connection?.branchName || 'Unknown Branch'} (${connection?.projectName || 'Unknown Project'})${connection?.selectedDatabase ? `\nDatabase: ${connection.selectedDatabase}` : ''}${connection?.port ? `\nPort: ${connection.port}` : ''}`;
            case 'database':
                return `Database: ${item.name}${item.metadata?.size ? ` (${item.metadata.size})` : ''}`;
            case 'schema':
                return `Schema: ${item.name}`;
            case 'table':
                return `Table: ${item.name}${item.metadata?.size ? ` (${item.metadata.size})` : ''}`;
            case 'view':
                return `View: ${item.name}`;
            case 'column':
                const column = item.metadata;
                let tooltip = `Column: ${item.name} (${column?.data_type || 'unknown'})`;
                if (column?.is_primary_key) tooltip += ' - PRIMARY KEY';
                if (column?.is_foreign_key) tooltip += ' - FOREIGN KEY';
                if (!column?.is_nullable) tooltip += ' - NOT NULL';
                return tooltip;
            case 'index':
                const index = item.metadata;
                let indexTooltip = `Index: ${item.name}`;
                if (index?.is_primary) indexTooltip += ' - PRIMARY';
                else if (index?.is_unique) indexTooltip += ' - UNIQUE';
                return indexTooltip;
            case 'function':
                const func = item.metadata;
                return `Function: ${item.name}(${func?.parameters || ''}) → ${func?.return_type || 'void'}`;
            case 'trigger':
                const trigger = item.metadata;
                return `Trigger: ${item.name} (${trigger?.timing || ''} ${trigger?.event || ''})`;
            default:
                return item.name;
        }
    }

    private getDescription(): string | undefined {
        const { item } = this;
        switch (item.type) {
            case 'connection':
                const connection = item.metadata;
                return 'Branch';
            case 'column':
                const column = item.metadata;
                if (column?.data_type) {
                    let desc = column.data_type;
                    if (column.character_maximum_length) {
                        desc += `(${column.character_maximum_length})`;
                    }
                    return desc;
                }
                break;
            case 'table':
            case 'view':
                return item.metadata?.table_type;
            case 'index':
                if (item.metadata?.is_primary) return 'PRIMARY';
                if (item.metadata?.is_unique) return 'UNIQUE';
                break;
        }
        return undefined;
    }

    private getIcon(): vscode.ThemeIcon | undefined {
        switch (this.item.type) {
            case 'connection':
                return new vscode.ThemeIcon('git-branch');
            case 'database':
                return new vscode.ThemeIcon('database');
            case 'schema':
                return new vscode.ThemeIcon('folder');
            case 'table':
                return new vscode.ThemeIcon('table');
            case 'view':
                return new vscode.ThemeIcon('eye');
            case 'column':
                const column = this.item.metadata;
                if (column?.is_primary_key) {
                    return new vscode.ThemeIcon('key');
                } else if (column?.is_foreign_key) {
                    return new vscode.ThemeIcon('link');
                } else {
                    return new vscode.ThemeIcon('symbol-field');
                }
            case 'index':
                return new vscode.ThemeIcon('list-ordered');
            case 'function':
                return new vscode.ThemeIcon('symbol-function');
            case 'trigger':
                return new vscode.ThemeIcon('play');
            default:
                return new vscode.ThemeIcon('symbol-misc');
        }
    }
}

export class SchemaTreeProvider implements vscode.TreeDataProvider<SchemaItem> {
    public _onDidChangeTreeData: vscode.EventEmitter<SchemaItem | undefined | null | void> = new vscode.EventEmitter<SchemaItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<SchemaItem | undefined | null | void> = this._onDidChangeTreeData.event;

    private schemaCache = new Map<string, SchemaItem[]>();
    public containerReadyCache: { isReady: boolean; timestamp: number } | null = null;
    private readonly CONTAINER_CHECK_CACHE_DURATION = 10000; // 10 seconds
    private isPreloading = false;

    constructor(
        private schemaService: SchemaService,
        private stateService: StateService,
        private authManager: AuthManager,
        private dockerService: DockerService
    ) {
        // Listen for authentication state changes
        this.authManager.onDidChangeAuthentication((isAuthenticated) => {
            console.debug('Schema tree: Authentication state changed', { isAuthenticated });
            if (!isAuthenticated) {
                this.clearCache();
                // Don't auto-refresh - require manual refresh
            }
        });
    }

    refresh(): void {
        this.clearCache();
        this._onDidChangeTreeData.fire();
    }

    public clearCache(): void {
        this.schemaCache.clear();
        this.containerReadyCache = null;
        this.isPreloading = false;
        console.debug('Schema view: All caches cleared');
    }

    public forceRefresh(): void {
        console.debug('Schema view: Force refresh triggered - clearing all caches and refreshing');
        this.clearCache();
        this._onDidChangeTreeData.fire();
        // Also fire a delayed refresh to ensure VS Code processes the change
        setTimeout(() => {
            this._onDidChangeTreeData.fire();
        }, 50);
    }

    private async checkContainerReadyWithCache(): Promise<boolean> {
        const now = Date.now();
        
        // Return cached result if still valid
        if (this.containerReadyCache && 
            (now - this.containerReadyCache.timestamp) < this.CONTAINER_CHECK_CACHE_DURATION) {
            return this.containerReadyCache.isReady;
        }
        
        // Check container readiness
        try {
            const isReady = await this.dockerService.checkContainerReady();
            this.containerReadyCache = { isReady, timestamp: now };
            return isReady;
        } catch (error) {
            console.error('Error checking container readiness:', error);
            // Cache negative result for shorter duration
            this.containerReadyCache = { isReady: false, timestamp: now - (this.CONTAINER_CHECK_CACHE_DURATION - 2000) };
            return false;
        }
    }

    getTreeItem(element: SchemaItem): vscode.TreeItem {
        const hasChildren = this.hasChildren(element);
        const collapsibleState = hasChildren ? 
            vscode.TreeItemCollapsibleState.Collapsed : 
            vscode.TreeItemCollapsibleState.None;
        
        return new SchemaTreeItem(element, collapsibleState);
    }

    private hasChildren(element: SchemaItem): boolean {
        switch (element.type) {
            case 'connection':
            case 'database':
            case 'schema':
                return true;
            case 'table':
                return true; // Tables have columns, indexes, and potentially triggers
            case 'view':
                return true; // Views have columns
            default:
                return false;
        }
    }

    async getChildren(element?: SchemaItem): Promise<SchemaItem[]> {
        try {
            // Check if connected
            const viewData = await this.stateService.getViewData();
            if (!viewData.connected) {
                return [];
            }

            // Check if proxy container is ready before loading data (with caching)
            const isContainerReady = await this.checkContainerReadyWithCache();
            if (!isContainerReady) {
                console.warn('Schema view: Proxy container is not ready yet');
                vscode.window.showWarningMessage('Database proxy is not ready yet. Please wait for the container to start completely.');
                return [];
            }

            if (!element) {
                // Root level - show connection root node and preload all data
                const connectionRoot = this.getConnectionRoot(viewData);
                console.debug('Schema view: Returning root connection node for branch:', viewData.currentlyConnectedBranch);
                
                // Start preloading all schema data in the background (only if not already preloading)
                if (!this.isPreloading) {
                    this.isPreloading = true;
                    this.preloadAllSchemaData().catch(error => {
                        console.error('Error preloading schema data:', error);
                    }).finally(() => {
                        this.isPreloading = false;
                    });
                }
                return connectionRoot;
            }

            const cacheKey = element.id;
            if (this.schemaCache.has(cacheKey)) {
                console.debug(`Schema view: Returning cached data for ${cacheKey}`);
                return this.schemaCache.get(cacheKey)!;
            }

            let children: SchemaItem[] = [];

            switch (element.type) {
                case 'connection':
                    children = await this.getDatabases();
                    break;
                case 'database':
                    children = await this.getSchemas(element.name);
                    break;
                case 'schema':
                    const parts = element.id.split('_');
                    const database = parts[1];
                    const schema = parts[2];
                    children = await this.getTablesAndFunctions(database, schema);
                    break;
                case 'table':
                case 'view':
                    const tableParts = element.id.split('_');
                    const tableDatabase = tableParts[1];
                    const tableSchema = tableParts[2];
                    const tableName = tableParts.slice(3).join('_');
                    children = await this.getTableChildren(tableDatabase, tableSchema, tableName);
                    break;
            }

            this.schemaCache.set(cacheKey, children);
            return children;

        } catch (error) {
            console.error('Error getting schema children:', error);
            vscode.window.showErrorMessage(`Failed to load schema: ${error instanceof Error ? error.message : 'Unknown error'}`);
            return [];
        }
    }

    private getConnectionRoot(viewData: any): SchemaItem[] {
        const branchName = viewData.currentlyConnectedBranch || 'Unknown Branch';
        const projectName = viewData.connection?.selectedProjectName || 'Unknown Project';
        const orgName = viewData.connection?.selectedOrgName || 'Unknown Organization';
        const selectedDatabase = viewData.selectedDatabase || 'postgres';
        const port = viewData.port || 5432;

        console.debug('Schema view: Creating connection root for branch:', branchName);

        const connectionItem: SchemaItem = {
            id: 'connection_root',
            name: `${branchName}`,
            type: 'connection' as const,
            parent: undefined,
            metadata: {
                branchName,
                projectName,
                orgName,
                selectedDatabase,
                port
            }
        };

        return [connectionItem];
    }

    private async getDatabases(): Promise<SchemaItem[]> {
        try {
            console.debug('Schema view: Fetching databases from service');
            const databases = await this.schemaService.getDatabases();
            console.debug(`Schema view: Retrieved ${databases.length} databases`);
            return databases;
        } catch (error) {
            console.error('Error fetching databases:', error);
            return [];
        }
    }

    private async getSchemas(database: string): Promise<SchemaItem[]> {
        try {
            return await this.schemaService.getSchemas(database);
        } catch (error) {
            console.error('Error fetching schemas:', error);
            return [];
        }
    }

    private async getTablesAndFunctions(database: string, schema: string): Promise<SchemaItem[]> {
        try {
            const [tables, functions] = await Promise.all([
                this.schemaService.getTables(database, schema),
                this.schemaService.getFunctions(database, schema)
            ]);
            return [...tables, ...functions];
        } catch (error) {
            console.error('Error fetching tables and functions:', error);
            return [];
        }
    }

    private async getTableChildren(database: string, schema: string, table: string): Promise<SchemaItem[]> {
        try {
            const [columns, indexes, triggers] = await Promise.all([
                this.schemaService.getColumns(database, schema, table),
                this.schemaService.getIndexes(database, schema, table),
                this.schemaService.getTriggers(database, schema, table)
            ]);
            return [...columns, ...indexes, ...triggers];
        } catch (error) {
            console.error('Error fetching table children:', error);
            return [];
        }
    }

    private async preloadAllSchemaData(): Promise<void> {
        try {
            console.debug('Schema view: Starting preload of all schema data...');
            
            // Check if we're still connected and container is ready
            const viewData = await this.stateService.getViewData();
            if (!viewData.connected) {
                console.debug('Schema view: Aborting preload - not connected');
                return;
            }
            
            // Load all databases first
            const databases = await this.getDatabases();
            
            // Don't preload if there are too many databases (performance consideration)
            if (databases.length > 10) {
                console.debug(`Schema view: Skipping preload due to large number of databases (${databases.length})`);
                return;
            }
            
            // Cache databases for connection root
            this.schemaCache.set('connection_root', databases);
            
            // For each database, load schemas and their contents
            for (const database of databases) {
                try {
                    const schemas = await this.getSchemas(database.name);
                    
                    // Don't preload if there are too many schemas in this database
                    if (schemas.length > 20) {
                        console.debug(`Schema view: Skipping preload for database ${database.name} due to large number of schemas (${schemas.length})`);
                        continue;
                    }
                    
                    // Cache schemas
                    this.schemaCache.set(database.id, schemas);
                    
                    // For each schema, load tables and their contents
                    for (const schema of schemas) {
                        try {
                            const parts = schema.id.split('_');
                            const dbName = parts[1];
                            const schemaName = parts[2];
                            
                            const tablesAndFunctions = await this.getTablesAndFunctions(dbName, schemaName);
                            
                            // Don't preload table details if there are too many tables
                            if (tablesAndFunctions.length > 50) {
                                console.debug(`Schema view: Skipping table detail preload for schema ${schemaName} due to large number of tables (${tablesAndFunctions.length})`);
                                // Still cache the tables/functions list, just not their children
                                this.schemaCache.set(schema.id, tablesAndFunctions);
                                continue;
                            }
                            
                            // Cache tables and functions
                            this.schemaCache.set(schema.id, tablesAndFunctions);
                            
                            // For each table/view, load columns, indexes, and triggers
                            const tablePromises = tablesAndFunctions
                                .filter(item => item.type === 'table' || item.type === 'view')
                                .map(async (tableItem) => {
                                    try {
                                        const tableParts = tableItem.id.split('_');
                                        const tableDatabase = tableParts[1];
                                        const tableSchema = tableParts[2];
                                        const tableName = tableParts.slice(3).join('_');
                                        
                                        const tableChildren = await this.getTableChildren(tableDatabase, tableSchema, tableName);
                                        
                                        // Cache table children
                                        this.schemaCache.set(tableItem.id, tableChildren);
                                    } catch (error) {
                                        console.error(`Error preloading table children for ${tableItem.name}:`, error);
                                    }
                                });
                            
                            // Execute table preloading in parallel but limit concurrency
                            const batchSize = 3; // Process 3 tables at a time to avoid overwhelming the database
                            for (let i = 0; i < tablePromises.length; i += batchSize) {
                                const batch = tablePromises.slice(i, i + batchSize);
                                await Promise.all(batch);
                            }
                            
                        } catch (error) {
                            console.error(`Error preloading schema ${schema.name}:`, error);
                        }
                    }
                } catch (error) {
                    console.error(`Error preloading database ${database.name}:`, error);
                }
            }
            
            console.debug('Schema view: Preload completed successfully');
            
            // Don't auto-refresh tree view - data will be available when manually refreshed
            
        } catch (error) {
            console.error('Error during schema preload:', error);
        }
    }
}

export class SchemaViewProvider {
    private treeDataProvider: SchemaTreeProvider;
    private treeView: vscode.TreeView<SchemaItem>;
    private lastConnectionState: boolean = false;
    private lastConnectedBranch: string = '';
    private schemaService: SchemaService;

    constructor(
        private context: vscode.ExtensionContext,
        private stateService: StateService,
        private authManager: AuthManager,
        private dockerService: DockerService
    ) {
        this.schemaService = new SchemaService(stateService, context);
        this.treeDataProvider = new SchemaTreeProvider(this.schemaService, stateService, authManager, dockerService);
        
        this.treeView = vscode.window.createTreeView('neonLocalSchema', {
            treeDataProvider: this.treeDataProvider,
            showCollapseAll: true
        });

        this.registerCommands();
        this.setupEventListeners();
    }

    private registerCommands(): void {
        this.context.subscriptions.push(
            vscode.commands.registerCommand('neonLocal.schema.refresh', () => {
                console.debug('Schema view: Manual refresh triggered');
                this.treeDataProvider.refresh();
            }),
            vscode.commands.registerCommand('neonLocal.schema.showDetails', (item: SchemaItem) => {
                this.showItemDetails(item);
            }),

            vscode.commands.registerCommand('neonLocal.schema.openSqlQuery', () => {
                this.openSqlQuery();
            }),
            vscode.commands.registerCommand('neonLocal.schema.queryTable', (item: SchemaItem) => {
                this.queryTable(item);
            }),
            vscode.commands.registerCommand('neonLocal.schema.viewTableData', (item: SchemaItem) => {
                this.viewTableData(item);
            }),
            vscode.commands.registerCommand('neonLocal.schema.resetFromParent', () => {
                this.resetFromParent();
            }),
            vscode.commands.registerCommand('neonLocal.schema.launchPsql', (item: SchemaItem) => {
                this.launchPsql(item);
            }),
            vscode.commands.registerCommand('neonLocal.schema.truncateTable', (item: SchemaItem) => {
                this.truncateTable(item);
            }),
            vscode.commands.registerCommand('neonLocal.schema.dropTable', (item: SchemaItem) => {
                this.dropTable(item);
            })
        );
    }

    private setupEventListeners(): void {
        // Register a command to listen for connection state changes
        this.context.subscriptions.push(
            vscode.commands.registerCommand('neonLocal.schema.onConnectionStateChanged', async (viewData) => {
                const wasConnectedBefore = this.lastConnectionState;
                const isConnectedNow = viewData?.connected || false;
                const currentBranch = viewData?.currentlyConnectedBranch || '';
                const branchChanged = currentBranch !== this.lastConnectedBranch;
                
                console.debug('Schema view: Connection state changed', {
                    wasConnectedBefore,
                    isConnectedNow,
                    lastBranch: this.lastConnectedBranch,
                    currentBranch,
                    branchChanged
                });
                
                // Update the last known states
                this.lastConnectionState = isConnectedNow;
                this.lastConnectedBranch = currentBranch;
                
                // Handle connection state changes
                if (isConnectedNow && (!wasConnectedBefore || branchChanged)) {
                    console.debug('Schema view: New connection or branch change - forcing aggressive refresh');
                    // Use force refresh to ensure complete cache clear and tree update
                    this.treeDataProvider.forceRefresh();
                } else if (wasConnectedBefore && !isConnectedNow) {
                    console.debug('Schema view: Connection lost - clearing all caches');
                    this.treeDataProvider.clearCache();
                    this.treeDataProvider.refresh();
                }
            })
        );

        // Store initial connection state and refresh if already connected
        this.stateService.getViewData().then(viewData => {
            this.lastConnectionState = viewData.connected;
            this.lastConnectedBranch = viewData.currentlyConnectedBranch || '';
            console.debug('Schema view: Initial state stored', { 
                connected: viewData.connected, 
                branch: this.lastConnectedBranch 
            });
            
            // If already connected on startup, refresh to show current branch data
            if (viewData.connected) {
                console.debug('Schema view: Already connected on startup - force refreshing with current branch data');
                this.treeDataProvider.forceRefresh();
            }
        });
    }

    private showItemDetails(item: SchemaItem): void {
        const details = this.formatItemDetails(item);
        vscode.window.showInformationMessage(details, { modal: false });
    }

    private formatItemDetails(item: SchemaItem): string {
        switch (item.type) {
            case 'database':
                return `Database: ${item.name}${item.metadata?.size ? `\nSize: ${item.metadata.size}` : ''}`;
            case 'schema':
                return `Schema: ${item.name}\nOwner: ${item.metadata?.owner || 'Unknown'}`;
            case 'table':
                return `Table: ${item.name}\nType: ${item.metadata?.table_type || 'Unknown'}\nSize: ${item.metadata?.size || 'Unknown'}`;
            case 'view':
                return `View: ${item.name}\nType: ${item.metadata?.table_type || 'Unknown'}`;
            case 'column':
                const col = item.metadata;
                let details = `Column: ${item.name}\nType: ${col?.data_type || 'Unknown'}`;
                if (col?.character_maximum_length) details += `(${col.character_maximum_length})`;
                details += `\nNullable: ${col?.is_nullable ? 'Yes' : 'No'}`;
                if (col?.column_default) details += `\nDefault: ${col.column_default}`;
                if (col?.is_primary_key) details += '\nPrimary Key: Yes';
                if (col?.is_foreign_key) details += `\nForeign Key: ${col.foreign_table}.${col.foreign_column}`;
                return details;
            case 'index':
                const idx = item.metadata;
                let indexDetails = `Index: ${item.name}`;
                if (idx?.is_primary) indexDetails += '\nType: Primary Key';
                else if (idx?.is_unique) indexDetails += '\nType: Unique';
                else indexDetails += '\nType: Regular';
                if (idx?.definition) indexDetails += `\nDefinition: ${idx.definition}`;
                return indexDetails;
            case 'function':
                const func = item.metadata;
                return `Function: ${item.name}\nParameters: ${func?.parameters || 'None'}\nReturn Type: ${func?.return_type || 'void'}`;
            case 'trigger':
                const trigger = item.metadata;
                return `Trigger: ${item.name}\nEvent: ${trigger?.event || 'Unknown'}\nTiming: ${trigger?.timing || 'Unknown'}`;
            default:
                return `${item.type}: ${item.name}`;
        }
    }



    private openSqlQuery(): void {
        SqlQueryPanel.createOrShow(this.context, this.stateService);
    }

    private queryTable(item: SchemaItem): void {
        if (item.type !== 'table' && item.type !== 'view') {
            return;
        }

        // Parse ID more carefully: table_database_schema_tablename
        // Since table names can contain underscores, we need to split more carefully
        const parts = item.id.split('_');
        const type = parts[0]; // 'table' or 'view'
        const database = parts[1];
        const schema = parts[2];
        // The table name is everything after the third underscore
        const tableName = parts.slice(3).join('_');
        
        // Debug logging
        console.debug('QueryTable - Item ID:', item.id);
        console.debug('QueryTable - Parts:', parts);
        console.debug('QueryTable - Database:', database, 'Schema:', schema, 'Table:', tableName);
        
        const query = `SELECT *\nFROM ${schema}.${tableName}\nLIMIT 100;`;
        console.debug('QueryTable - Generated query:', query);
        
        SqlQueryPanel.createOrShow(this.context, this.stateService, query, database);
    }

    private viewTableData(item: SchemaItem): void {
        if (item.type !== 'table') {
            return;
        }

        // Parse ID: table_database_schema_tablename
        const parts = item.id.split('_');
        const database = parts[1];
        const schema = parts[2];
        // The table name is everything after the third underscore
        const tableName = parts.slice(3).join('_');
        
        // Debug logging
        console.debug('ViewTableData - Item ID:', item.id);
        console.debug('ViewTableData - Parts:', parts);
        console.debug('ViewTableData - Database:', database, 'Schema:', schema, 'Table:', tableName);
        
        TableDataPanel.createOrShow(this.context, this.stateService, schema, tableName, database);
    }

    private async resetFromParent(): Promise<void> {
        // Call the existing global reset command to ensure consistent behavior
        await vscode.commands.executeCommand('neon-local-connect.resetFromParent');
    }

    private async launchPsql(item: SchemaItem): Promise<void> {
        if (item.type !== 'database') {
            return;
        }

        try {
            // Get the current view data to get proxy port
            const viewData = await this.stateService.getViewData();
            
            if (!viewData.connected) {
                throw new Error('Database is not connected. Please connect first.');
            }

            const database = item.name;
            const port = viewData.port;
            
            // Use the local proxy credentials (from ConnectionPoolService)
            const connectionString = `postgres://neon:npg@localhost:${port}/${database}`;

            // Launch PSQL with the local proxy connection string
            const terminal = vscode.window.createTerminal(`Neon PSQL - ${database}`);
            terminal.show();
            terminal.sendText(`psql "${connectionString}"`);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to launch PSQL: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    private async truncateTable(item: SchemaItem): Promise<void> {
        if (item.type !== 'table') {
            return;
        }

        try {
            // Parse table ID: table_database_schema_tablename
            const parts = item.id.split('_');
            const database = parts[1];
            const schema = parts[2];
            const tableName = parts.slice(3).join('_');

            // Show confirmation dialog
            const confirmMessage = `Are you sure you want to truncate table "${schema}.${tableName}"? This action will remove all data from the table and cannot be undone.`;
            
            const answer = await vscode.window.showWarningMessage(
                confirmMessage,
                { modal: true },
                'Truncate'
            );

            if (answer !== 'Truncate') {
                return;
            }

            // Execute truncate command
            const query = `TRUNCATE TABLE ${schema}.${tableName}`;
            await this.schemaService.testConnection(database); // Ensure connection
            
            // Use the schema service connection pool to execute the truncate
            const connectionPool = (this.schemaService as any).connectionPool;
            await connectionPool.executeQuery(query, [], database);

            vscode.window.showInformationMessage(`Table "${schema}.${tableName}" has been truncated successfully.`);
            
            // Refresh the schema view to reflect any changes
            this.treeDataProvider.refresh();
            
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to truncate table: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    private async dropTable(item: SchemaItem): Promise<void> {
        if (item.type !== 'table') {
            return;
        }

        try {
            // Parse table ID: table_database_schema_tablename  
            const parts = item.id.split('_');
            const database = parts[1];
            const schema = parts[2];
            const tableName = parts.slice(3).join('_');

            // Show confirmation dialog with stronger warning
            const confirmMessage = `Are you sure you want to DROP table "${schema}.${tableName}"? This action will permanently delete the table and all its data. This cannot be undone.`;
            
            const answer = await vscode.window.showErrorMessage(
                confirmMessage,
                { modal: true },
                'Drop Table'
            );

            if (answer !== 'Drop Table') {
                return;
            }

            // Execute drop command
            const query = `DROP TABLE ${schema}.${tableName}`;
            await this.schemaService.testConnection(database); // Ensure connection
            
            // Use the schema service connection pool to execute the drop
            const connectionPool = (this.schemaService as any).connectionPool;
            await connectionPool.executeQuery(query, [], database);

            vscode.window.showInformationMessage(`Table "${schema}.${tableName}" has been dropped successfully.`);
            
            // Refresh the schema view to reflect the removal
            this.treeDataProvider.refresh();
            
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to drop table: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    getSchemaService(): SchemaService {
        return this.schemaService;
    }

    dispose(): void {
        this.treeView.dispose();
    }
}