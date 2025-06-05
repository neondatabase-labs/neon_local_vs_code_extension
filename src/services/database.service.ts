import * as vscode from 'vscode';

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

    async createDatabase(name: string): Promise<void> {
        // TODO: Implement database creation
    }

    async dropDatabase(name: string): Promise<void> {
        // TODO: Implement database deletion
    }
} 