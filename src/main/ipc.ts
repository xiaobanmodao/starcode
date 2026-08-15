import { BrowserWindow, ipcMain } from 'electron';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { z } from 'zod';
import {
  CPP_STANDARDS,
  IPC,
  LANGUAGE_REQUEST_METHODS,
  type AppState,
  type BuildEvent,
  type BuildRequest,
  type DebugCommand,
  type DebugEvent,
  type DebugStartRequest,
  type FormatRequest,
  type LanguageDocument,
  type LanguageEvent,
  type LanguageRequest,
  type ProjectConfigV1,
  type RunRequest,
  type TerminalEvent,
  type TestSuiteV1,
} from '../shared/contracts';
import { AccessRegistry } from './services/access-registry';
import { BuildService } from './services/build-service';
import { CppLanguageAdapter } from './services/cpp-adapter';
import { CppLanguageService } from './services/cpp-language-service';
import { DebugService } from './services/debug-service';
import { FileService } from './services/file-service';
import { OperationCoordinator } from './services/operation-coordinator';
import { ProjectService, projectSchema } from './services/project-service';
import { RunService } from './services/run-service';
import { SampleFileService, testExportResultSchema, testImportResultSchema } from './services/sample-file-service';
import { TestService } from './services/test-service';
import { TestStore, testSuiteSchema } from './services/test-store';

const pathSchema = z.string().min(1);
const execFileAsync = promisify(execFile);
const buildSchema = z.object({
  rootPath: z.string().min(1).optional(),
  activeFile: z.string().min(1),
  mode: z.enum(['release', 'debug']),
});
const runSchema = buildSchema.extend({ args: z.array(z.string()).optional() });
const sourceBreakpointsSchema = z.object({ path: z.string().min(1), lines: z.array(z.number().int().positive()) });
const debugStartSchema = buildSchema.extend({ breakpoints: z.array(sourceBreakpointsSchema), args: z.array(z.string()).optional() });
const languageDocumentSchema = z.object({
  path: pathSchema,
  text: z.string(),
  version: z.number().int().positive(),
  rootPath: pathSchema.optional(),
});
const languageRequestSchema = z.object({
  method: z.enum(LANGUAGE_REQUEST_METHODS),
  params: z.record(z.string(), z.unknown()),
});
const formatSchema = z.object({
  path: pathSchema,
  text: z.string(),
  range: z.object({ startLine: z.number().int().positive(), endLine: z.number().int().positive() }).optional(),
});

function validateSender(event: Electron.IpcMainInvokeEvent | Electron.IpcMainEvent, window: BrowserWindow): void {
  if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) {
    throw new Error('拒绝来自未知页面的 IPC 请求。');
  }
}

