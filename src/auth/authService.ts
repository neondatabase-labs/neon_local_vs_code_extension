import { createServer, IncomingMessage, ServerResponse } from 'http';
import { createReadStream } from 'fs';
import { AddressInfo } from 'net';
import * as vscode from 'vscode';
import * as path from 'path';
import { CONFIG, OAUTH } from '../constants';

// oauth server timeouts
const SERVER_TIMEOUT = 10_000;
// where to wait for incoming redirect request from oauth server to arrive
const REDIRECT_URI = (port: number) => `http://127.0.0.1:${port}/callback`;
// These scopes cannot be cancelled, they are always needed.
const ALWAYS_PRESENT_SCOPES = ['openid', 'offline', 'offline_access'] as const;

const NEON_VSCODE_SCOPES = [
    'openid',
    'offline',
    'offline_access',
    'urn:neoncloud:orgs:read',
    'urn:neoncloud:projects:read',
    'urn:neoncloud:projects:create',
    'urn:neoncloud:projects:update',

] as const;

const AUTH_TIMEOUT_SECONDS = 60;

export const defaultClientID = 'neonctl';

export type AuthProps = {
  oauthHost: string;
  clientId: string;
  extensionUri: vscode.Uri;
};

/**
 * Gets the configured OAuth callback port from VS Code settings
 * @returns The configured port number or 0 for auto (dynamic) port assignment
 */
const getConfiguredOAuthPort = (): number => {
  const config = vscode.workspace.getConfiguration(CONFIG.EXTENSION_NAME);
  const configuredPort = config.get<number | string>(CONFIG.SETTINGS.OAUTH_CALLBACK_PORT, OAUTH.DEFAULT_PORT_AUTO);
  
  console.debug('🔍 OAuth port configuration:', { configuredPort, type: typeof configuredPort });
  
  // Handle 'auto' setting or string 'auto'
  if (configuredPort === OAUTH.DEFAULT_PORT_AUTO || configuredPort === 'auto') {
    console.debug('🔍 Using dynamic OAuth port (auto)');
    return 0; // 0 means let the OS choose an available port
  }
  
  // Handle numeric port
  if (typeof configuredPort === 'number') {
    if (configuredPort >= OAUTH.MIN_PORT && configuredPort <= OAUTH.MAX_PORT) {
      console.debug('🔍 Using configured OAuth port:', configuredPort);
      return configuredPort;
    } else {
      console.warn('⚠️  OAuth port out of range, falling back to auto:', configuredPort);
      return 0;
    }
  }
  
  // Handle string numbers
  if (typeof configuredPort === 'string') {
    const portNumber = parseInt(configuredPort, 10);
    if (!isNaN(portNumber) && portNumber >= OAUTH.MIN_PORT && portNumber <= OAUTH.MAX_PORT) {
      console.debug('🔍 Using configured OAuth port (parsed from string):', portNumber);
      return portNumber;
    }
  }
  
  console.warn('⚠️  Invalid OAuth port configuration, falling back to auto:', configuredPort);
  return 0; // Fallback to dynamic port
};

// Cache issuer discovery and actual client instances to ensure complete consistency
let _cachedIssuer: any = null;
let _cachedClient: any = null;
let _cachedClientConfig: any = null;

