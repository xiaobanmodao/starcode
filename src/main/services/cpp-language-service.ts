import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import type {
  Diagnostic,
  FormatRequest,
  LanguageDocument,
  LanguageEvent,
  LanguageRequest,
  LanguageServiceStatus,
} from '../../shared/contracts';
import { LspClient } from '../language/lsp-client';
import { CppLanguageAdapter } from './cpp-adapter';
import { ProjectService } from './project-service';

type LspDiagnostic = {
  range?: { start?: { line?: number; character?: number } };
  severity?: number;
  code?: string | number;
  source?: string;
  message?: string;
};

const fallbackStyle = '{BasedOnStyle: LLVM, IndentWidth: 4, TabWidth: 4, UseTab: Never, ColumnLimit: 0}';

export class CppLanguageService {
  private client?: LspClient;
  private rootPath?: string;
  private activeFile?: string;
  private stopping = false;
  private readonly openDocuments = new Map<string, LanguageDocument>();
  private status: LanguageServiceStatus = { state: 'stopped', message: 'C++ 智能提示已关闭。' };

  constructor(
    private readonly projects: ProjectService,
    private readonly cpp: CppLanguageAdapter,
    private readonly emit: (event: LanguageEvent) => void,
  ) {}

  getStatus(): LanguageServiceStatus {
    return this.status;
  }

  async open(document: LanguageDocument): Promise<LanguageServiceStatus> {
    await this.ensureStarted(document);
    const previous = this.openDocuments.get(document.path);
    this.openDocuments.set(document.path, document);
    if (!previous) {
      this.client?.notify('textDocument/didOpen', {
        textDocument: {
          uri: pathToFileURL(document.path).href,
          languageId: 'cpp',
          version: document.version,
          text: document.text,
        },
      });
    } else if (document.version > previous.version || document.text !== previous.text) {
      await this.change(document);
    }
    return this.status;
  }

  async change(document: LanguageDocument): Promise<void> {
    if (!this.client || !this.openDocuments.has(document.path)) return;
    this.openDocuments.set(document.path, document);
    this.client.notify('textDocument/didChange', {
      textDocument: { uri: pathToFileURL(document.path).href, version: document.version },
      contentChanges: [{ text: document.text }],
    });
  }

  async save(document: LanguageDocument): Promise<void> {
    if (!this.client || !this.openDocuments.has(document.path)) return;
    this.openDocuments.set(document.path, document);
    this.client.notify('textDocument/didSave', {
      textDocument: { uri: pathToFileURL(document.path).href },
      text: document.text,
    });
  }

  async close(filePath: string): Promise<void> {
    if (!this.openDocuments.delete(filePath)) return;
    this.client?.notify('textDocument/didClose', { textDocument: { uri: pathToFileURL(filePath).href } });
    this.emit({ type: 'diagnostics', path: filePath, diagnostics: [] });
  }

  async request(request: LanguageRequest): Promise<unknown> {
    if (!this.client || this.status.state === 'error' || this.status.state === 'stopped') return null;
    return this.client.request(request.method, request.params);
  }

  async restart(document: LanguageDocument): Promise<LanguageServiceStatus> {
    const documents = [...this.openDocuments.values()];
    if (!documents.some((item) => item.path === document.path)) documents.push(document);
    await this.stop(false);
    await this.start(document, true);
    for (const item of documents) {
      this.openDocuments.set(item.path, item);
      this.client?.notify('textDocument/didOpen', {
        textDocument: { uri: pathToFileURL(item.path).href, languageId: 'cpp', version: item.version, text: item.text },
      });
    }
    return this.status;
  }

  async stop(clearDocuments = true): Promise<void> {
    this.stopping = true;
    const client = this.client;
    this.client = undefined;
    if (client) await client.shutdown();
    this.rootPath = undefined;
    this.activeFile = undefined;
    if (clearDocuments) this.openDocuments.clear();
    this.setStatus({ state: 'stopped', message: 'C++ 智能提示已关闭。' });
    this.stopping = false;
  }

  async format(request: FormatRequest): Promise<string> {
    const toolchain = await this.cpp.detectToolchain();
    if (!toolchain.formatterReady || !toolchain.formatterPath) throw new Error('未找到 clang-format，请在 C++ 设置中重新检测工具链。');
    const hasProjectStyle = await this.hasFormatConfig(request.path);
    const args = [
      `--assume-filename=${request.path}`,
      hasProjectStyle ? '--style=file' : `--style=${fallbackStyle}`,
      ...(request.range ? [`--lines=${request.range.startLine}:${request.range.endLine}`] : []),
    ];
    const environment = await this.cpp.languageEnvironment();
    return new Promise<string>((resolve, reject) => {
      const child = spawn(toolchain.formatterPath!, args, {
        cwd: path.dirname(request.path),
        env: environment,
        shell: false,
        windowsHide: true,
      });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8'); });
      child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8'); });
      child.once('error', reject);
      child.once('close', (code) => {
        if (code === 0) resolve(stdout);
        else reject(new Error(stderr.trim() || `clang-format 已退出（代码 ${code ?? 'unknown'}）。`));
      });
      child.stdin.end(request.text, 'utf8');
    });
  }

