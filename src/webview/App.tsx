import * as React from 'react';
import { StateProvider } from './context/StateContext';
import { MainApp } from './components/App';

interface AppProps {
  vscode: any;
}

export function App({ vscode }: AppProps) {
  return (
    <StateProvider vscode={vscode}>
      <MainApp vscode={vscode} />
    </StateProvider>
  );
} 