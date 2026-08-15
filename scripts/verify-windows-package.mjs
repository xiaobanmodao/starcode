import fs from 'node:fs/promises';
import path from 'node:path';

const [packagedAppDirectory, makeDirectory] = process.argv.slice(2).map((value) => value && path.resolve(value));

if (!packagedAppDirectory || !makeDirectory) {
  throw new Error('用法：node scripts/verify-windows-package.mjs <packaged-app-dir> <make-dir>');
}

async function exists(filePath) {
  return fs.access(filePath).then(() => true).catch(() => false);
}

async function filesRecursively(directory) {
  const result = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const candidate = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await filesRecursively(candidate));
    else if (entry.isFile()) result.push(candidate);
  }
  return result;
}

const requiredRelativePaths = [
  'StarCode.exe',
  'resources/app.asar',
  'resources/toolchains/toolchain-lock.json',
  'resources/toolchains/windows-x64/bin/g++.exe',
  'resources/toolchains/windows-x64/bin/gdb.exe',
  'resources/toolchains/windows-x64/bin/clangd.exe',
  'resources/toolchains/windows-x64/bin/clang-format.exe',
];

const missing = [];
for (const relativePath of requiredRelativePaths) {
  if (!await exists(path.join(packagedAppDirectory, relativePath))) missing.push(relativePath);
}

const packagedFiles = await filesRecursively(packagedAppDirectory);
const unpackedNodePtyDirectory = path.join(
  packagedAppDirectory,
  'resources',
  'app.asar.unpacked',
  'node_modules',
  'node-pty',
);
if (!packagedFiles.some((filePath) => {
  const relativePath = path.relative(unpackedNodePtyDirectory, filePath);
  return relativePath !== ''
    && !relativePath.startsWith(`..${path.sep}`)
    && relativePath !== '..'
    && !path.isAbsolute(relativePath)
    && path.extname(filePath).toLocaleLowerCase('en-US') === '.node';
})) {
  missing.push('resources/app.asar.unpacked/node_modules/node-pty/**/*.node');
}

const makeFiles = await filesRecursively(makeDirectory);
if (!makeFiles.some((filePath) => path.basename(filePath) === 'StarCode-Windows-x64-Setup.exe')) {
  missing.push('StarCode-Windows-x64-Setup.exe');
}

if (missing.length) throw new Error(`Windows 打包资源不完整：${missing.join('、')}`);
console.log(`Windows 打包资源检查通过：${packagedAppDirectory}`);
