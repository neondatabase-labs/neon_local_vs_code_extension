import * as vscode from 'vscode';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface TableInfo {
    name: string;
    schema: string;
    type: string;
    owner: string;
}

export class DatabaseService {
    constructor() {}

    async getDatabases(): Promise<string[]> {
        // TODO: Implement database listing
        return [];
    }

    async getRoles(): Promise<string[]> {
        // TODO: Implement role listing
        return [];
    }

    async getTables(database: string): Promise<TableInfo[]> {
        try {
            const query = `
                SELECT 
                    schemaname as schema,
                    tablename as name,
                    tableowner as owner,
                    'table' as type
                FROM pg_catalog.pg_tables
                WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
                UNION ALL
                SELECT 
                    schemaname as schema,
                    viewname as name,
                    viewowner as owner,
                    'view' as type
                FROM pg_catalog.pg_views
                WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
                ORDER BY schema, name;
            `;
            
            const { stdout } = await execAsync(`psql "postgres://neon:npg@localhost:5432/${database}?sslmode=require" -t -A -F"," -c "${query}"`);
            
            return stdout.split('\n')
                .filter(line => line.trim())
                .map(line => {
                    const [schema, name, owner, type] = line.split(',');
                    return { schema, name, owner, type };
                });
        } catch (error) {
            console.error('Error fetching tables:', error);
            throw new Error('Failed to fetch database tables');
        }
    }

    async createDatabase(name: string): Promise<void> {
        // TODO: Implement database creation
    }

    async dropDatabase(name: string): Promise<void> {
        // TODO: Implement database deletion
    }
} 