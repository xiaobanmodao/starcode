import * as pty from 'node-pty';
import path from 'node:path';
import type { BuildResult, RunRequest, TerminalEvent } from '../../shared/contracts';
import { BuildService } from './build-service';
import { OperationCoordinator } from './operation-coordinator';

export class RunService {
  private terminal?: pty.IPty;
  private startedAt?: number;

  constructor(
    private readonly builds: BuildService,
    private readonly coordinator: OperationCoordinator,
    private readonly emit: (event: TerminalEvent) => void,
  ) {}

  async start(request: RunRequest): Promise<BuildResult> {
    this.coordinator.acquire('running');
    try {
      const result = await this.builds.build({ ...request, mode: 'release' });
      if (!result.success || !result.executablePath) {
        this.coordinator.release('running');
        return result;
      }
      const cwd = result.workingDirectory || request.rootPath || path.dirname(request.activeFile);
      this.terminal = pty.spawn(result.executablePath, request.args ?? [], {
        name: 'xterm-256color',
        cols: 100,
        rows: 28,
        cwd,
        env: { ...process.env, LANG: 'C.UTF-8' } as Record<string, string>,
        useConpty: process.platform === 'win32',
      });
      this.startedAt = Date.now();
      this.emit({ type: 'started', startedAt: this.startedAt });
      this.terminal.onData((data) => this.emit({ type: 'data', data }));
      this.terminal.onExit(({ exitCode }) => {
        const durationMs = this.startedAt === undefined ? undefined : Date.now() - this.startedAt;
        this.terminal = undefined;
        this.startedAt = undefined;
        this.emit({ type: 'exit', exitCode, durationMs });
        this.coordinator.release('running');
      });
      return result;
    } catch (error) {
      this.startedAt = undefined;
      this.coordinator.release('running');
      this.emit({ type: 'error', data: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }

  input(data: string): void {
    this.terminal?.write(data);
  }

  resize(cols: number, rows: number): void {
    if (this.terminal && cols > 0 && rows > 0) this.terminal.resize(cols, rows);
  }

  stop(): void {
    this.builds.cancel();
    try {
      this.terminal?.kill();
    } finally {
      if (!this.terminal) this.coordinator.release('running');
    }
  }
}
