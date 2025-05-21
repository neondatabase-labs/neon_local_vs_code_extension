export const getStyles = (): string => `
<style>
    body {
        padding: 20px;
        font-family: var(--vscode-font-family);
        color: var(--vscode-editor-foreground);
        line-height: 1.5;
    }
    .header {
        display: flex;
        align-items: center;
        margin-bottom: 20px;
    }
    .neon-logo {
        margin-right: 10px;
    }
    h1 {
        margin: 0;
        font-size: 20px;
        font-weight: 600;
    }
    select {
        width: 100%;
        padding: 8px;
        padding-right: 32px;
        margin: 4px 0 8px 0;
        background-color: var(--vscode-dropdown-background);
        color: var(--vscode-dropdown-foreground);
        border: 1px solid var(--vscode-dropdown-border);
        border-radius: 4px;
        font-size: 13px;
        transition: border-color 0.2s, opacity 0.2s;
        appearance: none;
        background-image: url("data:image/svg+xml;charset=utf-8,%3Csvg width='16' height='16' viewBox='0 0 16 16' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath fill-rule='evenodd' clip-rule='evenodd' d='M7.976 10.072l4.357-4.357.62.618L8.284 11h-.618L3 6.333l.619-.618 4.357 4.357z' fill='%23C5C5C5'/%3E%3C/svg%3E");
        background-repeat: no-repeat;
        background-position: right 8px center;
    }
    select:focus, button:focus {
        outline: 1px solid var(--vscode-focusBorder);
        outline-offset: -1px;
    }
    select:hover:not(:disabled) {
        border-color: var(--vscode-dropdown-listBackground);
    }
    button {
        width: 100%;
        padding: 8px;
        margin: 4px 0 8px 0;
        background-color: var(--vscode-button-background);
        color: var(--vscode-button-foreground);
        border: none;
        border-radius: 4px;
        font-size: 13px;
        cursor: pointer;
        font-weight: 500;
        text-align: center;
        transition: background-color 0.2s;
    }
    button:hover:not(:disabled) {
        background-color: var(--vscode-button-hoverBackground);
    }
    button:disabled {
        opacity: 0.5;
        cursor: not-allowed;
    }
    .section {
        margin-bottom: 8px;
    }
    .section label {
        display: block;
        margin-bottom: 0px;
        color: var(--vscode-foreground);
        font-size: 13px;
        font-weight: 500;
    }
    .proxy-buttons {
        display: flex;
        flex-direction: column;
        gap: 8px;
        margin-top: 20px;
    }
    .proxy-buttons button {
        margin: 0;
    }
    .connection-details {
        padding: 0;
        margin-top: 8px;
    }
    .detail-row {
        display: flex;
        flex-direction: column;
        padding: 8px 0;
        gap: 2px;
    }
    .detail-row:last-child {
        padding-bottom: 0;
    }
    .detail-label {
        color: var(--vscode-descriptionForeground);
        font-size: 10px;
        font-weight: 500;
        text-transform: uppercase;
        letter-spacing: 0.04em;
    }
    .detail-value {
        color: var(--vscode-foreground);
        font-size: 13px;
        font-weight: normal;
    }
    .connection-status {
        margin: 0;
        padding: 0;
    }
    .status-indicator {
        display: flex;
        align-items: center;
        font-size: 13px;
        font-weight: 500;
    }
    .status-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        margin-right: 8px;
    }
    .status-indicator.connected {
        color: var(--vscode-testing-iconPassed, #73C991);
    }
    .status-indicator.connected .status-dot {
        background-color: var(--vscode-testing-iconPassed, #73C991);
        box-shadow: 0 0 4px var(--vscode-testing-iconPassed, #73C991);
    }
    .status-indicator.disconnected {
        color: var(--vscode-testing-iconQueued, #919191);
    }
    .status-indicator.disconnected .status-dot {
        background-color: var(--vscode-testing-iconQueued, #919191);
    }
    .connection-string-container {
        display: flex;
        align-items: center;
        gap: 8px;
        font-family: var(--vscode-editor-font-family);
        width: 100%;
    }
    .connection-string {
        flex: 1;
        font-size: 13px;
        word-break: break-all;
        color: var(--vscode-foreground);
    }
    .copy-button {
        display: flex;
        align-items: center;
        justify-content: center;
        background-color: transparent;
        color: var(--vscode-icon-foreground);
        padding: 4px;
        font-size: 12px;
        border-radius: 3px;
        margin: 0;
        flex-shrink: 0;
        width: 20px;
        height: 20px;
        border: none;
        cursor: pointer;
        opacity: 0.5;
        position: relative;
    }
    .copy-button:hover {
        background-color: var(--vscode-toolbar-hoverBackground);
        opacity: 1;
    }
    .copy-success {
        position: absolute;
        color: var(--vscode-notificationsSuccessIcon-foreground, #89D185);
        font-size: 10px;
        left: calc(100% + 4px);
        top: 50%;
        transform: translateY(-50%);
        white-space: nowrap;
        opacity: 0;
        transition: opacity 0.3s;
        pointer-events: none;
    }
    .copy-success.visible {
        opacity: 1;
    }
    .form-description {
        color: var(--vscode-descriptionForeground);
        font-size: 13px;
        margin-bottom: 16px;
    }
    .detail-label-container {
        display: flex;
        align-items: center;
        gap: 4px;
    }
    .spinner {
        display: none;
        width: 24px;
        height: 24px;
        margin: 20px auto;
        border: 3px solid var(--vscode-button-background);
        border-top: 3px solid var(--vscode-button-hoverBackground);
        border-radius: 50%;
        animation: spin 1s linear infinite;
    }
    @keyframes spin {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
    }
    .stop-button, .reset-button, .sql-editor-button, .psql-button {
        background-color: var(--vscode-button-background);
        color: var(--vscode-button-foreground);
    }
    .stop-button:hover, .reset-button:hover, .sql-editor-button:hover, .psql-button:hover {
        background-color: var(--vscode-button-hoverBackground);
    }
</style>
`; 