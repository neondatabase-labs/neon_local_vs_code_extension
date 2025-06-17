import * as vscode from 'vscode';
import { auth, refreshToken, TokenSet, AuthProps } from './authService';
import { CONFIG } from '../constants';

export class AuthManager {
  private static instance: AuthManager;
  private context: vscode.ExtensionContext;
  private _isAuthenticated: boolean = false;
  private _tokenSet: TokenSet | undefined;
  private _onDidChangeAuthentication = new vscode.EventEmitter<boolean>();
  
  readonly onDidChangeAuthentication = this._onDidChangeAuthentication.event;

  private constructor(context: vscode.ExtensionContext) {
    this.context = context;
    this._tokenSet = this.context.globalState.get<TokenSet>('neon.tokenSet');
    this._isAuthenticated = !!this._tokenSet || !!this.getPersistentApiToken();
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

  get tokenSet(): TokenSet | undefined {
    return this._tokenSet;
  }

  getPersistentApiToken(): string | undefined {
    return vscode.workspace.getConfiguration(CONFIG.EXTENSION_NAME).get<string>(CONFIG.SETTINGS.PERSISTENT_API_TOKEN);
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
      
      await this.context.globalState.update('neon.tokenSet', tokenSet);
      await vscode.workspace.getConfiguration(CONFIG.EXTENSION_NAME).update(CONFIG.SETTINGS.API_KEY, tokenSet.access_token, true);
      await vscode.workspace.getConfiguration(CONFIG.EXTENSION_NAME).update(CONFIG.SETTINGS.REFRESH_TOKEN, tokenSet.refresh_token, true);
      
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
    
    await this.context.globalState.update('neon.tokenSet', undefined);
    await vscode.workspace.getConfiguration(CONFIG.EXTENSION_NAME).update(CONFIG.SETTINGS.API_KEY, undefined, true);
    await vscode.workspace.getConfiguration(CONFIG.EXTENSION_NAME).update(CONFIG.SETTINGS.REFRESH_TOKEN, undefined, true);
    await vscode.workspace.getConfiguration(CONFIG.EXTENSION_NAME).update(CONFIG.SETTINGS.PERSISTENT_API_TOKEN, undefined, true);
    
    this._onDidChangeAuthentication.fire(false);
    
    vscode.window.showInformationMessage('Signed out from Neon');
  }

  async refreshTokenIfNeeded(): Promise<boolean> {
    // If using persistent API token, no need to refresh
    if (this.getPersistentApiToken()) {
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
      await vscode.workspace.getConfiguration(CONFIG.EXTENSION_NAME).update(CONFIG.SETTINGS.API_KEY, newTokenSet.access_token, true);
      await vscode.workspace.getConfiguration(CONFIG.EXTENSION_NAME).update(CONFIG.SETTINGS.REFRESH_TOKEN, newTokenSet.refresh_token, true);
      
      return true;
    } catch (error) {
      console.error('Failed to refresh token:', error);
      
      // If refresh fails, sign out
      await this.signOut();
      return false;
    }
  }

  async setPersistentApiToken(token: string): Promise<void> {
    await vscode.workspace.getConfiguration(CONFIG.EXTENSION_NAME).update(CONFIG.SETTINGS.PERSISTENT_API_TOKEN, token, true);
    this._isAuthenticated = true;
    this._onDidChangeAuthentication.fire(true);
    vscode.window.showInformationMessage('Successfully imported API token!');
  }
} 