# Changelog

All notable changes to LexiEng are documented here.

## 0.2.0 — 2026-07-23

- Renamed the project, extension, Rust crate, packages, and public repository from LexiJap to LexiEng.
- Added `Q` lookup for the word under the pointer, including unscanned pages.
- Kept non-target words out of the DOM while making every page word available through pointer-based `Q` lookup.
- Added Anki card-state snapshots, current scheduling metrics, and scheduler-provided next intervals.
- Added Again, Hard, Good, and Easy popup controls backed by AnkiConnect `answerCards` and Anki’s active scheduler, including FSRS.
- Migrated IndexedDB to store Anki cards without discarding existing imported dictionaries or known-word data.

## 0.1.0 — 2026-07-23

- Initial Chrome and Microsoft Edge Manifest V3 extension.
- Rust/WASM English tokenizer and Yomitan format 3/4 archive importer.
- Batched IndexedDB storage for definition, IPA, and frequency data.
- On-demand page scanning, target-word marking, local dictionary popup, and side panel.
- Read-only AnkiConnect sync with an `English Mining` default deck.
- Configurable frequency ceiling and target range, defaulting to a 20,000-word exclusion.
- Default, Sepia, Rosé Pine, Nord, Catppuccin Mocha, and Monochrome themes.
