import * as vscode from 'vscode';
import { SchemaService, SchemaItem } from './services/schema.service';
import { StateService } from './services/state.service';
import { AuthManager } from './auth/authManager';
import { SqlQueryPanel } from './sqlQueryPanel';
import { TableDataPanel } from './tableDataPanel';

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
    private _onDidChangeTreeData: vscode.EventEmitter<SchemaItem | undefined | null | void> = new vscode.EventEmitter<SchemaItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<SchemaItem | undefined | null | void> = this._onDidChangeTreeData.event;

    private schemaCache = new Map<string, SchemaItem[]>();

    constructor(
        private schemaService: SchemaService,
        private stateService: StateService,
        private authManager: AuthManager
    ) {
        // Listen for authentication state changes
        this.authManager.onDidChangeAuthentication((isAuthenticated) => {
            console.debug('Schema tree: Authentication state changed', { isAuthenticated });
            if (!isAuthenticated) {
                this.clearCache();
                this.refresh();
            }
        });
    }

    refresh(): void {
        this.clearCache();
        this._onDidChangeTreeData.fire();
    }

    public clearCache(): void {
        this.schemaCache.clear();
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

            if (!element) {
                // Root level - show databases
                return this.getDatabases();
            }

            const cacheKey = element.id;
            if (this.schemaCache.has(cacheKey)) {
                return this.schemaCache.get(cacheKey)!;
            }

            let children: SchemaItem[] = [];

            switch (element.type) {
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
                    const tableName = tableParts[3];
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

    private async getDatabases(): Promise<SchemaItem[]> {
        try {
            return await this.schemaService.getDatabases();
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
}

export class SchemaViewProvider {
    private treeDataProvider: SchemaTreeProvider;
    private treeView: vscode.TreeView<SchemaItem>;
    private lastConnectionState: boolean = false;
    private schemaService: SchemaService;

    constructor(
        private context: vscode.ExtensionContext,
        private stateService: StateService,
        private authManager: AuthManager
    ) {
        this.schemaService = new SchemaService(stateService, context);
        this.treeDataProvider = new SchemaTreeProvider(this.schemaService, stateService, authManager);
        
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
                this.treeDataProvider.refresh();
            }),
            vscode.commands.registerCommand('neonLocal.schema.showDetails', (item: SchemaItem) => {
                this.showItemDetails(item);
            }),
            vscode.commands.registerCommand('neonLocal.schema.copyName', (item: SchemaItem) => {
                this.copyItemName(item);
            }),
            vscode.commands.registerCommand('neonLocal.schema.openSqlQuery', () => {
                this.openSqlQuery();
            }),
            vscode.commands.registerCommand('neonLocal.schema.queryTable', (item: SchemaItem) => {
                this.queryTable(item);
            }),
            vscode.commands.registerCommand('neonLocal.schema.viewTableData', (item: SchemaItem) => {
                this.viewTableData(item);
            })
        );
    }

    private setupEventListeners(): void {
        // Register a command to listen for connection state changes
        this.context.subscriptions.push(
            vscode.commands.registerCommand('neonLocal.schema.onConnectionStateChanged', async (viewData) => {
                const wasConnectedBefore = this.lastConnectionState;
                const isConnectedNow = viewData?.connected || false;
                
                console.debug('Schema view: Connection state changed', {
                    wasConnectedBefore,
                    isConnectedNow,
                    shouldRefresh: isConnectedNow && (!wasConnectedBefore || isConnectedNow !== wasConnectedBefore)
                });
                
                // Update the last known connection state
                this.lastConnectionState = isConnectedNow;
                
                // Refresh the schema tree when connection is established or changes
                if (isConnectedNow) {
                    console.debug('Schema view: Refreshing due to connection established');
                    this.treeDataProvider.refresh();
                } else if (wasConnectedBefore && !isConnectedNow) {
                    console.debug('Schema view: Clearing cache due to connection lost');
                    this.treeDataProvider.clearCache();
                    this.treeDataProvider.refresh();
                }
            })
        );

        // Store initial connection state
        this.stateService.getViewData().then(viewData => {
            this.lastConnectionState = viewData.connected;
            if (viewData.connected) {
                this.treeDataProvider.refresh();
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

    private async copyItemName(item: SchemaItem): Promise<void> {
        try {
            await vscode.env.clipboard.writeText(item.name);
            vscode.window.showInformationMessage(`Copied "${item.name}" to clipboard`);
        } catch (error) {
            vscode.window.showErrorMessage('Failed to copy to clipboard');
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

    getSchemaService(): SchemaService {
        return this.schemaService;
    }

    dispose(): void {
        this.treeView.dispose();
    }
}