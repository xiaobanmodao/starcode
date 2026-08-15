import { loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';

const runtime = globalThis as typeof globalThis & {
  MonacoEnvironment?: { getWorker(): Worker };
};

runtime.MonacoEnvironment = {
  getWorker: () => new EditorWorker(),
};
loader.config({ monaco });

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
