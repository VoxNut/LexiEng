# LexiJap

LexiJap is a fast, local-first English immersion reader for Chrome and Microsoft Edge. It brings together your own Yomitan/Yomichan dictionaries, the words already in your Anki mining deck, and frequency-rank filtering so familiar vocabulary stays out of the way.

![LexiJap settings](docs/settings-preview.png)

The workflow is inspired by [JitenReader](https://github.com/Sirush/JitenReader), but LexiJap is an independent English-focused implementation. Its parsing and dictionary core is written in Rust and compiled to WebAssembly.

## What it does

- Imports multiple Yomitan/Yomichan ZIP dictionaries in one queue.
- Preserves plain and structured definitions, IPA metadata, and frequency metadata.
- Syncs known terms from every note in an Anki deck through AnkiConnect. The default deck is `English Mining`.
- Auto-detects common fields such as `Word`, `Expression`, `Term`, `Vocabulary`, and `Front`, or lets you choose a field explicitly.
- Excludes frequency ranks 1–20,000 by default, with editable minimum and maximum target ranks.
- Scans a page only when requested, marks target vocabulary, and shows definitions on click or Shift-hover.
- Provides a persistent Chromium side panel for lookup and reading coverage.
- Keeps manual known-word overrides without changing Anki notes.
- Includes Default, Sepia, Rosé Pine, Nord, Catppuccin Mocha, and Monochrome themes.
- Uses a bundled Inter variable font with Noto Sans JP, Yu Gothic UI, and Meiryo fallbacks.
- Contains no telemetry, advertising, cloud API, remote code, animation, or gradient styling.

## Install from a release

1. Download `lexijap-v*-chromium.zip` from the [releases page](https://github.com/VoxNut/lexijap/releases).
2. Extract it to a permanent folder.
3. Open `chrome://extensions/` in Chrome or `edge://extensions/` in Edge.
4. Enable **Developer mode**.
5. Choose **Load unpacked** and select the extracted folder containing `manifest.json`.
6. Pin LexiJap and click its toolbar icon to open the side panel.

Chrome or Edge 116 and newer are supported.

## First setup

### 1. Import dictionaries

Open LexiJap settings and drag all of your dictionary ZIPs onto the Dictionaries section. The importer accepts standard Yomitan formats 3 and 4 and detects content by archive structure, not filename.

It supports the structures used by:

- yzk English frequency lists
- seth OALD IPA and extra data
- Cambridge Dictionary
- COBUILD Advanced Learner's Dictionary
- Oxford Dictionary of English and OALD 10
- Hackterms
- Macmillan with IPA
- プログレッシブ英和中辞典
- Urban Dictionary
- wty English and IPA packs
- Từ điển Lạc Việt

No dictionary data is included in this repository. You are responsible for obtaining and using dictionary files under their respective licenses.

Large collections can contain millions of entries and take several minutes to import. Keep the settings tab open until the queue finishes. Each archive is decompressed one bank at a time in a dedicated Rust/WASM worker and committed to IndexedDB in 750-row batches.

### 2. Sync Anki knowledge

1. Install [AnkiConnect](https://git.sr.ht/~foosoft/anki-connect) and keep Anki open.
2. Leave the endpoint at `http://127.0.0.1:8765` unless your AnkiConnect configuration uses another URL.
3. Enter `English Mining` or select another discovered deck.
4. Test the connection and choose the field containing the headword. **Detect automatically** prefers a field named `Word`.
5. Choose **Sync English Mining**.

Sync is read-only with respect to Anki: LexiJap calls `findNotes` and `notesInfo`, then replaces only its local `anki` known-word source. Manual known words remain intact. If AnkiConnect rejects the extension origin, add the installed `chrome-extension://<extension-id>` origin to AnkiConnect's `webCorsOriginList` and restart Anki.

### 3. Set the frequency range

The defaults are:

| Setting | Default | Effect |
| --- | ---: | --- |
| Known ceiling | 20,000 | Ranks 1–20,000 are treated as familiar |
| Target start | 20,001 | First rank eligible for marking |
| Target end | 100,000 | Last rank eligible for marking |
| Unranked words | Included | Technical and uncovered vocabulary can still be marked |

Anki and manual known-word status always win over the frequency range. When several frequency dictionaries are enabled, choose one explicitly or let LexiJap use the best available rank.

## Reading workflow

1. Open a normal web page.
2. Click **Scan page** in the LexiJap side panel, use the page context menu, or press `Alt+Shift+L`.
3. Click a marked word, or hold Shift while hovering it, to see local definitions, IPA, and frequency.
4. Mark a word known manually when needed.
5. Choose **Clear marks** before editing a highly interactive page.

LexiJap deliberately avoids automatic page scanning. This reduces startup work, prevents background CPU use, and gives you control over DOM changes.

## Build from source

Requirements:

- Node.js 22+
- Rust 1.85+
- the `wasm32-unknown-unknown` Rust target
- `wasm-bindgen-cli` 0.2.105

```powershell
rustup target add wasm32-unknown-unknown
cargo install wasm-bindgen-cli --version 0.2.105 --locked
npm install
npm run check
npm run build
```

Load the generated `dist/` folder as an unpacked extension. To create the release archive:

```powershell
npm run package
```

The ZIP is written to `packages/`.

## Architecture

```text
Web page content script
        │ text batches
        ▼
Manifest V3 service worker ── Rust/WASM tokenizer + inflection candidates
        │
        ├── IndexedDB: dictionary terms, IPA/frequency metadata, known words
        ├── chrome.storage.local: small user settings
        └── Side panel: lookup, coverage, manual known state

Settings page
        ├── Dedicated Rust/WASM ZIP worker ── bounded import batches ── IndexedDB
        └── AnkiConnect on localhost ── read-only known-word synchronization
```

JavaScript handles browser APIs, IndexedDB, safe DOM rendering, and UI. Rust handles Unicode tokenization, normalization, inflection candidates, ZIP decompression, Yomitan bank parsing, and frequency extraction.

Structured dictionary content is rendered through an element/style allowlist; raw dictionary HTML is never injected. Manifest V3 permits only code packaged with the extension.

## Verification

```powershell
npm run typecheck
npm test
cargo test --workspace
npm run build
npm run verify:dictionary -- path\to\dictionary.zip
```

The importer has also been exercised against multi-million-row real-world English dictionary collections. An ignored Rust compatibility test can validate a local folder without committing dictionary data:

```powershell
$env:LEXIJAP_DICTIONARY_DIR='D:\path\to\yomitan-zips'
cargo test --release validates_external_archive_directory -- --ignored --nocapture
```

## Privacy and permissions

See [PRIVACY.md](PRIVACY.md) for the complete policy and permission rationale. In short: page text, dictionaries, and known words remain on your device; only the AnkiConnect endpoint you configure receives requests, and those requests stay on localhost by default.

## Contributing

Issues and focused pull requests are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) before changing storage schemas or the Rust/JavaScript boundary.

LexiJap is available under the [MIT License](LICENSE). The bundled Inter font is licensed separately under the [SIL Open Font License 1.1](LICENSES/Inter-OFL.txt).
