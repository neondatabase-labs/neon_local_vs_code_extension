import { Client, Pool, PoolClient } from 'pg';
import * as vscode from 'vscode';
import { StateService } from './state.service';

export interface ConnectionConfig {
    host: string;
    port: number;
    database: string;
    user: string;
    password: string;
    ssl?: {
        rejectUnauthorized: boolean;
    };
}

// Wrapper to handle both pool and direct clients
export interface ManagedClient {
    isPoolClient: boolean;
    query(text: string, values?: any[]): Promise<any>;
    release(): void;
    // Add other essential Client methods we need
    connect?(): Promise<void>;
    end?(): Promise<void>;
}

export class ConnectionPoolService {
    private pools: Map<string, Pool> = new Map();
    private poolStates: Map<string, 'active' | 'ending' | 'ended'> = new Map();
    private stateService: StateService;

    constructor(stateService: StateService) {
        this.stateService = stateService;
    }

    private getPoolKey(database: string): string {
        return `${database}`;
    }

    private async getConnectionConfig(database?: string): Promise<ConnectionConfig> {
        const viewData = await this.stateService.getViewData();
        
        if (!viewData.connected) {
            throw new Error('Database is not connected. Please connect first.');
        }

        return {
            host: 'localhost',
            port: viewData.port,
            database: database || viewData.selectedDatabase || 'postgres',
            user: 'neon',
            password: 'npg',
            ssl: {
                rejectUnauthorized: false
            }
        };
    }

    private createPool(config: ConnectionConfig): Pool {
        const pool = new Pool({
            ...config,
            max: 5, // Maximum number of clients in the pool
            min: 0, // Minimum number of clients in the pool
            idleTimeoutMillis: 60000, // Close idle clients after 60 seconds
            connectionTimeoutMillis: 5000, // Reduced timeout for faster failure detection
        });

        const poolKey = this.getPoolKey(config.database);
        this.poolStates.set(poolKey, 'active');

        // Handle pool errors
        pool.on('error', (err) => {
            console.error(`Pool error for database ${config.database}:`, err);
            this.handlePoolError(poolKey);
        });

        return pool;
    }

    async getConnection(database?: string): Promise<ManagedClient> {
        const config = await this.getConnectionConfig(database);
        
        // Quick proxy check first
        const isProxyReachable = await this.checkProxyStatus(config);
        if (!isProxyReachable) {
            throw new Error(`Unable to connect to database proxy at ${config.host}:${config.port}. Please ensure the Neon proxy container is running and accessible.`);
        }
        
        const poolKey = this.getPoolKey(config.database);
        const poolState = this.poolStates.get(poolKey);

        // If pool is ending or ended, wait or create new one
        if (poolState === 'ending') {
            // Wait a bit for pool to finish ending, then create new one
            await new Promise(resolve => setTimeout(resolve, 100));
            return this.getConnection(database); // Recursive call after wait
        }

        let pool = this.pools.get(poolKey);
        if (!pool || poolState === 'ended') {
            // Clean up any existing ended pool
            if (pool) {
                this.pools.delete(poolKey);
                this.poolStates.delete(poolKey);
            }
            
            pool = this.createPool(config);
            this.pools.set(poolKey, pool);
        }

        try {
            // Get a client from the pool with retry logic
            const poolClient = await this.getClientWithRetry(pool, 3);
            return this.wrapPoolClient(poolClient);
        } catch (error) {
            console.error(`Failed to get connection for database ${config.database}:`, error);
            
            // If pool connection fails, safely close and remove the pool
            await this.safeClosePool(poolKey);
            
            const directClient = await this.createDirectConnection(config);
            return this.wrapDirectClient(directClient);
        }
    }

    private async getClientWithRetry(pool: Pool, retries: number): Promise<PoolClient> {
        for (let i = 0; i < retries; i++) {
            try {
                const client = await pool.connect();
                return client;
            } catch (error) {
                console.warn(`Connection attempt ${i + 1} failed:`, error);
                
                if (i === retries - 1) {
                    throw error;
                }
                
                // Shorter wait with reduced backoff for better UX
                await new Promise(resolve => setTimeout(resolve, Math.min(500 * Math.pow(2, i), 2000)));
            }
        }
        
        throw new Error('All connection attempts failed');
    }

