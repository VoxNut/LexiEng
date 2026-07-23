import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const generated = path.join(root, '.generated', 'wasm', 'lexijap_core.js');
const wasmPath = path.join(root, '.generated', 'wasm', 'lexijap_core_bg.wasm');

if (process.argv.length < 3) {
  console.error('Usage: npm run verify:dictionary -- <dictionary.zip> [more.zip]');
  process.exitCode = 2;
} else {
  await access(generated).catch(() => {
    throw new Error('Run npm run build before verifying dictionaries.');
  });
  const module = await import(pathToFileURL(generated).href);
  await module.default({ module_or_path: await readFile(wasmPath) });

  for (const argument of process.argv.slice(2)) {
    const filePath = path.resolve(argument);
    const archive = new module.YomitanArchive(new Uint8Array(await readFile(filePath)));
    const metadata = archive.metadata();
    let terms = 0;
    let meta = 0;
    const modes = new Set();
    while (true) {
      const batch = archive.next_batch(1_000);
      if (batch.kind === 'done') break;
      if (batch.kind === 'terms') terms += batch.records.length;
      if (batch.kind === 'metadata') {
        meta += batch.records.length;
        for (const record of batch.records) modes.add(record.mode);
      }
    }
    archive.free();
    console.log(
      `${path.basename(filePath)}: ${metadata.title} (${metadata.revision}), ` +
        `${terms.toLocaleString('en-US')} terms, ${meta.toLocaleString('en-US')} metadata rows` +
        `${modes.size ? ` [${[...modes].join(', ')}]` : ''}`,
    );
  }
}
