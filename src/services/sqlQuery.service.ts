import * as vscode from 'vscode';
import { Client } from 'pg';
import { StateService } from './state.service';

export interface QueryResult {
    columns: string[];
    rows: any[];
    rowCount: number;
    executionTime: number;
    affectedRows?: number;
}

export interface QueryError {
    message: string;
    line?: number;
    position?: number;
    detail?: string;
}

export class SqlQueryService {
    constructor(
        private stateService: StateService,
        private context: vscode.ExtensionContext
    ) {}

    private async getConnection(database?: string): Promise<Client> {
        const viewData = await this.stateService.getViewData();
        
        if (!viewData.connected) {
            throw new Error('Database is not connected. Please connect first.');
        }

        const client = new Client({
            host: 'localhost',
            port: viewData.port,
            database: database || viewData.selectedDatabase || 'postgres',
            user: 'neon',
            password: 'npg',
            ssl: {
                rejectUnauthorized: false // Accept self-signed certificates
            }
        });

        await client.connect();
        return client;
    }

    async executeQuery(sql: string, database?: string): Promise<QueryResult> {
        let client: Client | null = null;
        const startTime = Date.now();
        
        try {
            client = await this.getConnection(database);
            
            // Clean the SQL query
            const cleanSql = sql.trim();
            if (!cleanSql) {
                throw new Error('SQL query cannot be empty');
            }

            console.debug('Executing SQL query:', cleanSql);
            
            const result = await client.query(cleanSql);
            const executionTime = Date.now() - startTime;

            // Handle different types of results
            const columns = result.fields ? result.fields.map(field => field.name) : [];
            const rows = result.rows || [];
            const rowCount = rows.length;
            const affectedRows = result.rowCount;

            console.debug(`Query executed successfully in ${executionTime}ms, ${rowCount} rows returned`);

            return {
                columns,
                rows,
                rowCount,
                executionTime,
                affectedRows
            };

        } catch (error) {
            const executionTime = Date.now() - startTime;
            console.error('SQL query execution failed:', error);
            
            // Parse PostgreSQL error for better user experience
            const pgError = error as any;
            const queryError: QueryError = {
                message: pgError.message || 'Unknown database error',
                line: pgError.line ? parseInt(pgError.line) : undefined,
                position: pgError.position ? parseInt(pgError.position) : undefined,
                detail: pgError.detail
            };

            throw queryError;
        } finally {
            if (client) {
                await client.end();
            }
        }
    }

    async explainQuery(sql: string, database?: string): Promise<QueryResult> {
        const explainSql = `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sql}`;
        return this.executeQuery(explainSql, database);
    }

    async getTablePreview(schema: string, table: string, limit: number = 100, database?: string): Promise<QueryResult> {
        const sql = `SELECT * FROM ${schema}.${table} LIMIT ${limit}`;
        return this.executeQuery(sql, database);
    }

    async getTableInfo(schema: string, table: string, database?: string): Promise<{
        columns: any[];
        indexes: any[];
        constraints: any[];
    }> {
        let client: Client | null = null;
        
        try {
            client = await this.getConnection(database);

            // Get column information
            const columnsResult = await client.query(`
                SELECT 
                    column_name,
                    data_type,
                    is_nullable,
                    column_default,
                    character_maximum_length,
                    numeric_precision,
                    numeric_scale
                FROM information_schema.columns 
                WHERE table_schema = $1 AND table_name = $2
                ORDER BY ordinal_position
            `, [schema, table]);

            // Get index information  
            const indexesResult = await client.query(`
                SELECT 
                    indexname as name,
                    indexdef as definition
                FROM pg_indexes 
                WHERE schemaname = $1 AND tablename = $2
                ORDER BY indexname
            `, [schema, table]);

            // Get constraint information
            const constraintsResult = await client.query(`
                SELECT 
                    constraint_name,
                    constraint_type
                FROM information_schema.table_constraints 
                WHERE table_schema = $1 AND table_name = $2
                ORDER BY constraint_name
            `, [schema, table]);

            return {
                columns: columnsResult.rows,
                indexes: indexesResult.rows,
                constraints: constraintsResult.rows
            };

        } catch (error) {
            console.error('Error getting table info:', error);
            throw error;
        } finally {
            if (client) {
                await client.end();
            }
        }
    }

    validateSql(sql: string): { isValid: boolean; errors: string[] } {
        const errors: string[] = [];
        const trimmedSql = sql.trim();

        if (!trimmedSql) {
            errors.push('SQL query cannot be empty');
            return { isValid: false, errors };
        }

        // Basic SQL validation
        const dangerousPatterns = [
            /drop\s+database/i,
            /drop\s+schema/i,
            /drop\s+table/i,
            /truncate\s+table/i,
            /delete\s+from.*without.*where/i
        ];

        for (const pattern of dangerousPatterns) {
            if (pattern.test(trimmedSql)) {
                errors.push('Potentially dangerous operation detected. Please be careful with destructive queries.');
                break;
            }
        }

        return { isValid: errors.length === 0, errors };
    }

    formatSql(sql: string): string {
        // Basic SQL formatting
        return sql
            .replace(/\s+/g, ' ')
            .replace(/,/g, ',\n    ')
            .replace(/\bSELECT\b/gi, 'SELECT')
            .replace(/\bFROM\b/gi, '\nFROM')
            .replace(/\bWHERE\b/gi, '\nWHERE')
            .replace(/\bORDER BY\b/gi, '\nORDER BY')
            .replace(/\bGROUP BY\b/gi, '\nGROUP BY')
            .replace(/\bHAVING\b/gi, '\nHAVING')
            .replace(/\bJOIN\b/gi, '\nJOIN')
            .replace(/\bLEFT JOIN\b/gi, '\nLEFT JOIN')
            .replace(/\bRIGHT JOIN\b/gi, '\nRIGHT JOIN')
            .replace(/\bINNER JOIN\b/gi, '\nINNER JOIN')
            .trim();
    }
}