import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import path from 'node:path';
import type { BuildRequest, TestCaseResult, TestRunResult, TestSuiteV1 } from '../../shared/contracts';
import { BuildService } from './build-service';
import { OperationCoordinator } from './operation-coordinator';
import { killProcessTree } from './process-utils';

const OUTPUT_LIMIT = 1024 * 1024;
const WARMUP_CASE: TestSuiteV1['cases'][number] = {
  id: '__starcode_warmup__',
  name: '隐藏预热测试点',
  input: '',
  expectedOutput: '',
  timeoutMs: 2000,
};

export function normalizeOutput(value: string): string {
  const lines = value.replaceAll('\r\n', '\n').replaceAll('\r', '\n').split('\n').map((line) => line.replace(/[\t ]+$/u, ''));
  while (lines.length && lines.at(-1) === '') lines.pop();
  return lines.join('\n');
}

export function firstDifferenceLine(expected: string, actual: string): number | undefined {
  const expectedLines = normalizeOutput(expected).split('\n');
  const actualLines = normalizeOutput(actual).split('\n');
  const length = Math.max(expectedLines.length, actualLines.length);
  for (let index = 0; index < length; index += 1) {
    if (expectedLines[index] !== actualLines[index]) return index + 1;
  }
  return undefined;
}

export class TestService {
  private child?: ChildProcessWithoutNullStreams;
  private cancelled = false;

  constructor(
    private readonly builds: BuildService,
    private readonly coordinator: OperationCoordinator,
  ) {}

  async run(request: BuildRequest, suite: TestSuiteV1): Promise<TestRunResult> {
    this.coordinator.acquire('testing');
    this.cancelled = false;
    try {
      const build = await this.builds.build({ ...request, mode: 'release' });
      const cases: TestCaseResult[] = [];
      if (!build.success || !build.executablePath) return { build, cases };
      const workingDirectory = build.workingDirectory || request.rootPath || path.dirname(request.activeFile);
      if (suite.cases.length > 0 && !this.cancelled) {
        // Consume one-time OS executable validation and cold-start work without exposing a fake result.
        await this.runCase(build.executablePath, workingDirectory, WARMUP_CASE);
      }
      for (const testCase of suite.cases) {
        if (this.cancelled) {
          cases.push({ id: testCase.id, status: 'cancelled', actualOutput: '', stderr: '', exitCode: null, durationMs: 0 });
          continue;
        }
        cases.push(await this.runCase(build.executablePath, workingDirectory, testCase));
      }
      return { build, cases };
    } finally {
      this.child = undefined;
      this.coordinator.release('testing');
    }
  }

  cancel(): void {
    this.cancelled = true;
    this.builds.cancel();
    killProcessTree(this.child?.pid);
  }

  private runCase(executablePath: string, cwd: string, testCase: TestSuiteV1['cases'][number]): Promise<TestCaseResult> {
    return new Promise((resolve) => {
      let startedAt: bigint | undefined;
      let timer: NodeJS.Timeout | undefined;
      let stdout = '';
      let stderr = '';
      let outputBytes = 0;
      let timedOut = false;
      let outputOverflow = false;
      let settled = false;
      const finish = (exitCode: number | null) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        if (this.child === child) this.child = undefined;
        const actual = normalizeOutput(stdout);
        const expected = normalizeOutput(testCase.expectedOutput);
        const status = this.cancelled
          ? 'cancelled'
          : timedOut
            ? 'timeout'
            : exitCode !== 0 || outputOverflow
              ? 'runtime-error'
              : actual === expected
                ? 'passed'
                : 'wrong-answer';
        resolve({
          id: testCase.id,
          status,
          actualOutput: stdout,
          stderr: outputOverflow ? `${stderr}\n输出超过 1 MB 限制。` : stderr,
          exitCode,
          durationMs: startedAt === undefined ? 0 : Number((process.hrtime.bigint() - startedAt) / 1_000_000n),
          firstDifferenceLine: status === 'wrong-answer' ? firstDifferenceLine(expected, actual) : undefined,
        });
      };
      const child = spawn(executablePath, [], {
        cwd,
        shell: false,
        windowsHide: true,
        detached: process.platform !== 'win32',
      });
      this.child = child;
      const consume = (data: Buffer, target: 'stdout' | 'stderr') => {
        const remaining = Math.max(0, OUTPUT_LIMIT - outputBytes);
        if (remaining > 0) {
          const text = data.subarray(0, remaining).toString('utf8');
          if (target === 'stdout') stdout += text;
          else stderr += text;
        }
        outputBytes += data.length;
        if (outputBytes > OUTPUT_LIMIT && !outputOverflow) {
          outputOverflow = true;
          killProcessTree(child.pid);
        }
      };
      child.stdout.on('data', (data: Buffer) => consume(data, 'stdout'));
      child.stderr.on('data', (data: Buffer) => consume(data, 'stderr'));
      child.once('spawn', () => {
        startedAt = process.hrtime.bigint();
        timer = setTimeout(() => {
          timedOut = true;
          killProcessTree(child.pid);
        }, Math.max(100, testCase.timeoutMs));
        child.stdin.end(testCase.input);
      });
      child.once('error', (error) => {
        stderr += error.message;
        finish(null);
      });
      child.once('close', (code) => finish(code));
    });
  }
}
