import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import type { TerminalEvent, TestSuiteV1 } from '../src/shared/contracts';
import { AccessRegistry } from '../src/main/services/access-registry';
import { BuildService } from '../src/main/services/build-service';
import { CppLanguageAdapter } from '../src/main/services/cpp-adapter';
import { OperationCoordinator } from '../src/main/services/operation-coordinator';
import { ProjectService } from '../src/main/services/project-service';
import { RunService } from '../src/main/services/run-service';
import { TestService } from '../src/main/services/test-service';

const execFileAsync = promisify(execFile);

describe('C++ 训练工作流集成', () => {
  it('构建显式源文件清单的多文件项目', async () => {
    const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), 'starcode-multi-'));
    const access = new AccessRegistry();
    access.approveRoot(rootPath);
    const projects = new ProjectService(access);
    const cpp = new CppLanguageAdapter();
    try {
      const toolchain = await cpp.detectToolchain(true);
      if (!toolchain.ready) return;
      await fs.writeFile(path.join(rootPath, 'main.cpp'), '#include <iostream>\nint twice(int);\nint main(){std::cout << twice(21) << "\\n";}\n');
      await fs.writeFile(path.join(rootPath, 'solve.cpp'), 'int twice(int value){return value * 2;}\n');
      await projects.saveConfig(rootPath, {
        version: 1,
        name: 'multi-file',
        entry: 'main.cpp',
        sources: ['main.cpp', 'solve.cpp'],
        standard: 'c++20',
        includeDirs: [],
        defines: [],
        extraCompilerArgs: [],
        runArgs: [],
        workingDirectory: '.',
      });
      const builds = new BuildService(projects, cpp, () => undefined);
      const build = await builds.build({ rootPath, activeFile: path.join(rootPath, 'main.cpp'), mode: 'release' });
      expect(build.success, build.output).toBe(true);
      const execution = await execFileAsync(build.executablePath!, [], { cwd: rootPath });
      expect(execution.stdout).toBe('42\n');
      expect(build.command).toContain('gnu++20');
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  }, 30000);

  it('支持终端输入并能停止等待输入的进程', async () => {
    const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), 'starcode-run-'));
    const activeFile = path.join(rootPath, 'main.cpp');
    const access = new AccessRegistry();
    access.approveRoot(rootPath);
    const cpp = new CppLanguageAdapter();
    const events: TerminalEvent[] = [];
    const runs = new RunService(
      new BuildService(new ProjectService(access), cpp, () => undefined),
      new OperationCoordinator(),
      (event) => events.push(event),
    );
    try {
      const toolchain = await cpp.detectToolchain(true);
      if (!toolchain.ready) return;
      await fs.writeFile(activeFile, '#include <iostream>\nint main(){int value; if(std::cin >> value) std::cout << value * 2 << "\\n";}\n');
      const firstBuild = await runs.start({ rootPath, activeFile, mode: 'release' });
      expect(firstBuild.success, firstBuild.output).toBe(true);
      runs.input('21\r');
      await waitUntil(() => events.some((event) => event.type === 'exit'));
      expect(events.filter((event) => event.type === 'data').map((event) => event.data).join('')).toContain('42');
      expect(events.find((event) => event.type === 'started')?.startedAt).toEqual(expect.any(Number));
      expect(events.find((event) => event.type === 'exit')?.durationMs).toEqual(expect.any(Number));

      const exitsBeforeStop = events.filter((event) => event.type === 'exit').length;
      const secondBuild = await runs.start({ rootPath, activeFile, mode: 'release' });
      expect(secondBuild.success, secondBuild.output).toBe(true);
      runs.stop();
      await waitUntil(() => events.filter((event) => event.type === 'exit').length > exitsBeforeStop);
    } finally {
      runs.stop();
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  }, 30000);

  it('样例执行耗时不包含构建阶段', async () => {
    const delayedBuild = {
      async build() {
        await new Promise((resolve) => setTimeout(resolve, 600));
        return {
          success: true,
          exitCode: 0,
          executablePath: process.execPath,
          workingDirectory: process.cwd(),
          command: process.execPath,
          output: '',
          diagnostics: [],
          durationMs: 600,
        };
      },
      cancel() { /* nothing to cancel in this deterministic fake build */ },
    } as unknown as BuildService;
    const tests = new TestService(delayedBuild, new OperationCoordinator());
    const suite: TestSuiteV1 = {
      version: 1,
      target: 'main.cpp',
      cases: [{
        id: 'timing',
        name: '计时边界',
        input: 'process.stdout.write("ok\\n");\n',
        expectedOutput: 'ok\n',
        timeoutMs: 2000,
      }],
    };
    const totalStartedAt = Date.now();
    const result = await tests.run({ activeFile: path.join(process.cwd(), 'main.cpp'), mode: 'release' }, suite);
    const totalDuration = Date.now() - totalStartedAt;
    expect(totalDuration).toBeGreaterThanOrEqual(550);
    expect(result.cases[0]?.status).toBe('passed');
    expect(result.cases[0]?.durationMs).toBeLessThan(400);
  }, 10000);

  it('正式样例前运行隐藏的空输入预热点且不返回其结果', async () => {
    const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), 'starcode-warmup-'));
    const hookPath = path.join(rootPath, 'launch-hook.cjs');
    const markerPath = path.join(rootPath, 'launches.txt');
    const previousNodeOptions = process.env.NODE_OPTIONS;
    const previousMarker = process.env.STARCODE_WARMUP_MARKER;
    await fs.writeFile(hookPath, 'require("node:fs").appendFileSync(process.env.STARCODE_WARMUP_MARKER, "launch\\n");\n');
    process.env.NODE_OPTIONS = [previousNodeOptions, `--require=${hookPath}`].filter(Boolean).join(' ');
    process.env.STARCODE_WARMUP_MARKER = markerPath;
    const build = {
      async build() {
        return {
          success: true,
          exitCode: 0,
          executablePath: process.execPath,
          workingDirectory: rootPath,
          command: process.execPath,
          output: '',
          diagnostics: [],
          durationMs: 0,
        };
      },
      cancel() { /* nothing to cancel in this deterministic fake build */ },
    } as unknown as BuildService;
    const tests = new TestService(build, new OperationCoordinator());
    const suite: TestSuiteV1 = {
      version: 1,
      target: 'main.cpp',
      cases: [
        { id: 'first', name: '样例 1', input: 'process.stdout.write("2");\n', expectedOutput: '2', timeoutMs: 2000 },
        { id: 'second', name: '样例 2', input: 'process.stdout.write("4");\n', expectedOutput: '4', timeoutMs: 2000 },
      ],
    };
    try {
      const result = await tests.run({ activeFile: path.join(rootPath, 'main.cpp'), mode: 'release' }, suite);
      const launches = (await fs.readFile(markerPath, 'utf8')).trim().split('\n');
      expect(launches).toHaveLength(3);
      expect(result.cases.map((item) => item.id)).toEqual(['first', 'second']);
      expect(result.cases.every((item) => item.status === 'passed')).toBe(true);
    } finally {
      if (previousNodeOptions === undefined) delete process.env.NODE_OPTIONS;
      else process.env.NODE_OPTIONS = previousNodeOptions;
      if (previousMarker === undefined) delete process.env.STARCODE_WARMUP_MARKER;
      else process.env.STARCODE_WARMUP_MARKER = previousMarker;
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  }, 10000);

  it('区分通过、答案错误、运行错误、超时和输出超限', async () => {
    const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), 'starcode-cases-'));
    const activeFile = path.join(rootPath, 'main.cpp');
    const access = new AccessRegistry();
    access.approveRoot(rootPath);
    const cpp = new CppLanguageAdapter();
    const tests = new TestService(
      new BuildService(new ProjectService(access), cpp, () => undefined),
      new OperationCoordinator(),
    );
    try {
      const toolchain = await cpp.detectToolchain(true);
      if (!toolchain.ready) return;
      await fs.writeFile(activeFile, [
        '#include <iostream>',
        'int main(){',
        '  int value = 0; std::cin >> value;',
        '  if(value == 99) while(true) {}',
        '  if(value == 77) { for(int i = 0; i < 1100000; ++i) std::cout << "x"; return 0; }',
        '  if(value < 0) return 3;',
        '  std::cout << value * 2 << "\\n";',
        '}',
      ].join('\n'));
      const suite: TestSuiteV1 = {
        version: 1,
        target: 'main.cpp',
        cases: [
          { id: 'pass', name: '通过', input: '2\n', expectedOutput: '4\n', timeoutMs: 2000 },
          { id: 'wa', name: '答案错误', input: '3\n', expectedOutput: '7\n', timeoutMs: 2000 },
          { id: 're', name: '运行错误', input: '-1\n', expectedOutput: '', timeoutMs: 2000 },
          { id: 'tle', name: '超时', input: '99\n', expectedOutput: '', timeoutMs: 150 },
          { id: 'overflow', name: '输出超限', input: '77\n', expectedOutput: '', timeoutMs: 5000 },
        ],
      };
      const result = await tests.run({ rootPath, activeFile, mode: 'release' }, suite);
      expect(result.build.success, result.build.output).toBe(true);
      expect(Object.fromEntries(result.cases.map((item) => [item.id, item.status]))).toEqual({
        pass: 'passed',
        wa: 'wrong-answer',
        re: 'runtime-error',
        tle: 'timeout',
        overflow: 'runtime-error',
      });
      expect(result.cases.find((item) => item.id === 'wa')?.firstDifferenceLine).toBe(1);
      expect(result.cases.find((item) => item.id === 'overflow')?.stderr).toContain('输出超过 1 MB 限制');
    } finally {
      tests.cancel();
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  }, 30000);
});

async function waitUntil(predicate: () => boolean, timeoutMs = 10000): Promise<void> {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) throw new Error('等待进程事件超时。');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
