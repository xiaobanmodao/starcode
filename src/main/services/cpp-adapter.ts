import { app } from 'electron';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { Diagnostic, ProjectConfigV1, ToolchainStatus } from '../../shared/contracts';
import type { BuildPlan, LanguageAdapter } from './language-adapter';

const execFileAsync = promisify(execFile);

function quote(value: string): string {
  return /\s/.test(value) ? `"${value.replaceAll('"', '\\"')}"` : value;
}

async function versionOf(command: string, args: string[] = ['--version']): Promise<string | undefined> {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, { timeout: 5000 });
    return `${stdout}${stderr}`.split(/\r?\n/)[0]?.trim();
  } catch {
    return undefined;
  }
}

async function findOnPath(command: string): Promise<string | undefined> {
  try {
    const finder = process.platform === 'win32' ? 'where.exe' : 'which';
    const { stdout } = await execFileAsync(finder, [command]);
    return stdout.split(/\r?\n/)[0]?.trim() || undefined;
  } catch {
    return undefined;
  }
}

async function probeCompiler(command: string, env: NodeJS.ProcessEnv = process.env): Promise<boolean> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'starcode-probe-'));
  const source = path.join(directory, 'probe.cpp');
  try {
    await fs.writeFile(source, '#include <iostream>\nint main(){std::cout << 1;}\n', 'utf8');
    await execFileAsync(command, ['-std=c++17', '-fsyntax-only', source], { timeout: 10000, env });
    return true;
  } catch {
    return false;
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

async function macDeveloperModeEnabled(): Promise<boolean> {
  try {
    const { stdout, stderr } = await execFileAsync('/usr/sbin/DevToolsSecurity', ['-status'], { timeout: 5000 });
    return /currently enabled/i.test(`${stdout}${stderr}`);
  } catch {
    return false;
  }
}

export class CppLanguageAdapter implements LanguageAdapter {
  readonly id = 'cpp';
  readonly extensions = ['.cpp', '.cc', '.cxx'];
  private cachedStatus?: ToolchainStatus;
  private macDeveloperDir?: string;
  private macSdkRoot?: string;

  private windowsToolchainRoot(): string {
    const configured = process.env.STARCODE_TOOLCHAIN_ROOT;
    if (configured) return configured;
    const base = app?.isPackaged ? process.resourcesPath : path.join(app?.getAppPath?.() ?? process.cwd(), 'resources');
    return path.join(base, 'toolchains', 'windows-x64');
  }

  private compatibilityIncludeRoot(): string | undefined {
    if (process.platform !== 'darwin') return undefined;
    const base = app?.isPackaged ? process.resourcesPath : path.join(app?.getAppPath?.() ?? process.cwd(), 'resources');
    return path.join(base, 'cpp-compat', 'include');
  }

  async detectToolchain(force = false): Promise<ToolchainStatus> {
    if (this.cachedStatus && !force) return this.cachedStatus;
    if (process.platform === 'win32') {
      const root = this.windowsToolchainRoot();
      const bundledCompiler = path.join(root, 'bin', 'g++.exe');
      const bundledDebugger = path.join(root, 'bin', 'gdb.exe');
      const bundledLanguageServer = path.join(root, 'bin', 'clangd.exe');
      const bundledFormatter = path.join(root, 'bin', 'clang-format.exe');
      const compilerPath = await fs.access(bundledCompiler).then(() => bundledCompiler).catch(() => findOnPath('g++.exe'));
      const debuggerPath = await fs.access(bundledDebugger).then(() => bundledDebugger).catch(() => findOnPath('gdb.exe'));
      const languageServerPath = await fs.access(bundledLanguageServer).then(() => bundledLanguageServer).catch(() => findOnPath('clangd.exe'));
      const formatterPath = await fs.access(bundledFormatter).then(() => bundledFormatter).catch(() => findOnPath('clang-format.exe'));
      const ready = Boolean(compilerPath && await probeCompiler(compilerPath));
      this.cachedStatus = {
        platform: process.platform,
        compilerPath,
        debuggerPath,
        compilerVersion: compilerPath ? await versionOf(compilerPath) : undefined,
        debuggerVersion: debuggerPath ? await versionOf(debuggerPath) : undefined,
        debuggerReady: Boolean(debuggerPath),
        debuggerMessage: debuggerPath ? 'GDB 已就绪。' : '缺少 GDB，调试暂不可用。',
        languageServerPath,
        languageServerVersion: languageServerPath ? await versionOf(languageServerPath) : undefined,
        languageServerReady: Boolean(languageServerPath),
        formatterPath,
        formatterVersion: formatterPath ? await versionOf(formatterPath) : undefined,
        formatterReady: Boolean(formatterPath),
        ready,
        bundled: compilerPath === bundledCompiler,
        message: ready
          ? debuggerPath ? 'MinGW-w64 GCC/GDB 已就绪。' : 'GCC 已就绪，但缺少 GDB，调试暂不可用。'
          : compilerPath ? '找到了 GCC，但标准库编译探针失败，请重新准备内置工具链。' : '未找到内置工具链，请运行 npm run toolchain:windows。',
      };
      return this.cachedStatus;
    }

    let compilerPath: string | undefined;
    let debuggerPath: string | undefined;
    let languageServerPath: string | undefined;
    let formatterPath: string | undefined;
    this.macDeveloperDir = undefined;
    this.macSdkRoot = undefined;
    try {
      compilerPath = (await execFileAsync('xcrun', ['--find', 'clang++'])).stdout.trim();
      debuggerPath = (await execFileAsync('xcrun', ['--find', 'lldb-dap'])).stdout.trim();
      languageServerPath = (await execFileAsync('xcrun', ['--find', 'clangd'])).stdout.trim();
      formatterPath = (await execFileAsync('xcrun', ['--find', 'clang-format'])).stdout.trim();
    } catch {
      compilerPath = await findOnPath('clang++');
      debuggerPath = await findOnPath('lldb-dap');
      languageServerPath = await findOnPath('clangd');
      formatterPath = await findOnPath('clang-format');
    }
    let ready = Boolean(compilerPath && await probeCompiler(compilerPath));
    if (!ready) {
      const commandLineToolsRoot = '/Library/Developer/CommandLineTools';
      const commandLineToolsCompiler = path.join(commandLineToolsRoot, 'usr', 'bin', 'clang++');
      const commandLineToolsDebugger = path.join(commandLineToolsRoot, 'usr', 'bin', 'lldb-dap');
      const commandLineToolsLanguageServer = path.join(commandLineToolsRoot, 'usr', 'bin', 'clangd');
      const commandLineToolsFormatter = path.join(commandLineToolsRoot, 'usr', 'bin', 'clang-format');
      const sdkRoot = await execFileAsync('/usr/bin/xcrun', ['--sdk', 'macosx', '--show-sdk-path'], {
        env: { ...process.env, DEVELOPER_DIR: commandLineToolsRoot },
        timeout: 5000,
      }).then(({ stdout }) => stdout.trim()).catch(() => undefined);
      const commandLineToolsEnv = {
        ...process.env,
        DEVELOPER_DIR: commandLineToolsRoot,
        ...(sdkRoot ? { SDKROOT: sdkRoot } : {}),
      };
      const commandLineToolsReady = await fs.access(commandLineToolsCompiler)
        .then(() => probeCompiler(commandLineToolsCompiler, commandLineToolsEnv))
        .catch(() => false);
      if (commandLineToolsReady) {
        compilerPath = commandLineToolsCompiler;
        debuggerPath = await fs.access(commandLineToolsDebugger).then(() => commandLineToolsDebugger).catch(() => undefined);
        languageServerPath = await fs.access(commandLineToolsLanguageServer).then(() => commandLineToolsLanguageServer).catch(() => languageServerPath);
        formatterPath = await fs.access(commandLineToolsFormatter).then(() => commandLineToolsFormatter).catch(() => formatterPath);
        this.macDeveloperDir = commandLineToolsRoot;
        this.macSdkRoot = sdkRoot;
        ready = true;
      }
    }
    const developerModeEnabled = Boolean(debuggerPath) && await macDeveloperModeEnabled();
    this.cachedStatus = {
      platform: process.platform,
      compilerPath,
      debuggerPath,
      compilerVersion: compilerPath ? await versionOf(compilerPath) : undefined,
      debuggerVersion: debuggerPath ? await versionOf(debuggerPath) : undefined,
      debuggerReady: Boolean(debuggerPath && developerModeEnabled),
      debuggerMessage: !debuggerPath
        ? '缺少 lldb-dap，调试暂不可用。'
        : developerModeEnabled
          ? 'LLDB 调试权限已就绪。'
          : 'Apple 调试权限尚未启用。请点击“启用调试权限”并输入管理员密码。',
      languageServerPath,
      languageServerVersion: languageServerPath ? await versionOf(languageServerPath) : undefined,
      languageServerReady: Boolean(languageServerPath),
      formatterPath,
      formatterVersion: formatterPath ? await versionOf(formatterPath) : undefined,
      formatterReady: Boolean(formatterPath),
      ready,
      bundled: false,
      message: ready
        ? debuggerPath ? 'Apple Clang/LLDB 已就绪。' : 'Apple Clang 已就绪，但缺少 lldb-dap，调试暂不可用。'
        : compilerPath ? '找到了 Apple Clang，但 C++ 标准库不可用；请安装 Command Line Tools 或修复 Xcode。' : '需要安装 Apple Command Line Tools。',
    };
    return this.cachedStatus;
  }

  async createBuildPlan(input: {
    rootPath: string;
    activeFile: string;
    config: ProjectConfigV1 | null;
    mode: 'release' | 'debug';
  }): Promise<BuildPlan> {
    const status = await this.detectToolchain();
    if (!status.ready || !status.compilerPath) throw new Error(status.message);
    const { rootPath, activeFile, config, mode } = input;
    const sources = config?.sources?.length ? config.sources.map((source) => path.resolve(rootPath, source)) : [activeFile];
    const targetName = (config?.name || path.basename(activeFile, path.extname(activeFile))).replace(/[^\p{L}\p{N}_.-]+/gu, '-');
    const buildDir = path.join(rootPath, '.starcode', 'build', mode);
    await fs.mkdir(buildDir, { recursive: true });
    const executablePath = path.join(buildDir, `${targetName}${process.platform === 'win32' ? '.exe' : ''}`);
    const runtimeCwd = path.resolve(rootPath, config?.workingDirectory || '.');
    const standard = config?.standard ?? 'c++17';
    const compatibilityIncludeRoot = this.compatibilityIncludeRoot();
    const args = [
      `-std=gnu++${standard.replace('c++', '')}`,
      ...(mode === 'release' ? ['-O2', '-Wall', '-Wextra'] : ['-O0', '-g3', '-fno-omit-frame-pointer', '-Wall', '-Wextra']),
      ...(process.platform === 'win32' ? ['-static-libgcc', '-static-libstdc++'] : []),
      ...(compatibilityIncludeRoot ? ['-isystem', compatibilityIncludeRoot] : []),
      ...sources,
      ...(config?.includeDirs ?? []).map((directory) => `-I${path.resolve(rootPath, directory)}`),
      ...(config?.defines ?? []).map((define) => `-D${define}`),
      ...(config?.extraCompilerArgs ?? []),
      '-o',
      executablePath,
    ];
    const toolchainBin = path.dirname(status.compilerPath);
    return {
      compiler: status.compilerPath,
      args,
      cwd: rootPath,
      executablePath,
      runtimeCwd,
      environment: {
        ...process.env,
        PATH: `${toolchainBin}${path.delimiter}${process.env.PATH ?? ''}`,
        LANG: 'C.UTF-8',
        ...(this.macDeveloperDir ? { DEVELOPER_DIR: this.macDeveloperDir } : {}),
        ...(this.macSdkRoot ? { SDKROOT: this.macSdkRoot } : {}),
      },
    };
  }

  parseDiagnostics(output: string, cwd: string): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];
    for (const line of output.split(/\r?\n/)) {
      const match = line.match(/^(.*):(\d+):(\d+):\s+(fatal error|error|warning|note):\s+(.*)$/);
      if (!match) continue;
      const [, file = '', lineNumber = '1', column = '1', kind = 'note', message = ''] = match;
      diagnostics.push({
        file: path.isAbsolute(file) ? file : path.resolve(cwd, file),
        line: Number(lineNumber),
        column: Number(column),
        severity: kind.includes('error') ? 'error' : kind === 'warning' ? 'warning' : 'note',
        message,
        source: 'build',
      });
    }
    return diagnostics;
  }

  async createCompilationCommands(input: {
    rootPath: string;
    activeFile: string;
    config: ProjectConfigV1 | null;
  }): Promise<Array<{ directory: string; file: string; arguments: string[] }>> {
    const status = await this.detectToolchain();
    if (!status.ready || !status.compilerPath) throw new Error(status.message);
    const sources = input.config?.sources?.length
      ? input.config.sources.map((source) => path.resolve(input.rootPath, source))
      : [input.activeFile];
    const standard = input.config?.standard ?? 'c++17';
    const compatibilityIncludeRoot = this.compatibilityIncludeRoot();
    const common = [
      status.compilerPath,
      `-std=gnu++${standard.replace('c++', '')}`,
      '-Wall',
      '-Wextra',
      ...(compatibilityIncludeRoot ? ['-isystem', compatibilityIncludeRoot] : []),
      ...(input.config?.includeDirs ?? []).map((directory) => `-I${path.resolve(input.rootPath, directory)}`),
      ...(input.config?.defines ?? []).map((define) => `-D${define}`),
      ...(input.config?.extraCompilerArgs ?? []),
      '-fsyntax-only',
    ];
    return sources.map((source) => ({ directory: input.rootPath, file: source, arguments: [...common, source] }));
  }

  async languageEnvironment(): Promise<NodeJS.ProcessEnv> {
    const status = await this.detectToolchain();
    const toolPath = status.compilerPath ?? status.languageServerPath ?? status.formatterPath;
    return {
      ...process.env,
      ...(toolPath ? { PATH: `${path.dirname(toolPath)}${path.delimiter}${process.env.PATH ?? ''}` } : {}),
      LANG: 'C.UTF-8',
      ...(this.macDeveloperDir ? { DEVELOPER_DIR: this.macDeveloperDir } : {}),
      ...(this.macSdkRoot ? { SDKROOT: this.macSdkRoot } : {}),
    };
  }

  async debuggerCommand(): Promise<{ command: string; args: string[]; kind: 'gdb' | 'lldb'; environment: NodeJS.ProcessEnv }> {
    const status = await this.detectToolchain();
    if (!status.ready || !status.debuggerPath) throw new Error(status.message);
    if (status.debuggerReady === false) throw new Error(status.debuggerMessage ?? '调试器尚未就绪。');
    const environment = {
      ...process.env,
      PATH: `${path.dirname(status.debuggerPath)}${path.delimiter}${process.env.PATH ?? ''}`,
      LANG: 'C.UTF-8',
      ...(this.macDeveloperDir ? { DEVELOPER_DIR: this.macDeveloperDir } : {}),
      ...(this.macSdkRoot ? { SDKROOT: this.macSdkRoot } : {}),
    };
    return process.platform === 'win32'
      ? { command: status.debuggerPath, args: ['--interpreter=dap'], kind: 'gdb', environment }
      : { command: status.debuggerPath, args: [], kind: 'lldb', environment };
  }

  formatCommand(plan: BuildPlan): string {
    return [plan.compiler, ...plan.args].map(quote).join(' ');
  }
}
