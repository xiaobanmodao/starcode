import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const lock = JSON.parse(await fs.readFile(path.join(root, 'resources', 'toolchains', 'toolchain-lock.json'), 'utf8'));
const cache = path.join(root, '.cache', 'msys2-toolchain');
const destination = path.join(root, 'resources', 'toolchains', 'windows-x64');
const withSources = process.argv.includes('--with-sources');

if (process.platform !== 'win32') {
  console.error('Windows 工具链只能在 Windows 主机或 Windows CI 上准备。');
  process.exit(1);
}

async function exists(candidate) {
  return fs.access(candidate).then(() => true).catch(() => false);
}

async function sha256(filePath) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}

async function download(url, filePath, expectedHash) {
  if (await exists(filePath)) {
    if (!expectedHash || await sha256(filePath) === expectedHash) return;
    await fs.rm(filePath, { force: true });
  }
  console.log(`下载 ${url}`);
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok || !response.body) throw new Error(`下载失败：${response.status} ${url}`);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const handle = await fs.open(filePath, 'w');
  try {
    for await (const chunk of Readable.fromWeb(response.body)) await handle.write(chunk);
  } finally {
    await handle.close();
  }
  if (expectedHash && await sha256(filePath) !== expectedHash) throw new Error(`SHA-256 校验失败：${path.basename(filePath)}`);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', shell: false, ...options });
  if (result.status !== 0) throw new Error(`${command} 执行失败（${result.status ?? 'unknown'}）。`);
}

await fs.mkdir(cache, { recursive: true });
let msysRoot = process.env.MSYS2_ROOT || 'C:\\msys64';
let bash = path.join(msysRoot, 'usr', 'bin', 'bash.exe');
if (!await exists(bash)) {
  const installerPath = path.join(cache, path.basename(new URL(lock.bootstrap.url).pathname));
  await download(lock.bootstrap.url, installerPath, lock.bootstrap.sha256);
  const extractedRoot = path.join(cache, 'runtime');
  await fs.rm(extractedRoot, { recursive: true, force: true });
  await fs.mkdir(extractedRoot, { recursive: true });
  run(installerPath, ['-y', `-o${extractedRoot}`]);
  msysRoot = path.join(extractedRoot, 'msys64');
  bash = path.join(msysRoot, 'usr', 'bin', 'bash.exe');
  if (!await exists(bash)) throw new Error('无法从 MSYS2 自解压包中找到 bash.exe。');
}

const packageNames = lock.packages.map((entry) => entry.name);
run(bash, ['-lc', `pacman -Sy --noconfirm --needed ${packageNames.join(' ')}`], { env: { ...process.env, CHERE_INVOKING: '1', MSYSTEM: 'UCRT64' } });

for (const entry of lock.packages) {
  const query = spawnSync(bash, ['-lc', `pacman -Q ${entry.name}`], { encoding: 'utf8', shell: false });
  const installed = query.stdout?.trim().split(/\s+/)[1];
  if (installed !== entry.version) throw new Error(`${entry.name} 版本为 ${installed ?? 'missing'}，锁文件要求 ${entry.version}。`);
  const archive = path.join(msysRoot, 'var', 'cache', 'pacman', 'pkg', `${entry.name}-${entry.version}-any.pkg.tar.zst`);
  if (!await exists(archive) || await sha256(archive) !== entry.sha256) throw new Error(`${entry.name} 包文件 SHA-256 与锁文件不一致。`);
}

await fs.rm(destination, { recursive: true, force: true });
await fs.cp(path.join(msysRoot, 'ucrt64'), destination, { recursive: true, force: true });
const packageList = spawnSync(bash, ['-lc', "pacman -Q | grep '^mingw-w64-ucrt-x86_64-'"], { encoding: 'utf8', shell: false });
await fs.writeFile(path.join(destination, 'installed-packages.txt'), packageList.stdout || '', 'utf8');
await fs.writeFile(path.join(destination, 'toolchain-manifest.json'), `${JSON.stringify({
  generatedAt: new Date().toISOString(),
  lockSchemaVersion: lock.schemaVersion,
  roots: lock.packages.map(({ name, version, sha256 }) => ({ name, version, sha256 })),
  compilerSha256: await sha256(path.join(destination, 'bin', 'g++.exe')),
  debuggerSha256: await sha256(path.join(destination, 'bin', 'gdb.exe')),
  languageServerSha256: await sha256(path.join(destination, 'bin', 'clangd.exe')),
  formatterSha256: await sha256(path.join(destination, 'bin', 'clang-format.exe')),
}, null, 2)}\n`, 'utf8');

if (withSources) {
  const sourceDirectory = path.join(root, 'licenses', 'third-party-sources');
  for (const entry of lock.packages) {
    await download(entry.source, path.join(sourceDirectory, path.basename(new URL(entry.source).pathname)));
  }
}

console.log(`Windows x64 工具链已准备到 ${destination}`);
