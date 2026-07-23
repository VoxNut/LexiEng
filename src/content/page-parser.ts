import { ClassifiedToken, LearningState, RuntimeRequest, ScanStats, Settings } from '../shared/types';

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
  'iframe',
  'object',
  '[contenteditable="true"]',
  '[aria-hidden="true"]',
  '[data-lexieng-ignore]',
  '.lexieng-word',
  '#lexieng-popup-host',
  '#lexieng-status-host',
  '.lexieng-reader-controls',
].join(',');

const MAX_TEXT_CHARACTERS = 500_000;
const MAX_TEXT_NODES = 12_000;
const BATCH_CHARACTER_LIMIT = 42_000;
const BATCH_NODE_LIMIT = 120;

export class PageParser {
  private parsing = false;
  private parsed = false;
  private observer?: MutationObserver;
  private observerTimer?: number;
  private pendingRoots = new Set<Node>();
  private stats?: ScanStats;

  public constructor(
    private readonly getSettings: () => Promise<Settings>,
    private readonly onStateChange: (stats: ScanStats | undefined, parsing: boolean) => void,
  ) {}

  public get isParsing(): boolean {
    return this.parsing;
  }

  public get isParsed(): boolean {
    return this.parsed;
  }

  public get currentStats(): ScanStats | undefined {
    return this.stats;
  }

  public async parsePage(root: Node = document.body): Promise<ScanStats> {
    if (this.parsing) throw new Error('LexiEng is already parsing this page');
    this.clear(false);
    return this.parseRoots([root], true);
  }

  public async parseSelection(): Promise<ScanStats> {
    const selection = window.getSelection();
    if (!selection?.rangeCount || !selection.toString().trim()) {
      throw new Error('Select some text before parsing the selection');
    }
    if (this.parsing) throw new Error('LexiEng is already parsing this page');

    const range = selection.getRangeAt(0).cloneRange();
    const root = range.commonAncestorContainer;
    const nodes = this.collectTextNodes(root, (node) => range.intersectsNode(node));
    return this.parseNodes(nodes, false);
  }

  public async parseReader(root: Node): Promise<ScanStats> {
    if (this.parsing) throw new Error('LexiEng is already parsing this page');
    return this.parseRoots([root], false);
  }

  public clear(notify = true): void {
    this.stopObserver();
    const parents = new Set<Node>();
    for (const marker of document.querySelectorAll('.lexieng-word')) {
      const parent = marker.parentNode;
      if (!parent) continue;
      parents.add(parent);
      marker.replaceWith(document.createTextNode(marker.textContent ?? ''));
    }
    for (const parent of parents) parent.normalize();
    this.parsed = false;
    this.stats = undefined;
    if (notify) this.onStateChange(undefined, false);
  }

  public visibleReviewCardIds(settings: Settings): number[] {
    const allowed = new Set<LearningState>();
    if (settings.massReviewNew) allowed.add('new');
    if (settings.massReviewDue) allowed.add('due');
    if (settings.massReviewLearning) allowed.add('learning');
    if (settings.massReviewYoung) allowed.add('young');
    if (settings.massReviewMature) allowed.add('mature');

    const ids = new Set<number>();
    for (const marker of document.querySelectorAll<HTMLElement>(
      '.lexieng-word[data-anki-card-ids]',
    )) {
      if (!allowed.has(marker.dataset.learningState as LearningState)) continue;
      const rect = marker.getBoundingClientRect();
      if (
        rect.bottom < 0 ||
        rect.top > window.innerHeight ||
        rect.right < 0 ||
        rect.left > window.innerWidth
      ) {
        continue;
      }
      for (const raw of (marker.dataset.ankiCardIds ?? '').split(',')) {
        const cardId = Number(raw);
        if (Number.isFinite(cardId)) ids.add(cardId);
      }
    }
    return [...ids];
  }

  public refreshStats(): ScanStats {
    this.stats = calculateStats();
    this.parsed = this.stats.total > 0;
    this.onStateChange(this.stats, this.parsing);
    return this.stats;
  }

  private async parseRoots(roots: Node[], watchDynamic: boolean): Promise<ScanStats> {
    const nodes = roots.flatMap((root) => this.collectTextNodes(root));
    const stats = await this.parseNodes(nodes, watchDynamic);
    return stats;
  }

  private async parseNodes(nodes: Text[], watchDynamic: boolean): Promise<ScanStats> {
    if (nodes.length === 0) {
      const empty = calculateStats();
      this.stats = empty;
      this.onStateChange(empty, false);
      return empty;
    }

    this.parsing = true;
    this.onStateChange(this.stats, true);
    try {
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
        }
        for (const [nodeIndex, tokens] of byNode) {
          const node = batch[nodeIndex];
          if (node?.isConnected) markTextNode(node, tokens);
        }
        await yieldToPage();
      }

