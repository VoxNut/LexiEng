import init, {
  lookup_candidates as lookupCandidates,
  tokenize_nodes as tokenizeNodes,
} from '../.generated/wasm/lexieng_core.js';
import { mineAnkiNote, reviewAnkiCard, reviewAnkiCards } from './shared/anki';
import {
  addAnkiKnownTerm,
  classifyTokens,
  lookupTerm,
  setManualKnown,
  updateAnkiCard,
} from './shared/db';
import { getSettings } from './shared/settings';
import { RuntimeRequest } from './shared/types';

let wasmReady: Promise<WebAssembly.Exports> | undefined;

chrome.runtime.onInstalled.addListener((details) => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'lexieng-scan',
      title: 'LexiEng: parse page',
      contexts: ['page'],
    });
    chrome.contextMenus.create({
      id: 'lexieng-scan-selection',
      title: 'LexiEng: parse selection',
      contexts: ['selection'],
    });
    chrome.contextMenus.create({
      id: 'lexieng-lookup',
      title: 'LexiEng: look up “%s”',
      contexts: ['selection'],
    });
    chrome.contextMenus.create({
      id: 'lexieng-reader',
      title: 'LexiEng: open reader mode',
      contexts: ['page', 'selection'],
    });
    chrome.contextMenus.create({
      id: 'lexieng-clear',
      title: 'LexiEng: clear parsed words',
      contexts: ['page'],
    });
  });
  if (details.reason === 'install') void chrome.runtime.openOptionsPage();
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab?.id) return;

  if (info.menuItemId === 'lexieng-scan') {
    void sendTabMessage(tab.id, { type: 'scanPage' });
  }
  if (info.menuItemId === 'lexieng-scan-selection') {
    void sendTabMessage(tab.id, { type: 'scanSelection' });
  }
  if (info.menuItemId === 'lexieng-clear') {
    void sendTabMessage(tab.id, { type: 'clearPage' });
  }
  if (info.menuItemId === 'lexieng-lookup' && info.selectionText) {
    void sendTabMessage(tab.id, {
      type: 'openLookup',
      word: info.selectionText.trim(),
    });
  }
  if (info.menuItemId === 'lexieng-reader') {
    void sendTabMessage(tab.id, {
      type: 'openReaderMode',
      text: info.selectionText?.trim() || undefined,
    });
  }
});

chrome.commands.onCommand.addListener((command) => {
  if (command !== 'parse-page') return;
  void withActiveTab((tabId) => sendTabMessage(tabId, { type: 'scanPage' }));
});

chrome.runtime.onMessage.addListener(
  (message: RuntimeRequest, sender, sendResponse: (response?: unknown) => void) => {
    if (message.type === 'scanStats') {
      if (sender.tab?.id) updateBadge(sender.tab.id, message.stats.coverage);
      return false;
    }
    if (message.type === 'wordSelected') return false;

    void handleMessage(message)
      .then(sendResponse)
      .catch((error: unknown) => {
        sendResponse({ error: error instanceof Error ? error.message : String(error) });
      });
    return true;
  },
);

