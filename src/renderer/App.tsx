import {
  Bug,
  ChevronDown,
  CircleDot,
  Code2,
  FilePlus2,
  FlaskConical,
  FolderOpen,
  Hammer,
  Pause,
  Play,
  RotateCcw,
  Save,
  Settings,
  SkipForward,
  Square,
  StepForward,
  TerminalSquare,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  AppState,
  BuildRequest,
  DebugSnapshot,
  FileTreeNode,
  LanguageServiceStatus,
  ProjectConfigV1,
  ProjectSnapshot,
  TestSuiteV1,
} from '../shared/contracts';
import { DebugInspector } from './components/DebugInspector';
import { EditorArea } from './components/EditorArea';
import { FileTree } from './components/FileTree';
import { SettingsDialog } from './components/SettingsDialog';
import { formatRuntime, TerminalPanel } from './components/TerminalPanel';
import { TestPanel } from './components/TestPanel';
import { updateLanguageMarkers } from './language-client';
import { useWorkspaceStore } from './store';
import './styles.css';

function fileName(filePath: string): string {
  return filePath.split(/[\\/]/).at(-1) || filePath;
}

function directoryName(filePath: string): string {
  const normalized = filePath.replaceAll('\\', '/');
  return normalized.slice(0, Math.max(0, normalized.lastIndexOf('/'))) || normalized;
}

function relativePath(rootPath: string, filePath: string): string {
  const normalizedRoot = rootPath.replaceAll('\\', '/').replace(/\/$/u, '');
  const normalizedFile = filePath.replaceAll('\\', '/');
  return normalizedFile.startsWith(`${normalizedRoot}/`) ? normalizedFile.slice(normalizedRoot.length + 1) : fileName(filePath);
}

function flattenFiles(nodes: FileTreeNode[]): FileTreeNode[] {
  return nodes.flatMap((node) => node.kind === 'directory' ? flattenFiles(node.children ?? []) : [node]);
}

function firstCpp(project: ProjectSnapshot): string | undefined {
  if (project.config?.entry) {
    const normalizedRoot = project.rootPath.replace(/[\\/]$/u, '');
    return `${normalizedRoot}/${project.config.entry}`;
  }
  return flattenFiles(project.tree).find((node) => /\.(cpp|cc|cxx)$/i.test(node.name))?.path;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': Error: /u, '') : String(error);
}

