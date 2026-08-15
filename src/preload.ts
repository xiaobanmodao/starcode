import { contextBridge, ipcRenderer } from 'electron';
import { IPC, type BuildEvent, type DebugEvent, type LanguageEvent, type StarCodeApi, type TerminalEvent } from './shared/contracts';

function subscribe<T>(channel: string, callback: (event: T) => void): () => void {
  const listener = (_event: Electron.IpcRendererEvent, payload: T) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.off(channel, listener);
}

const api: StarCodeApi = {
  files: {
    openFile: () => ipcRenderer.invoke(IPC.FILE_OPEN),
    read: (path) => ipcRenderer.invoke(IPC.FILE_READ, path),
    save: (path, content) => ipcRenderer.invoke(IPC.FILE_SAVE, path, content),
    saveAs: (name, content) => ipcRenderer.invoke(IPC.FILE_SAVE_AS, name, content),
    create: (rootPath, relativePath, content) => ipcRenderer.invoke(IPC.FILE_CREATE, rootPath, relativePath, content),
    remove: (path) => ipcRenderer.invoke(IPC.FILE_REMOVE, path),
  },
  projects: {
    open: () => ipcRenderer.invoke(IPC.PROJECT_OPEN),
    openPath: (path) => ipcRenderer.invoke(IPC.PROJECT_OPEN_PATH, path),
    refresh: (rootPath) => ipcRenderer.invoke(IPC.PROJECT_REFRESH, rootPath),
    saveConfig: (rootPath, config) => ipcRenderer.invoke(IPC.PROJECT_SAVE_CONFIG, rootPath, config),
    getState: () => ipcRenderer.invoke(IPC.APP_STATE_GET),
    setState: (patch) => ipcRenderer.invoke(IPC.APP_STATE_SET, patch),
  },
  toolchain: {
    detect: () => ipcRenderer.invoke(IPC.TOOLCHAIN_DETECT),
    installMacTools: () => ipcRenderer.invoke(IPC.TOOLCHAIN_INSTALL_MAC),
    enableMacDebugging: () => ipcRenderer.invoke(IPC.TOOLCHAIN_ENABLE_MAC_DEBUGGING),
  },
  language: {
    open: (document) => ipcRenderer.invoke(IPC.LANGUAGE_OPEN, document),
    change: (document) => ipcRenderer.invoke(IPC.LANGUAGE_CHANGE, document),
    save: (document) => ipcRenderer.invoke(IPC.LANGUAGE_SAVE, document),
    close: (path) => ipcRenderer.invoke(IPC.LANGUAGE_CLOSE, path),
    request: (request) => ipcRenderer.invoke(IPC.LANGUAGE_REQUEST, request),
    format: (request) => ipcRenderer.invoke(IPC.LANGUAGE_FORMAT, request),
    restart: (document) => ipcRenderer.invoke(IPC.LANGUAGE_RESTART, document),
    stop: () => ipcRenderer.invoke(IPC.LANGUAGE_STOP),
    onEvent: (callback) => subscribe<LanguageEvent>(IPC.LANGUAGE_EVENT, callback),
  },
  build: {
    start: (request) => ipcRenderer.invoke(IPC.BUILD_START, request),
    cancel: () => ipcRenderer.invoke(IPC.BUILD_CANCEL),
    onEvent: (callback) => subscribe<BuildEvent>(IPC.BUILD_EVENT, callback),
  },
  run: {
    start: (request) => ipcRenderer.invoke(IPC.RUN_START, request),
    input: (data) => ipcRenderer.send(IPC.RUN_INPUT, data),
    resize: (cols, rows) => ipcRenderer.send(IPC.RUN_RESIZE, cols, rows),
    stop: () => ipcRenderer.invoke(IPC.RUN_STOP),
    onEvent: (callback) => subscribe<TerminalEvent>(IPC.RUN_EVENT, callback),
  },
  tests: {
    load: (rootPath, targetPath) => ipcRenderer.invoke(IPC.TEST_LOAD, rootPath, targetPath),
    save: (rootPath, suite) => ipcRenderer.invoke(IPC.TEST_SAVE, rootPath, suite),
    importFiles: () => ipcRenderer.invoke(IPC.TEST_IMPORT_FILES),
    exportFiles: (suite) => ipcRenderer.invoke(IPC.TEST_EXPORT_FILES, suite),
    run: (request, suite) => ipcRenderer.invoke(IPC.TEST_RUN, request, suite),
    cancel: () => ipcRenderer.invoke(IPC.TEST_CANCEL),
  },
  debug: {
    start: (request) => ipcRenderer.invoke(IPC.DEBUG_START, request),
    command: (command) => ipcRenderer.invoke(IPC.DEBUG_COMMAND, command),
    onEvent: (callback) => subscribe<DebugEvent>(IPC.DEBUG_EVENT, callback),
  },
};

contextBridge.exposeInMainWorld('starcode', api);
