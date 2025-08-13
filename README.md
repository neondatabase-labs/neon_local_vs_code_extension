
# Neon Local Connect your IDE Extension

Connect any app to any Neon branch over localhost, and manage your database directly from your IDE. Browse schemas, run queries, and edit table data - all without leaving your IDE. Built on Docker-based [Neon Local](https://github.com/neondatabase-labs/neon_local) with a powerful database management interface.

## ✨ Features

- **Database Visualization**: Browse your database schema with an intuitive tree view showing databases, schemas, tables, columns, and relationships
- **Built-in SQL Editor**: Write and execute SQL queries directly in your IDE with syntax highlighting, results display, and export capabilities  
- **Table Data Management**: View, edit, insert, and delete table data with a spreadsheet-like interface without leaving your IDE
- **Branch Management**: Create and connect to Neon branches using a local connection string without leaving your IDE
- **Ephemeral Workflows**: Easily incorporate ephemeral Neon branches into your local development and testing workflows
- **Multiple Query Options**: Query your database using the built-in SQL editor, terminal, or via the Neon console
- **Driver Support**: Supports both Postgres and Neon serverless drivers
- **Container Management**: The extension manages a Neon Local Docker container for you, no manual Docker commands required

## 📋 Requirements

- Docker must be installed and running
- your IDE 1.85.0 or later
- A [Neon account](https://neon.tech)

## 🚀 Quick start

### 1. **Install the extension**

Find "Neon Local Connect" in the your IDE Marketplace and click **Install**.

### 2. **Sign in to Neon**
Open the Neon Local Connect panel in the sidebar (look for the Neon logo).

Click **Sign in**

![sign in with your Neon account](/resources/sign-in.png)

OAuth sign in will ask to launch authentication in an external browser.


![neon OAuth authorization in browser](/resources/authorize.png)

You can also import a Neon API key to make it so that you don't need to resign into the extension after closing your IDE. All auth tokens or API keys are securely stored and encrypted by the extension.

### 3. **Connect to a branch**

You have two main choices:

- **Existing branch:**  
  Use this if you want to connect to a long-lived branch (like `main`, `development`, or a feature branch) that you or your team will use repeatedly. This is best for ongoing development, team collaboration, or when you want your changes to persist.

  ![persistent branch connected](/resources/connected.png)

- **Ephemeral branch:**  
  Choose this for a temporary, disposable branch that's created just for your current development session. Perfect for testing, experiments, or CI runs. Your branch (and any changes) will be automatically deleted when you disconnect.

   ![ephemeral branch connected](/resources/ephemeral_connected.png)


### 4. **Use the static connection string**

After connecting, you can find your local connection string in the extension panel. Copy the connection string, update it with your database name, and then add it to your app's `.env` or config. The local connection string will not change as you switch between branches:

![Local connection details](/resources/connection_string.png)

Example `.env`:

```env
DATABASE_URL="postgres://neon:npg@localhost:5432/neondb"
```

The local connection string can support both traditional postgres connections and connections using the Neon serverless driver.

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

## 🗂️ Database Schema View

Once connected, the extension provides a comprehensive **Database Schema** view in the sidebar that lets you explore your database structure visually:

![Database Schema View](/resources/database_schema_view.png)

### What you can see:
- **Databases**: All available databases in your connected branch
- **Schemas**: Database schemas organized in a tree structure  
- **Tables & Views**: All tables and views with their column definitions
- **Data Types**: Column data types, constraints, and relationships
- **Primary Keys**: Clearly marked primary key columns
- **Foreign Keys**: Visual indicators for foreign key relationships

### What you can do:
- **Right-click any table** to access quick actions:
  - **Query Table**: Opens a pre-filled `SELECT *` query in the SQL Editor
  - **View Table Data**: Opens the table data in an editable spreadsheet view
  - **Truncate Table**: Remove all rows from a table
  - **Drop Table**: Delete the table entirely
- **Right-click databases** to launch a psql shell for that specific database
- **Refresh** the schema view to see the latest structural changes
- **Expand/collapse** database objects to focus on what you need

The schema view automatically updates when you switch between branches, so you always see the current state of your connected database.

## ⚡ Built-in SQL Editor

Execute SQL queries directly in your IDE with the integrated SQL Editor:

![SQL Editor in your IDE](/resources/sql_editor_view.png)

### Features:
- **Syntax Highlighting**: Full SQL syntax support with intelligent highlighting
- **Query Execution**: Run queries with `Ctrl+Enter` or the Execute button
- **Results Display**: View query results in a tabular format with:
  - Column sorting and filtering
  - Export to CSV/JSON formats
  - Performance statistics (execution time, rows affected, etc.)
  - Error highlighting with detailed messages
- **Query History**: Access your previous queries
- **Database Context**: Automatically connects to the selected database

### How to use:
1. **From Schema View**: Right-click any table and select "Query Table" for a pre-filled SELECT query
2. **From Actions Panel**: Click "Open SQL Editor" to start with a blank query
3. **From Command Palette**: Use `Ctrl+Shift+P` and search for "Neon: Open SQL Editor"

The SQL Editor integrates seamlessly with your database connection, so you can query any database in your current branch without additional setup.

## 📊 Table Data Management

View and edit your table data with a powerful, spreadsheet-like interface:

![Table Data Editor](/resources/table_data_view.png)

### Viewing Data:
- **Paginated Display**: Navigate through large datasets with page controls
- **Column Management**: Show/hide columns, sort by any column
- **Data Types**: Visual indicators for different data types (primary keys, foreign keys, etc.)
- **Null Handling**: Clear visualization of NULL values

### Editing Capabilities:
- **Row Editing**: Double-click any row to edit all fields inline (requires primary key)
- **Insert New Rows**: Add new records with the "Add Row" button
- **Delete Rows**: Remove records with confirmation dialogs (requires primary key)
- **Batch Operations**: Edit multiple fields before saving changes
- **Data Validation**: Real-time validation based on column types and constraints

> **Note**: Row editing and deletion require tables to have a primary key defined. This ensures data integrity by uniquely identifying rows for safe updates.

### How to access:
1. **From Schema View**: Right-click any table and select "View Table Data"
2. The data opens in a new tab with full editing capabilities
3. Changes are immediately applied to your database
4. Use the refresh button to see updates from other sources

Perfect for quick data inspection, testing, and small data modifications without writing SQL.

## 🖱️ Panel actions

Once connected, the Neon Local Connect panel provides quick access to common database operations:

### Branch Management:
- **Reset from Parent Branch:** Instantly reset your branch to match its parent's state  
  [Docs: Branch reset](https://neon.com/docs/guides/reset-from-parent)

### Database Tools (available in the main panel):
- **Open SQL Editor (Browser):** Launch the Neon SQL Editor in your browser for advanced queries  
  [Docs: SQL Editor](https://neon.com/docs/get-started-with-neon/query-with-neon-sql-editor)
- **Open Table View (Browser):** Browse your database schema and data in the Neon Console  
  [Docs: Tables](https://neon.com/docs/guides/tables)
- **Launch PSQL:** Open a psql shell in the integrated terminal for direct SQL access  
  [Docs: Using psql with Neon](https://neon.com/docs/connect/query-with-psql-editor)

### Built-in Database Tools (new in your IDE):
- **Database Schema View:** Explore your database structure in the sidebar with expandable tree view
- **Built-in SQL Editor:** Write and execute queries directly in your IDE with results display
- **Table Data Editor:** View and edit table data with a spreadsheet-like interface
- **Context Menus:** Right-click databases, tables, and views for quick actions like querying and data management

## 💡 Why this matters

- **Unified Development Experience**: Manage your database schema, run queries, and edit data without leaving your IDE
- **No Dynamic Connection Strings**: Just use `localhost:5432` everywhere, no matter which branch you're on
- **Visual Database Management**: See your database structure at a glance and interact with it through intuitive UI
- **Faster Development Cycles**: Query, test, and modify data instantly without switching between tools
- **Branch-Aware Workflows**: Switch branches for features, tests, or teammates without touching your app code
- **Universal Compatibility**: Works with any language or framework that supports Postgres
- **Powered by Neon Local**: All the power of [Neon Local](https://github.com/neondatabase-labs/neon_local) with an enhanced your IDE UI

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
