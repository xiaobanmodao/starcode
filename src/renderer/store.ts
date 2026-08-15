import { create } from 'zustand';
import type {
  DebugSnapshot,
  Diagnostic,
  FileDocument,
  ProjectSnapshot,
  TestCaseResult,
  TestSuiteV1,
  ToolchainStatus,
} from '../shared/contracts';

export interface EditorDocument extends FileDocument {
  dirty: boolean;
}

type BottomPanel = 'problems' | 'terminal' | 'tests' | 'debug';
type UiOperation = 'idle' | 'building' | 'running' | 'testing' | 'debugging';

interface WorkspaceState {
  project: ProjectSnapshot | null;
  documents: EditorDocument[];
  activePath?: string;
  toolchain?: ToolchainStatus;
  operation: UiOperation;
  panel: BottomPanel;
  panelOpen: boolean;
  buildOutput: string;
  diagnostics: Diagnostic[];
  buildDiagnostics: Diagnostic[];
  languageDiagnostics: Record<string, Diagnostic[]>;
  suite?: TestSuiteV1;
  testResults: TestCaseResult[];
  debugSnapshot?: DebugSnapshot;
  error?: string;
  setProject(project: ProjectSnapshot | null): void;
  openDocument(document: FileDocument, activate?: boolean): void;
  closeDocument(path: string): void;
  setActive(path: string): void;
  updateContent(path: string, content: string): void;
  markSaved(path: string): void;
  setToolchain(toolchain: ToolchainStatus): void;
  setOperation(operation: UiOperation): void;
  showPanel(panel: BottomPanel): void;
  setPanelOpen(open: boolean): void;
  setBuildOutput(output: string): void;
  appendBuildOutput(output: string): void;
  setDiagnostics(diagnostics: Diagnostic[]): void;
  setLanguageDiagnostics(path: string, diagnostics: Diagnostic[]): void;
  setSuite(suite: TestSuiteV1 | undefined): void;
  setTestResults(results: TestCaseResult[]): void;
  setDebugSnapshot(snapshot: DebugSnapshot | undefined): void;
  setError(error: string | undefined): void;
}

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  project: null,
  documents: [],
  operation: 'idle',
  panel: 'terminal',
  panelOpen: true,
  buildOutput: '',
  diagnostics: [],
  buildDiagnostics: [],
  languageDiagnostics: {},
  testResults: [],
  setProject: (project) => set({ project }),
  openDocument: (document, activate = true) => set((state) => ({
    documents: state.documents.some((item) => item.path === document.path)
      ? state.documents
      : [...state.documents, { ...document, dirty: false }],
    activePath: activate ? document.path : state.activePath,
  })),
  closeDocument: (path) => set((state) => {
    const index = state.documents.findIndex((document) => document.path === path);
    const documents = state.documents.filter((document) => document.path !== path);
    const next = documents[Math.min(Math.max(index - 1, 0), Math.max(documents.length - 1, 0))];
    return { documents, activePath: state.activePath === path ? next?.path : state.activePath };
  }),
  setActive: (activePath) => set({ activePath }),
  updateContent: (path, content) => set((state) => ({
    documents: state.documents.map((document) => document.path === path ? { ...document, content, dirty: true } : document),
  })),
  markSaved: (path) => set((state) => ({
    documents: state.documents.map((document) => document.path === path ? { ...document, dirty: false } : document),
  })),
  setToolchain: (toolchain) => set({ toolchain }),
  setOperation: (operation) => set({ operation }),
  showPanel: (panel) => set({ panel, panelOpen: true }),
  setPanelOpen: (panelOpen) => set({ panelOpen }),
  setBuildOutput: (buildOutput) => set({ buildOutput }),
  appendBuildOutput: (text) => set((state) => ({ buildOutput: state.buildOutput + text })),
  setDiagnostics: (diagnostics) => set((state) => {
    const buildDiagnostics = diagnostics.map((item) => ({ ...item, source: 'build' as const }));
    return { buildDiagnostics, diagnostics: [...buildDiagnostics, ...Object.values(state.languageDiagnostics).flat()] };
  }),
  setLanguageDiagnostics: (path, diagnostics) => set((state) => {
    const languageDiagnostics = { ...state.languageDiagnostics, [path]: diagnostics };
    if (!diagnostics.length) delete languageDiagnostics[path];
    return { languageDiagnostics, diagnostics: [...state.buildDiagnostics, ...Object.values(languageDiagnostics).flat()] };
  }),
  setSuite: (suite) => set({ suite, testResults: [] }),
  setTestResults: (testResults) => set({ testResults }),
  setDebugSnapshot: (debugSnapshot) => set({ debugSnapshot }),
  setError: (error) => set({ error }),
}));