export const refreshToken = async (
  { oauthHost, clientId }: AuthProps,
  tokenSet: any, // Use any to avoid importing TokenSet at module level
) => {
  console.debug('🔍 Starting token refresh with params:', { oauthHost, clientId });
  
  // Add error handling and validation for oauthHost
  if (!oauthHost || typeof oauthHost !== 'string') {
    throw new Error('Invalid OAuth host configuration');
  }
  
  // Validate that the OAuth host is a valid URL
  try {
    new URL(oauthHost);
  } catch (error) {
    throw new Error(`Invalid OAuth host URL: ${oauthHost}`);
  }
  
  // Validate tokenSet
  if (!tokenSet || !tokenSet.refresh_token) {
    console.debug('🚨 Token validation failed:', {
      hasTokenSet: !!tokenSet,
      tokenSetType: typeof tokenSet,
      tokenSetKeys: tokenSet ? Object.keys(tokenSet) : 'no tokenSet',
      hasRefreshToken: !!tokenSet?.refresh_token,
      refreshTokenType: typeof tokenSet?.refresh_token,
      refreshTokenLength: tokenSet?.refresh_token?.length
    });
    throw new Error('Invalid token set or missing refresh token');
  }
  
  console.debug('🔍 Token validation passed:', {
    hasAccessToken: !!tokenSet.access_token,
    hasRefreshToken: !!tokenSet.refresh_token,
    tokenSetKeys: Object.keys(tokenSet)
  });
  
  console.debug('🔍 Discovering oauth server');
  
  let issuer;
  try {
    console.debug('🔍 Loading openid-client dynamically...');
    const { Issuer } = await import('openid-client');
    
    // CRITICAL: Use cached issuer if available to ensure consistency
    if (_cachedIssuer && _cachedIssuer.issuer === oauthHost + '/') {
      console.debug('🔄 Reusing cached OAuth issuer for consistency');
      issuer = _cachedIssuer;
    } else {
      console.debug('🔍 Attempting to discover issuer at:', oauthHost);
      issuer = await Issuer.discover(oauthHost);
      _cachedIssuer = issuer;
      console.debug('🔍 Successfully discovered and cached issuer:', issuer.issuer);
    }
  } catch (error) {
    console.error('🚨 Failed to discover OAuth issuer:', error);
    throw new Error(`Failed to discover OAuth issuer at ${oauthHost}: ${error instanceof Error ? error.message : String(error)}`);
  }

  let client;
  try {
    console.debug('🔍 Creating OAuth client for token refresh');
    
    // CRITICAL: Try to reuse cached client instance first for maximum consistency
    if (_cachedClient && tokenSet.original_client_metadata) {
      console.debug('🔄 REUSING CACHED CLIENT INSTANCE for maximum consistency');
      console.debug('🔍 Cached client redirect URIs:', _cachedClient.redirect_uris);
      console.debug('🔍 Cached client ID:', _cachedClient.client_id);
      console.debug('🔍 Cached client auth method:', _cachedClient.token_endpoint_auth_method);
      console.debug('🔍 Cached client response types:', _cachedClient.response_types);
      console.debug('🔍 Cached client issuer:', _cachedClient.issuer?.issuer);
      console.debug('🔍 Cached client full metadata:', JSON.stringify(_cachedClient.metadata, null, 2));
      client = _cachedClient;
    } else if (tokenSet.original_client_metadata) {
      console.debug('🔄 Creating new client from stored metadata (no cached instance available)');
      console.debug('🔍 Stored client metadata:', tokenSet.original_client_metadata);
      client = new issuer.Client(tokenSet.original_client_metadata);
      // Cache this client instance for future use
      _cachedClient = client;
      console.debug('🔍 Created and cached new client with redirect URIs:', client.redirect_uris);
    } else {
      console.debug('🆕 Creating fallback OAuth client (no stored metadata available)');
      
      // Use the stored original redirect URI, or fallback to a default pattern
      let originalRedirectUri = tokenSet.original_redirect_uri;
      
      if (!originalRedirectUri) {
        console.debug('⚠️  No stored redirect URI found - this is likely an existing user before the fix');
        console.debug('⚠️  Token may fail to refresh - user may need to re-authenticate');
        // Try a reasonable default - port 0 (though this may not work)
        originalRedirectUri = REDIRECT_URI(0);
      }
      
      console.debug('🔍 Using redirect URI for refresh:', originalRedirectUri);
      
      const clientMetadata = {
        token_endpoint_auth_method: 'none' as const,
        client_id: clientId,
        redirect_uris: [originalRedirectUri],
        response_types: ['code'],
      };
      
      client = new issuer.Client(clientMetadata);
      // Cache this client instance for future use
      _cachedClient = client;
      console.debug('🔍 Created and cached fallback client configuration');
    }
    
    console.debug('🔍 Successfully prepared OAuth client for refresh');
  } catch (error) {
    console.error('🚨 Failed to create OAuth client:', error);
    throw new Error(`Failed to create OAuth client: ${error instanceof Error ? error.message : String(error)}`);
  }

  try {
    console.debug('🔍 Refreshing token with tokenSet:', {
      hasAccessToken: !!tokenSet.access_token,
      hasRefreshToken: !!tokenSet.refresh_token,
      tokenSetKeys: Object.keys(tokenSet),
      tokenType: tokenSet.token_type,
      scope: tokenSet.scope,
      fullTokenSetForDebug: tokenSet // Show complete tokenSet for debugging
    });
    
    console.debug('🔍 Client configuration used for refresh:', {
      issuer: client.issuer.issuer,
      clientId: client.client_id,
      redirectUris: client.redirect_uris,
      responseTypes: client.response_types,
      tokenEndpointAuthMethod: client.token_endpoint_auth_method,
      allMetadata: client.metadata,
      fullClientDebug: JSON.stringify(client.metadata, null, 2)
    });
    
    // Log the exact HTTP request that will be made (without credentials)
    console.debug('🔍 Token endpoint details:', {
      tokenEndpoint: client.issuer.token_endpoint,
      issuerMetadata: JSON.stringify(client.issuer.metadata, null, 2),
      clientMetadataComparison: {
        refreshClientId: client.client_id,
        refreshRedirectUris: client.redirect_uris,
        refreshResponseTypes: client.response_types,
        refreshTokenEndpointAuthMethod: client.token_endpoint_auth_method
      }
    });
    
    console.debug('🔍 Input tokenSet for refresh:', {
      hasAccessToken: !!tokenSet.access_token,
      hasRefreshToken: !!tokenSet.refresh_token,
      accessTokenSample: tokenSet.access_token?.substring(0, 20) + '...',
      refreshTokenSample: tokenSet.refresh_token?.substring(0, 20) + '...',
      refreshTokenLength: tokenSet.refresh_token?.length,
      refreshTokenType: typeof tokenSet.refresh_token,
      tokenType: tokenSet.token_type,
      scope: tokenSet.scope,
      expiresAt: tokenSet.expires_at,
      originalRedirectUri: tokenSet.original_redirect_uri,
      fullRefreshTokenDebug: tokenSet.refresh_token, // Full token for debugging
      tokenSetStringified: JSON.stringify(tokenSet, null, 2),
      // Check for any timing or session-related properties
      tokenAgeSeconds: tokenSet.expires_at ? Math.floor(Date.now() / 1000) - (tokenSet.expires_at - (tokenSet.expires_in || 3600)) : 'unknown',
      issuedAtEstimate: tokenSet.expires_at ? new Date((tokenSet.expires_at - (tokenSet.expires_in || 3600)) * 1000).toISOString() : 'unknown',
      currentTime: new Date().toISOString(),
      expiresAtTime: tokenSet.expires_at ? new Date(tokenSet.expires_at * 1000).toISOString() : 'unknown'
    });
    
    // CRITICAL: Enhanced HTTP request debugging before refresh
    console.debug('🚨 ABOUT TO MAKE TOKEN REFRESH REQUEST...');
    console.debug('🔍 Final request parameters that will be sent:', {
      tokenEndpoint: client.issuer.token_endpoint,
      method: 'POST',
      contentType: 'application/x-www-form-urlencoded',
      requestBody: {
        grant_type: 'refresh_token',
        refresh_token: tokenSet.refresh_token?.substring(0, 10) + '...' + tokenSet.refresh_token?.substring(tokenSet.refresh_token.length - 10),
        client_id: client.client_id,
        // Note: redirect_uri might be included in request body
        redirect_uri: client.redirect_uris?.[0]
      },
      clientHeaders: {
        'User-Agent': 'neon-local-connect/1.0.18',
        'Accept': 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      clientConfiguration: {
        client_id: client.client_id,
        redirect_uris: client.redirect_uris,
        response_types: client.response_types,
        token_endpoint_auth_method: client.token_endpoint_auth_method
      }
    });
    
    console.debug('🔍 Token refresh timing analysis:', {
      currentTimestamp: Math.floor(Date.now() / 1000),
      tokenExpiresAt: tokenSet.expires_at,
      tokenIsExpired: tokenSet.expires_at ? Math.floor(Date.now() / 1000) >= tokenSet.expires_at : 'unknown',
      timeUntilExpiry: tokenSet.expires_at ? tokenSet.expires_at - Math.floor(Date.now() / 1000) : 'unknown',
      refreshTokenAge: tokenSet.expires_at && tokenSet.expires_in ? 
        Math.floor(Date.now() / 1000) - (tokenSet.expires_at - tokenSet.expires_in) : 'unknown'
    });
    
    const newTokenSet = await client.refresh(tokenSet);
    
    console.debug('🔍 Successfully refreshed token, new tokenSet analysis:', {
      keys: Object.keys(newTokenSet),
      hasNewAccessToken: !!newTokenSet.access_token,
      hasNewRefreshToken: !!newTokenSet.refresh_token,
      newAccessTokenSample: newTokenSet.access_token?.substring(0, 20) + '...',
      newRefreshTokenSample: newTokenSet.refresh_token?.substring(0, 20) + '...',
      newRefreshTokenLength: newTokenSet.refresh_token?.length,
      refreshTokenChanged: tokenSet.refresh_token !== newTokenSet.refresh_token,
      accessTokenChanged: tokenSet.access_token !== newTokenSet.access_token,
      newTokenType: newTokenSet.token_type,
      newScope: newTokenSet.scope,
      newExpiresAt: newTokenSet.expires_at
    });
    
    // Preserve the original redirect URI and client metadata for future refresh operations
    newTokenSet.original_redirect_uri = tokenSet.original_redirect_uri;
    newTokenSet.original_client_metadata = tokenSet.original_client_metadata;
    
    return newTokenSet;
  } catch (error: any) {
    console.error('🚨 Failed to refresh token:', error);
    
    // Check for specific OAuth error types
    const errorMessage = error?.message || String(error);
    const isInvalidGrant = errorMessage.includes('invalid_grant');
    const isExpiredToken = errorMessage.includes('expired');
    
    console.debug('🔍 Refresh error analysis:', {
      isInvalidGrant,
      isExpiredToken,
      errorMessage,
      errorResponse: error?.response?.data,
      errorStatus: error?.response?.status
    });
    
    // Preserve the original error message for better debugging
    throw error;
  }
};

export const auth = async ({ oauthHost, clientId, extensionUri }: AuthProps) => {
  console.debug('🔍 Starting auth flow with params:', { oauthHost, clientId });
  
  // Add error handling and validation for oauthHost
  if (!oauthHost || typeof oauthHost !== 'string') {
    throw new Error('Invalid OAuth host configuration');
  }
  
  // Validate that the OAuth host is a valid URL
  try {
    new URL(oauthHost);
  } catch (error) {
    throw new Error(`Invalid OAuth host URL: ${oauthHost}`);
  }
  
  console.debug('🔍 Discovering oauth server');
  
  let issuer;
  try {
    console.debug('🔍 Loading openid-client dynamically...');
    const { Issuer } = await import('openid-client');
    
    // CRITICAL: Use cached issuer if available to ensure consistency
    if (_cachedIssuer && _cachedIssuer.issuer === oauthHost + '/') {
      console.debug('🔄 Reusing cached OAuth issuer for initial auth consistency');
      issuer = _cachedIssuer;
    } else {
      console.debug('🔍 Attempting to discover issuer at:', oauthHost);
      issuer = await Issuer.discover(oauthHost);
      _cachedIssuer = issuer;
      console.debug('🔍 Successfully discovered and cached issuer for initial auth:', issuer.issuer);
    }
  } catch (error) {
    console.error('🚨 Failed to discover OAuth issuer:', error);
    throw new Error(`Failed to discover OAuth issuer at ${oauthHost}: ${error instanceof Error ? error.message : String(error)}`);
  }

  //
  // Start HTTP server and wait till /callback is hit
  //
  console.debug('🔍 Starting HTTP Server for callback');
  const configuredPort = getConfiguredOAuthPort();
  const server = createServer();
  
  // Try to listen on the configured port, with error handling for port conflicts
  const listenPromise = new Promise<void>((resolve, reject) => {
    const errorHandler = (error: any) => {
      if (error.code === 'EADDRINUSE' && configuredPort !== 0) {
        console.warn(`⚠️  OAuth port ${configuredPort} is already in use, falling back to dynamic port`);
        server.removeListener('error', errorHandler);
        server.listen(0, '127.0.0.1', function (this: typeof server) {
          console.debug(`🔍 Listening on fallback port ${(this.address() as AddressInfo).port}`);
          resolve();
        });
      } else {
        reject(error);
      }
    };
    
    server.once('error', errorHandler);
    server.listen(configuredPort, '127.0.0.1', function (this: typeof server) {
      const actualPort = (this.address() as AddressInfo).port;
      console.debug(`🔍 Listening on OAuth callback port ${actualPort}${configuredPort === 0 ? ' (auto)' : ' (configured)'}`);
      server.removeListener('error', errorHandler);
      resolve();
    });
  });
  
  await listenPromise;
  const listen_port = (server.address() as AddressInfo).port;

  let neonOAuthClient;
  try {
    console.debug('🔍 Creating OAuth client with redirect URI:', REDIRECT_URI(listen_port));
    neonOAuthClient = new issuer.Client({
      token_endpoint_auth_method: 'none',
      client_id: clientId,
      redirect_uris: [REDIRECT_URI(listen_port)],
      response_types: ['code'],
    });
    
    // CRITICAL: Cache the client instance for future refresh operations
    _cachedClient = neonOAuthClient;
    console.debug('🔍 Successfully created and cached OAuth client for initial auth');
    console.debug('🔍 Initial auth client configuration:', {
      issuer: neonOAuthClient.issuer.issuer,
      clientId: neonOAuthClient.client_id,
      redirectUris: neonOAuthClient.redirect_uris,
      responseTypes: neonOAuthClient.response_types,
      tokenEndpointAuthMethod: neonOAuthClient.token_endpoint_auth_method,
      allMetadata: neonOAuthClient.metadata,
      fullInitialClientDebug: JSON.stringify(neonOAuthClient.metadata, null, 2)
    });
  } catch (error) {
    console.error('🚨 Failed to create OAuth client:', error);
    throw new Error(`Failed to create OAuth client: ${error instanceof Error ? error.message : String(error)}`);
  }

  // https://datatracker.ietf.org/doc/html/rfc6819#section-4.4.1.8
  let state, codeVerifier, codeChallenge;
  try {
    console.debug('🔍 Generating OAuth parameters...');
    console.debug('🔍 Loading generators from openid-client...');
    const { generators } = await import('openid-client');
    
    state = generators.state();
    console.debug('🔍 Generated state:', state);
    
    codeVerifier = generators.codeVerifier();
    console.debug('🔍 Generated codeVerifier length:', codeVerifier.length);
    
    codeChallenge = generators.codeChallenge(codeVerifier);
    console.debug('🔍 Generated codeChallenge:', codeChallenge);
    
    console.debug('🔍 Successfully generated OAuth parameters');
  } catch (error) {
    console.error('🚨 Failed to generate OAuth parameters:', error);
    throw new Error(`Failed to generate OAuth parameters: ${error instanceof Error ? error.message : String(error)}`);
  }

  return new Promise<any>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new Error(
          `Authentication timed out after ${AUTH_TIMEOUT_SECONDS} seconds`,
        ),
      );
    }, AUTH_TIMEOUT_SECONDS * 1000);

    const onRequest = async (
      request: IncomingMessage,
      response: ServerResponse,
    ) => {
      //
      // Wait for callback and follow oauth flow.
      //
      if (!request.url?.startsWith('/callback')) {
        response.writeHead(404);
        response.end();
        return;
      }

      // process the CORS preflight OPTIONS request
      if (request.method === 'OPTIONS') {
        response.writeHead(200, {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST',
          'Access-Control-Allow-Headers': 'Content-Type',
        });
        response.end();
        return;
      }

      console.debug(`Callback received: ${request.url}`);
      const params = neonOAuthClient.callbackParams(request);
      const tokenSet = await neonOAuthClient.callback(
        REDIRECT_URI(listen_port),
        params,
        {
          code_verifier: codeVerifier,
          state,
        },
      );

      // Store the redirect URI used during authentication for future refresh operations
      tokenSet.original_redirect_uri = REDIRECT_URI(listen_port);
      
      // CRITICAL: Store complete client metadata in tokenSet for refresh operations
      tokenSet.original_client_metadata = {
        token_endpoint_auth_method: 'none' as const,
        client_id: clientId,
        redirect_uris: [REDIRECT_URI(listen_port)],
        response_types: ['code'],
      };
      console.debug('🔍 Stored complete client metadata in tokenSet for refresh operations');

      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      const callbackHtmlPath = path.join(__dirname, 'callback.html');
      createReadStream(callbackHtmlPath).pipe(response);

      clearTimeout(timer);
      resolve(tokenSet);
      server.close();
    };

    server.on('request', (req, res) => {
      void onRequest(req, res);
    });

    //
    // Open browser to let user authenticate
    //
    const scopes = NEON_VSCODE_SCOPES;

    const authUrl = neonOAuthClient.authorizationUrl({
      scope: scopes.join(' '),
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    });

    vscode.window.showInformationMessage('Awaiting authentication in web browser.');
    vscode.env.openExternal(vscode.Uri.parse(authUrl));
  });
}; 