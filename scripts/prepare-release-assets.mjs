import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

const [downloadDirectory, releaseDirectory] = process.argv.slice(2).map((value) => value && path.resolve(value));

if (!downloadDirectory || !releaseDirectory) {
  throw new Error('用法：node scripts/prepare-release-assets.mjs <download-dir> <release-dir>');
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

function requireSingle(files, description, predicate) {
  const matches = files.filter(predicate);
  if (matches.length !== 1) throw new Error(`${description} 数量应为 1，实际为 ${matches.length}。`);
  return matches[0];
}

async function sha256(filePath) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}

const files = await filesRecursively(downloadDirectory);
const setup = requireSingle(files, 'Windows Setup', (filePath) => path.basename(filePath) === 'StarCode-Windows-x64-Setup.exe');
const archive = requireSingle(files, 'macOS ZIP', (filePath) => /^StarCode-.*darwin.*\.zip$/iu.test(path.basename(filePath)));
const dmg = requireSingle(files, 'macOS DMG', (filePath) => /^StarCode-.*\.dmg$/iu.test(path.basename(filePath)));
const assets = [setup, archive, dmg];

await fs.rm(releaseDirectory, { recursive: true, force: true });
await fs.mkdir(releaseDirectory, { recursive: true });
for (const source of assets) await fs.copyFile(source, path.join(releaseDirectory, path.basename(source)));

const checksumLines = [];
for (const source of assets) {
  const fileName = path.basename(source);
  checksumLines.push(`${await sha256(path.join(releaseDirectory, fileName))}  ${fileName}`);
}
await fs.writeFile(path.join(releaseDirectory, 'SHA256SUMS.txt'), `${checksumLines.join('\n')}\n`, 'utf8');
console.log(`发行资产已准备到 ${releaseDirectory}`);
