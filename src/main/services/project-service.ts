import { app, dialog } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { CPP_STANDARDS, type AppState, type FileTreeNode, type ProjectConfigV1, type ProjectSnapshot } from '../../shared/contracts';
import { AccessRegistry } from './access-registry';
import { atomicWrite } from './file-service';

const projectSchema = z.object({
  version: z.literal(1),
  name: z.string().min(1),
  entry: z.string().min(1),
  sources: z.array(z.string().min(1)).min(1),
  standard: z.enum(CPP_STANDARDS),
  includeDirs: z.array(z.string()),
  defines: z.array(z.string()),
  extraCompilerArgs: z.array(z.string()),
  runArgs: z.array(z.string()),
  workingDirectory: z.string(),
});

const ignoredDirectories = new Set(['.git', 'node_modules', 'build', 'out']);

async function listDirectory(rootPath: string, currentPath = rootPath): Promise<FileTreeNode[]> {
  const entries = await fs.readdir(currentPath, { withFileTypes: true });
  const result: FileTreeNode[] = [];
  for (const entry of entries) {
    if (entry.name === '.DS_Store' || (entry.isDirectory() && (ignoredDirectories.has(entry.name) || entry.name === '.starcode'))) continue;
    const entryPath = path.join(currentPath, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      result.push({ name: entry.name, path: entryPath, kind: 'directory', children: await listDirectory(rootPath, entryPath) });
    } else {
      result.push({ name: entry.name, path: entryPath, kind: 'file' });
    }
  }
  return result.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name, 'zh-CN') : a.kind === 'directory' ? -1 : 1));
}

const defaultState: AppState = {
  recentProjects: [],
  theme: 'system',
  editorFontSize: 14,
  editorTabSize: 4,
  formatOnSave: false,
  languageIntelligenceEnabled: true,
  bottomPanelHeight: 255,
};

export class ProjectService {
  constructor(private readonly access: AccessRegistry) {}

  private get statePath(): string {
    return path.join(app.getPath('userData'), 'state.json');
  }

  async open(): Promise<ProjectSnapshot | null> {
    const result = await dialog.showOpenDialog({ title: '打开文件夹', properties: ['openDirectory', 'createDirectory'] });
    const rootPath = result.filePaths[0];
    if (result.canceled || !rootPath) return null;
    return this.openPath(rootPath);
  }

  async openPath(rootPath: string): Promise<ProjectSnapshot> {
    const stat = await fs.stat(rootPath);
    if (!stat.isDirectory()) throw new Error('项目路径不是文件夹。');
    this.access.approveRoot(rootPath);
    const state = await this.getState();
    const recentProjects = [
      { path: rootPath, name: path.basename(rootPath), lastOpenedAt: Date.now() },
      ...state.recentProjects.filter((item) => item.path !== rootPath),
    ].slice(0, 10);
    await this.setState({ recentProjects, lastProjectPath: rootPath });
    return this.refresh(rootPath);
  }

  async refresh(rootPath: string): Promise<ProjectSnapshot> {
    this.access.assertReadable(rootPath);
    return { rootPath, config: await this.loadConfig(rootPath), tree: await listDirectory(rootPath) };
  }

  async loadConfig(rootPath: string): Promise<ProjectConfigV1 | null> {
    const configPath = path.join(rootPath, '.starcode', 'project.json');
    try {
      const raw = JSON.parse(await fs.readFile(configPath, 'utf8')) as unknown;
      return projectSchema.parse(raw);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      if (error instanceof SyntaxError || error instanceof z.ZodError) {
        throw new Error('.starcode/project.json 格式无效，请修复后重试。');
      }
      throw error;
    }
  }

  async saveConfig(rootPath: string, config: ProjectConfigV1): Promise<ProjectSnapshot> {
    this.access.assertReadable(rootPath);
    const validated = projectSchema.parse(config);
    for (const projectPath of [validated.entry, validated.workingDirectory, ...validated.sources, ...validated.includeDirs]) {
      this.access.assertWithin(rootPath, path.resolve(rootPath, projectPath));
    }
    const metadataPath = path.join(rootPath, '.starcode');
    await fs.mkdir(metadataPath, { recursive: true });
    await atomicWrite(path.join(metadataPath, 'project.json'), `${JSON.stringify(validated, null, 2)}\n`);
    await atomicWrite(path.join(metadataPath, '.gitignore'), 'build/\n');
    return this.refresh(rootPath);
  }

  async getState(): Promise<AppState> {
    try {
      const parsed = JSON.parse(await fs.readFile(this.statePath, 'utf8')) as Partial<AppState>;
      return { ...defaultState, ...parsed, recentProjects: parsed.recentProjects ?? [] };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { ...defaultState };
      return { ...defaultState };
    }
  }

  async setState(patch: Partial<AppState>): Promise<AppState> {
    const next = { ...(await this.getState()), ...patch };
    await atomicWrite(this.statePath, `${JSON.stringify(next, null, 2)}\n`);
    return next;
  }
}

export { projectSchema };
