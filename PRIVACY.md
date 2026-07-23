# LexiJap privacy policy

Last updated: July 23, 2026

LexiJap is a local-first browser extension. It has no developer-operated backend, analytics, advertising, account system, or telemetry.

## Data stored on the device

LexiJap stores the following in the browser profile:

- imported Yomitan/Yomichan dictionary entries and metadata in IndexedDB;
- locally derived frequency ranks and IPA records in IndexedDB;
- normalized known terms imported from Anki and terms marked known manually in IndexedDB;
- appearance, frequency, and Anki connection settings in `chrome.storage.local`.

Dictionary archives are read from files explicitly selected by the user. Their contents are not uploaded.

## Page access

LexiJap requests access to web pages so its content script can scan visible text after the user chooses **Scan page**. Text is tokenized and matched locally. Page text is not retained after classification and is not transmitted to a remote server.

Browser-internal pages, extension stores, and other pages where Chromium blocks content scripts cannot be scanned.

## AnkiConnect

When the user tests or starts an Anki sync, LexiJap sends AnkiConnect API requests to the URL configured in settings. The default is `http://127.0.0.1:8765`, which is the local computer.

LexiJap uses read-only AnkiConnect actions such as `version`, `deckNames`, `findNotes`, and `notesInfo`. It does not create, edit, or delete Anki notes. Extracted headwords are stored locally as a known-word source.

If a user changes the endpoint to a non-local address, requests and Anki data will be sent to that address at the user's direction.

## Permissions

- **Host access (`<all_urls>`)**: allows on-demand scanning and word marking on ordinary websites, and allows connecting to a user-configured AnkiConnect endpoint.
- **Context menus**: adds scan, lookup, and clear actions.
- **Side panel**: provides the persistent reader and lookup interface.
- **Storage**: stores small settings.
- **Tabs**: sends user-requested scan and clear commands to the active tab.
- **Unlimited storage**: allows large locally imported dictionaries to exceed normal extension storage quotas.

## Retention and deletion

Users can remove individual dictionaries from LexiJap settings. Running Anki sync replaces the previous local Anki-derived known-word set. Uninstalling the extension removes its browser-managed local data.

## Remote code

LexiJap does not download or execute remote code. All JavaScript, WebAssembly, styles, and fonts are packaged with the extension.

## Changes

Material changes to this policy will be described in the repository changelog and reflected by the date above.
