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
    private context: vscode.ExtensionContext;
    private _neonLocalPath: string;
    public readonly branchesFilePath: string;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
        this._neonLocalPath = path.join(context.globalStorageUri.fsPath, '.neon_local');
        this.branchesFilePath = path.join(this._neonLocalPath, '.branches');
        
        // Ensure the .neon_local directory exists
        if (!fs.existsSync(this._neonLocalPath)) {
            fs.mkdirSync(this._neonLocalPath, { recursive: true });
        }
    }

    private get neonLocalDir(): string {
        const neonLocalPath = path.join(this.context.globalStorageUri.fsPath, '.neon_local');
        console.debug('Neon Local Connect directory path:', neonLocalPath);
        return neonLocalPath;
    }

    public async readBranchesFile(): Promise<string | undefined> {
        try {
            if (!fs.existsSync(this.neonLocalDir)) {
                fs.mkdirSync(this.neonLocalDir, { recursive: true });
            }

            if (!fs.existsSync(this.branchesFilePath)) {
                console.debug('Branches file does not exist at:', this.branchesFilePath);
                return undefined;
            }

            const content = await fs.promises.readFile(this.branchesFilePath, 'utf-8');
            console.debug('Read .branches file at path:', this.branchesFilePath);
            console.debug('Raw .branches file content:', content);
            
            const data = JSON.parse(content) as BranchesFile;
            console.debug('Parsed .branches file data:', JSON.stringify(data, null, 2));
            
            if (!data.main?.branch_id) {
                console.warn('No main branch ID found in branches file. Data structure:', JSON.stringify(data));
                return undefined;
            }
            
            console.debug('Successfully extracted branch ID:', data.main.branch_id);
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

    public async deleteBranchesFile(): Promise<void> {
        try {
            if (fs.existsSync(this.branchesFilePath)) {
                await fs.promises.unlink(this.branchesFilePath);
                console.debug('Successfully deleted .branches file at:', this.branchesFilePath);
            } else {
                console.debug('Branches file does not exist, no cleanup needed');
            }
        } catch (error) {
            console.error('Error deleting branches file:', error);
            if (error instanceof Error) {
                console.error('Error details:', error.message);
                console.error('Error stack:', error.stack);
            }
        }
    }
} 