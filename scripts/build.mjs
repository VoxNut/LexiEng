import { build } from 'esbuild';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import sharp from 'sharp';

const root = path.resolve(import.meta.dirname, '..');
const outDir = path.join(root, 'dist');
const generatedDir = path.join(root, '.generated', 'wasm');
const isDev = process.argv.includes('--dev');

await rm(outDir, { recursive: true, force: true });
await rm(generatedDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });
await mkdir(generatedDir, { recursive: true });

execFileSync(
  'cargo',
  ['build', '--package', 'lexieng-core', '--target', 'wasm32-unknown-unknown', ...(isDev ? [] : ['--release'])],
  { cwd: root, stdio: 'inherit' },
);

const profile = isDev ? 'debug' : 'release';
const wasmInput = path.join(root, 'target', 'wasm32-unknown-unknown', profile, 'lexieng_core.wasm');
execFileSync(
  'wasm-bindgen',
  [wasmInput, '--target', 'web', '--out-dir', generatedDir, '--out-name', 'lexieng_core', '--no-typescript'],
  { cwd: root, stdio: 'inherit' },
);

const common = {
  bundle: true,
  charset: 'utf8',
  legalComments: 'none',
  minify: !isDev,
  sourcemap: isDev,
  target: ['chrome116', 'edge116'],
  logLevel: 'info',
};

await Promise.all([
  build({
    ...common,
    entryPoints: [path.join(root, 'src', 'background.ts')],
    outfile: path.join(outDir, 'background.js'),
    format: 'esm',
  }),
  build({
    ...common,
    entryPoints: [path.join(root, 'src', 'content.ts')],
    outfile: path.join(outDir, 'content.js'),
    format: 'iife',
  }),
  build({
    ...common,
    entryPoints: [path.join(root, 'src', 'widget.ts')],
    outfile: path.join(outDir, 'widget.js'),
    format: 'esm',
  }),
  build({
    ...common,
    entryPoints: [path.join(root, 'src', 'options.ts')],
    outfile: path.join(outDir, 'options.js'),
    format: 'esm',
  }),
  build({
    ...common,
    entryPoints: [path.join(root, 'src', 'dictionary-worker.ts')],
    outfile: path.join(outDir, 'dictionary-worker.js'),
    format: 'esm',
  }),
]);

await Promise.all([
  cp(path.join(root, 'src', 'manifest.json'), path.join(outDir, 'manifest.json')),
  cp(path.join(root, 'src', 'pages'), path.join(outDir, 'pages'), { recursive: true }),
  cp(path.join(root, 'src', 'styles'), path.join(outDir, 'styles'), { recursive: true }),
  cp(path.join(root, 'src', 'assets'), path.join(outDir, 'assets'), { recursive: true }),
  cp(path.join(root, 'LICENSE'), path.join(outDir, 'LICENSE')),
  cp(path.join(root, 'PRIVACY.md'), path.join(outDir, 'PRIVACY.md')),
  cp(path.join(root, 'LICENSES'), path.join(outDir, 'LICENSES'), { recursive: true }),
  cp(
    path.join(generatedDir, 'lexieng_core_bg.wasm'),
    path.join(outDir, 'wasm', 'lexieng_core_bg.wasm'),
    { recursive: true },
  ),
]);

const interSource = path.join(
  root,
  'node_modules',
  '@fontsource-variable',
  'inter',
  'files',
  'inter-latin-wght-normal.woff2',
);
await cp(interSource, path.join(outDir, 'assets', 'inter-latin.woff2'));

const svg = await readFile(path.join(root, 'src', 'assets', 'icon.svg'));
for (const size of [16, 32, 48, 128]) {
  await sharp(svg).resize(size, size).png().toFile(path.join(outDir, 'assets', `icon-${size}.png`));
}

const manifestPath = path.join(outDir, 'manifest.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
manifest.version = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')).version;
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

console.log(`Built ${isDev ? 'development' : 'production'} extension at ${outDir}`);
