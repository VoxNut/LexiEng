import { renderLookupResult } from './shared/renderer';
import { getSettings } from './shared/settings';
import { ClassifiedToken, LookupResult, RuntimeRequest, ScanStats, Theme } from './shared/types';

const EXCLUDED_SELECTOR = [
  'script',
  'style',
  'noscript',
  'textarea',
  'input',
  'select',
  'option',
  'button',
  'code',
  'pre',
  'svg',
  'canvas',
  '[contenteditable="true"]',
  '[aria-hidden="true"]',
  '[data-lexijap-ignore]',
  '.lexijap-word',
  '#lexijap-popup-host',
].join(',');

const MAX_TEXT_CHARACTERS = 300_000;
const MAX_TEXT_NODES = 8_000;
const BATCH_CHARACTER_LIMIT = 45_000;
const BATCH_NODE_LIMIT = 100;

let scanning = false;
let marked = false;
let popupHost: HTMLElement | undefined;
let activeWord = '';
let activeTheme: Theme = 'default';

chrome.runtime.onMessage.addListener(
  (message: RuntimeRequest, _sender, sendResponse: (response?: unknown) => void) => {
    if (message.type === 'scanPage') {
      void scanPage()
        .then((stats) => sendResponse({ ok: true, stats }))
        .catch((error: unknown) => sendResponse({ error: errorMessage(error) }));
      return true;
    }
    if (message.type === 'clearPage') {
      clearMarks();
      sendResponse({ ok: true });
    }
    return false;
  },
);

document.addEventListener('pointerover', (event) => {
  if (!(event instanceof PointerEvent) || !event.shiftKey) return;
  const target = event.target instanceof Element ? event.target.closest<HTMLElement>('.lexijap-word') : null;
  if (target) void openLookup(target);
});

document.addEventListener('click', (event) => {
  const target = event.target instanceof Element ? event.target.closest<HTMLElement>('.lexijap-word') : null;
  if (!target) return;
  event.preventDefault();
  event.stopPropagation();
  void openLookup(target);
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closePopup();
  if ((event.key === 'Enter' || event.key === ' ') && event.target instanceof HTMLElement) {
    const target = event.target.closest<HTMLElement>('.lexijap-word');
    if (target) {
      event.preventDefault();
      void openLookup(target);
    }
  }
});

async function scanPage(): Promise<ScanStats> {
  if (scanning) throw new Error('A page scan is already running');
  scanning = true;
  clearMarks();
  activeTheme = (await getSettings()).theme;

  try {
    const nodes = collectTextNodes();
    const totals: Omit<ScanStats, 'coverage'> = {
      total: 0,
      unique: 0,
      known: 0,
      knownAnki: 0,
      knownFrequency: 0,
      targets: 0,
      outsideRange: 0,
      unranked: 0,
    };
    const uniqueWords = new Set<string>();

    for (const batch of createBatches(nodes)) {
      const response = await sendMessage<ClassifiedToken[]>({
        type: 'tokenizeAndClassify',
        nodes: batch.map((node) => node.data),
      });
      const byNode = new Map<number, ClassifiedToken[]>();
      for (const token of response) {
        const list = byNode.get(token.nodeIndex) ?? [];
        list.push(token);
        byNode.set(token.nodeIndex, list);
        totals.total += 1;
        uniqueWords.add(token.matched || token.normalized);
        if (token.frequencyRank === undefined) totals.unranked += 1;
        if (token.state === 'known-anki' || token.state === 'known-manual') {
          totals.known += 1;
          if (token.state === 'known-anki') totals.knownAnki += 1;
        } else if (token.state === 'known-frequency') {
          totals.known += 1;
          totals.knownFrequency += 1;
        } else if (token.state === 'target') {
          totals.targets += 1;
        } else {
          totals.outsideRange += 1;
        }
      }
      for (const [nodeIndex, tokens] of byNode) {
        const node = batch[nodeIndex];
        if (node?.isConnected) markTextNode(node, tokens);
      }
      await yieldToPage();
    }

    totals.unique = uniqueWords.size;
    const stats: ScanStats = {
      ...totals,
      coverage: totals.total === 0 ? 100 : (totals.known / totals.total) * 100,
    };
    marked = true;
    await chrome.runtime.sendMessage({ type: 'scanStats', stats } satisfies RuntimeRequest).catch(() => undefined);
    return stats;
  } finally {
    scanning = false;
  }
}

