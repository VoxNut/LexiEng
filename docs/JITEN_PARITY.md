# JitenReader parity contract

LexiEng is an English adaptation of JitenReader's reading workflow, not a visual
reskin. This document records the behavior being adapted and the intentional
English-specific substitutions.

Reference:

- JitenReader 1.3.2, commit `8f4862cc9a9f5492db9d4e53629340acaf214cd2`
- Installed Chromium build 1.3.2 (`fkegmlkjkenojfiplaclhlmncfeooaeo`)
- Source: <https://github.com/Sirush/JitenReader>

## Product structure

| JitenReader behavior | LexiEng adaptation |
| --- | --- |
| Toolbar action opens a compact widget | Toolbar action opens a compact LexiEng widget |
| Parsing, popup, reader, and status UI live in the page | Same; there is no side panel |
| Trigger parser handles arbitrary pages | Parse page or selection from widget, keybind, context menu, or in-page control |
| Automatic/custom parsers handle supported reading apps | Mutation/visibility parsing for dynamic English pages; host-specific adapters can be added independently |
| Background parser calls Jiten | Rust/WASM tokenization plus local IndexedDB Yomitan lookup |
| Jiten account supplies vocabulary state | AnkiConnect snapshot plus manual state and local frequency rules |

## Reading workflow

| Capability | Required LexiEng behavior |
| --- | --- |
| Page parsing | Wrap every parsed English token without breaking surrounding layout |
| Target highlighting | Use the configured frequency range after Anki/manual-known precedence |
| Popup activation | `Q` on the word under the pointer by default; click and optional hover are also supported |
| Selection lookup | Look up a selected phrase without requiring a page parse |
| Popup content | Headword, IPA, frequency, state, all enabled local dictionaries, Anki card schedules, and actions |
| Reader mode | Extract readable content into an in-page reading view and parse that view |
| Status bar | Coverage, unique coverage, state totals, parse/reader/review/clear/settings controls |
| Dynamic pages | Parse newly added readable text while parsing is enabled |
| Clear/pause | Restore original text and stop automatic parsing cleanly |

## Knowledge and review mapping

JitenReader's card states are mapped to Anki as follows:

| JitenReader concept | LexiEng / Anki source |
| --- | --- |
| New | Anki new card |
| Young | Review card below the mature interval |
| Mature | Review card at or above the mature interval |
| Due | Anki reports the card as due |
| Mastered | Manual known flag |
| Suspended | Anki suspended card |
| Blacklisted | Manual ignored flag |
| Redundant | A token resolved through another inflected/base-form candidate |
| Frequency-known | English-only state for ranks below the configured known ceiling |

The popup grades Again, Hard, Good, and Easy through Anki's active scheduler.
When FSRS is enabled in Anki, those actions therefore use FSRS. LexiEng does not
implement a competing scheduler.

## Intentional differences

- Dictionaries are user-imported Yomitan/Yomichan archives, never Jiten's
  Japanese API.
- English inflection candidates and IPA replace Japanese morphology, furigana,
  and pitch accent.
- Frequency-known words can be excluded even when they are absent from Anki.
- The UI is flat and motion-free. No animation or gradient styling is added.
- PDF reconstruction and Japanese-reader-specific site parsers are separate
  follow-up adapters; they must not distort the core web-reading workflow.
