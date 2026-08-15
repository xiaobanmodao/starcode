export const CPP_STANDARDS = ['c++11', 'c++14', 'c++17', 'c++20', 'c++23'] as const;
export type CppStandard = (typeof CPP_STANDARDS)[number];
export type BuildMode = 'release' | 'debug';
export type OperationKind = 'idle' | 'building' | 'running' | 'testing' | 'debugging';

export interface ProjectConfigV1 {
  version: 1;
  name: string;
  entry: string;
  sources: string[];
  standard: CppStandard;
  includeDirs: string[];
  defines: string[];
  extraCompilerArgs: string[];
  runArgs: string[];
  workingDirectory: string;
}

export interface FileTreeNode {
  name: string;
  path: string;
  kind: 'file' | 'directory';
  children?: FileTreeNode[];
}

export interface ProjectSnapshot {
  rootPath: string;
  config: ProjectConfigV1 | null;
  tree: FileTreeNode[];
}

export interface FileDocument {
  path: string;
  name: string;
  content: string;
}

export interface RecentProject {
  path: string;
  name: string;
  lastOpenedAt: number;
}

export interface ToolchainStatus {
  platform: NodeJS.Platform;
  compilerPath?: string;
  compilerVersion?: string;
  debuggerPath?: string;
  debuggerVersion?: string;
  debuggerReady?: boolean;
  debuggerMessage?: string;
  languageServerPath?: string;
  languageServerVersion?: string;
  languageServerReady?: boolean;
  formatterPath?: string;
  formatterVersion?: string;
  formatterReady?: boolean;
  ready: boolean;
  bundled: boolean;
  message: string;
}

export interface Diagnostic {
  file: string;
  line: number;
  column: number;
  severity: 'error' | 'warning' | 'note';
  message: string;
  source: 'build' | 'clangd';
  code?: string;
}

export type LanguageServiceState = 'stopped' | 'starting' | 'indexing' | 'ready' | 'error';

export interface LanguageServiceStatus {
  state: LanguageServiceState;
  message: string;
  rootPath?: string;
  serverPath?: string;
  serverVersion?: string;
}

export interface LanguageDocument {
  path: string;
  text: string;
  version: number;
  rootPath?: string;
}

export const LANGUAGE_REQUEST_METHODS = [
  'textDocument/completion',
  'textDocument/signatureHelp',
  'textDocument/hover',
  'textDocument/definition',
  'textDocument/references',
  'textDocument/rename',
  'textDocument/documentSymbol',
] as const;
export type LanguageRequestMethod = (typeof LANGUAGE_REQUEST_METHODS)[number];

export interface LanguageRequest {
  method: LanguageRequestMethod;
  params: Record<string, unknown>;
}

export interface FormatRequest {
  path: string;
  text: string;
  range?: { startLine: number; endLine: number };
}

export type LanguageEvent =
  | { type: 'status'; status: LanguageServiceStatus }
  | { type: 'diagnostics'; path: string; diagnostics: Diagnostic[] }
  | { type: 'log'; text: string };

export interface BuildRequest {
  rootPath?: string;
  activeFile: string;
  mode: BuildMode;
}

export interface BuildResult {
  success: boolean;
  exitCode: number | null;
  executablePath?: string;
  workingDirectory?: string;
  command: string;
  output: string;
  diagnostics: Diagnostic[];
  durationMs: number;
}

export interface BuildEvent {
  type: 'started' | 'output' | 'finished';
  text?: string;
  result?: BuildResult;
}

export interface RunRequest extends BuildRequest {
  args?: string[];
}

export interface TerminalEvent {
  type: 'started' | 'data' | 'exit' | 'error';
  data?: string;
  exitCode?: number;
  startedAt?: number;
  durationMs?: number;
}

export interface TestCaseV1 {
  id: string;
  name: string;
  input: string;
  expectedOutput: string;
  timeoutMs: number;
}

export interface TestSuiteV1 {
  version: 1;
  target: string;
  cases: TestCaseV1[];
}

export interface TestImportIssue {
  baseName: string;
  reason: string;
}

export interface TestImportResult {
  cancelled: boolean;
  cases: TestCaseV1[];
  issues: TestImportIssue[];
}

export interface TestExportEntry {
  id: string;
  inputFileName: string;
  outputFileName: string;
}

export interface TestExportResult {
  cancelled: boolean;
  directory?: string;
  entries: TestExportEntry[];
}

export type TestStatus = 'passed' | 'wrong-answer' | 'runtime-error' | 'timeout' | 'cancelled';

export interface TestCaseResult {
  id: string;
  status: TestStatus;
  actualOutput: string;
  stderr: string;
  exitCode: number | null;
  durationMs: number;
  firstDifferenceLine?: number;
}

export interface TestRunResult {
  build: BuildResult;
  cases: TestCaseResult[];
}

export interface SourceBreakpoints {
  path: string;
  lines: number[];
}

export interface DebugStartRequest extends BuildRequest {
  breakpoints: SourceBreakpoints[];
  args?: string[];
}

export type DebugCommand =
  | { type: 'continue' | 'pause' | 'next' | 'stepIn' | 'stepOut'; threadId: number }
  | { type: 'evaluate'; expression: string; frameId?: number }
  | { type: 'input'; data: string }
  | { type: 'disconnect' }
  | { type: 'setBreakpoints'; breakpoints: SourceBreakpoints[] }
  | { type: 'snapshot'; threadId?: number };

export interface DebugVariable {
  name: string;
  value: string;
  type?: string;
  variablesReference: number;
}

export interface DebugFrame {
  id: number;
  name: string;
  line: number;
  column: number;
  source?: { name?: string; path?: string };
}

