# Neon Local VS Code Extension

This VS Code extension provides a seamless integration with Neon Database for local development. It allows you to manage Neon database branches and run local proxies using either PostgreSQL or Neon Serverless drivers.

## Features

- Configure Neon API key and project settings
- Create, switch between, and delete Neon database branches
- Start and stop local proxy with support for both PostgreSQL and Neon Serverless drivers
- Status bar indicator showing current branch
- Automatic container management

## Requirements

- Docker must be installed and running on your system
- A Neon account and API key
- VS Code 1.85.0 or later

## Installation

1. Install the extension from the VS Code marketplace
2. Configure your Neon API key and project ID using the "Neon: Configure Local Environment" command

## Usage

The extension provides the following commands (accessible via Command Palette - Ctrl/Cmd + Shift + P):

- **Neon: Configure Local Environment**: Set up your Neon API key, project ID, and preferred driver
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

* `neonLocal.apiKey`: Your Neon API key
* `neonLocal.projectId`: Your Neon project ID
* `neonLocal.driver`: Driver to use (postgres/serverless)
* `neonLocal.deleteOnStop`: Whether to delete the branch when stopping the proxy

## Security Notes

- Your Neon API key is stored securely in VS Code's secret storage
- The extension only communicates with the official Neon API and your local Docker daemon
- All connections use SSL/TLS encryption

## Troubleshooting

1. **Proxy won't start**: Ensure Docker is running and port 5432 is not in use
2. **Connection errors**: Check if the correct driver is selected and SSL settings are properly configured
3. **API errors**: Verify your API key and project ID are correct

## Contributing

The source code for this extension is available on GitHub. Contributions are welcome!

## License

MIT 