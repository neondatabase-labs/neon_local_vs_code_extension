# Neon Local VS Code Extension

This VS Code extension provides a seamless integration with Neon Database for local development. It allows you to manage Neon database branches and run local proxies using either PostgreSQL or Neon Serverless drivers.

## Features

- **Secure Authentication**: Sign in with OAuth or import a persistent API key
- **Secure Token Storage**: All tokens are encrypted and stored using VS Code's SecretStorage API
- Create, switch between, and delete Neon database branches
- Start and stop local proxy with support for both PostgreSQL and Neon Serverless drivers
- Status bar indicator showing current branch
- Automatic container management

## Requirements

- Docker must be installed and running on your system
- A Neon account (for OAuth sign-in) or API key
- VS Code 1.85.0 or later

## Installation

1. Install the extension from the VS Code marketplace
2. Open the Connect view in the sidebar
3. Sign in with your Neon account or import a persistent API key

## Authentication

The extension supports two authentication methods:

### OAuth Sign-in (Recommended)
1. Click "Sign in" in the Connect view
2. Complete the OAuth flow in your browser
3. Your access and refresh tokens are securely stored

### Persistent API Key
1. Click "Import API Key" in the Connect view
2. Enter your Neon persistent API key
3. The key is securely stored and encrypted

**Security**: All tokens are encrypted and stored using VS Code's SecretStorage API.

## Usage

The extension provides the following commands (accessible via Command Palette - Ctrl/Cmd + Shift + P):

- **Neon: Start Local Proxy**: Start the local proxy with a selected branch
- **Neon: Stop Local Proxy**: Stop the currently running proxy
- **Neon: Create New Branch**: Create a new Neon database branch
- **Neon: Switch Branch**: Switch to a different branch
- **Neon: Delete Branch**: Delete an existing branch

## Connection Information

### PostgreSQL Driver
When using the PostgreSQL driver, connect to your database using:
```postgres://neon:npg@localhost:5432/<database_name>?sslmode=require
```

### Neon Serverless Driver
When using the Neon Serverless driver, use:
```javascript
import { neon, neonConfig } from "@neondatabase/serverless";
const sql = neon("postgres://neon:npg@localhost:5432/<database_name>?sslmode=no-verify");
neonConfig.fetchEndpoint = 'http://localhost:5432/sql';
```

## Extension Settings

This extension contributes the following settings:

* `neonLocal.driver`: Driver to use (postgres/serverless)
* `neonLocal.deleteOnStop`: Whether to delete the branch when stopping the proxy

## Security Notes

- **All tokens are encrypted** and stored using VS Code's SecretStorage API
- **No tokens are stored in configuration files** or workspace settings
- The extension only communicates with the official Neon API and your local Docker daemon
- All connections use SSL/TLS encryption
- OAuth tokens are automatically refreshed when needed

## Troubleshooting

1. **Proxy won't start**: Ensure Docker is running and port 5432 is not in use
2. **Connection errors**: Check if the correct driver is selected and SSL settings are properly configured
3. **Authentication errors**: Try signing out and signing back in, or re-import your API key
4. **API errors**: Verify your authentication is working correctly

## Contributing

The source code for this extension is available on GitHub. Contributions are welcome!

## License

MIT 