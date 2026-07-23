import { renderLookupResult } from './shared/renderer';
import { applyTheme, getSettings } from './shared/settings';
import { LookupResult, RuntimeRequest, ScanStats } from './shared/types';
import { asErrorMessage, formatNumber } from './shared/util';

const scanButton = requiredButton('scan-page');
const clearButton = requiredButton('clear-page');
const optionsButton = requiredButton('open-options');
const form = requiredElement<HTMLFormElement>('lookup-form');
const input = requiredElement<HTMLInputElement>('lookup-input');
const results = requiredElement<HTMLElement>('lookup-results');
const empty = requiredElement<HTMLElement>('lookup-empty');
const status = requiredElement<HTMLElement>('scan-status');

void initialize();

chrome.runtime.onMessage.addListener((message: RuntimeRequest) => {
  if (message.type === 'scanStats') updateStats(message.stats);
  if (message.type === 'wordSelected' && message.word) {
    input.value = message.word;
    void lookup(message.word);
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.settings) return;
  void getSettings().then(({ theme }) => applyTheme(theme));
});

scanButton.addEventListener('click', () => void scanPage());
clearButton.addEventListener('click', () => void clearPage());
optionsButton.addEventListener('click', () => void chrome.runtime.openOptionsPage());
form.addEventListener('submit', (event) => {
  event.preventDefault();
  const query = input.value.trim();
  if (query) void lookup(query);
});

async function initialize(): Promise<void> {
  applyTheme((await getSettings()).theme);
}

async function scanPage(): Promise<void> {
  setStatus('Scanning…', 'working');
  scanButton.disabled = true;
  try {
    const response = await sendMessage<{ ok: true; stats?: ScanStats }>({ type: 'scanActivePage' });
    if (response.stats) updateStats(response.stats);
    else setStatus('Scanned', 'ready');
  } catch (error) {
    setStatus(asErrorMessage(error), 'error');
  } finally {
    scanButton.disabled = false;
  }
}

async function clearPage(): Promise<void> {
  try {
    await sendMessage({ type: 'clearActivePage' });
    setStatus('Cleared', 'ready');
    setText('coverage-value', '—');
    setText('known-value', '—');
    setText('target-value', '—');
  } catch (error) {
    setStatus(asErrorMessage(error), 'error');
  }
}

async function lookup(query: string): Promise<void> {
  input.value = query;
  empty.hidden = true;
  results.hidden = false;
  results.replaceChildren(textElement('div', 'Looking up…', 'empty-state'));
  try {
    const result = await sendMessage<LookupResult>({ type: 'lookup', query });
    renderLookupResult(
      results,
      result,
      (nested) => void lookup(nested),
      (known) => void setKnown(result.query, known),
    );
  } catch (error) {
    results.replaceChildren(textElement('div', asErrorMessage(error), 'lookup-error'));
  }
}

async function setKnown(term: string, known: boolean): Promise<void> {
  await sendMessage({ type: 'setKnown', term, known });
  await lookup(term);
}

function updateStats(stats: ScanStats): void {
  setText('coverage-value', `${stats.coverage.toFixed(stats.coverage === 100 ? 0 : 1)}%`);
  setText('known-value', formatNumber(stats.known));
  setText('target-value', formatNumber(stats.targets));
  setStatus(`${formatNumber(stats.unique)} unique words`, 'ready');
}

function setStatus(text: string, state: 'working' | 'error' | 'ready'): void {
  status.textContent = text;
  status.dataset.state = state;
  status.title = text;
}

async function sendMessage<T = unknown>(message: RuntimeRequest): Promise<T> {
  const response = (await chrome.runtime.sendMessage(message)) as T | { error?: string };
  if (response && typeof response === 'object' && 'error' in response && response.error) {
    throw new Error(response.error);
  }
  return response as T;
}

function setText(id: string, value: string): void {
  requiredElement(id).textContent = value;
}

function textElement(tag: keyof HTMLElementTagNameMap, text: string, className: string): HTMLElement {
  const node = document.createElement(tag);
  node.textContent = text;
  node.className = className;
  return node;
}

function requiredButton(id: string): HTMLButtonElement {
  return requiredElement<HTMLButtonElement>(id);
}

function requiredElement<T extends HTMLElement = HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing #${id}`);
  return element as T;
}
