import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  exportTestCasesToDirectory,
  importTestCasesFromDirectory,
  pairSampleFileNames,
  sanitizeSampleBaseName,
} from '../src/main/services/sample-file-io';
import type { TestSuiteV1 } from '../src/shared/contracts';

const temporaryDirectories: string[] = [];

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe('样例文件导入', () => {
  it('按不区分大小写的同名文件配对并自然排序', async () => {
    const directory = await temporaryDirectory('starcode-import-');
    await Promise.all([
      fs.writeFile(path.join(directory, '10.IN'), 'ten input\n'),
      fs.writeFile(path.join(directory, '10.OUT'), 'ten output\n'),
      fs.writeFile(path.join(directory, '2.In'), 'two input\n'),
      fs.writeFile(path.join(directory, '2.oUt'), 'two output\n'),
      fs.writeFile(path.join(directory, '1.in'), 'one input\n'),
      fs.writeFile(path.join(directory, '1.out'), 'one output\n'),
      fs.mkdir(path.join(directory, 'nested')),
    ]);
    await fs.writeFile(path.join(directory, 'nested', 'ignored.in'), 'ignored');

    const result = await importTestCasesFromDirectory(directory);

    expect(result.cancelled).toBe(false);
    expect(result.issues).toEqual([]);
    expect(result.cases.map((item) => item.name)).toEqual(['1', '2', '10']);
    expect(result.cases.map((item) => [item.input, item.expectedOutput, item.timeoutMs])).toEqual([
      ['one input\n', 'one output\n', 2000],
      ['two input\n', 'two output\n', 2000],
      ['ten input\n', 'ten output\n', 2000],
    ]);
    expect(new Set(result.cases.map((item) => item.id)).size).toBe(3);
  });

  it('跳过缺失或重复的文件并汇总原因', () => {
    const result = pairSampleFileNames([
      'valid.in',
      'VALID.out',
      'missing-output.in',
      'missing-input.out',
      'duplicate.in',
      'DUPLICATE.IN',
      'duplicate.out',
      'notes.txt',
    ]);

    expect(result.pairs.map((item) => item.baseName)).toEqual(['valid']);
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ baseName: 'missing-input', reason: '缺少 .in 文件' }),
      expect.objectContaining({ baseName: 'missing-output', reason: '缺少 .out 文件' }),
      expect.objectContaining({ baseName: 'duplicate', reason: '存在重复的 .in 文件' }),
    ]));
  });

  it('始终使用 .in 文件的原始名称作为测试点名称', () => {
    const result = pairSampleFileNames(['SAMPLE.out', 'sample.in']);

    expect(result.pairs).toEqual([
      { baseName: 'sample', inputFileName: 'sample.in', outputFileName: 'SAMPLE.out' },
    ]);
  });
});

describe('样例文件导出', () => {
  it('清理跨平台文件名并避开已有文件和大小写冲突', async () => {
    const directory = await temporaryDirectory('starcode-export-');
    await fs.writeFile(path.join(directory, 'case.IN'), 'existing input');
    await fs.writeFile(path.join(directory, 'case.OUT'), 'existing output');
    const suite: TestSuiteV1 = {
      version: 1,
      target: 'main.cpp',
      cases: [
        { id: 'one', name: 'case', input: '1\n', expectedOutput: '2\n', timeoutMs: 2000 },
        { id: 'two', name: 'A/B', input: '3\n', expectedOutput: '4\n', timeoutMs: 2000 },
        { id: 'three', name: 'A:B', input: '5\n', expectedOutput: '6\n', timeoutMs: 2000 },
        { id: 'four', name: 'CON', input: '7\n', expectedOutput: '8\n', timeoutMs: 2000 },
      ],
    };

    const result = await exportTestCasesToDirectory(directory, suite);

    expect(result.cancelled).toBe(false);
    expect(result.entries).toEqual([
      { id: 'one', inputFileName: 'case-2.in', outputFileName: 'case-2.out' },
      { id: 'two', inputFileName: 'A_B.in', outputFileName: 'A_B.out' },
      { id: 'three', inputFileName: 'A_B-2.in', outputFileName: 'A_B-2.out' },
      { id: 'four', inputFileName: 'sample-CON.in', outputFileName: 'sample-CON.out' },
    ]);
    expect(await fs.readFile(path.join(directory, 'case.IN'), 'utf8')).toBe('existing input');
    expect(await fs.readFile(path.join(directory, 'case-2.in'), 'utf8')).toBe('1\n');
    expect(await fs.readFile(path.join(directory, 'A_B-2.out'), 'utf8')).toBe('6\n');
  });

  it('为清理后为空的名称提供稳定名称', () => {
    expect(sanitizeSampleBaseName('...')).toBe('sample');
    expect(sanitizeSampleBaseName('  hello. ')).toBe('hello');
    expect(sanitizeSampleBaseName('LPT1')).toBe('sample-LPT1');
  });
});
