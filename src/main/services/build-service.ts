import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { BuildEvent, BuildRequest, BuildResult } from '../../shared/contracts';
import { CppLanguageAdapter } from './cpp-adapter';
import { displayCommand, killProcessTree } from './process-utils';
import { ProjectService } from './project-service';

export class BuildService {
  private child?: ChildProcessWithoutNullStreams;

  constructor(
    private readonly projects: ProjectService,
    private readonly cpp: CppLanguageAdapter,
    private readonly emit: (event: BuildEvent) => void,
  ) {}

  async build(request: BuildRequest): Promise<BuildResult> {
    const startedAt = Date.now();
    const rootPath = request.rootPath || path.dirname(request.activeFile);
    const config = request.rootPath ? await this.projects.loadConfig(rootPath) : null;
    const plan = await this.cpp.createBuildPlan({ ...request, rootPath, config });
    const command = displayCommand(plan.compiler, plan.args);
    await fs.mkdir(path.join(rootPath, '.starcode'), { recursive: true });
    const ignorePath = path.join(rootPath, '.starcode', '.gitignore');
    await fs.writeFile(ignorePath, 'build/\n', { encoding: 'utf8' });
    this.emit({ type: 'started', text: command });

    return new Promise<BuildResult>((resolve) => {
      let output = '';
      let settled = false;
      const finish = (exitCode: number | null, spawnError?: Error) => {
        if (settled) return;
        settled = true;
        this.child = undefined;
        if (spawnError) output += `${spawnError.message}\n`;
        const result: BuildResult = {
          success: exitCode === 0 && !spawnError,
          exitCode,
          executablePath: exitCode === 0 ? plan.executablePath : undefined,
          workingDirectory: plan.runtimeCwd,
          command,
          output,
          diagnostics: this.cpp.parseDiagnostics(output, rootPath),
          durationMs: Date.now() - startedAt,
        };
        this.emit({ type: 'finished', result });
        resolve(result);
      };
      try {
        this.child = spawn(plan.compiler, plan.args, {
          cwd: plan.cwd,
          env: plan.environment,
          shell: false,
          windowsHide: true,
          detached: process.platform !== 'win32',
        });
        const consume = (data: Buffer) => {
          const text = data.toString('utf8');
          output += text;
          this.emit({ type: 'output', text });
        };
        this.child.stdout.on('data', consume);
        this.child.stderr.on('data', consume);
        this.child.once('error', (error) => finish(null, error));
        this.child.once('close', (code) => finish(code));
      } catch (error) {
        finish(null, error as Error);
      }
    });
  }

  cancel(): void {
    killProcessTree(this.child?.pid);
  }
}
