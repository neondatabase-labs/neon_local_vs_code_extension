import * as path from 'path';
import { runTests } from '@vscode/test-electron';

async function main() {
    try {
        console.log('Starting test runner...');
        
        // The folder containing the Extension Manifest package.json
        const extensionDevelopmentPath = path.resolve(__dirname, '../../');
        console.log('Extension development path:', extensionDevelopmentPath);
        
        // The path to the extension test runner script
        const extensionTestsPath = path.resolve(__dirname, './suite/index');
        console.log('Extension tests path:', extensionTestsPath);

        // Download VS Code, unzip it and run the integration test
        await runTests({
            extensionDevelopmentPath,
            extensionTestsPath,
            launchArgs: [
                '--disable-gpu',
                '--no-sandbox',
                '--new-window',
                '--disable-workspace-trust'
            ],
            version: '1.85.0'
        });
    } catch (err) {
        console.error('Failed to run tests');
        console.error(err);
        process.exit(1);
    }
}

main(); 