    private async handlePoolError(poolKey: string): Promise<void> {
        console.debug(`Handling pool error for ${poolKey}`);
        await this.safeClosePool(poolKey);
    }

    private async safeClosePool(poolKey: string): Promise<void> {
        const pool = this.pools.get(poolKey);
        if (!pool) return;

        const currentState = this.poolStates.get(poolKey);
        if (currentState === 'ending' || currentState === 'ended') {
            return; // Already being closed or closed
        }

        this.poolStates.set(poolKey, 'ending');
        
        try {
            await pool.end();
            this.poolStates.set(poolKey, 'ended');
            console.debug(`Pool ${poolKey} safely closed`);
        } catch (error) {
            console.error(`Error closing pool ${poolKey}:`, error);
            this.poolStates.set(poolKey, 'ended');
        } finally {
            this.pools.delete(poolKey);
            // Keep the poolState as 'ended' briefly to prevent immediate recreation
            setTimeout(() => {
                this.poolStates.delete(poolKey);
            }, 1000);
        }
    }

    private async createDirectConnection(config: ConnectionConfig): Promise<Client> {
        const client = new Client(config);
        
        try {
            await client.connect();
            return client;
        } catch (error) {
            console.error('Direct connection failed:', error);
            throw new Error(`Unable to connect to database ${config.database}. Please ensure the Neon proxy is running and accessible.`);
        }
    }

    private wrapPoolClient(client: PoolClient): ManagedClient {
        return {
            isPoolClient: true,
            query: client.query.bind(client),
            release: client.release.bind(client)
        };
    }

    private wrapDirectClient(client: Client): ManagedClient {
        return {
            isPoolClient: false,
            query: client.query.bind(client),
            release: () => {
                // For direct clients, end the connection instead of release
                client.end().catch(err => 
                    console.error('Error ending direct client connection:', err)
                );
            },
            connect: client.connect.bind(client),
            end: client.end.bind(client)
        };
    }

    private async checkProxyStatus(config: ConnectionConfig): Promise<boolean> {
        const net = require('net');
        
        return new Promise<boolean>((resolve) => {
            const socket = new net.Socket();
            
            const timeout = setTimeout(() => {
                socket.destroy();
                resolve(false);
            }, 10000); // 10 second timeout
            
            socket.connect(config.port, config.host, () => {
                clearTimeout(timeout);
                socket.destroy();
                resolve(true);
            });
            
            socket.on('error', () => {
                clearTimeout(timeout);
                resolve(false);
            });
        });
    }

    async executeQuery<T = any>(
        query: string, 
        params: any[] = [], 
        database?: string
    ): Promise<{ rows: T[]; rowCount: number }> {
        let client: ManagedClient | null = null;
        
        try {
            client = await this.getConnection(database);
            const result = await client.query(query, params);
            return {
                rows: result.rows,
                rowCount: result.rowCount || 0
            };
        } catch (error) {
            console.error('Query execution failed:', error);
            throw error;
        } finally {
            if (client) {
                client.release();
            }
        }
    }

    async testConnection(database?: string): Promise<boolean> {
        try {
            const result = await this.executeQuery('SELECT 1 as test', [], database);
            return result.rows.length > 0 && result.rows[0].test === 1;
        } catch (error) {
            console.error('Connection test failed:', error);
            return false;
        }
    }

    async closeAll(): Promise<void> {
        const poolKeys = Array.from(this.pools.keys());
        const closePromises = poolKeys.map(poolKey => this.safeClosePool(poolKey));
        
        await Promise.all(closePromises);
        this.pools.clear();
        this.poolStates.clear();
    }

    async closePool(database: string): Promise<void> {
        const poolKey = this.getPoolKey(database);
        await this.safeClosePool(poolKey);
    }

    // Health check for all pools
    async healthCheck(): Promise<{ [database: string]: boolean }> {
        const results: { [database: string]: boolean } = {};
        
        for (const [poolKey] of this.pools) {
            try {
                results[poolKey] = await this.testConnection(poolKey);
            } catch (error) {
                results[poolKey] = false;
            }
        }
        
        return results;
    }
}