import * as vscode from 'vscode';
import { WebViewService } from './services/webview.service';
import { StateService } from './services/state.service';
import { ConnectViewProvider } from './connectView';
import { DatabaseViewProvider } from './databaseView';
import { ActionsViewProvider } from './actionsView';
import { DockerService } from './services/docker.service';
import { ViewData } from './types';

export async function activate(context: vscode.ExtensionContext) {
  // Initialize services
  const stateService = new StateService(context);
  const webviewService = new WebViewService(context, stateService);
  const dockerService = new DockerService(context, stateService);

  // Initialize webview service
  await webviewService.initialize();

  // Register the viewDataChanged command first
  context.subscriptions.push(
    vscode.commands.registerCommand('neonLocal.viewDataChanged', async (viewData: ViewData) => {
      webviewService.updateViewData('neonLocal', viewData);
    })
  );

  // Check initial container status
  try {
    const isRunning = await dockerService.checkContainerStatus();
    if (isRunning) {
      console.log('Container is already running, updating state...');
      // Get container info to update state
      const containerInfo = await dockerService.getContainerInfo();
      if (containerInfo) {
        await stateService.setIsProxyRunning(true);
        await stateService.setCurrentlyConnectedBranch(containerInfo.branchId);
        // Start the status check to keep state in sync
        await dockerService.startStatusCheck();
        console.log('Started status check for existing container');
      }
    } else {
      console.log('No running container found on startup');
      await stateService.setIsProxyRunning(false);
    }
  } catch (error) {
    console.error('Error checking initial container status:', error);
    await stateService.setIsProxyRunning(false);
  }

  // Register commands
  let disposables: vscode.Disposable[] = [];

  // Register webview view providers
  const connectViewProvider = new ConnectViewProvider(
    context.extensionUri,
    webviewService,
    stateService,
    dockerService,
    context
  );
  const databaseViewProvider = new DatabaseViewProvider(
    context.extensionUri,
    webviewService,
    stateService
  );
  const actionsViewProvider = new ActionsViewProvider(
    context.extensionUri,
    webviewService,
    stateService
  );

  // Register core commands
  disposables.push(
    vscode.commands.registerCommand('neon-local.configure', () => {
      webviewService.configure();
    }),
    vscode.commands.registerCommand('neon-local.showPanel', () => {
      webviewService.showPanel(context);
    }),
    vscode.commands.registerCommand('neon-local.stopProxy', async () => {
      await dockerService.stopContainer();
    }),
    vscode.commands.registerCommand('neon-local.clearAuth', async () => {
      await stateService.clearAuth();
    })
  );

  // Register database action commands
  disposables.push(
    vscode.commands.registerCommand('neon-local.openSqlEditor', async () => {
      try {
        // Get the current project and branch IDs
        const projectId = await stateService.getCurrentProjectId();
        const branchId = await stateService.getCurrentBranchId();
        
        if (!projectId || !branchId) {
          throw new Error('Project ID or Branch ID not found');
        }

        // Get available databases
        const databases = await stateService.getDatabases();
        if (!databases || databases.length === 0) {
          throw new Error('No databases available');
        }

        // Prompt user to select a database
        const selectedDatabase = await vscode.window.showQuickPick(
          databases.map(db => ({
            label: db.name,
            description: `Owner: ${db.owner_name}`,
            detail: db.created_at ? `Created: ${new Date(db.created_at).toLocaleString()}` : undefined
          })),
          {
            placeHolder: 'Select a database',
            ignoreFocusOut: true
          }
        );

                if (!selectedDatabase) {
                    return; // User cancelled
                }

        // Open the SQL Editor URL in the browser with the selected database
        const sqlEditorUrl = `https://console.neon.tech/app/projects/${projectId}/branches/${branchId}/databases/${selectedDatabase.label}/sql-editor`;
        await vscode.env.openExternal(vscode.Uri.parse(sqlEditorUrl));
      } catch (error) {
        vscode.window.showErrorMessage(`Failed to open SQL Editor: ${error}`);
      }
            }),
            vscode.commands.registerCommand('neon-local.openTableView', async () => {
                try {
                    // Get the current project and branch IDs
                    const projectId = await stateService.getCurrentProjectId();
                    const branchId = await stateService.getCurrentBranchId();
                    
                    if (!projectId || !branchId) {
                        throw new Error('Project ID or Branch ID not found');
                    }

                    // Get available databases
                    const databases = await stateService.getDatabases();
                    if (!databases || databases.length === 0) {
                        throw new Error('No databases available');
                    }

                    // Prompt user to select a database
                    const selectedDatabase = await vscode.window.showQuickPick(
                        databases.map(db => ({
                            label: db.name,
                            description: `Owner: ${db.owner_name}`,
                            detail: db.created_at ? `Created: ${new Date(db.created_at).toLocaleString()}` : undefined
                        })),
                        {
                            placeHolder: 'Select a database to view tables',
                            ignoreFocusOut: true
                        }
                    );

                if (!selectedDatabase) {
                    return; // User cancelled
                }

                    // Open the Table View URL in the browser with the selected database
                    const tableViewUrl = `https://console.neon.tech/app/projects/${projectId}/branches/${branchId}/tables?database=${selectedDatabase.label}`;
                    await vscode.env.openExternal(vscode.Uri.parse(tableViewUrl));
                } catch (error) {
                    vscode.window.showErrorMessage(`Failed to open Table View: ${error}`);
                }
            }),
            vscode.commands.registerCommand('neon-local.launchPsql', async () => {
                    const terminal = vscode.window.createTerminal('Neon PSQL');
                    terminal.show();
      terminal.sendText('psql "postgres://neon:npg@localhost:5432/neondb?sslmode=require"');
    }),
    vscode.commands.registerCommand('neon-local.resetFromParent', async () => {
        try {
            const config = vscode.workspace.getConfiguration('neonLocal');
        const projectId = config.get<string>('projectId');
        const branchId = await stateService.getCurrentBranchId();
        
        if (!projectId || !branchId) {
          throw new Error('Project ID or Branch ID not found');
        }

        // Stop the proxy before resetting
        await dockerService.stopContainer();
        
        // Get the Neon API client and reset the branch
        const client = await webviewService.getNeonApiClient();
        await client.post(`/projects/${projectId}/branches/${branchId}/reset`);
        
        // Restart the proxy with the reset branch
        await dockerService.startContainer({
          branchId,
          driver: config.get('driver', 'postgres'),
          isExisting: true,
          context,
          projectId
        });

        vscode.window.showInformationMessage('Branch has been reset from parent');
            } catch (error) {
        vscode.window.showErrorMessage(`Failed to reset branch: ${error}`);
      }
    })
  );

  // Register view providers
  disposables.push(
    vscode.window.registerWebviewViewProvider('neonLocalConnect', connectViewProvider),
    vscode.window.registerWebviewViewProvider('neonLocalDatabase', databaseViewProvider),
    vscode.window.registerWebviewViewProvider('neonLocalActions', actionsViewProvider)
  );

  context.subscriptions.push(...disposables);
} 