export default function App() {
  const store = useWorkspaceStore();
  const activeDocument = store.documents.find((document) => document.path === store.activePath);
  const [appState, setAppState] = useState<AppState>({
    recentProjects: [],
    theme: 'system',
    editorFontSize: 14,
    editorTabSize: 4,
    formatOnSave: false,
    languageIntelligenceEnabled: true,
    bottomPanelHeight: 255,
  });
  const [breakpoints, setBreakpoints] = useState<Record<string, number[]>>({});
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [newFileOpen, setNewFileOpen] = useState(false);
  const [newFilePath, setNewFilePath] = useState('main.cpp');
  const [resolvedTheme, setResolvedTheme] = useState<'dark' | 'light'>(() => window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
  const [reveal, setReveal] = useState<{ path: string; line: number; column: number; token: number }>();
  const [terminalClearToken, setTerminalClearToken] = useState(0);
  const [runStartedAt, setRunStartedAt] = useState<number>();
  const [panelHeight, setPanelHeight] = useState(255);
  const [diagnosticFilter, setDiagnosticFilter] = useState<'all' | 'build' | 'clangd'>('all');
  const [notice, setNotice] = useState<string>();
  const [languageStatus, setLanguageStatus] = useState<LanguageServiceStatus>({ state: 'stopped', message: 'C++ 智能提示已关闭。' });
  const terminalWrite = useRef<(data: string) => void>(() => undefined);
  const languageContext = useRef<string | undefined>(undefined);
  const languageVersions = useRef(new Map<string, { text: string; version: number }>());
  const languageTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const languageQueue = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    if (appState.theme !== 'system') {
      setResolvedTheme(appState.theme);
      return undefined;
    }
    const media = window.matchMedia('(prefers-color-scheme: light)');
    const update = () => setResolvedTheme(media.matches ? 'light' : 'dark');
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, [appState.theme]);

  useEffect(() => {
    document.documentElement.style.colorScheme = resolvedTheme;
  }, [resolvedTheme]);

  const showError = useCallback((error: unknown) => {
    store.setError(errorText(error));
    setTimeout(() => useWorkspaceStore.getState().setError(undefined), 5000);
  }, [store.setError]);

  const showNotice = useCallback((message: string) => {
    setNotice(message);
    setTimeout(() => setNotice(undefined), 5000);
  }, []);

  const loadFile = useCallback(async (filePath: string) => {
    try {
      const existing = useWorkspaceStore.getState().documents.find((item) => item.path === filePath);
      if (existing) return store.setActive(filePath);
      store.openDocument(await window.starcode.files.read(filePath));
    } catch (error) { showError(error); }
  }, [showError, store.openDocument, store.setActive]);

  const applyProject = useCallback(async (project: ProjectSnapshot) => {
    store.setProject(project);
    const target = firstCpp(project);
    if (target) await loadFile(target);
  }, [loadFile, store.setProject]);

  useEffect(() => {
    void (async () => {
      try {
        const state = await window.starcode.projects.getState();
        setAppState(state);
        setPanelHeight(state.bottomPanelHeight);
        setBreakpoints(state.breakpoints ?? {});
        store.setToolchain(await window.starcode.toolchain.detect());
        if (state.lastProjectPath) await applyProject(await window.starcode.projects.openPath(state.lastProjectPath));
      } catch (error) { showError(error); }
    })();
  }, []);

  useEffect(() => window.starcode.language.onEvent((event) => {
    if (event.type === 'status') setLanguageStatus(event.status);
    if (event.type === 'diagnostics') {
      store.setLanguageDiagnostics(event.path, event.diagnostics);
      updateLanguageMarkers(event.path, event.diagnostics);
    }
  }), [store.setLanguageDiagnostics]);

  useEffect(() => window.starcode.build.onEvent((event) => {
    if (event.type === 'output' && event.text) store.appendBuildOutput(event.text);
    if (event.type === 'finished' && event.result) {
      store.setDiagnostics(event.result.diagnostics);
      if (event.result.diagnostics.length) store.showPanel('problems');
    }
  }), [store.appendBuildOutput, store.setDiagnostics, store.showPanel]);

  useEffect(() => window.starcode.run.onEvent((event) => {
    if (event.type === 'started') setRunStartedAt(event.startedAt ?? Date.now());
    if (event.type === 'data' && event.data) terminalWrite.current(event.data);
    if (event.type === 'exit') {
      const duration = event.durationMs === undefined ? '' : `，运行时间 ${formatRuntime(event.durationMs)}`;
      terminalWrite.current(`\r\n\x1b[90m[程序已退出，代码 ${event.exitCode ?? 'unknown'}${duration}]\x1b[0m\r\n`);
      setRunStartedAt(undefined);
      store.setOperation('idle');
    }
    if (event.type === 'error' && event.data) {
      terminalWrite.current(`\r\n\x1b[31m${event.data}\x1b[0m\r\n`);
      setRunStartedAt(undefined);
      store.setOperation('idle');
    }
  }), [store.setOperation]);

  useEffect(() => window.starcode.debug.onEvent((event) => {
    if (event.type === 'output' && event.text) terminalWrite.current(event.text);
    if (event.type === 'stopped') {
      const threadId = typeof event.body?.threadId === 'number' ? event.body.threadId : undefined;
      void window.starcode.debug.command({ type: 'snapshot', threadId }).then((snapshot) => {
        store.setDebugSnapshot(snapshot as DebugSnapshot);
        store.showPanel('debug');
      }).catch(showError);
    }
    if (event.type === 'continued') store.setDebugSnapshot(undefined);
    if (event.type === 'terminated' || event.type === 'error') {
      if (event.text) terminalWrite.current(`\r\n\x1b[31m${event.text}\x1b[0m\r\n`);
      store.setOperation('idle');
      store.setDebugSnapshot(undefined);
    }
  }), [showError, store.setDebugSnapshot, store.setOperation, store.showPanel]);

  useEffect(() => {
    if (!store.project || !activeDocument || !/\.(cpp|cc|cxx)$/i.test(activeDocument.path)) {
      store.setSuite(undefined);
      return;
    }
    void window.starcode.tests.load(store.project.rootPath, activeDocument.path).then(store.setSuite).catch(showError);
  }, [store.project?.rootPath, activeDocument?.path]);

  useEffect(() => {
    const isCpp = (candidate: { path: string }) => /\.(cpp|cc|cxx)$/i.test(candidate.path);
    const rootPath = store.project?.rootPath;
    const normalizedRoot = rootPath?.replaceAll('\\', '/').replace(/\/$/u, '');
    const documents = rootPath
      ? store.documents.filter((document) => isCpp(document) && document.path.replaceAll('\\', '/').startsWith(`${normalizedRoot}/`))
      : activeDocument && isCpp(activeDocument) ? [activeDocument] : [];
    const nextContext = !appState.languageIntelligenceEnabled || !documents.length
      ? 'disabled'
      : rootPath ?? directoryName(documents[0]!.path);

    const enqueue = (task: () => Promise<unknown>) => {
      languageQueue.current = languageQueue.current.catch(() => undefined).then(async () => { await task(); });
    };

    if (languageContext.current !== nextContext) {
      languageContext.current = nextContext;
      for (const timer of languageTimers.current.values()) clearTimeout(timer);
      languageTimers.current.clear();
      languageVersions.current.clear();
      for (const document of documents) languageVersions.current.set(document.path, { text: document.content, version: 1 });
      enqueue(async () => {
        await window.starcode.language.stop();
        if (nextContext === 'disabled') return;
        for (const document of documents) {
          await window.starcode.language.open({ path: document.path, text: document.content, version: 1, rootPath });
        }
      });
      return;
    }
    if (nextContext === 'disabled') return;

    const desired = new Set(documents.map((document) => document.path));
    for (const filePath of languageVersions.current.keys()) {
      if (desired.has(filePath)) continue;
      languageVersions.current.delete(filePath);
      const timer = languageTimers.current.get(filePath);
      if (timer) clearTimeout(timer);
      languageTimers.current.delete(filePath);
      enqueue(() => window.starcode.language.close(filePath));
    }

    for (const document of documents) {
      const previous = languageVersions.current.get(document.path);
      if (!previous) {
        languageVersions.current.set(document.path, { text: document.content, version: 1 });
        enqueue(() => window.starcode.language.open({ path: document.path, text: document.content, version: 1, rootPath }));
        continue;
      }
      if (previous.text === document.content) continue;
      const next = { text: document.content, version: previous.version + 1 };
      languageVersions.current.set(document.path, next);
      const existingTimer = languageTimers.current.get(document.path);
      if (existingTimer) clearTimeout(existingTimer);
      languageTimers.current.set(document.path, setTimeout(() => {
        languageTimers.current.delete(document.path);
        enqueue(() => window.starcode.language.change({ path: document.path, text: next.text, version: next.version, rootPath }));
      }, 150));
    }
  }, [activeDocument?.path, appState.languageIntelligenceEnabled, store.documents, store.project?.rootPath]);

  useEffect(() => () => {
    for (const timer of languageTimers.current.values()) clearTimeout(timer);
    void window.starcode.language.stop();
  }, []);

  const saveDocument = useCallback(async (path: string) => {
    const document = useWorkspaceStore.getState().documents.find((item) => item.path === path);
    if (!document || !document.dirty) return;
    let content = document.content;
    if (appState.formatOnSave && /\.(cpp|cc|cxx|h|hpp|hh)$/i.test(document.path)) {
      content = await window.starcode.language.format({ path: document.path, text: content });
      if (content !== document.content) store.updateContent(document.path, content);
    }
    const timer = languageTimers.current.get(document.path);
    if (timer) clearTimeout(timer);
    languageTimers.current.delete(document.path);
    const tracked = languageVersions.current.get(document.path);
    let current = tracked;
    if (tracked && tracked.text !== content) {
      current = { text: content, version: tracked.version + 1 };
      languageVersions.current.set(document.path, current);
      await window.starcode.language.change({ path: document.path, text: content, version: current.version, rootPath: store.project?.rootPath });
    }
    await window.starcode.files.save(document.path, content);
    if (current) await window.starcode.language.save({ path: document.path, text: content, version: current.version, rootPath: store.project?.rootPath });
    store.markSaved(path);
  }, [appState.formatOnSave, store.markSaved, store.project?.rootPath, store.updateContent]);

  const saveAll = useCallback(async () => {
    for (const document of useWorkspaceStore.getState().documents) await saveDocument(document.path);
  }, [saveDocument]);

  const requestFor = useCallback((mode: 'release' | 'debug'): BuildRequest => {
    const current = useWorkspaceStore.getState();
    if (!current.activePath) throw new Error('请先打开一个 C++ 源文件。');
    if (!/\.(cpp|cc|cxx)$/i.test(current.activePath)) throw new Error('当前文件不是可编译的 C++ 源文件。');
    return { rootPath: current.project?.rootPath, activeFile: current.activePath, mode };
  }, []);

  const compile = useCallback(async () => {
    try {
      store.setOperation('building');
      store.setBuildOutput('');
      store.setDiagnostics([]);
      store.showPanel('problems');
      await saveAll();
      await window.starcode.build.start(requestFor('release'));
    } catch (error) { showError(error); }
    finally { store.setOperation('idle'); }
  }, [requestFor, saveAll, showError, store]);

  const run = useCallback(async () => {
    try {
      store.setOperation('running');
      store.setBuildOutput('');
      store.showPanel('terminal');
      setRunStartedAt(undefined);
      setTerminalClearToken((value) => value + 1);
      await saveAll();
      const result = await window.starcode.run.start({
        ...requestFor('release'),
        args: store.project?.config?.runArgs ?? [],
      });
      if (!result.success) store.setOperation('idle');
    } catch (error) { store.setOperation('idle'); showError(error); }
  }, [requestFor, saveAll, showError, store]);

  const debug = useCallback(async () => {
    try {
      store.setOperation('debugging');
      store.setBuildOutput('');
      store.showPanel('terminal');
      setTerminalClearToken((value) => value + 1);
      await saveAll();
      const result = await window.starcode.debug.start({
        ...requestFor('debug'),
        breakpoints: Object.entries(breakpoints).map(([path, lines]) => ({ path, lines })),
        args: store.project?.config?.runArgs ?? [],
      });
      if (!result.success) store.setOperation('idle');
    } catch (error) { store.setOperation('idle'); showError(error); }
  }, [breakpoints, requestFor, saveAll, showError, store]);

  const runTests = useCallback(async () => {
    if (!store.suite) return;
    try {
      store.setOperation('testing');
      await saveAll();
      if (store.project) await window.starcode.tests.save(store.project.rootPath, store.suite);
      const result = await window.starcode.tests.run(requestFor('release'), store.suite);
      store.setDiagnostics(result.build.diagnostics);
      store.setTestResults(result.cases);
    } catch (error) { showError(error); }
    finally { store.setOperation('idle'); }
  }, [requestFor, saveAll, showError, store]);

  const stop = useCallback(async () => {
    try {
      if (store.operation === 'running') await window.starcode.run.stop();
      else if (store.operation === 'testing') await window.starcode.tests.cancel();
      else if (store.operation === 'debugging') {
        await window.starcode.build.cancel();
        await window.starcode.debug.command({ type: 'disconnect' }).catch(() => undefined);
      } else await window.starcode.build.cancel();
    } catch (error) { showError(error); }
    finally { store.setOperation('idle'); }
  }, [showError, store]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') { event.preventDefault(); void saveAll().catch(showError); }
      if (event.key === 'F9') { event.preventDefault(); void compile(); }
      if (event.key === 'F10') { event.preventDefault(); void run(); }
      if (event.key === 'F5') { event.preventDefault(); void debug(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [compile, debug, run, saveAll, showError]);

  const openProject = async () => {
    try { const project = await window.starcode.projects.open(); if (project) await applyProject(project); }
    catch (error) { showError(error); }
  };
  const openStandalone = async () => {
    try { const document = await window.starcode.files.openFile(); if (document) store.openDocument(document); }
    catch (error) { showError(error); }
  };
  const createFile = async () => {
    try {
      if (!store.project) {
        const document = await window.starcode.files.saveAs('main.cpp', '#include <iostream>\nusing namespace std;\n\nint main() {\n    ios::sync_with_stdio(false);\n    cin.tie(nullptr);\n\n    return 0;\n}\n');
        if (document) store.openDocument(document);
        return;
      }
      setNewFilePath('main.cpp');
      setNewFileOpen(true);
    } catch (error) { showError(error); }
  };

  const confirmCreateFile = async () => {
    if (!store.project || !newFilePath.trim()) return;
    try {
      store.openDocument(await window.starcode.files.create(store.project.rootPath, newFilePath.trim(), '#include <iostream>\nusing namespace std;\n\nint main() {\n    return 0;\n}\n'));
      store.setProject(await window.starcode.projects.refresh(store.project.rootPath));
      setNewFileOpen(false);
    } catch (error) { showError(error); }
  };

  const closeDocument = (path: string) => {
    const document = store.documents.find((item) => item.path === path);
    if (document?.dirty && !window.confirm(`${document.name} 尚未保存，确定关闭吗？`)) return;
    store.closeDocument(path);
  };

  const toggleBreakpoint = (path: string, line: number) => {
    const current = breakpoints[path] ?? [];
    const next = { ...breakpoints, [path]: current.includes(line) ? current.filter((item) => item !== line) : [...current, line].sort((a, b) => a - b) };
    if (!next[path]?.length) delete next[path];
    setBreakpoints(next);
    void window.starcode.projects.setState({ breakpoints: next });
    if (store.operation === 'debugging') void window.starcode.debug.command({ type: 'setBreakpoints', breakpoints: Object.entries(next).map(([sourcePath, lines]) => ({ path: sourcePath, lines })) });
  };

  const openLocation = async (path: string, line: number, column = 1) => {
    await loadFile(path);
    setReveal({ path, line, column, token: Date.now() });
  };

  const initialConfig = useMemo<ProjectConfigV1 | undefined>(() => {
    if (!store.project) return undefined;
    if (store.project.config) return store.project.config;
    const sources = flattenFiles(store.project.tree).filter((node) => /\.(cpp|cc|cxx)$/i.test(node.name)).map((node) => relativePath(store.project!.rootPath, node.path));
    const entry = store.activePath ? relativePath(store.project.rootPath, store.activePath) : sources[0] ?? 'main.cpp';
    return { version: 1, name: fileName(store.project.rootPath), entry, sources: sources.length ? sources : [entry], standard: 'c++17', includeDirs: [], defines: [], extraCompilerArgs: [], runArgs: [], workingDirectory: '.' };
  }, [store.project, store.activePath]);

  const restartLanguage = async () => {
    const document = useWorkspaceStore.getState().documents.find((item) => item.path === useWorkspaceStore.getState().activePath);
    if (!document || !/\.(cpp|cc|cxx)$/i.test(document.path)) throw new Error('请先打开一个 C++ 源文件。');
    const tracked = languageVersions.current.get(document.path) ?? { text: document.content, version: 1 };
    languageVersions.current.set(document.path, tracked);
    await window.starcode.language.restart({ path: document.path, text: tracked.text, version: tracked.version, rootPath: store.project?.rootPath });
  };

  const saveSettings = async (
    patch: Pick<AppState, 'theme' | 'editorFontSize' | 'editorTabSize' | 'formatOnSave' | 'languageIntelligenceEnabled'>,
    config?: ProjectConfigV1,
  ) => {
    try {
      const state = await window.starcode.projects.setState(patch);
      setAppState(state);
      if (store.project && config) {
        store.setProject(await window.starcode.projects.saveConfig(store.project.rootPath, config));
        if (patch.languageIntelligenceEnabled && activeDocument && /\.(cpp|cc|cxx)$/i.test(activeDocument.path)) await restartLanguage();
      }
      setSettingsOpen(false);
    } catch (error) { showError(error); }
  };

  const persistPanelHeight = (height: number) => {
    setPanelHeight(height);
    void window.starcode.projects.setState({ bottomPanelHeight: height }).then(setAppState).catch(showError);
  };

  const beginPanelResize = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startY = event.clientY;
    const startHeight = panelHeight;
    let finalHeight = startHeight;
    const move = (moveEvent: PointerEvent) => {
      finalHeight = Math.round(Math.min(window.innerHeight * 0.6, Math.max(160, startHeight + startY - moveEvent.clientY)));
      setPanelHeight(finalHeight);
    };
    const finish = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      persistPanelHeight(finalHeight);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', finish, { once: true });
  };

  const saveSuite = async () => {
    if (!store.project || !store.suite) return;
    try { await window.starcode.tests.save(store.project.rootPath, store.suite); }
    catch (error) { showError(error); }
  };

  const importSampleFiles = async () => {
    if (!store.project || !store.suite) return;
    try {
      const result = await window.starcode.tests.importFiles();
      if (result.cancelled) return;
      if (result.cases.length) {
        const nextSuite = { ...store.suite, cases: [...store.suite.cases, ...result.cases] };
        store.setSuite(nextSuite);
        await window.starcode.tests.save(store.project.rootPath, nextSuite);
      }
      const issueSummary = result.issues.length
        ? `；跳过 ${result.issues.length} 组：${result.issues.slice(0, 3).map((item) => `${item.baseName}（${item.reason}）`).join('、')}${result.issues.length > 3 ? '等' : ''}`
        : '';
      showNotice(`已导入 ${result.cases.length} 组样例${issueSummary}`);
    } catch (error) { showError(error); }
  };

  const exportSampleFiles = async () => {
    if (!store.suite?.cases.length) return;
    try {
      const result = await window.starcode.tests.exportFiles(store.suite);
      if (!result.cancelled) showNotice(`已导出 ${result.entries.length} 组样例到 ${result.directory ?? '所选文件夹'}`);
    } catch (error) { showError(error); }
  };

  const debugThread = store.debugSnapshot?.selectedThreadId ?? 1;
  const busy = store.operation !== 'idle';
  const visibleDiagnostics = diagnosticFilter === 'all' ? store.diagnostics : store.diagnostics.filter((item) => item.source === diagnosticFilter);

  const needsDebugPermission = Boolean(store.toolchain?.ready && store.toolchain.debuggerPath && store.toolchain.debuggerReady === false);
  const hasToolchainBanner = Boolean(store.toolchain && (!store.toolchain.ready || needsDebugPermission));

  return <div className={`app ${hasToolchainBanner ? 'has-toolchain-banner' : ''}`} data-theme={resolvedTheme}>
    <header className="titlebar">
      <div className="app-title"><div className="mini-logo">S</div><strong>StarCode</strong><span>{store.project ? fileName(store.project.rootPath) : 'C++ 竞赛训练'}</span></div>
      <div className="window-drag-region" />
      <div className={`toolchain-pill ${store.toolchain?.ready ? 'ready' : 'missing'}`} title={store.toolchain?.compilerVersion ?? store.toolchain?.message} onClick={() => void window.starcode.toolchain.detect().then(store.setToolchain)}>
        <CircleDot size={12} />{store.toolchain?.ready ? 'C++ 工具链就绪' : '工具链未就绪'}
      </div>
    </header>

    <nav className="toolbar">
      <div className="toolbar-group">
        <button onClick={() => void openProject()} title="打开文件夹"><FolderOpen size={17} /><span>打开</span></button>
        <button onClick={() => void openStandalone()} title="打开源文件"><Code2 size={17} /></button>
        <button onClick={() => void createFile()} title="新建文件"><FilePlus2 size={17} /></button>
        <button onClick={() => activeDocument && void saveDocument(activeDocument.path).catch(showError)} disabled={!activeDocument?.dirty} title="保存"><Save size={17} /></button>
      </div>
      <div className="toolbar-separator" />
      <div className="toolbar-group action-group">
        <button onClick={() => void compile()} disabled={busy || !activeDocument} title="编译 (F9)"><Hammer size={17} /><span>编译</span></button>
        <button className="run-button" onClick={() => void run()} disabled={busy || !activeDocument} title="运行 (F10)"><Play size={17} /><span>运行</span></button>
        <button onClick={() => void debug()} disabled={busy || !activeDocument || !store.toolchain?.debuggerReady} title={store.toolchain?.debuggerReady ? '调试 (F5)' : store.toolchain?.debuggerMessage}><Bug size={17} /><span>调试</span></button>
        <button onClick={() => { store.showPanel('tests'); if (store.suite?.cases.length) void runTests(); }} disabled={busy || !store.suite} title="样例测试"><FlaskConical size={17} /><span>测试</span></button>
        <button className="stop-button" onClick={() => void stop()} disabled={!busy} title="停止"><Square size={15} /><span>停止</span></button>
      </div>
      {store.operation === 'debugging' && <div className="toolbar-group debug-controls">
        <button onClick={() => void window.starcode.debug.command({ type: 'continue', threadId: debugThread })} title="继续"><Play size={15} /></button>
        <button onClick={() => void window.starcode.debug.command({ type: 'pause', threadId: debugThread })} title="暂停"><Pause size={15} /></button>
        <button onClick={() => void window.starcode.debug.command({ type: 'next', threadId: debugThread })} title="单步跳过"><SkipForward size={15} /></button>
        <button onClick={() => void window.starcode.debug.command({ type: 'stepIn', threadId: debugThread })} title="单步进入"><StepForward size={15} /></button>
        <button onClick={() => void window.starcode.debug.command({ type: 'stepOut', threadId: debugThread })} title="单步跳出"><RotateCcw size={15} /></button>
      </div>}
      <div className="toolbar-spacer" />
      <button onClick={() => setSettingsOpen(true)} title="设置"><Settings size={17} /></button>
    </nav>

    {hasToolchainBanner && store.toolchain && <div className="toolchain-banner">
      <span>{needsDebugPermission ? store.toolchain.debuggerMessage : store.toolchain.message}</span>
      {store.toolchain.platform === 'darwin' && !store.toolchain.ready && <button onClick={() => void window.starcode.toolchain.installMacTools()}>安装 Command Line Tools</button>}
      {needsDebugPermission && <button onClick={() => void window.starcode.toolchain.enableMacDebugging().then(store.setToolchain).catch(showError)}>启用调试权限</button>}
      <button onClick={() => void window.starcode.toolchain.detect().then(store.setToolchain)}>重新检测</button>
    </div>}

    <main className={`workspace ${store.panelOpen ? '' : 'panel-closed'} ${store.operation === 'debugging' ? 'with-debugger' : ''}`} style={store.panelOpen ? { gridTemplateRows: `minmax(0, 1fr) ${panelHeight}px` } : undefined}>
      <aside className="sidebar">
        <div className="sidebar-heading"><span>资源管理器</span><div><button onClick={() => void createFile()} title="新建文件"><FilePlus2 size={14} /></button><button onClick={() => store.project && void window.starcode.projects.refresh(store.project.rootPath).then(store.setProject)} title="刷新"><RotateCcw size={14} /></button></div></div>
        {store.project ? <>
          <div className="project-name"><ChevronDown size={13} />{fileName(store.project.rootPath)}</div>
          <FileTree nodes={store.project.tree} activePath={store.activePath} onOpen={(path) => void loadFile(path)} />
        </> : <div className="welcome-sidebar">
          <p>还没有打开文件夹</p><button className="primary" onClick={() => void openProject()}><FolderOpen size={14} />打开文件夹</button>
          {!!appState.recentProjects.length && <div className="recent-list"><h4>最近项目</h4>{appState.recentProjects.map((recent) => <button key={recent.path} onClick={() => void window.starcode.projects.openPath(recent.path).then(applyProject).catch(showError)}><span>{recent.name}</span><small>{recent.path}</small></button>)}</div>}
        </div>}
      </aside>

      <section className="editor-region">
        <EditorArea documents={store.documents} activePath={store.activePath} fontSize={appState.editorFontSize} tabSize={appState.editorTabSize} theme={resolvedTheme} breakpoints={breakpoints} onActivate={store.setActive} onClose={closeDocument} onChange={store.updateContent} onSave={() => activeDocument && void saveDocument(activeDocument.path).catch(showError)} onToggleBreakpoint={toggleBreakpoint} onOpenLocation={openLocation} reveal={reveal} />
      </section>

      {store.operation === 'debugging' && <DebugInspector snapshot={store.debugSnapshot} onFrame={(path, line) => void openLocation(path, line)} onEvaluate={async (expression) => {
        const response = await window.starcode.debug.command({ type: 'evaluate', expression, frameId: store.debugSnapshot?.selectedFrameId }) as { result?: string };
        return response.result ?? '—';
      }} />}

      <section className="bottom-panel">
        {store.panelOpen && <div className="panel-resizer" role="separator" aria-label="调整底部面板高度" onPointerDown={beginPanelResize} onDoubleClick={() => persistPanelHeight(255)} />}
        <div className="panel-tabs">
          <button className={store.panel === 'problems' ? 'active' : ''} onClick={() => store.showPanel('problems')}>问题 <span>{store.diagnostics.length}</span></button>
          <button className={store.panel === 'terminal' ? 'active' : ''} onClick={() => store.showPanel('terminal')}><TerminalSquare size={13} />终端</button>
          <button className={store.panel === 'tests' ? 'active' : ''} onClick={() => store.showPanel('tests')}><FlaskConical size={13} />样例</button>
          {store.operation === 'debugging' && <button className={store.panel === 'debug' ? 'active' : ''} onClick={() => store.showPanel('debug')}><Bug size={13} />调试控制台</button>}
          {store.panel === 'problems' && <select className="diagnostic-filter" aria-label="问题来源" value={diagnosticFilter} onChange={(event) => setDiagnosticFilter(event.target.value as typeof diagnosticFilter)}><option value="all">全部来源</option><option value="build">编译</option><option value="clangd">clangd</option></select>}
          <div className="panel-tab-spacer" />
          <button onClick={() => store.setPanelOpen(!store.panelOpen)}>{store.panelOpen ? '收起' : '展开'}</button>
        </div>
        <div className={`panel-content ${store.panelOpen ? '' : 'hidden'}`}>
          <div className={store.panel === 'problems' ? 'panel-page' : 'panel-page hidden'}>
            {visibleDiagnostics.length ? <div className="problems-list">{visibleDiagnostics.map((item, index) => <button key={`${item.source}-${item.file}-${item.line}-${index}`} onClick={() => void openLocation(item.file, item.line, item.column)}><span className={`severity ${item.severity}`}>{item.severity === 'error' ? '错误' : item.severity === 'warning' ? '警告' : '提示'}</span><span className={`diagnostic-source ${item.source}`}>{item.source === 'clangd' ? 'clangd' : '编译'}</span><span className="problem-message">{item.message}</span><small>{fileName(item.file)}:{item.line}:{item.column}</small></button>)}</div> : <pre className="build-output">{store.buildOutput || '当前来源没有问题。'}</pre>}
          </div>
          <div className={store.panel === 'terminal' || store.panel === 'debug' ? 'panel-page' : 'panel-page hidden'}><TerminalPanel mode={store.operation === 'debugging' ? 'debug' : store.operation === 'running' ? 'run' : 'idle'} theme={resolvedTheme} clearToken={terminalClearToken} runningSince={store.operation === 'running' ? runStartedAt : undefined} onReady={(write) => { terminalWrite.current = write; }} /></div>
          <div className={store.panel === 'tests' ? 'panel-page' : 'panel-page hidden'}><TestPanel suite={store.suite} results={store.testResults} running={store.operation === 'testing'} busy={busy} onChange={store.setSuite} onSave={() => void saveSuite()} onRun={() => void runTests()} onImport={() => void importSampleFiles()} onExport={() => void exportSampleFiles()} /></div>
        </div>
      </section>
    </main>

    <footer className="statusbar"><span>{store.operation === 'idle' ? '就绪' : ({ building: '正在编译…', running: '程序运行中', testing: '正在运行样例…', debugging: '调试会话中' } as const)[store.operation]}</span><span>{activeDocument ? relativePath(store.project?.rootPath ?? '', activeDocument.path) : ''}</span><span className="status-spacer" /><button className={`language-indicator ${languageStatus.state}`} onClick={() => setSettingsOpen(true)} title={languageStatus.message}><CircleDot size={10} />C++ 智能提示：{({ stopped: '已关闭', starting: '启动中', indexing: '索引中', ready: '就绪', error: '异常' } as const)[languageStatus.state]}</button><span>UTF-8</span><span>{store.project?.config?.standard ?? 'c++17'}</span></footer>
    {store.error && <div className="toast">{store.error}</div>}
    {notice && <div className="toast notice">{notice}</div>}
    {newFileOpen && <div className="modal-backdrop" onMouseDown={() => setNewFileOpen(false)}>
      <form className="modal new-file-modal" onSubmit={(event) => { event.preventDefault(); void confirmCreateFile(); }} onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-title"><div><h2>新建 C++ 文件</h2><p>输入相对当前项目的文件路径</p></div><button type="button" onClick={() => setNewFileOpen(false)} title="关闭新建文件" aria-label="关闭新建文件">×</button></div>
        <div className="new-file-body"><label>文件路径<input autoFocus aria-label="新文件路径" value={newFilePath} onChange={(event) => setNewFilePath(event.target.value)} placeholder="例如 src/main.cpp" /></label></div>
        <div className="modal-footer"><button type="button" onClick={() => setNewFileOpen(false)}>取消</button><button className="primary" type="submit" disabled={!newFilePath.trim()}>创建文件</button></div>
      </form>
    </div>}
    {settingsOpen && <SettingsDialog appState={appState} toolchain={store.toolchain} languageStatus={languageStatus} initialProject={initialConfig} onSave={(patch, config) => void saveSettings(patch, config)} onRestartLanguage={() => void restartLanguage().catch(showError)} onClose={() => setSettingsOpen(false)} />}
  </div>;
}
