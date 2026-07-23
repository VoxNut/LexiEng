# Changelog

All notable changes to LexiEng are documented here.

## 0.3.0 — 2026-07-23

- Rebuilt the reading workflow against JitenReader 1.3.2’s actual toolbar-widget, in-page parser, popup, status-bar, reader-mode, and card-action architecture.
- Removed the Chromium side panel, its permission, pages, scripts, and styles.
- Added a compact toolbar widget for page/selection parsing, reader mode, status-bar control, clearing, themes, and settings.
- Parse every English token into Anki/manual/frequency-aware New, Learning, Young, Mature, Due, Mastered, Suspended, Buried, frequency-known, target, and outside-range states.
- Added bounded automatic parsing for readable text inserted after the initial parse.
- Made `Q` reliably open the word at the pointer, with click, optional hover, and `Alt+L` selection lookup alternatives.
- Added a flat, resizable dictionary popup with local definitions, IPA, frequency, Anki schedule data, and `1`–`4` scheduler grading shortcuts.
- Added popup mining to the configured Anki note type with local meanings, IPA, frequency, and the surrounding sentence.
- Added an in-page coverage/status bar with state statistics, reader controls, and confirmed visible-card mass review.
- Added a focused full-page reader view with configurable type size, column width, line height, and all six themes.
- Documented the JitenReader-to-English behavior mapping in `docs/JITEN_PARITY.md`.

## 0.2.0 — 2026-07-23

- Renamed the project, extension, Rust crate, packages, and public repository from LexiJap to LexiEng.
- Added `Q` lookup for the word under the pointer, including unscanned pages.
- Kept non-target words out of the DOM while making every page word available through pointer-based `Q` lookup.
- Added Anki card-state snapshots and current scheduling metrics.
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