function collectTextNodes(): Text[] {
  if (!document.body) return [];
  const nodes: Text[] = [];
  let characters = 0;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!(node instanceof Text) || !node.data.trim()) return NodeFilter.FILTER_REJECT;
      const parent = node.parentElement;
      if (!parent || parent.closest(EXCLUDED_SELECTOR)) return NodeFilter.FILTER_REJECT;
      const style = getComputedStyle(parent);
      if (style.display === 'none' || style.visibility === 'hidden') return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  while (nodes.length < MAX_TEXT_NODES && characters < MAX_TEXT_CHARACTERS) {
    const node = walker.nextNode();
    if (!(node instanceof Text)) break;
    nodes.push(node);
    characters += node.length;
  }
  return nodes;
}

function createBatches(nodes: Text[]): Text[][] {
  const batches: Text[][] = [];
  let current: Text[] = [];
  let characters = 0;
  for (const node of nodes) {
    if (
      current.length > 0 &&
      (current.length >= BATCH_NODE_LIMIT || characters + node.length > BATCH_CHARACTER_LIMIT)
    ) {
      batches.push(current);
      current = [];
      characters = 0;
    }
    current.push(node);
    characters += node.length;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

function markTextNode(node: Text, tokens: ClassifiedToken[]): void {
  const targets = tokens.filter((token) => token.state === 'target');
  if (targets.length === 0 || !node.parentNode) return;
  const original = node.data;
  const fragment = document.createDocumentFragment();
  let cursor = 0;
  for (const token of targets.sort((a, b) => a.start - b.start)) {
    if (token.start < cursor || token.end > original.length) continue;
    fragment.append(original.slice(cursor, token.start));
    const marker = document.createElement('span');
    marker.className = 'lexijap-word';
    marker.dataset.word = token.surface;
    marker.dataset.normalized = token.matched || token.normalized;
    marker.dataset.frequency = token.frequencyRank?.toString() ?? '';
    marker.tabIndex = 0;
    marker.setAttribute('role', 'button');
    marker.setAttribute(
      'aria-label',
      `${token.surface}, ${token.frequencyRank === undefined ? 'unranked' : `frequency rank ${Math.round(token.frequencyRank)}`}`,
    );
    marker.title = token.hasDefinition
      ? 'Click, or hold Shift while hovering, to open LexiJap'
      : 'No imported definition; click to inspect';
    marker.textContent = original.slice(token.start, token.end);
    fragment.append(marker);
    cursor = token.end;
  }
  fragment.append(original.slice(cursor));
  node.replaceWith(fragment);
}

function clearMarks(): void {
  closePopup();
  const parents = new Set<Node>();
  for (const marker of document.querySelectorAll('.lexijap-word')) {
    const parent = marker.parentNode;
    if (!parent) continue;
    parents.add(parent);
    marker.replaceWith(document.createTextNode(marker.textContent ?? ''));
  }
  for (const parent of parents) parent.normalize();
  marked = false;
}

async function openLookup(target: HTMLElement): Promise<void> {
  const word = target.dataset.word ?? target.textContent ?? '';
  if (!word) return;
  activeWord = word;
  const host = ensurePopupHost();
  const root = host.shadowRoot;
  const results = root?.querySelector<HTMLElement>('.lexijap-popup-results');
  if (!results) return;
  results.replaceChildren(textNode('div', 'Looking up…', 'lexijap-popup-loading'));
  positionPopup(host, target);
  await chrome.runtime.sendMessage({ type: 'wordSelected', word } satisfies RuntimeRequest).catch(() => undefined);

  try {
    const result = await sendMessage<LookupResult>({ type: 'lookup', query: word });
    if (activeWord !== word) return;
    renderLookupResult(
      results,
      result,
      (query) => void lookupInsidePopup(query, target),
      (known) => void updateKnown(word, known, target),
    );
    positionPopup(host, target);
  } catch (error) {
    results.replaceChildren(textNode('div', errorMessage(error), 'lookup-error'));
  }
}

async function lookupInsidePopup(query: string, anchor: HTMLElement): Promise<void> {
  activeWord = query;
  const results = popupHost?.shadowRoot?.querySelector<HTMLElement>('.lexijap-popup-results');
  if (!results) return;
  const result = await sendMessage<LookupResult>({ type: 'lookup', query });
  renderLookupResult(
    results,
    result,
    (nested) => void lookupInsidePopup(nested, anchor),
    (known) => void updateKnown(query, known, anchor),
  );
  if (popupHost) positionPopup(popupHost, anchor);
}

async function updateKnown(term: string, known: boolean, anchor: HTMLElement): Promise<void> {
  await sendMessage({ type: 'setKnown', term, known });
  await lookupInsidePopup(term, anchor);
}

function ensurePopupHost(): HTMLElement {
  if (popupHost?.isConnected) return popupHost;
  popupHost = document.createElement('aside');
  popupHost.id = 'lexijap-popup-host';
  popupHost.dataset.lexijapIgnore = 'true';
  const root = popupHost.attachShadow({ mode: 'open' });
  const base = document.createElement('link');
  base.rel = 'stylesheet';
  base.href = chrome.runtime.getURL('styles/base.css');
  const resultsStyle = document.createElement('link');
  resultsStyle.rel = 'stylesheet';
  resultsStyle.href = chrome.runtime.getURL('styles/sidepanel.css');
  const style = document.createElement('style');
  style.textContent = `
    :host { all: initial; }
    .lexijap-popup-shell {
      position: relative; max-height: min(520px, calc(100vh - 20px)); overflow: auto;
      padding: 18px; border: 1px solid var(--border); border-radius: 10px;
      color: var(--text); background: var(--surface); box-shadow: var(--shadow);
      font: 14px/1.55 "Inter", "Noto Sans JP", "Yu Gothic UI", "Meiryo", sans-serif;
    }
    .lexijap-popup-close { position: sticky; z-index: 2; top: 0; float: right; width: 30px; min-height: 30px; padding: 0; }
    .lexijap-popup-results { clear: both; }
    .lexijap-popup-loading { padding: 22px; color: var(--muted); text-align: center; }
  `;
  const shell = document.createElement('div');
  shell.className = 'lexijap-popup-shell';
  shell.dataset.theme = activeTheme;
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'icon-button lexijap-popup-close';
  close.setAttribute('aria-label', 'Close LexiJap popup');
  close.textContent = '×';
  close.addEventListener('click', closePopup);
  const results = document.createElement('div');
  results.className = 'lexijap-popup-results lookup-results';
  shell.append(close, results);
  root.append(base, resultsStyle, style, shell);
  document.documentElement.append(popupHost);
  return popupHost;
}

function positionPopup(host: HTMLElement, target: HTMLElement): void {
  const anchor = target.getBoundingClientRect();
  const width = Math.min(410, window.innerWidth - 20);
  host.style.width = `${width}px`;
  const measuredHeight = Math.min(host.getBoundingClientRect().height || 360, window.innerHeight - 20);
  const left = Math.max(10, Math.min(anchor.left, window.innerWidth - width - 10));
  const roomBelow = window.innerHeight - anchor.bottom;
  const top = roomBelow >= measuredHeight + 8
    ? anchor.bottom + 6
    : Math.max(10, anchor.top - measuredHeight - 6);
  host.style.left = `${left}px`;
  host.style.top = `${top}px`;
}

function closePopup(): void {
  popupHost?.remove();
  popupHost = undefined;
  activeWord = '';
}

async function sendMessage<T = unknown>(message: RuntimeRequest): Promise<T> {
  const response = (await chrome.runtime.sendMessage(message)) as T | { error?: string };
  if (response && typeof response === 'object' && 'error' in response && response.error) {
    throw new Error(response.error);
  }
  return response as T;
}

function textNode(tag: keyof HTMLElementTagNameMap, text: string, className: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function yieldToPage(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

void marked;