      this.parsed = true;
      this.stats = calculateStats();
      const settings = await this.getSettings();
      if (watchDynamic && settings.parseDynamicContent) this.startObserver();
      await chrome.runtime
        .sendMessage({ type: 'scanStats', stats: this.stats } satisfies RuntimeRequest)
        .catch(() => undefined);
      return this.stats;
    } finally {
      this.parsing = false;
      this.onStateChange(this.stats, false);
    }
  }

  private collectTextNodes(root: Node, extraFilter?: (node: Text) => boolean): Text[] {
    const nodes: Text[] = [];
    let characters = 0;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!(node instanceof Text) || !node.data.trim()) return NodeFilter.FILTER_REJECT;
        if (extraFilter && !extraFilter(node)) return NodeFilter.FILTER_REJECT;
        const parent = node.parentElement;
        if (!parent || parent.closest(EXCLUDED_SELECTOR)) return NodeFilter.FILTER_REJECT;
        const style = getComputedStyle(parent);
        if (style.display === 'none' || style.visibility === 'hidden') {
          return NodeFilter.FILTER_REJECT;
        }
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

  private startObserver(): void {
    this.stopObserver();
    this.observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const added of mutation.addedNodes) {
          if (
            added instanceof Element &&
            (added.matches('.lexieng-word, [data-lexieng-ignore]') ||
              added.closest('[data-lexieng-ignore]'))
          ) {
            continue;
          }
          this.pendingRoots.add(added);
        }
      }
      if (this.pendingRoots.size === 0 || this.observerTimer !== undefined) return;
      this.observerTimer = window.setTimeout(() => {
        this.observerTimer = undefined;
        const roots = [...this.pendingRoots].filter((node) => node.isConnected);
        this.pendingRoots.clear();
        const nodes = roots.flatMap((root) => this.collectTextNodes(root));
        if (nodes.length > 0) void this.parseNodes(nodes, false);
      }, 120);
    });
    this.observer.observe(document.body, { childList: true, subtree: true });
  }

  private stopObserver(): void {
    this.observer?.disconnect();
    this.observer = undefined;
    if (this.observerTimer !== undefined) window.clearTimeout(this.observerTimer);
    this.observerTimer = undefined;
    this.pendingRoots.clear();
  }
}

function markTextNode(node: Text, tokens: ClassifiedToken[]): void {
  if (!node.parentNode || node.parentElement?.closest('.lexieng-word')) return;
  const original = node.data;
  const fragment = document.createDocumentFragment();
  let cursor = 0;

  for (const token of tokens.sort((a, b) => a.start - b.start)) {
    if (token.start < cursor || token.end > original.length) continue;
    fragment.append(original.slice(cursor, token.start));
    const marker = document.createElement('span');
    marker.className = [
      'lexieng-word',
      `lexieng-${token.state}`,
      `lexieng-state-${token.learningState}`,
      token.matched !== token.normalized ? 'lexieng-redundant' : '',
    ]
      .filter(Boolean)
      .join(' ');
    marker.dataset.word = token.surface;
    marker.dataset.normalized = token.matched || token.normalized;
    marker.dataset.frequency = token.frequencyRank?.toString() ?? '';
    marker.dataset.filterState = token.state;
    marker.dataset.learningState = token.learningState;
    marker.dataset.hasDefinition = String(token.hasDefinition);
    marker.dataset.ankiCardIds = token.ankiCardIds.join(',');
    marker.setAttribute('role', 'button');
    marker.setAttribute(
      'aria-label',
      `${token.surface}, ${token.learningState}, ${
        token.frequencyRank === undefined ? 'unranked' : `frequency rank ${Math.round(token.frequencyRank)}`
      }`,
    );
    marker.title = 'Press Q or click for LexiEng';
    marker.textContent = original.slice(token.start, token.end);
    fragment.append(marker);
    cursor = token.end;
  }

  fragment.append(original.slice(cursor));
  node.replaceWith(fragment);
}

function calculateStats(): ScanStats {
  const states: ScanStats['states'] = {};
  const uniqueWords = new Set<string>();
  const uniqueKnownWords = new Set<string>();
  let total = 0;
  let known = 0;
  let knownAnki = 0;
  let knownFrequency = 0;
  let targets = 0;
  let outsideRange = 0;
  let unranked = 0;

  for (const marker of document.querySelectorAll<HTMLElement>('.lexieng-word')) {
    const normalized = marker.dataset.normalized || marker.dataset.word || '';
    const filterState = marker.dataset.filterState;
    const learningState = marker.dataset.learningState as LearningState | undefined;
    total += 1;
    if (normalized) uniqueWords.add(normalized);
    if (!marker.dataset.frequency) unranked += 1;
    if (learningState) states[learningState] = (states[learningState] ?? 0) + 1;

    if (filterState === 'known-anki' || filterState === 'known-manual') {
      known += 1;
      if (normalized) uniqueKnownWords.add(normalized);
      if (filterState === 'known-anki') knownAnki += 1;
    } else if (filterState === 'known-frequency') {
      known += 1;
      knownFrequency += 1;
      if (normalized) uniqueKnownWords.add(normalized);
    } else if (filterState === 'target') {
      targets += 1;
    } else {
      outsideRange += 1;
    }
  }

  return {
    total,
    unique: uniqueWords.size,
    uniqueKnown: uniqueKnownWords.size,
    known,
    knownAnki,
    knownFrequency,
    targets,
    outsideRange,
    unranked,
    coverage: total === 0 ? 100 : (known / total) * 100,
    uniqueCoverage: uniqueWords.size === 0 ? 100 : (uniqueKnownWords.size / uniqueWords.size) * 100,
    states,
  };
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

async function sendMessage<T>(message: RuntimeRequest): Promise<T> {
  const response = (await chrome.runtime.sendMessage(message)) as T | { error?: string };
  if (response && typeof response === 'object' && 'error' in response && response.error) {
    throw new Error(response.error);
  }
  return response as T;
}

function yieldToPage(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, 0));
}
