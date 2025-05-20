import { getStyles } from './styles';

export const getSignInHtml = (): string => `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Neon Local</title>
    ${getStyles()}
    <style>
        .error-message {
            color: var(--vscode-errorForeground);
            margin: 10px 0;
            display: none;
        }
        .spinner {
            border: 2px solid var(--vscode-editor-foreground);
            border-top: 2px solid transparent;
            border-radius: 50%;
            width: 16px;
            height: 16px;
            animation: spin 1s linear infinite;
            margin: 10px auto;
            display: none;
        }
        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }
    </style>
</head>
<body>
    <div class="container">
        <p class="description">Sign in to access your Neon projects and databases.</p>
        <div class="error-message" id="errorMessage"></div>
        <button class="sign-in-button" id="signInButton">Sign in to Neon</button>
        <div class="spinner" id="spinner"></div>
    </div>
    <script>
        const vscode = acquireVsCodeApi();
        const signInButton = document.getElementById('signInButton');
        const spinner = document.getElementById('spinner');
        const errorMessage = document.getElementById('errorMessage');

        signInButton.addEventListener('click', () => {
            signInButton.disabled = true;
            spinner.style.display = 'block';
            errorMessage.style.display = 'none';
            vscode.postMessage({ command: 'signIn' });
        });

        window.addEventListener('message', event => {
            const message = event.data;
            switch (message.command) {
                case 'showLoading':
                    signInButton.disabled = true;
                    spinner.style.display = 'block';
                    errorMessage.style.display = 'none';
                    break;
                case 'resetSignIn':
                    signInButton.disabled = false;
                    spinner.style.display = 'none';
                    break;
                case 'showError':
                    signInButton.disabled = false;
                    spinner.style.display = 'none';
                    errorMessage.textContent = message.text;
                    errorMessage.style.display = 'block';
                    break;
            }
        });
    </script>
</body>
</html>
`; 