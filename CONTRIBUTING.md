# Contributing to LexiEng

Thanks for helping improve LexiEng. Small, reviewable changes with a clear performance or learning benefit are preferred.

## Development setup

Install Node.js 22+, Rust, the `wasm32-unknown-unknown` target, and the matching wasm-bindgen CLI:

```powershell
rustup target add wasm32-unknown-unknown
cargo install wasm-bindgen-cli --version 0.2.105 --locked
npm install
npm run check
npm run build:dev
```

Load `dist/` from `chrome://extensions/` or `edge://extensions/`, then reload the extension after rebuilding.

## Before opening a pull request

Run:

```powershell
cargo fmt --all -- --check
npm run check
npm run build
npm audit
```

Do not commit dictionary archives, Anki exports, personal word lists, or built `dist/`/`packages/` output.

## Important design constraints

- Keep scanning opt-in and avoid persistent page observers unless a clear integration requires one.
- Keep large dictionary work outside the UI thread and preserve importer backpressure.
- Do not load entire dictionary collections into memory.
- Treat dictionary content as untrusted. Extend renderer allowlists deliberately; never inject raw HTML.
- Do not change the IndexedDB schema without a migration path and version bump.
- Do not add telemetry, remote code, gradients, or motion effects.
- Preserve Chrome and Microsoft Edge support.

## Dictionary compatibility reports

Run the browser serialization path against a personal archive without adding it to the repository:

```powershell
npm run build
npm run verify:dictionary -- path\to\dictionary.zip
```

Include the dictionary title, revision, Yomitan format version, and failing bank name in an issue. Do not attach copyrighted dictionaries unless their license explicitly permits redistribution.