export interface DebugSnapshot {
  threads: Array<{ id: number; name: string }>;
  frames: DebugFrame[];
  scopes: Array<{ name: string; variablesReference: number; expensive: boolean }>;
  variables: DebugVariable[];
  selectedThreadId?: number;
  selectedFrameId?: number;
}

export interface DebugEvent {
  type: 'started' | 'initialized' | 'stopped' | 'continued' | 'output' | 'terminated' | 'error';
  body?: Record<string, unknown>;
  text?: string;
}

export interface AppState {
  recentProjects: RecentProject[];
  lastProjectPath?: string;
  theme: 'system' | 'dark' | 'light';
  editorFontSize: number;
  editorTabSize: number;
  formatOnSave: boolean;
  languageIntelligenceEnabled: boolean;
  bottomPanelHeight: number;
  breakpoints?: Record<string, number[]>;
}

export interface StarCodeApi {
  files: {
    openFile(): Promise<FileDocument | null>;
    read(path: string): Promise<FileDocument>;
    save(path: string, content: string): Promise<void>;
    saveAs(suggestedName: string, content: string): Promise<FileDocument | null>;
    create(rootPath: string, relativePath: string, content?: string): Promise<FileDocument>;
    remove(path: string): Promise<void>;
  };
  projects: {
    open(): Promise<ProjectSnapshot | null>;
    openPath(path: string): Promise<ProjectSnapshot>;
    refresh(rootPath: string): Promise<ProjectSnapshot>;
    saveConfig(rootPath: string, config: ProjectConfigV1): Promise<ProjectSnapshot>;
    getState(): Promise<AppState>;
    setState(patch: Partial<AppState>): Promise<AppState>;
  };
  toolchain: {
    detect(): Promise<ToolchainStatus>;
    installMacTools(): Promise<void>;
    enableMacDebugging(): Promise<ToolchainStatus>;
  };
  language: {
    open(document: LanguageDocument): Promise<LanguageServiceStatus>;
    change(document: LanguageDocument): Promise<void>;
    save(document: LanguageDocument): Promise<void>;
    close(path: string): Promise<void>;
    request(request: LanguageRequest): Promise<unknown>;
    format(request: FormatRequest): Promise<string>;
    restart(document: LanguageDocument): Promise<LanguageServiceStatus>;
    stop(): Promise<void>;
    onEvent(callback: (event: LanguageEvent) => void): () => void;
  };
  build: {
    start(request: BuildRequest): Promise<BuildResult>;
    cancel(): Promise<void>;
    onEvent(callback: (event: BuildEvent) => void): () => void;
  };
  run: {
    start(request: RunRequest): Promise<BuildResult>;
    input(data: string): void;
    resize(cols: number, rows: number): void;
    stop(): Promise<void>;
    onEvent(callback: (event: TerminalEvent) => void): () => void;
  };
  tests: {
    load(rootPath: string, targetPath: string): Promise<TestSuiteV1>;
    save(rootPath: string, suite: TestSuiteV1): Promise<void>;
    importFiles(): Promise<TestImportResult>;
    exportFiles(suite: TestSuiteV1): Promise<TestExportResult>;
    run(request: BuildRequest, suite: TestSuiteV1): Promise<TestRunResult>;
    cancel(): Promise<void>;
  };
  debug: {
    start(request: DebugStartRequest): Promise<BuildResult>;
    command(command: DebugCommand): Promise<unknown>;
    onEvent(callback: (event: DebugEvent) => void): () => void;
  };
}

export const IPC = {
  FILE_OPEN: 'files:open',
  FILE_READ: 'files:read',
  FILE_SAVE: 'files:save',
  FILE_SAVE_AS: 'files:save-as',
  FILE_CREATE: 'files:create',
  FILE_REMOVE: 'files:remove',
  PROJECT_OPEN: 'projects:open',
  PROJECT_OPEN_PATH: 'projects:open-path',
  PROJECT_REFRESH: 'projects:refresh',
  PROJECT_SAVE_CONFIG: 'projects:save-config',
  APP_STATE_GET: 'app-state:get',
  APP_STATE_SET: 'app-state:set',
  TOOLCHAIN_DETECT: 'toolchain:detect',
  TOOLCHAIN_INSTALL_MAC: 'toolchain:install-mac',
  TOOLCHAIN_ENABLE_MAC_DEBUGGING: 'toolchain:enable-mac-debugging',
  LANGUAGE_OPEN: 'language:open',
  LANGUAGE_CHANGE: 'language:change',
  LANGUAGE_SAVE: 'language:save',
  LANGUAGE_CLOSE: 'language:close',
  LANGUAGE_REQUEST: 'language:request',
  LANGUAGE_FORMAT: 'language:format',
  LANGUAGE_RESTART: 'language:restart',
  LANGUAGE_STOP: 'language:stop',
  LANGUAGE_EVENT: 'language:event',
  BUILD_START: 'build:start',
  BUILD_CANCEL: 'build:cancel',
  BUILD_EVENT: 'build:event',
  RUN_START: 'run:start',
  RUN_INPUT: 'run:input',
  RUN_RESIZE: 'run:resize',
  RUN_STOP: 'run:stop',
  RUN_EVENT: 'run:event',
  TEST_LOAD: 'tests:load',
  TEST_SAVE: 'tests:save',
  TEST_IMPORT_FILES: 'tests:import-files',
  TEST_EXPORT_FILES: 'tests:export-files',
  TEST_RUN: 'tests:run',
  TEST_CANCEL: 'tests:cancel',
  DEBUG_START: 'debug:start',
  DEBUG_COMMAND: 'debug:command',
  DEBUG_EVENT: 'debug:event',
} as const;
