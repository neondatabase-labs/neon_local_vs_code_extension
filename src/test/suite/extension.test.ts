import * as assert from 'assert';
import * as vscode from 'vscode';

console.log('Loading test file...');

describe('Extension Test Suite', () => {
    console.log('Setting up test suite...');

    before(async () => {
        console.log('Running before hook...');
        // List all installed extensions
        const extensions = vscode.extensions.all;
        console.log('Installed extensions:', extensions.map(ext => ext.id));
    });

    after(() => {
        console.log('Running after hook...');
    });

    it('should pass basic array test', () => {
        console.log('Running basic array test...');
        assert.strictEqual(-1, [1, 2, 3].indexOf(5));
        assert.strictEqual(-1, [1, 2, 3].indexOf(0));
    });

    it('should have the extension present', async () => {
        console.log('Checking for extension...');
        // List all extensions again to see what's available
        const allExtensions = vscode.extensions.all;
        console.log('Available extensions:', allExtensions.map(ext => ext.id));
        
        // Try to find our extension with the correct ID
        const ext = vscode.extensions.getExtension('undefined_publisher.neon-local');
        console.log('Found extension:', ext?.id);
        
        if (!ext) {
            console.error('Extension not found. Available extensions:', allExtensions.map(ext => ext.id));
        }
        
        assert.ok(ext, 'Extension should be present');
    });

    it('should activate the extension', async () => {
        console.log('Attempting to activate extension...');
        const ext = vscode.extensions.getExtension('undefined_publisher.neon-local');
        assert.ok(ext, 'Extension should be present');
        
        try {
            await ext?.activate();
            assert.strictEqual(ext?.isActive, true, 'Extension should be active');
            console.log('Extension activated successfully');
        } catch (error) {
            console.error('Error activating extension:', error);
            throw error;
        }
    });

    it('should register commands', async () => {
        console.log('Checking registered commands...');
        const commands = await vscode.commands.getCommands(true);
        console.log('All registered commands:', commands);
        
        const neonCommands = commands.filter(cmd => cmd.startsWith('neon-local.'));
        console.log('Found Neon commands:', neonCommands);
        
        // Check for specific commands we know should be registered
        const expectedCommands = [
            'neon-local.configure',
            'neon-local.showPanel',
            'neon-local.stopProxy',
            'neon-local.createBranch',
            'neon-local.clearAuth'
        ];
        
        expectedCommands.forEach(cmd => {
            assert.ok(neonCommands.includes(cmd), `Command ${cmd} should be registered`);
        });
    });
}); 