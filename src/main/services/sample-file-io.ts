import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type {
  TestExportEntry,
  TestExportResult,
  TestImportIssue,
  TestImportResult,
  TestSuiteV1,
} from '../../shared/contracts';

export interface SampleFilePair {
  baseName: string;
  inputFileName: string;
  outputFileName: string;
}

interface PairingResult {
  pairs: SampleFilePair[];
  issues: TestImportIssue[];
}

const naturalCollator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' });
const windowsDeviceName = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu;

export function pairSampleFileNames(fileNames: string[]): PairingResult {
  const groups = new Map<string, { baseName: string; inputs: string[]; outputs: string[] }>();
  for (const fileName of fileNames) {
    const extension = path.extname(fileName).toLocaleLowerCase('en-US');
    if (extension !== '.in' && extension !== '.out') continue;
    const baseName = fileName.slice(0, -extension.length);
    const key = baseName.toLocaleLowerCase('en-US');
    const group = groups.get(key) ?? { baseName, inputs: [], outputs: [] };
    if (extension === '.in') {
      if (group.inputs.length === 0) group.baseName = baseName;
      group.inputs.push(fileName);
    }
    else group.outputs.push(fileName);
    groups.set(key, group);
  }

  const pairs: SampleFilePair[] = [];
  const issues: TestImportIssue[] = [];
  for (const group of groups.values()) {
    if (group.inputs.length === 0) issues.push({ baseName: group.baseName, reason: '缺少 .in 文件' });
    if (group.outputs.length === 0) issues.push({ baseName: group.baseName, reason: '缺少 .out 文件' });
    if (group.inputs.length > 1) issues.push({ baseName: group.baseName, reason: '存在重复的 .in 文件' });
    if (group.outputs.length > 1) issues.push({ baseName: group.baseName, reason: '存在重复的 .out 文件' });
    if (group.inputs.length === 1 && group.outputs.length === 1) {
      pairs.push({ baseName: group.baseName, inputFileName: group.inputs[0]!, outputFileName: group.outputs[0]! });
    }
  }
  pairs.sort((left, right) => naturalCollator.compare(left.baseName, right.baseName));
  issues.sort((left, right) => naturalCollator.compare(left.baseName, right.baseName));
  return { pairs, issues };
}

export async function importTestCasesFromDirectory(directory: string): Promise<TestImportResult> {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const pairing = pairSampleFileNames(entries.filter((entry) => entry.isFile()).map((entry) => entry.name));
  const cases: TestImportResult['cases'] = [];
  const issues = [...pairing.issues];
  for (const pair of pairing.pairs) {
    try {
      const [input, expectedOutput] = await Promise.all([
        fs.readFile(path.join(directory, pair.inputFileName), 'utf8'),
        fs.readFile(path.join(directory, pair.outputFileName), 'utf8'),
      ]);
      cases.push({ id: randomUUID(), name: pair.baseName, input, expectedOutput, timeoutMs: 2000 });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      issues.push({ baseName: pair.baseName, reason: `读取失败：${message}` });
    }
  }
  return { cancelled: false, cases, issues };
}

export function sanitizeSampleBaseName(name: string): string {
  let sanitized = name.trim().replace(/[<>:"/\\|?*\u0000-\u001f]/gu, '_').replace(/[ .]+$/gu, '');
  if (!sanitized) sanitized = 'sample';
  if (windowsDeviceName.test(sanitized)) sanitized = `sample-${sanitized}`;
  return sanitized;
}

function nextAvailableBase(preferred: string, occupied: Set<string>): string {
  let suffix = 1;
  while (true) {
    const candidate = suffix === 1 ? preferred : `${preferred}-${suffix}`;
    const inputName = `${candidate}.in`.toLocaleLowerCase('en-US');
    const outputName = `${candidate}.out`.toLocaleLowerCase('en-US');
    if (!occupied.has(inputName) && !occupied.has(outputName)) return candidate;
    suffix += 1;
  }
}

async function removeCreated(paths: string[]): Promise<void> {
  await Promise.all(paths.map((createdPath) => fs.rm(createdPath, { force: true }).catch(() => undefined)));
}

async function reserveAndWritePair(
  inputPath: string,
  outputPath: string,
  input: string,
  expectedOutput: string,
): Promise<string[]> {
  const reservedPaths: string[] = [];
  let inputHandle: Awaited<ReturnType<typeof fs.open>> | undefined;
  let outputHandle: Awaited<ReturnType<typeof fs.open>> | undefined;
  let failure: unknown;
  try {
    inputHandle = await fs.open(inputPath, 'wx');
    reservedPaths.push(inputPath);
    outputHandle = await fs.open(outputPath, 'wx');
    reservedPaths.push(outputPath);
    await inputHandle.writeFile(input, 'utf8');
    await outputHandle.writeFile(expectedOutput, 'utf8');
  } catch (error) {
    failure = error;
  } finally {
    await Promise.all([
      inputHandle?.close().catch(() => undefined),
      outputHandle?.close().catch(() => undefined),
    ]);
  }
  if (failure) {
    await removeCreated(reservedPaths);
    throw failure;
  }
  return reservedPaths;
}

export async function exportTestCasesToDirectory(directory: string, suite: TestSuiteV1): Promise<TestExportResult> {
  const occupied = new Set((await fs.readdir(directory)).map((fileName) => fileName.toLocaleLowerCase('en-US')));
  const createdPaths: string[] = [];
  const entries: TestExportEntry[] = [];
  try {
    for (const testCase of suite.cases) {
      const preferred = sanitizeSampleBaseName(testCase.name);
      while (true) {
        const baseName = nextAvailableBase(preferred, occupied);
        const inputFileName = `${baseName}.in`;
        const outputFileName = `${baseName}.out`;
        const inputPath = path.join(directory, inputFileName);
        const outputPath = path.join(directory, outputFileName);
        try {
          const pairPaths = await reserveAndWritePair(
            inputPath,
            outputPath,
            testCase.input,
            testCase.expectedOutput,
          );
          createdPaths.push(...pairPaths);
          occupied.add(inputFileName.toLocaleLowerCase('en-US'));
          occupied.add(outputFileName.toLocaleLowerCase('en-US'));
          entries.push({ id: testCase.id, inputFileName, outputFileName });
          break;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
            occupied.add(inputFileName.toLocaleLowerCase('en-US'));
            occupied.add(outputFileName.toLocaleLowerCase('en-US'));
            continue;
          }
          throw error;
        }
      }
    }
    return { cancelled: false, directory, entries };
  } catch (error) {
    await removeCreated(createdPaths);
    throw error;
  }
}
