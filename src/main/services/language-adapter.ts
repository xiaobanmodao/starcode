import type { BuildMode, Diagnostic, ProjectConfigV1, ToolchainStatus } from '../../shared/contracts';

export interface BuildPlan {
  compiler: string;
  args: string[];
  cwd: string;
  executablePath: string;
  runtimeCwd: string;
  environment: NodeJS.ProcessEnv;
}

export interface LanguageAdapter {
  readonly id: string;
  readonly extensions: string[];
  detectToolchain(): Promise<ToolchainStatus>;
  createBuildPlan(input: {
    rootPath: string;
    activeFile: string;
    config: ProjectConfigV1 | null;
    mode: BuildMode;
  }): Promise<BuildPlan>;
  parseDiagnostics(output: string, cwd: string): Diagnostic[];
  debuggerCommand(): Promise<{ command: string; args: string[]; kind: 'gdb' | 'lldb' }>;
}