export function registerIpc(getWindow: () => BrowserWindow | null): () => void {
  const access = new AccessRegistry();
  const files = new FileService(access);
  const projects = new ProjectService(access);
  const tests = new TestStore(access);
  const sampleFiles = new SampleFileService();
  const cpp = new CppLanguageAdapter();
  const coordinator = new OperationCoordinator();
  const send = <T>(channel: string, payload: T) => {
    const window = getWindow();
    if (window && !window.isDestroyed()) window.webContents.send(channel, payload);
  };
  const builds = new BuildService(projects, cpp, (event: BuildEvent) => send(IPC.BUILD_EVENT, event));
  const runs = new RunService(builds, coordinator, (event: TerminalEvent) => send(IPC.RUN_EVENT, event));
  const testRunner = new TestService(builds, coordinator);
  const debuggerService = new DebugService(builds, cpp, coordinator, (event: DebugEvent) => send(IPC.DEBUG_EVENT, event));
  const language = new CppLanguageService(projects, cpp, (event: LanguageEvent) => send(IPC.LANGUAGE_EVENT, event));
  const channels: string[] = [];

  const handle = (channel: string, handler: (...args: unknown[]) => unknown) => {
    channels.push(channel);
    ipcMain.handle(channel, (event, ...args) => {
      const window = getWindow();
      if (!window) throw new Error('主窗口尚未创建。');
      validateSender(event, window);
      return handler(...args);
    });
  };

  handle(IPC.FILE_OPEN, () => files.openFile());
  handle(IPC.FILE_READ, (candidate) => files.read(pathSchema.parse(candidate)));
  handle(IPC.FILE_SAVE, (candidate, content) => files.save(pathSchema.parse(candidate), z.string().parse(content)));
  handle(IPC.FILE_SAVE_AS, (name, content) => files.saveAs(z.string().parse(name), z.string().parse(content)));
  handle(IPC.FILE_CREATE, (root, relative, content) => files.create(pathSchema.parse(root), pathSchema.parse(relative), z.string().optional().parse(content)));
  handle(IPC.FILE_REMOVE, (candidate) => files.remove(pathSchema.parse(candidate)));
  handle(IPC.PROJECT_OPEN, () => projects.open());
  handle(IPC.PROJECT_OPEN_PATH, (candidate) => projects.openPath(pathSchema.parse(candidate)));
  handle(IPC.PROJECT_REFRESH, (candidate) => projects.refresh(pathSchema.parse(candidate)));
  handle(IPC.PROJECT_SAVE_CONFIG, (root, config) => projects.saveConfig(pathSchema.parse(root), projectSchema.parse(config) as ProjectConfigV1));
  handle(IPC.APP_STATE_GET, () => projects.getState());
  handle(IPC.APP_STATE_SET, (patch) => projects.setState(z.record(z.string(), z.unknown()).parse(patch) as Partial<AppState>));
  handle(IPC.TOOLCHAIN_DETECT, () => cpp.detectToolchain(true));
  handle(IPC.TOOLCHAIN_INSTALL_MAC, () => {
    if (process.platform !== 'darwin') throw new Error('该操作仅适用于 macOS。');
    execFile('xcode-select', ['--install'], () => undefined);
  });
  handle(IPC.TOOLCHAIN_ENABLE_MAC_DEBUGGING, async () => {
    if (process.platform !== 'darwin') throw new Error('该操作仅适用于 macOS。');
    await execFileAsync('/usr/bin/osascript', [
      '-e',
      'do shell script "/usr/sbin/DevToolsSecurity -enable" with administrator privileges',
    ], { timeout: 120000 });
    return cpp.detectToolchain(true);
  });
  handle(IPC.LANGUAGE_OPEN, (raw) => {
    const document = languageDocumentSchema.parse(raw) as LanguageDocument;
    access.assertReadable(document.path);
    if (document.rootPath) access.assertReadable(document.rootPath);
    return language.open(document);
  });
  handle(IPC.LANGUAGE_CHANGE, (raw) => {
    const document = languageDocumentSchema.parse(raw) as LanguageDocument;
    access.assertReadable(document.path);
    return language.change(document);
  });
  handle(IPC.LANGUAGE_SAVE, (raw) => {
    const document = languageDocumentSchema.parse(raw) as LanguageDocument;
    access.assertReadable(document.path);
    return language.save(document);
  });
  handle(IPC.LANGUAGE_CLOSE, (candidate) => {
    const filePath = pathSchema.parse(candidate);
    access.assertReadable(filePath);
    return language.close(filePath);
  });
  handle(IPC.LANGUAGE_REQUEST, (raw) => language.request(languageRequestSchema.parse(raw) as LanguageRequest));
  handle(IPC.LANGUAGE_FORMAT, (raw) => {
    const request = formatSchema.parse(raw) as FormatRequest;
    access.assertReadable(request.path);
    return language.format(request);
  });
  handle(IPC.LANGUAGE_RESTART, (raw) => {
    const document = languageDocumentSchema.parse(raw) as LanguageDocument;
    access.assertReadable(document.path);
    if (document.rootPath) access.assertReadable(document.rootPath);
    return language.restart(document);
  });
  handle(IPC.LANGUAGE_STOP, () => language.stop());
  handle(IPC.BUILD_START, async (raw) => {
    const request = buildSchema.parse(raw) as BuildRequest;
    coordinator.acquire('building');
    try {
      return await builds.build(request);
    } finally {
      coordinator.release('building');
    }
  });
  handle(IPC.BUILD_CANCEL, () => builds.cancel());
  handle(IPC.RUN_START, (raw) => runs.start(runSchema.parse(raw) as RunRequest));
  handle(IPC.RUN_STOP, () => runs.stop());
  handle(IPC.TEST_LOAD, (root, target) => tests.load(pathSchema.parse(root), pathSchema.parse(target)));
  handle(IPC.TEST_SAVE, (root, suite) => tests.save(pathSchema.parse(root), testSuiteSchema.parse(suite) as TestSuiteV1));
  handle(IPC.TEST_IMPORT_FILES, async () => testImportResultSchema.parse(await sampleFiles.importFiles()));
  handle(IPC.TEST_EXPORT_FILES, async (suite) => testExportResultSchema.parse(await sampleFiles.exportFiles(testSuiteSchema.parse(suite) as TestSuiteV1)));
  handle(IPC.TEST_RUN, (raw, suite) => testRunner.run(buildSchema.parse(raw) as BuildRequest, testSuiteSchema.parse(suite) as TestSuiteV1));
  handle(IPC.TEST_CANCEL, () => testRunner.cancel());
  handle(IPC.DEBUG_START, (raw) => debuggerService.start(debugStartSchema.parse(raw) as DebugStartRequest));
  handle(IPC.DEBUG_COMMAND, (command) => debuggerService.command(command as DebugCommand));

  const onRunInput = (event: Electron.IpcMainEvent, data: unknown) => {
    const window = getWindow();
    if (!window) return;
    validateSender(event, window);
    runs.input(z.string().parse(data));
  };
  const onRunResize = (event: Electron.IpcMainEvent, cols: unknown, rows: unknown) => {
    const window = getWindow();
    if (!window) return;
    validateSender(event, window);
    runs.resize(z.number().int().positive().parse(cols), z.number().int().positive().parse(rows));
  };
  ipcMain.on(IPC.RUN_INPUT, onRunInput);
  ipcMain.on(IPC.RUN_RESIZE, onRunResize);

  return () => {
    void language.stop();
    for (const channel of channels) ipcMain.removeHandler(channel);
    ipcMain.off(IPC.RUN_INPUT, onRunInput);
    ipcMain.off(IPC.RUN_RESIZE, onRunResize);
  };
}
