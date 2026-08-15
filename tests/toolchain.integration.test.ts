import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { CppLanguageAdapter } from '../src/main/services/cpp-adapter';

const execFileAsync = promisify(execFile);

describe('本机 C++ 工具链集成', () => {
  it('编译并运行一段 C++17 程序', async () => {
    if (process.platform === 'win32') return;
    const adapter = new CppLanguageAdapter();
    const status = await adapter.detectToolchain(true);
    if (!status.ready || !status.compilerPath) return;
    const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), 'starcode-toolchain-'));
    try {
      const activeFile = path.join(rootPath, 'main.cpp');
      await fs.writeFile(activeFile, '#include <iostream>\nint main(){std::cout << 42 << "\\n";}\n');
      const plan = await adapter.createBuildPlan({ rootPath, activeFile, config: null, mode: 'release' });
      await execFileAsync(plan.compiler, plan.args, { cwd: plan.cwd, env: plan.environment });
      const result = await execFileAsync(plan.executablePath, [], { cwd: rootPath });
      expect(result.stdout).toBe('42\n');
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  }, 30000);
});
