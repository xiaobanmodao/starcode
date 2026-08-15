import { dialog } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { FileDocument } from '../../shared/contracts';
import { AccessRegistry } from './access-registry';

async function atomicWrite(filePath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.tmp`;
  await fs.writeFile(temporary, content, 'utf8');
  await fs.rename(temporary, filePath);
}

export class FileService {
  constructor(private readonly access: AccessRegistry) {}

  async openFile(): Promise<FileDocument | null> {
    const result = await dialog.showOpenDialog({
      title: '打开 C++ 源文件',
      properties: ['openFile'],
      filters: [
        { name: 'C++ 文件', extensions: ['cpp', 'cc', 'cxx', 'h', 'hpp'] },
        { name: '所有文件', extensions: ['*'] },
      ],
    });
    const filePath = result.filePaths[0];
    if (result.canceled || !filePath) return null;
    this.access.approveFile(filePath);
    return this.read(filePath);
  }

  async read(filePath: string): Promise<FileDocument> {
    this.access.assertReadable(filePath);
    return {
      path: filePath,
      name: path.basename(filePath),
      content: await fs.readFile(filePath, 'utf8'),
    };
  }

  async save(filePath: string, content: string): Promise<void> {
    this.access.assertReadable(filePath);
    await atomicWrite(filePath, content);
  }

  async saveAs(suggestedName: string, content: string): Promise<FileDocument | null> {
    const result = await dialog.showSaveDialog({
      title: '保存源文件',
      defaultPath: suggestedName || 'main.cpp',
      filters: [{ name: 'C++ 源文件', extensions: ['cpp'] }],
    });
    if (result.canceled || !result.filePath) return null;
    this.access.approveFile(result.filePath);
    await atomicWrite(result.filePath, content);
    return this.read(result.filePath);
  }

  async create(rootPath: string, relativePath: string, content = ''): Promise<FileDocument> {
    const filePath = path.resolve(rootPath, relativePath);
    this.access.assertWithin(rootPath, filePath);
    this.access.assertReadable(rootPath);
    try {
      await fs.access(filePath);
      throw new Error('同名文件已经存在。');
    } catch (error) {
      if (error instanceof Error && error.message === '同名文件已经存在。') throw error;
    }
    await atomicWrite(filePath, content);
    this.access.approveFile(filePath);
    return this.read(filePath);
  }

  async remove(filePath: string): Promise<void> {
    this.access.assertReadable(filePath);
    await fs.rm(filePath, { recursive: true });
  }
}

export { atomicWrite };
