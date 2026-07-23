import init, {
  lookup_candidates as lookupCandidates,
  tokenize_nodes as tokenizeNodes,
} from '../.generated/wasm/lexieng_core.js';
import { reviewAnkiCard } from './shared/anki';
import { classifyTokens, lookupTerm, setManualKnown, updateAnkiCard } from './shared/db';
import { getSettings } from './shared/settings';
import { RuntimeRequest } from './shared/types';

let wasmReady: Promise<WebAssembly.Exports> | undefined;

chrome.runtime.onInstalled.addListener((details) => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'lexieng-scan', title: 'LexiEng: scan page', contexts: ['page'] });
    chrome.contextMenus.create({
      id: 'lexieng-lookup',
      title: 'LexiEng: look up “%s”',
      contexts: ['selection'],
    });
    chrome.contextMenus.create({ id: 'lexieng-clear', title: 'LexiEng: clear marks', contexts: ['page'] });
  });
  if (details.reason === 'install') void chrome.runtime.openOptionsPage();
});

chrome.runtime.onStartup.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab?.id) return;
  if (info.menuItemId === 'lexieng-scan') void sendTabMessage(tab.id, { type: 'scanPage' });
  if (info.menuItemId === 'lexieng-clear') void sendTabMessage(tab.id, { type: 'clearPage' });
  if (info.menuItemId === 'lexieng-lookup' && info.selectionText) {
    if (tab.windowId !== undefined) void chrome.sidePanel.open({ windowId: tab.windowId });
    void chrome.runtime.sendMessage({ type: 'wordSelected', word: info.selectionText.trim() });
  }
});

chrome.commands.onCommand.addListener((command) => {
  if (command !== 'scan-page') return;
  void withActiveTab((tabId) => sendTabMessage(tabId, { type: 'scanPage' }));
});

chrome.runtime.onMessage.addListener(
  (message: RuntimeRequest, _sender, sendResponse: (response?: unknown) => void) => {
    if (message.type === 'scanStats' || message.type === 'wordSelected') return false;
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
    case 'scanActivePage':
      return withActiveTab((tabId) => sendTabMessage(tabId, { type: 'scanPage' }));
    case 'clearActivePage':
      return withActiveTab((tabId) => sendTabMessage(tabId, { type: 'clearPage' }));
    case 'scanPage':
    case 'clearPage':
      return { ok: true };
    default:
      return { ok: true };
  }
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
      throw new Error('This page cannot be scanned. Try a regular http(s) page.');
    }
    throw error;
  }
}
