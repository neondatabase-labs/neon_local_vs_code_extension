import { createServer, IncomingMessage, ServerResponse } from 'http';
import { createReadStream } from 'fs';
import { AddressInfo } from 'net';
import * as vscode from 'vscode';
import * as path from 'path';
import { CONFIG } from '../constants';

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
    console.debug('🔍 Attempting to discover issuer at:', oauthHost);
    issuer = await Issuer.discover(oauthHost);
    console.debug('🔍 Successfully discovered issuer:', issuer.issuer);
  } catch (error) {
    console.error('🚨 Failed to discover OAuth issuer:', error);
    throw new Error(`Failed to discover OAuth issuer at ${oauthHost}: ${error instanceof Error ? error.message : String(error)}`);
  }

  let client;
  try {
    console.debug('🔍 Creating OAuth client for token refresh');
    // Use the EXACT same client configuration as during initial auth to prevent client mismatch
    // For refresh operations, we use a fixed redirect URI that matches the pattern
    client = new issuer.Client({
      token_endpoint_auth_method: 'none',
      client_id: clientId,
      response_types: ['code'],
    });
    console.debug('🔍 Successfully created OAuth client for refresh');
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
      allMetadata: client.metadata
    });
    
    const newTokenSet = await client.refresh(tokenSet);
    console.debug('🔍 Successfully refreshed token, new tokenSet keys:', Object.keys(newTokenSet));
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
    console.debug('🔍 Attempting to discover issuer at:', oauthHost);
    issuer = await Issuer.discover(oauthHost);
    console.debug('🔍 Successfully discovered issuer:', issuer.issuer);
  } catch (error) {
    console.error('🚨 Failed to discover OAuth issuer:', error);
    throw new Error(`Failed to discover OAuth issuer at ${oauthHost}: ${error instanceof Error ? error.message : String(error)}`);
  }

  //
  // Start HTTP server and wait till /callback is hit
  //
  console.debug('🔍 Starting HTTP Server for callback');
  const server = createServer();
  server.listen(0, '127.0.0.1', function (this: typeof server) {
    console.debug(`🔍 Listening on port ${(this.address() as AddressInfo).port}`);
  });
  await new Promise((resolve) => server.once('listening', resolve));
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
    console.debug('🔍 Successfully created OAuth client for initial auth');
    console.debug('🔍 Initial auth client configuration:', {
      issuer: neonOAuthClient.issuer.issuer,
      clientId: neonOAuthClient.client_id,
      redirectUris: neonOAuthClient.redirect_uris,
      responseTypes: neonOAuthClient.response_types,
      tokenEndpointAuthMethod: neonOAuthClient.token_endpoint_auth_method,
      allMetadata: neonOAuthClient.metadata
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