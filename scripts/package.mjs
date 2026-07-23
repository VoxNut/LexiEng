import archiver from 'archiver';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
execFileSync('node', [path.join(root, 'scripts', 'build.mjs')], { cwd: root, stdio: 'inherit' });

const version = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')).version;
const packages = path.join(root, 'packages');
await mkdir(packages, { recursive: true });
const outputPath = path.join(packages, `lexieng-v${version}-chromium.zip`);

await new Promise((resolve, reject) => {
  const output = createWriteStream(outputPath);
  const archive = archiver('zip', { zlib: { level: 9 } });
  output.on('close', resolve);
  output.on('error', reject);
  archive.on('error', reject);
  archive.pipe(output);
  archive.directory(path.join(root, 'dist'), false);
  archive.finalize();
});

console.log(`Packed ${outputPath}`);
