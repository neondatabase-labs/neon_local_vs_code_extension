![Neon logo](/resources/Neon_logo.png)

# Neon Local Connect VS Code Extension

Connect any app to any Neon branch over localhost. Branch, test, and reset database branches from your IDE using Docker-based [Neon Local](https://github.com/neondatabase-labs/neon_local) under the hood.

## ✨ Features

- Create and connect to Neon branches using a local connection string without leaving your IDE.
- Easily incorporate ephemeral Neon branches into your local development and testing workflows.
- Query your database in your terminal or via the Neon console from your IDE.
- Supports both Postgres and Neon serverless drivers.
- The extension manages a Neon Local Docker container for you, no manual Docker commands required.

## 📋 Requirements

- Docker must be installed and running
- VS Code 1.85.0 or later
- A [Neon account](https://neon.tech)

## 🚀 Quick start

### 1. **Install the extension**

Find "Neon Local Connect" in the VS Code Marketplace and click **Install**.

### 2. **Sign in to Neon**
Open the Neon Local Connect panel in the sidebar (look for the Neon logo).

Click **Sign in** (OAuth) or **Import API Key**.

![choose your sign in method](/resources/neon_local_start_view.png)

OAuth sign in will ask to launch authentication in an external browser.


![neon OAuth authorization in browser](/resources/authorize_neon.png)

If you choose the API method, your access and refresh tokens (or API key) are securely stored and encrypted by the extension.

### 3. **Connect to a branch**

You have two main choices:

- **Existing branch:**  
  Use this if you want to connect to a long-lived branch (like `main`, `development`, or a feature branch) that you or your team will use repeatedly. This is best for ongoing development, team collaboration, or when you want your changes to persist.

  ![persistent branch connected](/resources/branch_connected.png)

- **Ephemeral branch:**  
  Choose this for a temporary, disposable branch that's created just for your current session. Perfect for testing, experiments, or CI runs. Your branch (and any changes) will be automatically deleted when you disconnect.

   ![ephemeral branch connected](/resources/ephemeral_branch_connected.png)

In both cases, you'll be asked to choose your driver type: **PostgreSQL** for most Postgres connections, or **Neon serverless** for edge or HTTP. [Read the docs for more info on choosing a connection type.](https://neon.com/docs/connect/choose-connection)

### 4. **Use the static connection string**

After connecting, you can find your local connection string in the **Local Connection Details** section of the extension panel. Select your database from the dropdown to see and copy the connection string for use in your app's `.env` or config:

![Local connection details](/resources/connection_details.png)

Example `.env`:

```env
DATABASE_URL="postgres://neon:npg@localhost:5432/neondb"
```

### 5. **Run your app**

Your app now talks to Neon via `localhost:5432`. No code changes needed when you switch branches!

**Example:**

```js
// Node.js example using pg or @neondatabase/serverless
const { Client } = require('pg'); // or require('@neondatabase/serverless')
const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
```

or

```bash
psql $DATABASE_URL
```

## 🖱️ Panel actions

Once connected, the Neon Local Connect panel provides quick access to common database operations:

- **Reset from Parent Branch:** Instantly reset your branch to match its parent's state.  
  [Docs: Branch reset][https://neon.com/docs/guides/reset-from-parent)
- **Open SQL Editor:** Launch the Neon SQL Editor in your browser for advanced queries.  
  [Docs: SQL Editor](https://neon.com/docs/get-started-with-neon/query-with-neon-sql-editor)
- **Open Table View:** Browse your database schema and data in the Neon Console.  
  [Docs: Tables](https://neon.com/docs/guides/tables)
- **Launch PSQL:** Open a psql shell in the integrated terminal for direct SQL access.  
  [Docs: Using psql with Neon](https://neon.com/docs/connect/query-with-psql-editor)

## 💡 Why this matters

- No more dynamic connection strings, just use `localhost:5432` everywhere.
- Switch branches for features, tests, or teammates without touching your app code.
- Works with any language or framework that supports Postgres.
- All the power of [Neon Local](https://github.com/neondatabase-labs/neon_local) with a simple VS Code UI.

## 🛠️ Troubleshooting

- Docker must be running for the extension to work.
- If you see "connection refused," check that Docker is running and port 5432 is available.

## 📚 Learn more

- [Neon Docs](https://neon.tech/docs/)
- [Neon Local Documentation](https://neon.tech/docs/local/neon-local)
- [Neon Serverless Driver](https://neon.tech/docs/serverless/serverless-driver)
- [Community & Support](https://discord.gg/92vNTzKDGp)
- [Neon Local Example React Express App](https://github.com/neondatabase-labs/neon-local-example-react-express-application)


## 📄 License

This extension is released under the [MIT License](LICENSE).
