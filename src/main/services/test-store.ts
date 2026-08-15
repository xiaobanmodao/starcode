import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { TestSuiteV1 } from '../../shared/contracts';
import { AccessRegistry } from './access-registry';
import { atomicWrite } from './file-service';

const testCaseSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  input: z.string(),
  expectedOutput: z.string(),
  timeoutMs: z.number().int().min(100).max(60000),
});

const testSuiteSchema = z.object({
  version: z.literal(1),
  target: z.string().min(1),
  cases: z.array(testCaseSchema),
});

function suiteFile(rootPath: string, targetPath: string): string {
  const relative = path.relative(rootPath, targetPath).replace(/[^\p{L}\p{N}_.-]+/gu, '__');
  return path.join(rootPath, '.starcode', 'tests', `${relative || 'main'}.json`);
}

export class TestStore {
  constructor(private readonly access: AccessRegistry) {}

  async load(rootPath: string, targetPath: string): Promise<TestSuiteV1> {
    this.access.assertReadable(rootPath);
    this.access.assertWithin(rootPath, targetPath);
    try {
      return testSuiteSchema.parse(JSON.parse(await fs.readFile(suiteFile(rootPath, targetPath), 'utf8')));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, target: path.relative(rootPath, targetPath), cases: [] };
      if (error instanceof SyntaxError || error instanceof z.ZodError) throw new Error('样例文件格式无效。');
      throw error;
    }
  }

  async save(rootPath: string, suite: TestSuiteV1): Promise<void> {
    this.access.assertReadable(rootPath);
    const validated = testSuiteSchema.parse(suite);
    const targetPath = path.resolve(rootPath, validated.target);
    this.access.assertWithin(rootPath, targetPath);
    await atomicWrite(suiteFile(rootPath, targetPath), `${JSON.stringify(validated, null, 2)}\n`);
  }
}

export { testCaseSchema, testSuiteSchema };