async function handleMessage(message: RuntimeRequest): Promise<unknown> {
  switch (message.type) {
    case 'tokenizeAndClassify': {
      await ensureWasm();
      const tokens = tokenizeNodes(message.nodes);
      return classifyTokens(tokens, await getSettings());
    }
    case 'lookup': {
      await ensureWasm();
      const candidates = lookupCandidates(message.query);
      return lookupTerm(message.query, candidates, await getSettings());
    }
    case 'setKnown':
      await setManualKnown(message.term, message.known);
      return { ok: true };
    case 'reviewAnkiCard': {
      const settings = await getSettings();
      const snapshot = await reviewAnkiCard(settings.ankiUrl, message.cardId, message.ease);
      return updateAnkiCard(snapshot);
    }
    case 'reviewAnkiCards': {
      const settings = await getSettings();
      const snapshots = await reviewAnkiCards(
        settings.ankiUrl,
        message.cardIds,
        message.ease,
      );
      return Promise.all(snapshots.map((snapshot) => updateAnkiCard(snapshot)));
    }
    case 'mineToAnki': {
      await ensureWasm();
      const settings = await getSettings();
      const result = await lookupTerm(
        message.term,
        lookupCandidates(message.term),
        settings,
      );
      const mined = await mineAnkiNote(settings.ankiUrl, {
        deck: settings.ankiDeck,
        model: settings.ankiModel,
        wordField: settings.ankiField,
        meaningField: settings.ankiMeaningField,
        sentenceField: settings.ankiSentenceField,
        ipaField: settings.ankiIpaField,
        frequencyField: settings.ankiFrequencyField,
        word: result.matched || result.query,
        meaning: result.entries
          .slice(0, 4)
          .map((entry) => plainText(entry.glossary))
          .filter(Boolean)
          .join('\n')
          .slice(0, 8000),
        sentence: message.sentence ?? '',
        ipa: result.ipa.map((entry) => entry.ipa).join(' · '),
        frequency:
          result.frequencyRank === undefined ? '' : String(Math.round(result.frequencyRank)),
      });
      await addAnkiKnownTerm(result.matched || result.query);
      await Promise.all(mined.cards.map((snapshot) => updateAnkiCard(snapshot)));
      return mined;
    }
    case 'scanActivePage':
      return withActiveTab((tabId) => sendTabMessage(tabId, { type: 'scanPage' }));
    case 'scanActiveSelection':
      return withActiveTab((tabId) => sendTabMessage(tabId, { type: 'scanSelection' }));
    case 'clearActivePage':
      return withActiveTab((tabId) => sendTabMessage(tabId, { type: 'clearPage' }));
    case 'openReaderActivePage':
      return withActiveTab((tabId) =>
        sendTabMessage(tabId, { type: 'openReaderMode', text: message.text }),
      );
    case 'toggleStatusBarActivePage':
      return withActiveTab((tabId) => sendTabMessage(tabId, { type: 'toggleStatusBar' }));
    case 'getActivePageState':
      return withActiveTab((tabId) => sendTabMessage(tabId, { type: 'getPageState' }));
    case 'scanPage':
    case 'scanSelection':
    case 'clearPage':
    case 'openReaderMode':
    case 'openLookup':
    case 'toggleStatusBar':
    case 'getPageState':
      return { ok: true };
    default:
      return { ok: true };
  }
}

function plainText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.map(plainText).filter(Boolean).join(' ');
  if (typeof value !== 'object') return '';
  const record = value as Record<string, unknown>;
  if (record.type === 'text' && typeof record.text === 'string') return record.text;
  return plainText(record.content ?? record.text);
}

function ensureWasm(): Promise<WebAssembly.Exports> {
  wasmReady ??= init({ module_or_path: chrome.runtime.getURL('wasm/lexieng_core_bg.wasm') });
  return wasmReady;
}

async function withActiveTab<T>(callback: (tabId: number) => Promise<T>): Promise<T> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error('No active browser tab');
  return callback(tab.id);
}

async function sendTabMessage(tabId: number, message: RuntimeRequest): Promise<unknown> {
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    if (/Receiving end does not exist|Could not establish connection/i.test(text)) {
      throw new Error('LexiEng cannot run on this browser-owned page. Open a normal web page.');
    }
    throw error;
  }
}

function updateBadge(tabId: number, coverage: number): void {
  const text = Number.isFinite(coverage) ? `${Math.round(coverage)}` : '';
  void chrome.action.setBadgeBackgroundColor({ tabId, color: '#246b60' });
  void chrome.action.setBadgeText({ tabId, text });
  void chrome.action.setTitle({
    tabId,
    title: text ? `LexiEng · ${text}% coverage` : 'LexiEng',
  });
}
