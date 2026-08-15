import path from 'node:path';

function canonical(candidate: string): string {
  return path.resolve(candidate);
}

function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(canonical(root), canonical(candidate));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

export class AccessRegistry {
  private readonly roots = new Set<string>();
  private readonly files = new Set<string>();

  approveRoot(rootPath: string): void {
    this.roots.add(canonical(rootPath));
  }

  approveFile(filePath: string): void {
    this.files.add(canonical(filePath));
  }

  assertReadable(candidate: string): void {
    const resolved = canonical(candidate);
    if (this.files.has(resolved) || [...this.roots].some((root) => isWithin(root, resolved))) return;
    throw new Error('该路径尚未通过文件或项目选择器授权。');
  }

  assertWithin(rootPath: string, candidate: string): void {
    if (!isWithin(rootPath, candidate)) throw new Error('路径不能位于当前项目之外。');
  }
}

export { isWithin };
