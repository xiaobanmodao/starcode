import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const temporaryDirectories: string[] = [];
const projectRoot = path.resolve(__dirname, '..');

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

async function writeFixture(root: string, relativePath: string, content = ''): Promise<void> {
  const filePath = path.join(root, relativePath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content);
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe('Windows 打包资源检查', () => {
  it('要求安装程序、工具链、ASAR 和 node-pty 原生模块完整存在', async () => {
    const root = await temporaryDirectory('starcode-win-package-');
    const packagedApp = path.join(root, 'StarCode-win32-x64');
    const makeDirectory = path.join(root, 'make');
    await Promise.all([
      writeFixture(packagedApp, 'starcode.exe'),
      writeFixture(packagedApp, 'resources/app.asar'),
      writeFixture(packagedApp, 'resources/toolchains/toolchain-lock.json', '{}'),
      writeFixture(packagedApp, 'resources/toolchains/windows-x64/bin/g++.exe'),
      writeFixture(packagedApp, 'resources/toolchains/windows-x64/bin/gdb.exe'),
      writeFixture(packagedApp, 'resources/toolchains/windows-x64/bin/clangd.exe'),
      writeFixture(packagedApp, 'resources/toolchains/windows-x64/bin/clang-format.exe'),
      writeFixture(packagedApp, 'resources/app.asar.unpacked/node_modules/node-pty/build/Release/pty.node'),
      writeFixture(makeDirectory, 'squirrel.windows/x64/StarCode-Windows-x64-Setup.exe'),
    ]);

    await expect(execFileAsync(process.execPath, [
      path.join(projectRoot, 'scripts', 'verify-windows-package.mjs'),
      packagedApp,
      makeDirectory,
    ])).resolves.toMatchObject({ stdout: expect.stringContaining('Windows 打包资源检查通过') });

    const nativeModule = path.join(packagedApp, 'resources/app.asar.unpacked/node_modules/node-pty/build/Release/pty.node');
    await fs.rm(nativeModule);
    await writeFixture(packagedApp, 'resources/other/node-pty/build/Release/pty.node');
    await expect(execFileAsync(process.execPath, [
      path.join(projectRoot, 'scripts', 'verify-windows-package.mjs'),
      packagedApp,
      makeDirectory,
    ])).rejects.toMatchObject({ stderr: expect.stringContaining('app.asar.unpacked/node_modules/node-pty') });
    await writeFixture(packagedApp, 'resources/app.asar.unpacked/node_modules/node-pty/build/Release/pty.node');

    await fs.rm(path.join(packagedApp, 'resources/toolchains/windows-x64/bin/gdb.exe'));
    await expect(execFileAsync(process.execPath, [
      path.join(projectRoot, 'scripts', 'verify-windows-package.mjs'),
      packagedApp,
      makeDirectory,
    ])).rejects.toMatchObject({ stderr: expect.stringContaining('gdb.exe') });
  });
});

describe('发行资产准备', () => {
  it('只收集三个发行文件并生成确定的 SHA-256 清单', async () => {
    const root = await temporaryDirectory('starcode-release-');
    const downloads = path.join(root, 'downloads');
    const release = path.join(root, 'release');
    await Promise.all([
      writeFixture(downloads, 'StarCode-Windows-x64/StarCode-Windows-x64-Setup.exe', 'setup'),
      writeFixture(downloads, 'StarCode-Windows-x64/source.tar.zst', 'source'),
      writeFixture(downloads, 'StarCode-macOS-arm64/StarCode-macOS-arm64.dmg', 'dmg'),
      writeFixture(downloads, 'StarCode-macOS-arm64/zip/darwin/arm64/StarCode-darwin-arm64-0.1.0.zip', 'zip'),
    ]);

    await execFileAsync(process.execPath, [
      path.join(projectRoot, 'scripts', 'prepare-release-assets.mjs'),
      downloads,
      release,
    ]);

    expect((await fs.readdir(release)).sort()).toEqual([
      'SHA256SUMS.txt',
      'StarCode-Windows-x64-Setup.exe',
      'StarCode-darwin-arm64-0.1.0.zip',
      'StarCode-macOS-arm64.dmg',
    ]);
    expect(await fs.readFile(path.join(release, 'SHA256SUMS.txt'), 'utf8')).toBe([
      '8fb6d5f37e8055ce720bd0b1d56587f88c0071f285966ba17e72b2b12672aa73  StarCode-Windows-x64-Setup.exe',
      '4a70fe9aa6436e02c2dea340fbd1e352e4ef2d8ce6ca52ad25d4b95471fc8bf2  StarCode-darwin-arm64-0.1.0.zip',
      '00cbbd0ddbda2762798f7009838ed34ca1f12b93965813c7df22943bc62166d1  StarCode-macOS-arm64.dmg',
      '',
    ].join('\n'));
  });
});
