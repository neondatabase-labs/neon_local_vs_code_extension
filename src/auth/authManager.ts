import * as vscode from 'vscode';
import { auth, refreshToken, TokenSet, AuthProps } from './authService';
import { CONFIG } from '../constants';
import { StateService } from '../services/state.service';
import { SecureTokenStorage } from '../services/secureTokenStorage';

export class AuthManager {
  private static instance: AuthManager;
  private context: vscode.ExtensionContext;
  private _isAuthenticated: boolean = false;
  private _tokenSet: TokenSet | undefined;
  private _onDidChangeAuthentication = new vscode.EventEmitter<boolean>();
  private secureStorage: SecureTokenStorage;
  
  readonly onDidChangeAuthentication = this._onDidChangeAuthentication.event;

  private constructor(context: vscode.ExtensionContext) {
    this.context = context;
    this.secureStorage = SecureTokenStorage.getInstance(context);
    this._tokenSet = this.context.globalState.get<TokenSet>('neon.tokenSet');
    // Initialize authentication state - will be updated when tokens are loaded
    this._isAuthenticated = !!this._tokenSet;
    // Initialize auth state asynchronously
    this.initializeAuthState().catch(console.error);
  }

  static getInstance(context: vscode.ExtensionContext): AuthManager {
    if (!AuthManager.instance) {
      AuthManager.instance = new AuthManager(context);
    }
    return AuthManager.instance;
  }

  get isAuthenticated(): boolean {
    return this._isAuthenticated;
  }

  async isAuthenticatedAsync(): Promise<boolean> {
    const persistentToken = await this.getPersistentApiToken();
    return !!persistentToken || !!this._tokenSet;
  }

  get tokenSet(): TokenSet | undefined {
    return this._tokenSet;
  }

  async getPersistentApiToken(): Promise<string | undefined> {
    return await this.secureStorage.getPersistentApiToken();
  }

  async signIn(): Promise<void> {
    try {
      const authProps: AuthProps = {
        oauthHost: 'https://oauth2.neon.tech',
        clientId: 'neonctl',
        extensionUri: this.context.extensionUri
      };

      const tokenSet = await auth(authProps);
      
      this._tokenSet = tokenSet;
      this._isAuthenticated = true;
      
      // Store tokens securely
      await this.context.globalState.update('neon.tokenSet', tokenSet);
      if (tokenSet.access_token) {
        await this.secureStorage.storeAccessToken(tokenSet.access_token);
      }
      if (tokenSet.refresh_token) {
        await this.secureStorage.storeRefreshToken(tokenSet.refresh_token);
      }
      
      this._onDidChangeAuthentication.fire(true);
      
      vscode.window.showInformationMessage('Successfully signed in to Neon!');
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to sign in: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  async signOut(): Promise<void> {
    this._tokenSet = undefined;
    this._isAuthenticated = false;
    
    // Clear all storage locations
    await this.context.globalState.update('neon.tokenSet', undefined);
    await this.secureStorage.clearAllTokens();
    
    // Clear the state service
    const stateService = new StateService(this.context);
    await stateService.clearState();
    await stateService.setCurrentOrg('');
    
    this._onDidChangeAuthentication.fire(false);
    
    vscode.window.showInformationMessage('Signed out from Neon');
  }

  async refreshTokenIfNeeded(): Promise<boolean> {
    // If using persistent API token, no need to refresh
    const persistentToken = await this.getPersistentApiToken();
    if (persistentToken) {
      return true;
    }

    if (!this._tokenSet || !this._tokenSet.refresh_token) {
      return false;
    }

    // Check if token is expired or about to expire (within 5 minutes)
    const now = Math.floor(Date.now() / 1000);
    const expiresAt = this._tokenSet.expires_at || 0;
    
    if (expiresAt - now > 300) {
      // Token is still valid for more than 5 minutes
      return true;
    }

    try {
      const authProps: AuthProps = {
        oauthHost: 'https://oauth2.neon.tech',
        clientId: 'neonctl',
        extensionUri: this.context.extensionUri
      };

      const newTokenSet = await refreshToken(authProps, this._tokenSet);
      
      this._tokenSet = newTokenSet;
      await this.context.globalState.update('neon.tokenSet', newTokenSet);
      if (newTokenSet.access_token) {
        await this.secureStorage.storeAccessToken(newTokenSet.access_token);
      }
      if (newTokenSet.refresh_token) {
        await this.secureStorage.storeRefreshToken(newTokenSet.refresh_token);
      }
      
      return true;
    } catch (error) {
      console.error('Failed to refresh token:', error);
      
      // If refresh fails, sign out
      await this.signOut();
      return false;
    }
  }

  async setPersistentApiToken(token: string): Promise<void> {
    await this.secureStorage.storePersistentApiToken(token);
    this._isAuthenticated = true;
    this._onDidChangeAuthentication.fire(true);
    vscode.window.showInformationMessage('Successfully imported API token!');
  }

  // Migration method to move existing tokens from config to secure storage
  async migrateTokensFromConfig(): Promise<void> {
    await this.secureStorage.migrateFromConfig();
  }

  // Initialize authentication state after constructor
  async initializeAuthState(): Promise<void> {
    const persistentToken = await this.getPersistentApiToken();
    const wasAuthenticated = this._isAuthenticated;
    // Persistent token takes precedence over OAuth token
    this._isAuthenticated = !!persistentToken || !!this._tokenSet;
    
    // Fire authentication change event if the state changed
    if (wasAuthenticated !== this._isAuthenticated) {
      this._onDidChangeAuthentication.fire(this._isAuthenticated);
    }
  }
} 