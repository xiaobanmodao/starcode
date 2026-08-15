import * as pty from 'node-pty';
import path from 'node:path';
import type {
  BuildResult,
  DebugCommand,
  DebugEvent,
  DebugSnapshot,
  DebugStartRequest,
  SourceBreakpoints,
} from '../../shared/contracts';
import { DapClient, type DapEvent, type DapRequest } from '../debug/dap-client';
import { BuildService } from './build-service';
import { CppLanguageAdapter } from './cpp-adapter';
import { OperationCoordinator } from './operation-coordinator';

interface DapThreads { threads?: Array<{ id: number; name: string }> }
interface DapStackTrace { stackFrames?: DebugSnapshot['frames'] }
interface DapScopes { scopes?: DebugSnapshot['scopes'] }
interface DapVariables { variables?: DebugSnapshot['variables'] }

export class DebugService {
  private client?: DapClient;
  private terminal?: pty.IPty;

  constructor(
    private readonly builds: BuildService,
    private readonly cpp: CppLanguageAdapter,
    private readonly coordinator: OperationCoordinator,
    private readonly emit: (event: DebugEvent) => void,
  ) {}

  async start(request: DebugStartRequest): Promise<BuildResult> {
    this.coordinator.acquire('debugging');
    try {
      const build = await this.builds.build({ ...request, mode: 'debug' });
      if (!build.success || !build.executablePath) {
        this.coordinator.release('debugging');
        return build;
      }
      const debuggerInfo = await this.cpp.debuggerCommand();
      const cwd = build.workingDirectory || request.rootPath || path.dirname(request.activeFile);
      const client = new DapClient();
      this.client = client;
      client.on('adapterOutput', (text: string) => this.emit({ type: 'output', text }));
      if (process.env.STARCODE_DAP_TRACE === '1') {
        client.on('protocol', (message: unknown) => this.emit({ type: 'output', text: `[DAP] ${JSON.stringify(message)}\n` }));
        client.on('protocolOut', (message: unknown) => this.emit({ type: 'output', text: `[DAP ->] ${JSON.stringify(message)}\n` }));
      }
      client.on('event', (event: DapEvent) => this.handleEvent(event));
      client.on('request', (dapRequest: DapRequest) => this.handleReverseRequest(dapRequest, cwd, debuggerInfo.environment));
      client.on('close', () => this.finish());
      client.start(debuggerInfo.command, debuggerInfo.args, cwd, debuggerInfo.environment);

      await client.request('initialize', {
        clientID: 'starcode',
        clientName: 'StarCode',
        adapterID: debuggerInfo.kind,
        pathFormat: 'path',
        linesStartAt1: true,
        columnsStartAt1: true,
        supportsVariableType: true,
        // LLDB's runInTerminal launcher attaches to a sibling process on
        // macOS, which fails while system developer mode is disabled. LLDB's
        // internal console launches the target directly and does not require
        // that machine-wide setting. Keep the PTY path for Windows/GDB.
        supportsRunInTerminalRequest: process.platform === 'win32',
      });
      const initialized = client.waitForEvent('initialized');
      const launch = client.request('launch', {
        program: build.executablePath,
        cwd,
        args: request.args ?? [],
        stopOnEntry: false,
        ...(process.platform === 'darwin' ? { disableASLR: false } : {}),
        ...(process.platform === 'win32' ? { console: 'integratedTerminal' } : {}),
      }, 30000).then(
        () => ({ error: undefined }),
        (error: unknown) => ({ error }),
      );
      await initialized;
      await this.applyBreakpoints(request.breakpoints);
      await client.request('configurationDone');
      const launchResult = await launch;
      if (launchResult.error) throw launchResult.error;
      this.emit({ type: 'started' });
      return build;
    } catch (error) {
      this.client?.terminate();
      this.client = undefined;
      this.coordinator.release('debugging');
      this.emit({ type: 'error', text: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }

  async command(command: DebugCommand): Promise<unknown> {
    if (command.type === 'input') {
      this.terminal?.write(command.data);
      return undefined;
    }
    if (command.type === 'disconnect') {
      try {
        await this.client?.request('disconnect', { terminateDebuggee: true }, 5000);
      } finally {
        this.client?.terminate();
        this.finish();
      }
      return undefined;
    }
    if (!this.client) throw new Error('当前没有调试会话。');
    if (command.type === 'setBreakpoints') return this.applyBreakpoints(command.breakpoints);
    if (command.type === 'snapshot') return this.snapshot(command.threadId);
    if (command.type === 'evaluate') {
      return this.client.request('evaluate', { expression: command.expression, frameId: command.frameId, context: 'watch' });
    }
    return this.client.request(command.type, { threadId: command.threadId });
  }

  private async applyBreakpoints(breakpoints: SourceBreakpoints[]): Promise<void> {
    if (!this.client) return;
    for (const source of breakpoints) {
      await this.client.request('setBreakpoints', {
        source: { path: source.path, name: path.basename(source.path) },
        breakpoints: source.lines.map((line) => ({ line })),
        sourceModified: false,
      });
    }
  }

  private async snapshot(requestedThreadId?: number): Promise<DebugSnapshot> {
    if (!this.client) throw new Error('当前没有调试会话。');
    const threadResponse = await this.client.request<DapThreads>('threads');
    const threads = threadResponse.threads ?? [];
    const selectedThreadId = requestedThreadId ?? threads[0]?.id;
    if (!selectedThreadId) return { threads, frames: [], scopes: [], variables: [] };
    const frameResponse = await this.client.request<DapStackTrace>('stackTrace', { threadId: selectedThreadId, startFrame: 0, levels: 50 });
    const frames = frameResponse.stackFrames ?? [];
    const selectedFrameId = frames[0]?.id;
    if (selectedFrameId === undefined) return { threads, frames, scopes: [], variables: [], selectedThreadId };
    const scopeResponse = await this.client.request<DapScopes>('scopes', { frameId: selectedFrameId });
    const scopes = scopeResponse.scopes ?? [];
    const inexpensiveScopes = scopes.filter((scope) => !scope.expensive);
    const localScopes = inexpensiveScopes.filter((scope) => /local|局部/iu.test(scope.name));
    const scopesToDisplay = localScopes.length ? localScopes : inexpensiveScopes.slice(0, 1);
    const variableGroups = await Promise.all(
      scopesToDisplay.map((scope) => this.client!.request<DapVariables>('variables', { variablesReference: scope.variablesReference })),
    );
    return {
      threads,
      frames,
      scopes,
      variables: variableGroups.flatMap((group) => group.variables ?? []),
      selectedThreadId,
      selectedFrameId,
    };
  }

  private handleEvent(event: DapEvent): void {
    if (event.event === 'initialized') this.emit({ type: 'initialized', body: event.body });
    else if (event.event === 'stopped') this.emit({ type: 'stopped', body: event.body });
    else if (event.event === 'continued') this.emit({ type: 'continued', body: event.body });
    else if (event.event === 'output') this.emit({ type: 'output', body: event.body, text: String(event.body?.output ?? '') });
    else if (event.event === 'terminated' || event.event === 'exited') {
      this.emit({ type: 'terminated', body: event.body });
      this.finish();
    }
  }

  private handleReverseRequest(request: DapRequest, fallbackCwd: string, fallbackEnvironment: NodeJS.ProcessEnv): void {
    if (request.command !== 'runInTerminal') {
      this.client?.respond(request, false, undefined, `不支持调试器请求 ${request.command}`);
      return;
    }
    const args = Array.isArray(request.arguments?.args) ? request.arguments?.args.map(String) : [];
    const executable = args.shift();
    if (!executable) {
      this.client?.respond(request, false, undefined, 'runInTerminal 缺少可执行文件。');
      return;
    }
    try {
      this.terminal = pty.spawn(executable, args, {
        name: 'xterm-256color',
        cols: 100,
        rows: 28,
        cwd: typeof request.arguments?.cwd === 'string' ? request.arguments.cwd : fallbackCwd,
        env: { ...fallbackEnvironment, ...(request.arguments?.env as Record<string, string> | undefined), LANG: 'C.UTF-8' } as Record<string, string>,
        useConpty: process.platform === 'win32',
      });
      this.terminal.onData((data) => this.emit({ type: 'output', text: data }));
      this.terminal.onExit(({ exitCode, signal }) => {
        if (process.env.STARCODE_DAP_TRACE === '1') this.emit({ type: 'output', text: `[PTY exit] code=${exitCode} signal=${signal}\n` });
      });
      // The process created here is LLDB's terminal launcher, not the program
      // being debugged. Reporting it as `processId` makes lldb-dap attach to
      // the launcher itself and eventually time out. The launcher communicates
      // the real target pid back through its --comm-file, so only expose the
      // terminal/shell pid in the DAP response.
      this.client?.respond(request, true, { shellProcessId: this.terminal.pid });
    } catch (error) {
      this.client?.respond(request, false, undefined, error instanceof Error ? error.message : String(error));
    }
  }

  private finish(): void {
    this.terminal?.kill();
    this.terminal = undefined;
    this.client = undefined;
    this.coordinator.release('debugging');
  }
}
