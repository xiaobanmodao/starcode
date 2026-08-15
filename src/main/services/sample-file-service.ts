import { dialog } from 'electron';
import { z } from 'zod';
import type { TestExportResult, TestImportResult, TestSuiteV1 } from '../../shared/contracts';
import { exportTestCasesToDirectory, importTestCasesFromDirectory } from './sample-file-io';
import { testCaseSchema } from './test-store';

const fileNameSchema = z.string().min(1).refine((value) => !/[\\/]/u.test(value), '必须是文件名。');

export const testImportResultSchema = z.object({
  cancelled: z.boolean(),
  cases: z.array(testCaseSchema),
  issues: z.array(z.object({ baseName: z.string(), reason: z.string().min(1) })),
});

export const testExportResultSchema = z.object({
  cancelled: z.boolean(),
  directory: z.string().min(1).optional(),
  entries: z.array(z.object({
    id: z.string().min(1),
    inputFileName: fileNameSchema,
    outputFileName: fileNameSchema,
  })),
});

export class SampleFileService {
  async importFiles(): Promise<TestImportResult> {
    const selection = await dialog.showOpenDialog({
      title: '选择包含 .in/.out 样例的文件夹',
      properties: ['openDirectory'],
    });
    if (selection.canceled || !selection.filePaths[0]) return { cancelled: true, cases: [], issues: [] };
    return testImportResultSchema.parse(await importTestCasesFromDirectory(selection.filePaths[0])) as TestImportResult;
  }

  async exportFiles(suite: TestSuiteV1): Promise<TestExportResult> {
    const selection = await dialog.showOpenDialog({
      title: '选择样例导出文件夹',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (selection.canceled || !selection.filePaths[0]) return { cancelled: true, entries: [] };
    return testExportResultSchema.parse(await exportTestCasesToDirectory(selection.filePaths[0], suite)) as TestExportResult;
  }
}
