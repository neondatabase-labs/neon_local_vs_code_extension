import * as vscode from 'vscode';
import { WebViewService } from './services/webview.service';
import { StateService } from './services/state.service';
import { ConnectViewProvider } from './connectView';
import { DatabaseViewProvider } from './databaseView';
import { ActionsViewProvider } from './actionsView';
import { DockerService } from './services/docker.service';
import { ViewData } from './types';
import { NeonApiService } from './services/api.service';
import { AuthManager } from './auth/authManager';

export async function activate(context: vscode.ExtensionContext) {
  // Initialize services
  const stateService = new StateService(context);
  const apiService = new NeonApiService(context);
  const webviewService = new WebViewService(context, stateService);
  const dockerService = new DockerService(context, stateService);
  const authManager = AuthManager.getInstance(context);

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
      console.debug('Container is already running, checking if it is ready...');
      
      // Check if the container is ready by looking at the logs
      const isReady = await dockerService.checkContainerReady();
      if (!isReady) {
        console.debug('Container is not ready (no ready message found), stopping it...');
        try {
          await dockerService.stopContainer();
          console.debug('Container stopped successfully');
        } catch (stopError) {
          console.error('Error stopping unready container:', stopError);
        }
        
        // Ensure the UI shows disconnected state
        await stateService.setIsProxyRunning(false);
        await stateService.setCurrentlyConnectedBranch('');
        await stateService.setDatabases([]);
        await stateService.setRoles([]);
        console.debug('State reset to disconnected after stopping unready container');
      } else {
        console.debug('Container is ready, updating state...');
        
        // First try to get branch ID from .branches file
        const branchId = await dockerService.checkBranchesFile(context);
        
        if (branchId) {
          console.debug('✅ Using branch ID from .branches file:', branchId);
          await stateService.setIsProxyRunning(true);
          await stateService.setCurrentlyConnectedBranch(branchId);

          // Fetch and update databases and roles
          try {
            const projectId = await stateService.getCurrentProjectId();
            console.debug('🔍 Extension startup - projectId:', projectId, 'branchId:', branchId);
            
            if (projectId) {
              console.debug('📊 Fetching databases and roles for startup...');
              const [databases, roles] = await Promise.all([
                apiService.getDatabases(projectId, branchId),
                apiService.getRoles(projectId, branchId)
              ]);
              await Promise.all([
                stateService.setDatabases(databases),
                stateService.setRoles(roles)
              ]);
              console.debug('✅ Updated databases and roles on startup');
            } else {
              console.warn('⚠️  No projectId found during startup');
            }
          } catch (error) {
            console.error('❌ Error fetching databases and roles on startup:', error);
          }
        } else {
          // Fallback to container info if .branches file doesn't have the ID
          console.debug('⚠️  No branch ID in .branches file, falling back to container info...');
          const containerInfo = await dockerService.getContainerInfo();
          if (containerInfo) {
            console.debug('✅ Using branch ID from container info:', containerInfo.branchId);
            await stateService.setIsProxyRunning(true);
            await stateService.setCurrentlyConnectedBranch(containerInfo.branchId);

            // Fetch and update databases and roles
            try {
              const projectId = containerInfo.projectId;
              console.debug('🔍 Extension startup (container fallback) - projectId:', projectId, 'branchId:', containerInfo.branchId);
              
              if (projectId) {
                console.debug('📊 Fetching databases and roles for startup (from container info)...');
                const [databases, roles] = await Promise.all([
                  apiService.getDatabases(projectId, containerInfo.branchId),
                  apiService.getRoles(projectId, containerInfo.branchId)
                ]);
                await Promise.all([
                  stateService.setDatabases(databases),
                  stateService.setRoles(roles)
                ]);
                console.debug('✅ Updated databases and roles on startup (from container info)');
              } else {
                console.warn('⚠️  No projectId found in container info during startup');
              }
            } catch (error) {
              console.error('❌ Error fetching databases and roles on startup (container fallback):', error);
            }
          } else {
            console.warn('⚠️  No container info available for fallback');
          }
        }
        
        // Start the status check to keep state in sync
        await dockerService.startStatusCheck();
        console.debug('Started status check for existing container');
      }
    } else {
      console.debug('No running container found on startup');
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
    stateService,
    context
  );
  const actionsViewProvider = new ActionsViewProvider(
    context.extensionUri,
    webviewService,
    stateService
  );

  // Register core commands
  disposables.push(
    vscode.commands.registerCommand('neon-local-connect.configure', () => {
      webviewService.configure();
    }),
    vscode.commands.registerCommand('neon-local-connect.showPanel', () => {
      webviewService.showPanel(context);
    }),
    vscode.commands.registerCommand('neon-local-connect.stopProxy', async () => {
      await dockerService.stopContainer();
    }),
    vscode.commands.registerCommand('neon-local-connect.clearAuth', async () => {
      await authManager.signOut();
    }),
    vscode.commands.registerCommand('neon-local-connect.forceTokenRefresh', async () => {
      try {
        console.debug('🔄 Force token refresh command triggered');
        const success = await authManager.refreshTokenIfNeeded(true, 'extension.forceRefresh');
        if (success) {
          vscode.window.showInformationMessage('✅ Token refresh successful!');
        } else {
          vscode.window.showWarningMessage('⚠️  Token refresh failed or no refresh token available');
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        
        // Enhanced user guidance for the known restart issue
        if (errorMessage.includes('invalid_grant')) {
          const action = await vscode.window.showErrorMessage(
            '🔄 Authentication needs renewal after VS Code restart. This is a known limitation with Neon\'s OAuth server.',
            'Sign In Again',
            'Learn More'
          );
          
          if (action === 'Sign In Again') {
            // Automatically clear auth and trigger sign-in
            await vscode.commands.executeCommand('neon-local-connect.clearAuth');
            await vscode.commands.executeCommand('neon-local-connect.configure');
          } else if (action === 'Learn More') {
            vscode.window.showInformationMessage(
              'Due to server-side session binding, refresh tokens become invalid after VS Code restarts. ' +
              'This is a security feature of the OAuth server. Simply sign in again to continue.'
            );
          }
        } else {
          vscode.window.showErrorMessage(`❌ Token refresh failed: ${errorMessage}`);
        }
        
        console.error('Force token refresh error:', error);
      }
    }),
    vscode.commands.registerCommand('neon-local-connect.testRefreshTiming', async () => {
      try {
        console.debug('🧪 Testing refresh timing immediately after restart');
        
        // Get current token info
        const tokenSet = authManager.tokenSet;
        if (!tokenSet) {
          vscode.window.showErrorMessage('No token set available');
          return;
        }
        
        const now = Math.floor(Date.now() / 1000);
        const expiresIn = tokenSet.expires_at ? tokenSet.expires_at - now : 'unknown';
        
        console.debug('🧪 Current token status:', {
          hasRefreshToken: !!tokenSet.refresh_token,
          refreshTokenSample: tokenSet.refresh_token?.substring(0, 20) + '...',
          accessTokenExpiresIn: expiresIn,
          originalRedirectUri: tokenSet.original_redirect_uri,
          tokenAge: tokenSet.expires_at ? now - (tokenSet.expires_at - (tokenSet.expires_in || 3600)) : 'unknown'
        });
        
        // Try refresh with detailed timing info
        const startTime = Date.now();
        const success = await authManager.refreshTokenIfNeeded(true, 'extension.timingTest');
        const endTime = Date.now();
        
        console.debug('🧪 Timing test result:', {
          success,
          durationMs: endTime - startTime,
          timestamp: new Date().toISOString()
        });
        
        if (success) {
          vscode.window.showInformationMessage(`✅ Timing test successful! Duration: ${endTime - startTime}ms`);
        } else {
          vscode.window.showWarningMessage(`⚠️  Timing test failed after ${endTime - startTime}ms`);
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        vscode.window.showErrorMessage(`❌ Timing test error: ${errorMessage}`);
        console.error('Timing test error:', error);
      }
    }),
    vscode.commands.registerCommand('neon-local-connect.debugOAuthIssuer', async () => {
      try {
        console.debug('🔍 Debugging OAuth issuer configuration...');
        
        // Import openid-client dynamically
        const { Issuer } = await import('openid-client');
        const issuer = await Issuer.discover('https://oauth2.neon.tech');
        
        console.debug('🔍 OAuth Issuer Full Metadata:', {
          issuer: issuer.issuer,
          authorizationEndpoint: issuer.authorization_endpoint,
          tokenEndpoint: issuer.token_endpoint,
          userinfoEndpoint: issuer.userinfo_endpoint,
          jwksUri: issuer.jwks_uri,
          responseTypesSupported: issuer.response_types_supported,
          responseModesSupported: issuer.response_modes_supported,
          tokenEndpointAuthMethodsSupported: issuer.token_endpoint_auth_methods_supported,
          fullMetadata: JSON.stringify(issuer.metadata, null, 2)
        });
        
        vscode.window.showInformationMessage('🔍 OAuth issuer metadata logged to console');
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        vscode.window.showErrorMessage(`❌ OAuth issuer debug error: ${errorMessage}`);
        console.error('OAuth issuer debug error:', error);
      }
    }),
    vscode.commands.registerCommand('neon-local-connect.testTokenStates', async () => {
      try {
        console.debug('🧪 Testing token refresh in different states...');
        
        // Test 1: Force refresh when token is still valid (this may fail)
        console.debug('🧪 TEST 1: Force refresh with valid token (expecting failure)');
        try {
          await authManager.refreshTokenIfNeeded(true, 'test.validToken');
          console.debug('✅ TEST 1 UNEXPECTED SUCCESS: Valid token refresh succeeded');
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          console.debug('❌ TEST 1 EXPECTED FAILURE: Valid token refresh failed (this is likely normal):', errorMessage);
        }
        
        // Test 1.5: Try refresh without forcing (should skip if valid)
        console.debug('🧪 TEST 1.5: Natural refresh check (should skip if valid)');
        try {
          const result = await authManager.refreshTokenIfNeeded(false, 'test.naturalRefresh');
          console.debug('🔍 TEST 1.5 RESULT: Natural refresh result:', result);
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          console.debug('❌ TEST 1.5 FAILED: Natural refresh failed:', errorMessage);
        }
        
        // Test 2: Detailed token expiry analysis
        console.debug('🧪 TEST 2: Detailed token expiry analysis');
        const tokenSet = authManager.tokenSet;
        if (tokenSet && tokenSet.expires_at) {
          const now = Math.floor(Date.now() / 1000);
          const timeUntilExpiry = tokenSet.expires_at - now;
          const timeUntilExpiryMinutes = Math.floor(timeUntilExpiry / 60);
          const tokenAge = tokenSet.expires_in ? now - (tokenSet.expires_at - tokenSet.expires_in) : 'unknown';
          
          console.debug(`🧪 DETAILED TOKEN ANALYSIS:`);
          console.debug(`  - Token expires in: ${timeUntilExpiry} seconds (${timeUntilExpiryMinutes} minutes)`);
          console.debug(`  - Token age: ${tokenAge} seconds`);
          console.debug(`  - Expires at: ${new Date(tokenSet.expires_at * 1000).toISOString()}`);
          console.debug(`  - Current time: ${new Date(now * 1000).toISOString()}`);
          console.debug(`  - Token is expired: ${timeUntilExpiry <= 0}`);
          console.debug(`  - Token expires soon (< 300s): ${timeUntilExpiry < 300}`);
          console.debug(`  - Token expires very soon (< 60s): ${timeUntilExpiry < 60}`);
          
          if (timeUntilExpiry > 300) {
            console.debug('🧪 HYPOTHESIS: Token has >5 minutes left - server may reject force refresh');
            console.debug('🧪 RECOMMENDATION: Wait until token has <5 minutes remaining before testing refresh');
          } else if (timeUntilExpiry > 0) {
            console.debug('🧪 Token expires soon - this would be a good time to test refresh');
          } else {
            console.debug('🧪 Token has expired - natural refresh should definitely work');
          }
        } else {
          console.debug('🧪 No token expiry information available');
        }
        
        // Test 3: Try an immediate refresh in same session (for comparison)
        console.debug('🧪 TEST 3: Immediate refresh in same session (for comparison)');
        console.debug('🧪 NOTE: This tests if the issue is restart-specific or general force-refresh');
        
        // Wait a moment to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        try {
          const immediateResult = await authManager.refreshTokenIfNeeded(true, 'test.immediateRefresh');
          console.debug('✅ TEST 3 SUCCESS: Immediate refresh in same session worked!');
          console.debug('🔍 This suggests the issue IS restart-specific, not just force-refresh');
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          console.debug('❌ TEST 3 FAILED: Immediate refresh in same session also failed:', errorMessage);
          console.debug('🔍 This suggests the issue is with force-refreshing valid tokens, not restart-specific');
        }

        vscode.window.showInformationMessage('Token state tests completed - check console for detailed analysis');
      } catch (error) {
        console.error('🚨 Token state test failed:', error);
        vscode.window.showErrorMessage(`Token state test failed: ${error}`);
      }
    }),
    vscode.commands.registerCommand('neon-local-connect.showWebviewStats', () => {
      const stats = webviewService.getRegistrationStats();
      vscode.window.showInformationMessage(
        `WebView Stats - Panels: ${stats.panels}, Views: ${stats.views}, Messages: ${stats.messageStats.successful} success / ${stats.messageStats.failed} failed`
      );
    }),
    vscode.commands.registerCommand('neon-local-connect.configureOAuthPort', async () => {
      try {
        // Get current configuration
        const config = vscode.workspace.getConfiguration('neonLocal');
        const currentPort = config.get<number | string>('oauthCallbackPort', 'auto');
        
        // Show quick pick for common options
        const quickPickItems = [
          {
            label: 'Auto (Recommended)',
            description: 'Let the system choose an available port automatically',
            detail: 'This is the safest option and avoids port conflicts',
            value: 'auto'
          },
          {
            label: 'Custom Port',
            description: 'Specify a specific port number',
            detail: 'Enter a port number between 1024 and 65535',
            value: 'custom'
          }
        ];

        const selection = await vscode.window.showQuickPick(quickPickItems, {
          placeHolder: `Current setting: ${currentPort}`,
          title: 'Configure OAuth Callback Port',
          ignoreFocusOut: true
        });

        if (!selection) {
          return; // User cancelled
        }

        let newPortValue: string | number;

        if (selection.value === 'auto') {
          newPortValue = 'auto';
        } else {
          // Custom port - show input box
          const portInput = await vscode.window.showInputBox({
            prompt: 'Enter a port number (1024-65535)',
            placeHolder: 'e.g., 8080',
            value: typeof currentPort === 'number' ? currentPort.toString() : '',
            validateInput: (value) => {
              if (!value || value.trim() === '') {
                return 'Port number is required';
              }
              
              const portNumber = parseInt(value.trim(), 10);
              if (isNaN(portNumber)) {
                return 'Port must be a valid number';
              }
              
              if (portNumber < 1024 || portNumber > 65535) {
                return 'Port must be between 1024 and 65535';
              }
              
              return undefined; // Valid
            },
            ignoreFocusOut: true
          });

          if (!portInput) {
            return; // User cancelled
          }

          newPortValue = parseInt(portInput.trim(), 10);
        }

        // Update the configuration
        await config.update('oauthCallbackPort', newPortValue, vscode.ConfigurationTarget.Global);

        // Show confirmation
        const portDisplay = newPortValue === 'auto' ? 'auto (dynamic)' : `${newPortValue} (static)`;
        vscode.window.showInformationMessage(
          `OAuth callback port set to: ${portDisplay}. This will take effect on the next authentication.`
        );

      } catch (error) {
        vscode.window.showErrorMessage(`Failed to configure OAuth port: ${error instanceof Error ? error.message : String(error)}`);
      }
    })
  );

  // Register database action commands
  disposables.push(
    vscode.commands.registerCommand('neon-local-connect.openSqlEditor', async () => {
      try {
        // Get the current project and branch IDs
        const projectId = await stateService.getCurrentProjectId();
        const viewData = await stateService.getViewData();
        const branchId = viewData.connectionType === 'new' ? viewData.currentlyConnectedBranch : await stateService.getCurrentBranchId();
        
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
        const sqlEditorUrl = `https://console.neon.tech/app/projects/${projectId}/branches/${branchId}/sql-editor?database=${selectedDatabase.label}`;
        await vscode.env.openExternal(vscode.Uri.parse(sqlEditorUrl));
      } catch (error) {
        vscode.window.showErrorMessage(`Failed to open SQL Editor: ${error}`);
      }
    }),
    vscode.commands.registerCommand('neon-local-connect.openTableView', async () => {
      try {
        // Get the current project and branch IDs
        const projectId = await stateService.getCurrentProjectId();
        const viewData = await stateService.getViewData();
        const branchId = viewData.connectionType === 'new' ? viewData.currentlyConnectedBranch : await stateService.getCurrentBranchId();
        
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
    vscode.commands.registerCommand('neon-local-connect.launchPsql', async () => {
      try {
        // Get the current project and branch IDs
        const projectId = await stateService.getCurrentProjectId();
        const viewData = await stateService.getViewData();
        const branchId = viewData.connectionType === 'new' ? viewData.currentlyConnectedBranch : await stateService.getCurrentBranchId();
        
        if (!projectId || !branchId) {
          throw new Error('Project ID or Branch ID not found');
        }

        // Get available databases and roles
        const databases = await stateService.getDatabases();
        const roles = await stateService.getRoles();
        if (!databases || databases.length === 0) {
          throw new Error('No databases available');
        }
        if (!roles || roles.length === 0) {
          throw new Error('No roles available');
        }

        // Prompt user to select a database
        const selectedDatabase = await vscode.window.showQuickPick(
          databases.map(db => ({
            label: db.name,
            description: `Owner: ${db.owner_name}`,
            detail: db.created_at ? `Created: ${new Date(db.created_at).toLocaleString()}` : undefined
          })),
          {
            placeHolder: 'Select a database to connect to',
            ignoreFocusOut: true
          }
        );

        if (!selectedDatabase) {
          return; // User cancelled
        }

        // Prompt user to select a role
        const selectedRole = await vscode.window.showQuickPick(
          roles.map(role => ({
            label: role.name,
            description: role.protected ? 'Protected' : undefined
          })),
          {
            placeHolder: 'Select a role to connect as',
            ignoreFocusOut: true
          }
        );

        if (!selectedRole) {
          return; // User cancelled
        }

        // Get the role password and compute endpoint
        const [password, endpoint] = await Promise.all([
          apiService.getRolePassword(projectId, branchId, selectedRole.label),
          apiService.getBranchEndpoint(projectId, branchId)
        ]);

        // Create the connection string
        const connectionString = `postgres://${selectedRole.label}:${password}@${endpoint}/${selectedDatabase.label}?sslmode=require`;

        // Launch PSQL with the connection string
        const terminal = vscode.window.createTerminal('Neon PSQL');
        terminal.show();
        terminal.sendText(`psql "${connectionString}"`);
      } catch (error) {
        vscode.window.showErrorMessage(`Failed to launch PSQL: ${error instanceof Error ? error.message : String(error)}`);
      }
    }),
    vscode.commands.registerCommand('neon-local-connect.resetFromParent', async () => {
        try {
            const containerInfo = await dockerService.getContainerInfo();
            
            if (!containerInfo) {
                throw new Error('Container info not found. Make sure the container is running.');
            }
            
            const projectId = containerInfo.projectId;
            const branchId = await stateService.currentlyConnectedBranch;
            const viewData = await stateService.getViewData();
            const connectionType = viewData.connectionType;
            const branchName = connectionType === 'existing' ? viewData.selectedBranchName : branchId;
            
            console.debug('Reset from parent - Project ID:', projectId);
            console.debug('Reset from parent - Branch ID:', branchId);
            console.debug('Reset from parent - Branch Name:', branchName);
            console.debug('Reset from parent - Connection Type:', connectionType);
            
            if (!projectId || !branchId) {
                throw new Error('Project ID or Branch ID not found');
            }

            // Check if the branch has a parent
            const branchDetails = await apiService.getBranchDetails(projectId, branchId);
            if (!branchDetails.parent_id) {
                vscode.window.showErrorMessage(`Cannot reset branch "${branchName}" as it does not have a parent branch.`);
                return;
            }

            // Add confirmation dialog with appropriate branch identifier
            const confirmMessage = connectionType === 'existing' 
                ? `Are you sure you want to reset branch "${branchName}" to its parent state? This action cannot be undone.`
                : `Are you sure you want to reset branch "${branchId}" to its parent state? This action cannot be undone.`;

            const answer = await vscode.window.showInformationMessage(
                confirmMessage,
                { modal: true },
                'Reset'
            );

            if (answer !== 'Reset') {
                return;
            }

            // Reset the branch using the API service
            await apiService.resetBranchToParent(projectId, branchId);

            // Show success message with appropriate branch identifier
            const successMessage = connectionType === 'existing'
                ? `Branch "${branchName}" reset.`
                : `Branch "${branchId}" reset.`;

            vscode.window.showInformationMessage(successMessage);
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