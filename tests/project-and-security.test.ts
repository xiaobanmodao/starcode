import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { AccessRegistry, isWithin } from '../src/main/services/access-registry';
import { OperationCoordinator } from '../src/main/services/operation-coordinator';
import { projectSchema } from '../src/main/services/project-service';
import { testExportResultSchema, testImportResultSchema } from '../src/main/services/sample-file-service';

describe('项目配置', () => {
  it('接受 v1 简单项目', () => {
    expect(projectSchema.parse({
      version: 1,
      name: 'demo',
      entry: 'main.cpp',
      sources: ['main.cpp', 'solve.cpp'],
      standard: 'c++17',
      includeDirs: [],
      defines: [],
      extraCompilerArgs: [],
      runArgs: [],
      workingDirectory: '.',
    }).sources).toHaveLength(2);
  });

  it('拒绝未知 C++ 标准', () => {
    expect(() => projectSchema.parse({ version: 1, name: 'x', entry: 'x.cpp', sources: ['x.cpp'], standard: 'c++98', includeDirs: [], defines: [], extraCompilerArgs: [], runArgs: [], workingDirectory: '.' })).toThrow();
  });
});

describe('路径与执行会话保护', () => {
  it('拒绝项目外路径', () => {
    const root = path.resolve('/tmp/starcode-project');
    expect(isWithin(root, path.join(root, 'src', 'main.cpp'))).toBe(true);
    expect(isWithin(root, path.resolve(root, '..', 'secret.txt'))).toBe(false);
    const registry = new AccessRegistry();
    registry.approveRoot(root);
    expect(() => registry.assertReadable(path.resolve(root, '..', 'secret.txt'))).toThrow();
  });

  it('只允许一个前台操作', () => {
    const coordinator = new OperationCoordinator();
    coordinator.acquire('running');
    expect(() => coordinator.acquire('building')).toThrow(/请先停止/u);
    coordinator.release('running');
    expect(() => coordinator.acquire('building')).not.toThrow();
  });
});

describe('样例文件 IPC 数据', () => {
  it('接受结构化导入导出结果并拒绝无效数据', () => {
    expect(testImportResultSchema.parse({
      cancelled: false,
      cases: [{ id: 'case-1', name: '1', input: '1\n', expectedOutput: '2\n', timeoutMs: 2000 }],
      issues: [{ baseName: '2', reason: '缺少 .out 文件' }],
    }).cases).toHaveLength(1);
    expect(testExportResultSchema.parse({
      cancelled: false,
      directory: '/tmp/export',
      entries: [{ id: 'case-1', inputFileName: '1.in', outputFileName: '1.out' }],
    }).entries).toHaveLength(1);
    expect(() => testImportResultSchema.parse({ cancelled: false, cases: [{ timeoutMs: 1 }], issues: [] })).toThrow();
    expect(() => testExportResultSchema.parse({ cancelled: false, entries: [{ inputFileName: '../1.in' }] })).toThrow();
  });
});
