# Neon Local Connect VS Code Extension

This VS Code extension provides a seamless integration with Neon Database for local development. It allows you to manage Neon database branches and run local proxies using either PostgreSQL or Neon Serverless drivers.

## Features

- Create and connect to Neon branches through a local connection string without leaving you IDE
- Easily incorporate ephemeral Neon branches into you local development and testing workflows
- Query your database in your terminal or via the Neon console from your IDE

## Requirements

- Docker must be installed and running on your system
- A Neon account (for OAuth sign-in) or API key
- VS Code 1.85.0 or later

## Installation

1. Install the extension from the VS Code marketplace
2. Open the Connect view in the sidebar of the Neon extension
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

