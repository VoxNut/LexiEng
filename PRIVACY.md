# LexiEng privacy policy

Last updated: July 23, 2026

LexiEng is a local-first browser extension. It has no developer-operated backend, analytics, advertising, account system, or telemetry.

## Data stored on the device

LexiEng stores the following in the browser profile:

- imported Yomitan/Yomichan dictionary entries and metadata in IndexedDB;
- locally derived frequency ranks and IPA records in IndexedDB;
- normalized known terms imported from Anki and terms marked known manually in IndexedDB;
- Anki card identifiers and scheduling summaries (state, interval, and review/lapse counts) in IndexedDB;
- appearance, frequency, and Anki connection settings in `chrome.storage.local`.

Dictionary archives are read from files explicitly selected by the user. Their contents are not uploaded.

## Page access

LexiEng requests access to web pages so its content script can parse text after the user chooses **Parse page** or **Parse selection**, keep parsing newly inserted text while that parser is active, extract a local reader view, and inspect the word under the pointer for `Q`. Text is tokenized and matched locally. Page text is not retained after classification and is not transmitted to a remote server.

Browser-internal pages, extension stores, and other pages where Chromium blocks content scripts cannot be scanned.

## AnkiConnect

When the user tests, starts an Anki sync, deliberately reviews cards, or mines a word, LexiEng sends AnkiConnect API requests to the URL configured in settings. The default is `http://127.0.0.1:8765`, which is the local computer.

Sync uses read actions such as `version`, `deckNames`, `modelNames`, `findNotes`, `notesInfo`, `findCards`, and `cardsInfo`. Extracted headwords and compact scheduling summaries are stored locally. When the user clicks Again, Hard, Good, or Easy—or confirms a visible-card mass review—LexiEng calls `answerCards`; Anki’s active scheduler updates those cards’ review history and due dates. When the user clicks **Add to Anki**, LexiEng calls `addNote` with the displayed word, imported dictionary data, and surrounding sentence. LexiEng does not edit or delete existing Anki notes.

If a user changes the endpoint to a non-local address, requests and Anki data will be sent to that address at the user's direction.

## Permissions

- **Host access (`<all_urls>`)**: allows on-demand parsing, word marking, popup lookup, and reader mode on ordinary websites, and allows connecting to a user-configured AnkiConnect endpoint.
- **Context menus**: adds parse, lookup, reader, and clear actions.
- **Storage**: stores small settings.
- **Tabs**: sends user-requested parse, reader, status-bar, and clear commands from the toolbar widget to the active tab.
- **Unlimited storage**: allows large locally imported dictionaries to exceed normal extension storage quotas.

## Retention and deletion

Users can remove individual dictionaries from LexiEng settings. Running Anki sync replaces the previous local Anki-derived known-word and scheduling snapshot. Uninstalling the extension removes its browser-managed local data. Reviews already submitted to Anki remain in the Anki collection and can be undone or managed in Anki.

## Remote code

LexiEng does not download or execute remote code. All JavaScript, WebAssembly, styles, and fonts are packaged with the extension.

## Changes

Material changes to this policy will be described in the repository changelog and reflected by the date above.
