import * as vscode from 'vscode';
import axios from 'axios';
import { createServer, IncomingMessage, ServerResponse } from 'http';
import { AddressInfo } from 'net';
import * as crypto from 'crypto';
import opener from 'opener';

// Using the same client ID as neonctl
const CLIENT_ID = 'neonctl';
const OAUTH_HOST = 'https://oauth2.neon.tech';
const SERVER_TIMEOUT = 10_000;
const AUTH_TIMEOUT_SECONDS = 60;

// These scopes match neonctl's requirements
const REQUIRED_SCOPES = [
    'openid',
    'offline',
    'offline_access',
    'urn:neoncloud:projects:create',
    'urn:neoncloud:projects:read',
    'urn:neoncloud:projects:update',
    'urn:neoncloud:projects:delete',
    'urn:neoncloud:orgs:create',
    'urn:neoncloud:orgs:read',
    'urn:neoncloud:orgs:update',
    'urn:neoncloud:orgs:delete',
    'urn:neoncloud:orgs:permission'
];

const REDIRECT_URI = (port: number) => `http://127.0.0.1:${port}/callback`;

// PKCE helper functions
function generateCodeVerifier(): string {
    // Generate a random string of 43-128 characters containing letters, numbers, underscores, hyphens, and dots
    const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
    const length = 128;
    const array = new Uint8Array(length);
    crypto.randomFillSync(array);
    const verifier = Array.from(array)
        .map(x => charset[x % charset.length])
        .join('');
    return verifier;
}

function generateCodeChallenge(verifier: string): string {
    const hash = crypto.createHash('sha256')
        .update(verifier)
        .digest();
    return hash.toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=/g, '');
}

export async function authenticate(): Promise<string> {
    // Start HTTP server and wait till /callback is hit
    const server = createServer();
    server.listen(0, '127.0.0.1');
    
    await new Promise((resolve) => server.once('listening', resolve));
    const listen_port = (server.address() as AddressInfo).port;

    return new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => {
            reject(new Error(`Authentication timed out after ${AUTH_TIMEOUT_SECONDS} seconds`));
        }, AUTH_TIMEOUT_SECONDS * 1000);

        // Generate PKCE values
        const codeVerifier = generateCodeVerifier();
        const codeChallenge = generateCodeChallenge(codeVerifier);
        
        console.log('PKCE Values:', {
            codeVerifier,
            codeChallenge,
            verifierLength: codeVerifier.length,
            challengeLength: codeChallenge.length
        });
        
        // Generate random state for security
        const state = crypto.randomBytes(16).toString('hex');
        
        // Construct authorization URL with PKCE
        const authUrl = new URL('/oauth2/auth', OAUTH_HOST);
        authUrl.searchParams.set('response_type', 'code');
        authUrl.searchParams.set('client_id', CLIENT_ID);
        authUrl.searchParams.set('redirect_uri', REDIRECT_URI(listen_port));
        authUrl.searchParams.set('state', state);
        authUrl.searchParams.set('code_challenge', codeChallenge);
        authUrl.searchParams.set('code_challenge_method', 'S256');
        authUrl.searchParams.set('scope', REQUIRED_SCOPES.join(' '));

        console.log('Authorization URL:', authUrl.toString());

        const onRequest = async (request: IncomingMessage, response: ServerResponse) => {
            if (!request.url?.startsWith('/callback')) {
                response.writeHead(404);
                response.end();
                return;
            }

            // Handle CORS preflight
            if (request.method === 'OPTIONS') {
                response.writeHead(200, {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Methods': 'GET, POST',
                    'Access-Control-Allow-Headers': 'Content-Type',
                });
                response.end();
                return;
            }

            try {
                const url = new URL(request.url, `http://127.0.0.1:${listen_port}`);
                const code = url.searchParams.get('code');
                const receivedState = url.searchParams.get('state');

                if (!code) {
                    throw new Error('No code received from OAuth provider');
                }

                if (receivedState !== state) {
                    throw new Error('State mismatch in OAuth flow');
                }

                console.log('Received callback:', {
                    code,
                    state: receivedState,
                    fullUrl: url.toString()
                });

                // Exchange code for token
                const tokenUrl = new URL('/oauth2/token', OAUTH_HOST);
                const tokenData = new URLSearchParams({
                    grant_type: 'authorization_code',
                    client_id: CLIENT_ID,
                    code,
                    code_verifier: codeVerifier,
                    redirect_uri: REDIRECT_URI(listen_port)
                });

                try {
                    console.log('Token request:', {
                        url: tokenUrl.toString(),
                        data: tokenData.toString(),
                        verifier: codeVerifier
                    });

                    const tokenResponse = await axios.post(
                        tokenUrl.toString(),
                        tokenData,
                        {
                            headers: {
                                'Accept': 'application/json',
                                'Content-Type': 'application/x-www-form-urlencoded'
                            }
                        }
                    );

                    console.log('Token response:', {
                        status: tokenResponse.status,
                        headers: tokenResponse.headers,
                        data: tokenResponse.data
                    });

                    response.writeHead(200, { 'Content-Type': 'text/html' });
                    response.end('<html><body><h1>Authentication successful!</h1><p>You can close this window and return to VS Code.</p></body></html>');

                    clearTimeout(timer);
                    
                    // Store both access token and refresh token
                    await vscode.workspace.getConfiguration('neonLocal').update('refreshToken', tokenResponse.data.refresh_token, true);
                    resolve(tokenResponse.data.access_token);
                    server.close();
                } catch (tokenError: any) {
                    console.error('Token exchange error:', {
                        status: tokenError.response?.status,
                        statusText: tokenError.response?.statusText,
                        data: tokenError.response?.data,
                        error: tokenError.message,
                        request: {
                            url: tokenUrl.toString(),
                            data: tokenData.toString(),
                            verifier: codeVerifier
                        }
                    });
                    throw new Error(`Token exchange failed: ${tokenError.response?.data?.error || tokenError.message}`);
                }
            } catch (error: any) {
                console.error('Authentication error:', {
                    message: error.message,
                    response: error.response?.data
                });
                response.writeHead(500, { 'Content-Type': 'text/html' });
                response.end(`<html><body><h1>Authentication failed!</h1><p>Error: ${error.message}</p><p>Please try again.</p></body></html>`);
                reject(error);
            }
        };

        server.on('request', (req, res) => {
            void onRequest(req, res);
        });

        // Open browser for authentication
        vscode.window.showInformationMessage('Please authenticate in your browser to continue.');
        try {
            opener(authUrl.toString());
        } catch (err) {
            const msg = `Failed to open web browser. Please copy & paste this URL to authenticate: ${authUrl.toString()}`;
            vscode.window.showErrorMessage(msg);
            console.error(err);
        }
    });
}

export async function refreshToken(refreshTokenStr: string): Promise<string> {
    try {
        const response = await axios.post(
            `${OAUTH_HOST}/oauth2/token`,
            {
                grant_type: 'refresh_token',
                client_id: CLIENT_ID,
                refresh_token: refreshTokenStr
            },
            {
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                transformRequest: [(data: Record<string, string>) => {
                    return Object.entries(data)
                        .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
                        .join('&');
                }]
            }
        );

        // Update stored refresh token if a new one is provided
        if (response.data.refresh_token) {
            await vscode.workspace.getConfiguration('neonLocal').update('refreshToken', response.data.refresh_token, true);
        }

        return response.data.access_token;
    } catch (error: any) {
        console.error('Refresh token error:', error);
        throw new Error('Failed to refresh token');
    }
} 