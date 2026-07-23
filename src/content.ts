import { PageParser } from './content/page-parser';
import { PopupController } from './content/popup-controller';
import { ReaderView } from './content/reader-view';
import { StatusBar } from './content/status-bar';
import { getSettings } from './shared/settings';
import { PageState, RuntimeRequest, ScanStats, Settings } from './shared/types';

let settings: Settings;
let lastStats: ScanStats | undefined;

const settingsReady = loadSettings();
const parser = new PageParser(
  async () => settingsReady.then(() => settings),
  (stats, parsing) => {
    lastStats = stats;
    statusBar.update(stats, parsing);
  },
);
const popup = new PopupController(
  async () => settingsReady.then(() => settings),
  () => parser.refreshStats(),
);
const reader = new ReaderView(
  async () => settingsReady.then(() => settings),
  async (root) => {
    parser.clear();
    await parser.parseReader(root);
  },
  () => parser.clear(),
);
const statusBar = new StatusBar({
  parse: () => run(() => parsePage()),
  reader: () => run(() => toggleReader()),
  review: () => run(() => reviewVisibleWords()),
  clear: () => {
    parser.clear();
    popup.close();
  },
  settings: () => chrome.runtime.openOptionsPage(),
});

void settingsReady;

chrome.runtime.onMessage.addListener(
  (message: RuntimeRequest, _sender, sendResponse: (response?: unknown) => void) => {
    const operation = handleMessage(message);
    if (!operation) return false;
    void operation
      .then(sendResponse)
      .catch((error: unknown) => sendResponse({ error: errorMessage(error) }));
    return true;
  },
);

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.settings) return;
  void loadSettings();
});

document.addEventListener(
  'keydown',
  (event) => {
    if (isTypingContext(event.target) || event.repeat) return;
    if (event.altKey && event.code === 'KeyP') {
      event.preventDefault();
      event.stopPropagation();
      void run(() => (window.getSelection()?.toString().trim() ? parseSelection() : parsePage()));
      return;
    }
    if (event.altKey && event.code === 'KeyH') {
      event.preventDefault();
      event.stopPropagation();
      void run(() => toggleReader());
      return;
    }
    if (event.altKey && event.code === 'KeyS' && window === window.top) {
      event.preventDefault();
      event.stopPropagation();
      statusBar.toggle();
    }
  },
  true,
);

async function loadSettings(): Promise<void> {
  settings = await getSettings();
  statusBar?.applySettings(settings);
  popup?.applySettings(settings);
  reader?.applyTheme(settings.theme);
}

function handleMessage(message: RuntimeRequest): Promise<unknown> | undefined {
  switch (message.type) {
    case 'scanPage':
      return parsePage();
    case 'scanSelection':
      return parseSelection();
    case 'clearPage':
      parser.clear();
      popup.close();
      return Promise.resolve({ ok: true });
    case 'openReaderMode':
      return reader.toggle(message.text).then(() => ({ ok: true }));
    case 'openLookup':
      return popup.openWord(message.word).then(() => ({ ok: true }));
    case 'toggleStatusBar':
      statusBar.toggle();
      return Promise.resolve({ ok: true, visible: statusBar.isVisible });
    case 'getPageState':
      return Promise.resolve(getPageState());
    default:
      return undefined;
  }
}

async function parsePage(): Promise<{ ok: true; stats: ScanStats }> {
  await settingsReady;
  statusBar.show();
  const root = reader.contentRoot ?? document.body;
  const stats = await parser.parsePage(root);
  return { ok: true, stats };
}

async function parseSelection(): Promise<{ ok: true; stats: ScanStats }> {
  await settingsReady;
  statusBar.show();
  const stats = await parser.parseSelection();
  return { ok: true, stats };
}

async function toggleReader(): Promise<{ ok: true }> {
  await settingsReady;
  await reader.toggle();
  statusBar.show();
  return { ok: true };
}

async function reviewVisibleWords(): Promise<{ ok: true; reviewed: number }> {
  await settingsReady;
  const cardIds = parser.visibleReviewCardIds(settings);
  if (cardIds.length === 0) {
    throw new Error('No reviewable Anki cards are visible with the current mass-review filters');
  }
  if (
    settings.massReviewRequireConfirm &&
    !confirm(`Review ${cardIds.length} visible Anki ${cardIds.length === 1 ? 'card' : 'cards'} as Good?`)
  ) {
    return { ok: true, reviewed: 0 };
  }
  await sendMessage({ type: 'reviewAnkiCards', cardIds, ease: 3 });
  await parsePage();
  return { ok: true, reviewed: cardIds.length };
}

function getPageState(): PageState {
  return {
    parsed: parser.isParsed,
    parsing: parser.isParsing,
    readerOpen: reader.active,
    statusBarVisible: statusBar.isVisible,
    stats: lastStats,
  };
}

async function run<T>(operation: () => Promise<T>): Promise<T | undefined> {
  try {
    return await operation();
  } catch (error) {
    showToast(errorMessage(error));
    return undefined;
  }
}

function showToast(message: string): void {
  document.getElementById('lexieng-toast')?.remove();
  const toast = document.createElement('div');
  toast.id = 'lexieng-toast';
  toast.dataset.lexiengIgnore = 'true';
  toast.textContent = message;
  document.documentElement.append(toast);
  window.setTimeout(() => toast.remove(), 4200);
}

function isTypingContext(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return Boolean(
    target.closest('input, textarea, select, [contenteditable="true"], [role="textbox"]'),
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function sendMessage<T = unknown>(message: RuntimeRequest): Promise<T> {
  const response = (await chrome.runtime.sendMessage(message)) as T | { error?: string };
  if (response && typeof response === 'object' && 'error' in response && response.error) {
    throw new Error(response.error);
  }
  return response as T;
}
