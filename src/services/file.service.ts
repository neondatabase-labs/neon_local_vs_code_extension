import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

interface BranchesFile {
    main: {
        branch_id: string;
    };
    [key: string]: {
        branch_id: string;
    };
}

export class FileService {
    private globalStorageUri: vscode.Uri;

    constructor(context: vscode.ExtensionContext) {
        this.globalStorageUri = context.globalStorageUri;
    }

    private get neonLocalDir(): string {
        const neonLocalPath = path.join(this.globalStorageUri.fsPath, '.neon_local');
        console.log('Neon local directory path:', neonLocalPath);
        return neonLocalPath;
    }

    private get branchesFilePath(): string {
        const branchesPath = path.join(this.neonLocalDir, '.branches');
        console.log('Branches file path:', branchesPath);
        return branchesPath;
    }

    public async readBranchesFile(): Promise<string | undefined> {
        try {
            if (!fs.existsSync(this.neonLocalDir)) {
                fs.mkdirSync(this.neonLocalDir, { recursive: true });
            }

            if (!fs.existsSync(this.branchesFilePath)) {
                console.log('Branches file does not exist at:', this.branchesFilePath);
                return undefined;
            }

            const content = await fs.promises.readFile(this.branchesFilePath, 'utf-8');
            console.log('Read .branches file at path:', this.branchesFilePath);
            console.log('Raw .branches file content:', content);
            
            const data = JSON.parse(content) as BranchesFile;
            console.log('Parsed .branches file data:', JSON.stringify(data, null, 2));
            
            if (!data.main?.branch_id) {
                console.warn('No main branch ID found in branches file. Data structure:', JSON.stringify(data));
                return undefined;
            }
            
            console.log('Successfully extracted branch ID:', data.main.branch_id);
            return data.main.branch_id;
        } catch (error) {
            console.error('Error reading branches file:', error);
            if (error instanceof Error) {
                console.error('Error details:', error.message);
                console.error('Error stack:', error.stack);
            }
            return undefined;
        }
    }
} 