import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { DebugEvent, DebugSnapshot } from '../src/shared/contracts';
import { AccessRegistry } from '../src/main/services/access-registry';
import { BuildService } from '../src/main/services/build-service';
import { CppLanguageAdapter } from '../src/main/services/cpp-adapter';
import { DebugService } from '../src/main/services/debug-service';
import { OperationCoordinator } from '../src/main/services/operation-coordinator';
import { ProjectService } from '../src/main/services/project-service';

describe('本机 LLDB-DAP 调试集成', () => {
  it.skipIf(process.platform !== 'darwin')('断点暂停后读取变量并继续运行', async () => {
    const cpp = new CppLanguageAdapter();
    const toolchain = await cpp.detectToolchain(true);
    if (!toolchain.ready || !toolchain.debuggerPath || !toolchain.debuggerReady) return;
    const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), 'starcode-debug-'));
    const activeFile = path.join(rootPath, 'main.cpp');
    await fs.writeFile(activeFile, '#include <iostream>\nint twice(int input) {\n    int doubled = input * 2;\n    return doubled;\n}\nint main() {\n    int value = 21;\n    int result = twice(value);\n    std::cout << result << "\\n";\n    return 0;\n}\n');
    const access = new AccessRegistry();
    access.approveRoot(rootPath);
    const events: DebugEvent[] = [];
    const builds = new BuildService(new ProjectService(access), cpp, () => undefined);
    const debug = new DebugService(builds, cpp, new OperationCoordinator(), (event) => events.push(event));
    try {
      const build = await debug.start({ activeFile, mode: 'debug', breakpoints: [{ path: activeFile, lines: [8] }] }).catch((error) => {
        throw new Error(`${String(error)}\n${events.filter((event) => event.type === 'output').map((event) => event.text).join('')}`);
      });
      expect(build.success, build.output).toBe(true);
      await waitUntil(() => events.some((event) => event.type === 'stopped'));
      const snapshot = await debug.command({ type: 'snapshot' }) as DebugSnapshot;
      expect(snapshot.frames[0]?.line).toBe(8);
      expect(snapshot.variables.some((variable) => variable.name === 'value' && variable.value.includes('21'))).toBe(true);
      expect(snapshot.variables.length).toBeLessThan(10);

      const evaluation = await debug.command({ type: 'evaluate', expression: 'value + 1', frameId: snapshot.selectedFrameId }) as { result?: string };
      expect(evaluation.result).toContain('22');

      const stoppedBeforeStepIn = eventCount(events, 'stopped');
      await debug.command({ type: 'stepIn', threadId: snapshot.selectedThreadId ?? 1 });
      await waitUntil(() => eventCount(events, 'stopped') > stoppedBeforeStepIn);
      const insideFunction = await debug.command({ type: 'snapshot' }) as DebugSnapshot;
      expect(insideFunction.frames[0]?.name).toContain('twice');
      expect(insideFunction.variables.some((variable) => variable.name === 'input' && variable.value.includes('21'))).toBe(true);

      const stoppedBeforeStepOut = eventCount(events, 'stopped');
      await debug.command({ type: 'stepOut', threadId: insideFunction.selectedThreadId ?? 1 });
      await waitUntil(() => eventCount(events, 'stopped') > stoppedBeforeStepOut);
      const afterStepOut = await debug.command({ type: 'snapshot' }) as DebugSnapshot;
      expect(afterStepOut.frames[0]?.name).toBe('main');

      const stoppedBeforeNext = eventCount(events, 'stopped');
      await debug.command({ type: 'next', threadId: afterStepOut.selectedThreadId ?? 1 });
      await waitUntil(() => eventCount(events, 'stopped') > stoppedBeforeNext);
      const terminated = waitUntil(() => events.some((event) => event.type === 'terminated'));
      const afterNext = await debug.command({ type: 'snapshot' }) as DebugSnapshot;
      await debug.command({ type: 'continue', threadId: afterNext.selectedThreadId ?? 1 });
      await terminated;
    } finally {
      await debug.command({ type: 'disconnect' }).catch(() => undefined);
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  }, 60000);
});

function eventCount(events: DebugEvent[], type: DebugEvent['type']): number {
  return events.filter((event) => event.type === type).length;
}

async function waitUntil(predicate: () => boolean, timeoutMs = 15000): Promise<void> {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) throw new Error('等待调试事件超时。');
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}