  private async hasFormatConfig(filePath: string): Promise<boolean> {
    let directory = path.dirname(filePath);
    while (true) {
      for (const name of ['.clang-format', '_clang-format']) {
        if (await fs.access(path.join(directory, name)).then(() => true).catch(() => false)) return true;
      }
      const parent = path.dirname(directory);
      if (parent === directory) return false;
      directory = parent;
    }
  }

  private async ensureStarted(document: LanguageDocument): Promise<void> {
    const nextRoot = document.rootPath || path.dirname(document.path);
    if (this.client && this.rootPath === nextRoot) return;
    if (this.client) await this.stop(true);
    await this.start(document, false);
  }

  private async start(document: LanguageDocument, forceToolchain: boolean): Promise<void> {
    const rootPath = document.rootPath || path.dirname(document.path);
    this.rootPath = rootPath;
    this.activeFile = document.path;
    this.setStatus({ state: 'starting', message: '正在启动 clangd…', rootPath });
    try {
      const status = await this.cpp.detectToolchain(forceToolchain);
      if (!status.languageServerReady || !status.languageServerPath || !status.compilerPath) {
        throw new Error('未找到 clangd，请在 C++ 设置中检查工具链。');
      }
      const config = document.rootPath ? await this.projects.loadConfig(rootPath) : null;
      const commands = await this.cpp.createCompilationCommands({ rootPath, activeFile: document.path, config });
      const databaseDirectory = path.join(rootPath, '.starcode', 'build', 'language');
      await fs.mkdir(databaseDirectory, { recursive: true });
      await fs.writeFile(path.join(databaseDirectory, 'compile_commands.json'), `${JSON.stringify(commands, null, 2)}\n`, 'utf8');

      const client = new LspClient();
      this.client = client;
      client.on('log', (text: string) => this.emit({ type: 'log', text }));
      client.on('notification', (method: string, params: Record<string, unknown>) => this.onNotification(method, params));
      client.on('close', () => {
        if (!this.stopping) this.setStatus({ state: 'error', message: 'clangd 意外退出，请点击状态栏重新启动。', rootPath });
      });
      client.start(status.languageServerPath, [
        `--compile-commands-dir=${databaseDirectory}`,
        `--query-driver=${status.compilerPath}`,
        '--background-index',
        '--clang-tidy=false',
        '--log=error',
      ], rootPath, await this.cpp.languageEnvironment());
      await client.request('initialize', {
        processId: process.pid,
        rootUri: pathToFileURL(rootPath).href,
        capabilities: {
          workspace: { configuration: true, workspaceFolders: true },
          textDocument: {
            completion: { completionItem: { snippetSupport: true, documentationFormat: ['markdown', 'plaintext'] } },
            hover: { contentFormat: ['markdown', 'plaintext'] },
            signatureHelp: { signatureInformation: { documentationFormat: ['markdown', 'plaintext'] } },
            publishDiagnostics: { relatedInformation: true },
            documentSymbol: { hierarchicalDocumentSymbolSupport: true },
          },
        },
        workspaceFolders: [{ uri: pathToFileURL(rootPath).href, name: path.basename(rootPath) }],
      }, 20000);
      client.notify('initialized');
      this.setStatus({
        state: 'ready',
        message: 'C++ 智能提示已就绪。',
        rootPath,
        serverPath: status.languageServerPath,
        serverVersion: status.languageServerVersion,
      });
    } catch (error) {
      this.client?.terminate();
      this.client = undefined;
      this.setStatus({ state: 'error', message: error instanceof Error ? error.message : String(error), rootPath });
      throw error;
    }
  }

  private onNotification(method: string, params: Record<string, unknown>): void {
    if (method === 'textDocument/publishDiagnostics') {
      const uri = typeof params.uri === 'string' ? params.uri : undefined;
      if (!uri) return;
      let filePath: string;
      try { filePath = fileURLToPath(uri); } catch { return; }
      const diagnostics = (Array.isArray(params.diagnostics) ? params.diagnostics : []).map((raw) => this.toDiagnostic(filePath, raw as LspDiagnostic));
      this.emit({ type: 'diagnostics', path: filePath, diagnostics });
      return;
    }
    if (method === '$/progress') {
      const value = params.value as { kind?: string; title?: string; message?: string } | undefined;
      if (value?.kind === 'begin' || value?.kind === 'report') {
        this.setStatus({ ...this.status, state: 'indexing', message: value.message || value.title || '正在建立 C++ 索引…' });
      } else if (value?.kind === 'end') {
        this.setStatus({ ...this.status, state: 'ready', message: 'C++ 智能提示已就绪。' });
      }
    }
  }

  private toDiagnostic(filePath: string, raw: LspDiagnostic): Diagnostic {
    const severity = raw.severity === 1 ? 'error' : raw.severity === 2 ? 'warning' : 'note';
    return {
      file: filePath,
      line: (raw.range?.start?.line ?? 0) + 1,
      column: (raw.range?.start?.character ?? 0) + 1,
      severity,
      message: raw.message || '未知诊断',
      source: 'clangd',
      code: raw.code === undefined ? undefined : String(raw.code),
    };
  }

  private setStatus(status: LanguageServiceStatus): void {
    this.status = status;
    this.emit({ type: 'status', status });
  }
}
