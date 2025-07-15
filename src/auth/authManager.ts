import * as vscode from 'vscode';
import { auth, refreshToken, AuthProps } from './authService';
import { CONFIG } from '../constants';
import { StateService } from '../services/state.service';
import { SecureTokenStorage } from '../services/secureTokenStorage';

// Use any instead of importing TokenSet to avoid loading openid-client during extension activation
type TokenSet = any;

export class AuthManager {
  private static instance: AuthManager;
  private context: vscode.ExtensionContext;
  private _isAuthenticated: boolean = false;
  private _tokenSet: TokenSet | undefined;
  private _onDidChangeAuthentication = new vscode.EventEmitter<boolean>();
  private secureStorage: SecureTokenStorage;
  private _refreshPromise: Promise<boolean> | null = null;

  readonly onDidChangeAuthentication = this._onDidChangeAuthentication.event;

  private constructor(context: vscode.ExtensionContext) {
    this.context = context;
    this.secureStorage = SecureTokenStorage.getInstance(context);
    const rawTokenSet = this.context.globalState.get<TokenSet>('neon.tokenSet');
    
    // Validate and clean the tokenSet from globalState
    if (rawTokenSet && typeof rawTokenSet === 'object') {
      // Ensure we have valid string tokens, not corrupted objects
      const cleanTokenSet: any = {};
      
      if (rawTokenSet.access_token && typeof rawTokenSet.access_token === 'string') {
        cleanTokenSet.access_token = rawTokenSet.access_token;
      }
      
      if (rawTokenSet.refresh_token && typeof rawTokenSet.refresh_token === 'string') {
        cleanTokenSet.refresh_token = rawTokenSet.refresh_token;
      }
      
      // Copy any other properties that might be needed by openid-client
      Object.keys(rawTokenSet).forEach(key => {
        if (key !== 'access_token' && key !== 'refresh_token' && rawTokenSet[key] !== undefined) {
          cleanTokenSet[key] = rawTokenSet[key];
        }
      });
      
      this._tokenSet = Object.keys(cleanTokenSet).length > 0 ? cleanTokenSet : undefined;
    } else {
      this._tokenSet = undefined;
    }
    
    console.log('AuthManager: Initializing with tokenSet from globalState:', {
      hasRawTokenSet: !!rawTokenSet,
      rawTokenSetType: typeof rawTokenSet,
      rawTokenSetKeys: rawTokenSet ? Object.keys(rawTokenSet) : 'none',
      hasCleanTokenSet: !!this._tokenSet,
      cleanTokenSetKeys: this._tokenSet ? Object.keys(this._tokenSet) : 'none',
      hasAccessToken: !!this._tokenSet?.access_token,
      hasRefreshToken: !!this._tokenSet?.refresh_token,
      accessTokenType: typeof this._tokenSet?.access_token,
      refreshTokenType: typeof this._tokenSet?.refresh_token
    });
    
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
    return this._isAuthenticated;
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
    try {
      this._tokenSet = undefined;
      this._isAuthenticated = false;
      
      // Clear stored tokens
      await this.context.globalState.update('neon.tokenSet', undefined);
      await this.secureStorage.clearAllTokens();
      
      this._onDidChangeAuthentication.fire(false);
      
      vscode.window.showInformationMessage('Successfully signed out from Neon!');
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to sign out: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  async refreshTokenIfNeeded(): Promise<boolean> {
    // If a refresh is already in progress, wait for it instead of starting another
    if (this._refreshPromise) {
      console.log('AuthManager: Awaiting ongoing token refresh');
      return this._refreshPromise;
    }

    // No refresh token → nothing we can do
    if (!this._tokenSet?.refresh_token) {
      console.log('AuthManager: refreshTokenIfNeeded → no refresh_token – skip refresh');
      return false;
    }

    // If we still have a non-expired access token, skip refreshing to avoid wasting
    // a one-time refresh token.  openid-client exposes `expires_at` in seconds.
    const expiresAtSeconds: number | undefined = this._tokenSet?.expires_at;
    const nowSeconds = Math.floor(Date.now() / 1000);
    const REFRESH_BUFFER = 60; // seconds before expiry we proactively refresh

    if (expiresAtSeconds && expiresAtSeconds - nowSeconds > REFRESH_BUFFER) {
      console.log('AuthManager: Access token is still valid, skip refresh. Expires in', (expiresAtSeconds - nowSeconds), 'seconds');
      return true; // token still valid
    }

    try {
      // Mark refresh in progress
      this._refreshPromise = (async () => {
      const authProps: AuthProps = {
        oauthHost: 'https://oauth2.neon.tech',
        clientId: 'neonctl',
        extensionUri: this.context.extensionUri
      };

      console.log('Attempting to refresh token...');
      const newTokenSet = await refreshToken(authProps, this._tokenSet);
      
      this._tokenSet = newTokenSet;
      
      // Update stored tokens
      await this.context.globalState.update('neon.tokenSet', newTokenSet);
      if (newTokenSet.access_token) {
        await this.secureStorage.storeAccessToken(newTokenSet.access_token);
      }
      if (newTokenSet.refresh_token) {
        await this.secureStorage.storeRefreshToken(newTokenSet.refresh_token);
      }
      
      console.log('Token refresh successful');
      return true;
      })();
      const result = await this._refreshPromise;
      return result;
    } catch (error) {
      // ensure promise cleared
      this._refreshPromise = null;
      console.error('AuthManager: Token refresh failed (will keep existing tokenSet):', error);

      // If the error is invalid_grant or similar we likely cannot refresh again, but
      // the current access token may still be usable (until it actually expires).
      // We therefore KEEP the tokens and report success to the caller so user stays
      // logged-in.  A later API 401 will trigger sign-out flow.

      return true;
    } finally {
      // clear promise when done
      this._refreshPromise = null;
    }
  }

  async setPersistentApiToken(token: string): Promise<void> {
    await this.secureStorage.storePersistentApiToken(token);
    
    // Update auth state
    this._isAuthenticated = true;
    this._onDidChangeAuthentication.fire(true);
  }

  async migrateTokensFromConfig(): Promise<void> {
    // Migration logic if needed
  }

  private validateRefreshToken(token: string): { isValid: boolean; issues: string[] } {
    const issues: string[] = [];
    
    if (!token) {
      issues.push('Token is empty or null');
      return { isValid: false, issues };
    }
    
    if (typeof token !== 'string') {
      issues.push(`Token is not a string, it's a ${typeof token}`);
      return { isValid: false, issues };
    }
    
    if (token.length < 10) {
      issues.push(`Token is too short: ${token.length} characters`);
    }
    
    if (token.includes('\n') || token.includes('\r')) {
      issues.push('Token contains newline characters');
    }
    
    if (token.includes(' ')) {
      issues.push('Token contains spaces');
    }
    
    if (/[^\w\-._~:/?#[\]@!$&'()*+,;=]/.test(token)) {
      issues.push('Token contains invalid characters for OAuth');
    }
    
    return { isValid: issues.length === 0, issues };
  }

  async initializeAuthState(): Promise<void> {
    console.log('AuthManager: Starting initializeAuthState...');
    
    // First, migrate any tokens from the old configuration-based storage
    await this.secureStorage.migrateFromConfig();
    
    // Check current token states
    const secureAccessToken = await this.secureStorage.getAccessToken();
    const secureRefreshToken = await this.secureStorage.getRefreshToken();
    const persistentToken = await this.getPersistentApiToken();
    const storedGlobalTokenSet = this.context.globalState.get<any>('neon.tokenSet');
    
    console.log('AuthManager: DETAILED Token inventory:');
    console.log('  - Has globalState tokenSet:', !!storedGlobalTokenSet);
    console.log('  - GlobalState tokenSet keys:', storedGlobalTokenSet ? Object.keys(storedGlobalTokenSet) : 'none');
    console.log('  - GlobalState access token length:', storedGlobalTokenSet?.access_token?.length || 'none');
    console.log('  - GlobalState refresh token length:', storedGlobalTokenSet?.refresh_token?.length || 'none');
    console.log('  - Has secure access token:', !!secureAccessToken);
    console.log('  - Secure access token length:', secureAccessToken?.length || 'none');
    console.log('  - Has secure refresh token:', !!secureRefreshToken);
    console.log('  - Secure refresh token length:', secureRefreshToken?.length || 'none');
    console.log('  - Has persistent token:', !!persistentToken);
    
    // Log actual token values (first/last 10 chars for security)
    if (secureAccessToken) {
      console.log('  - Secure access token sample:', secureAccessToken.substring(0, 10) + '...' + secureAccessToken.substring(secureAccessToken.length - 10));
    }
    if (secureRefreshToken) {
      console.log('  - Secure refresh token sample:', secureRefreshToken.substring(0, 10) + '...' + secureRefreshToken.substring(secureRefreshToken.length - 10));
      
      // Validate the refresh token from secure storage
      const refreshTokenValidation = this.validateRefreshToken(secureRefreshToken);
      console.log('  - Secure refresh token validation:', refreshTokenValidation);
    }
    if (storedGlobalTokenSet?.access_token) {
      console.log('  - GlobalState access token sample:', storedGlobalTokenSet.access_token.substring(0, 10) + '...' + storedGlobalTokenSet.access_token.substring(storedGlobalTokenSet.access_token.length - 10));
    }
    if (storedGlobalTokenSet?.refresh_token) {
      console.log('  - GlobalState refresh token sample:', storedGlobalTokenSet.refresh_token.substring(0, 10) + '...' + storedGlobalTokenSet.refresh_token.substring(storedGlobalTokenSet.refresh_token.length - 10));
      
      // Validate the refresh token from globalState
      const globalRefreshTokenValidation = this.validateRefreshToken(storedGlobalTokenSet.refresh_token);
      console.log('  - GlobalState refresh token validation:', globalRefreshTokenValidation);
    }
    
    // Compare tokens between storage locations
    if (secureRefreshToken && storedGlobalTokenSet?.refresh_token) {
      const tokensMatch = secureRefreshToken === storedGlobalTokenSet.refresh_token;
      console.log('  - Refresh tokens match between secure storage and globalState:', tokensMatch);
      if (!tokensMatch) {
        console.log('  - ⚠️  REFRESH TOKEN MISMATCH DETECTED!');
        console.log('    - Secure storage length:', secureRefreshToken.length);
        console.log('    - GlobalState length:', storedGlobalTokenSet.refresh_token.length);
        console.log('    - First 50 chars secure:', secureRefreshToken.substring(0, 50));
        console.log('    - First 50 chars global:', storedGlobalTokenSet.refresh_token.substring(0, 50));
      }
    }
    
    // Check if we need to reconstruct the tokenSet from secure storage
    if (!this._tokenSet && (secureAccessToken || secureRefreshToken)) {
      console.log('AuthManager: Reconstructing tokenSet from secure storage');
      // Create a more complete tokenSet that openid-client expects
      // Try to get additional metadata from the stored tokenSet
      const storedTokenSet = this.context.globalState.get<any>('neon.tokenSet') || {};
      
      this._tokenSet = {
        access_token: secureAccessToken,
        refresh_token: secureRefreshToken,
        token_type: storedTokenSet.token_type || 'Bearer', // Revert to original default with proper case
        // Preserve other properties that might be needed by openid-client
        ...(storedTokenSet.scope && { scope: storedTokenSet.scope }),
        ...(storedTokenSet.expires_in && { expires_in: storedTokenSet.expires_in }),
        ...(storedTokenSet.expires_at && { expires_at: storedTokenSet.expires_at }),
        ...(storedTokenSet.id_token && { id_token: storedTokenSet.id_token }),
        // Note: We don't have expires_in from storage, but refresh should still work
      };
      
      // Only include properties that have values
      if (!secureAccessToken) {
        delete this._tokenSet.access_token;
      }
      if (!secureRefreshToken) {
        delete this._tokenSet.refresh_token;
      }
      
      console.log('AuthManager: Reconstructed tokenSet structure:');
      console.log('  - Keys:', Object.keys(this._tokenSet));
      console.log('  - Token type:', this._tokenSet.token_type);
      console.log('  - Has access_token:', !!this._tokenSet.access_token);
      console.log('  - Has refresh_token:', !!this._tokenSet.refresh_token);
      console.log('  - Access token matches secure storage:', this._tokenSet.access_token === secureAccessToken);
      console.log('  - Refresh token matches secure storage:', this._tokenSet.refresh_token === secureRefreshToken);
      
      // Store in globalState for consistency
      await this.context.globalState.update('neon.tokenSet', this._tokenSet);
      console.log('AuthManager: TokenSet reconstructed and saved to globalState');
    } else if (this._tokenSet) {
      console.log('AuthManager: Using existing tokenSet from constructor');
      console.log('  - Existing tokenSet keys:', Object.keys(this._tokenSet));
      console.log('  - Access token length:', this._tokenSet.access_token?.length || 'none');
      console.log('  - Refresh token length:', this._tokenSet.refresh_token?.length || 'none');
    }
    
    const wasAuthenticated = this._isAuthenticated;
    
    // Persistent token takes precedence over OAuth token
    if (persistentToken) {
      console.log('AuthManager: Using persistent API token for authentication');
      this._isAuthenticated = true;
    } else if (this._tokenSet?.refresh_token) {
      // If we have a refresh token but no persistent token, attempt silent refresh
      console.log('AuthManager: Attempting silent token refresh on extension startup...');
      console.log('AuthManager: Pre-refresh token analysis:');
      console.log('  - Refresh token type:', typeof this._tokenSet.refresh_token);
      console.log('  - Refresh token length:', this._tokenSet.refresh_token.length);
      console.log('  - Refresh token starts with:', this._tokenSet.refresh_token.substring(0, 20));
      console.log('  - Access token type:', typeof this._tokenSet.access_token);
      console.log('  - Access token length:', this._tokenSet.access_token?.length || 'none');
      
      try {
        const refreshAttempt = await this.refreshTokenIfNeeded();
        // refreshAttempt may be false if we skipped due to token still valid or missing refresh token
        // maintain existing authenticated state unless we explicitly signed out elsewhere
        if (refreshAttempt) {
          console.log('AuthManager: Silent token refresh successful');
        } else {
          console.log('AuthManager: Silent token refresh was not performed or failed, keeping existing authentication state');
        }
      } catch (error) {
        // Silent refresh failed - log but don't show error to user
        console.log('AuthManager: Silent token refresh failed during startup:', error);
        this._isAuthenticated = false;
      }
    } else {
      // No tokens available
      console.log('AuthManager: No tokens available for authentication');
      this._isAuthenticated = false;
    }
    
    console.log('AuthManager: Final authentication state:', {
      wasAuthenticated,
      isAuthenticated: this._isAuthenticated,
      stateChanged: wasAuthenticated !== this._isAuthenticated
    });
    
    // Fire authentication change event if the state changed
    if (wasAuthenticated !== this._isAuthenticated) {
      this._onDidChangeAuthentication.fire(this._isAuthenticated);
    }
  }
} 