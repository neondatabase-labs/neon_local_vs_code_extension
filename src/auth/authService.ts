import { custom, generators, Issuer, TokenSet } from 'openid-client';
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

// Re-export TokenSet for use in other files
export { TokenSet };

custom.setHttpOptionsDefaults({
  timeout: SERVER_TIMEOUT,
});

export const refreshToken = async (
  { oauthHost, clientId }: AuthProps,
  tokenSet: TokenSet,
) => {
  console.debug('Discovering oauth server');
  const issuer = await Issuer.discover(oauthHost);

  const neonOAuthClient = new issuer.Client({
    token_endpoint_auth_method: 'none',
    client_id: clientId,
    response_types: ['code'],
  });
  return await neonOAuthClient.refresh(tokenSet);
};

export const auth = async ({ oauthHost, clientId, extensionUri }: AuthProps) => {
  console.debug('Discovering oauth server');
  const issuer = await Issuer.discover(oauthHost);

  //
  // Start HTTP server and wait till /callback is hit
  //
  console.debug('Starting HTTP Server for callback');
  const server = createServer();
  server.listen(0, '127.0.0.1', function (this: typeof server) {
    console.debug(`Listening on port ${(this.address() as AddressInfo).port}`);
  });
  await new Promise((resolve) => server.once('listening', resolve));
  const listen_port = (server.address() as AddressInfo).port;

  const neonOAuthClient = new issuer.Client({
    token_endpoint_auth_method: 'none',
    client_id: clientId,
    redirect_uris: [REDIRECT_URI(listen_port)],
    response_types: ['code'],
  });

  // https://datatracker.ietf.org/doc/html/rfc6819#section-4.4.1.8
  const state = generators.state();

  // we store the code_verifier in memory
  const codeVerifier = generators.codeVerifier();

  const codeChallenge = generators.codeChallenge(codeVerifier);

  return new Promise<TokenSet>((resolve, reject) => {
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

      response.writeHead(200, { 'Content-Type': 'text/html' });
      const callbackHtmlPath = path.join(extensionUri.fsPath, 'src', 'auth', 'callback.html');
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
    console.log(`Auth Url: ${authUrl}`);

    vscode.env.openExternal(vscode.Uri.parse(authUrl));
  });
}; 