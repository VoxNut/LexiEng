import { renderLookupResult } from '../shared/renderer';
import { LearningState, LookupResult, RuntimeRequest, Settings, Theme } from '../shared/types';

interface PopupAnchor {
  getBoundingClientRect(): DOMRect;
}

export class PopupController {
  private host?: HTMLElement;
  private results?: HTMLElement;
  private activeQuery = '';
  private activeAnchor?: PopupAnchor;
  private hoveredWord?: HTMLElement;
  private lastPointer?: { x: number; y: number };
  private hoverTimer?: number;
  private settings?: Settings;

  public constructor(
    private readonly getSettings: () => Promise<Settings>,
    private readonly onStateChange: () => void,
  ) {
    document.addEventListener('pointermove', this.handlePointerMove, {
      capture: true,
      passive: true,
    });
    document.addEventListener('pointerover', this.handlePointerOver, true);
    document.addEventListener('pointerout', this.handlePointerOut, true);
    document.addEventListener('click', this.handleClick, true);
    document.addEventListener('keydown', this.handleKeydown, true);
    document.addEventListener('pointerdown', this.handleOutsidePointer, true);
  }

  public get isOpen(): boolean {
    return Boolean(this.host?.isConnected);
  }

  public applySettings(settings: Settings): void {
    this.settings = settings;
    const shell = this.host?.shadowRoot?.querySelector<HTMLElement>('.lexieng-popup-shell');
    if (shell) {
      shell.dataset.theme = settings.theme;
      shell.style.width = `${settings.popupWidth}px`;
      shell.style.maxHeight = `${settings.popupHeight}px`;
    }
  }

  public applyTheme(theme: Theme): void {
    const shell = this.host?.shadowRoot?.querySelector<HTMLElement>('.lexieng-popup-shell');
    if (shell) shell.dataset.theme = theme;
  }

  public async openElement(element: HTMLElement): Promise<void> {
    const word = element.dataset.word ?? element.textContent ?? '';
    if (!word.trim()) return;
    await this.openWord(word, element);
  }

  public async openWord(word: string, anchor?: PopupAnchor): Promise<void> {
    const query = word.trim();
    if (!query) return;
    this.settings ??= await this.getSettings();
    this.activeQuery = query;
    this.activeAnchor = anchor ?? centeredAnchor();
    this.ensureHost();
    this.renderLoading();
    this.position();

    try {
      const result = await sendMessage<LookupResult>({ type: 'lookup', query });
      if (this.activeQuery !== query || !this.results) return;
      this.renderResult(result);
      this.updateParsedMarkers(result);
      this.position();
    } catch (error) {
      if (!this.results) return;
      this.results.replaceChildren(
        textElement('div', error instanceof Error ? error.message : String(error), 'lookup-error'),
      );
    }
  }

  public close(): void {
    this.host?.remove();
    this.host = undefined;
    this.results = undefined;
    this.activeQuery = '';
    this.activeAnchor = undefined;
  }

  private readonly handlePointerMove = (event: PointerEvent): void => {
    this.lastPointer = { x: event.clientX, y: event.clientY };
    const marker = findMarker(event);
    if (marker) this.hoveredWord = marker;
  };

  private readonly handlePointerOver = (event: PointerEvent): void => {
    const marker = findMarker(event);
    if (!marker) return;
    this.hoveredWord = marker;
    if (!this.settings?.showPopupOnHover) return;
    if (this.hoverTimer !== undefined) window.clearTimeout(this.hoverTimer);
    this.hoverTimer = window.setTimeout(() => void this.openElement(marker), 90);
  };

  private readonly handlePointerOut = (event: PointerEvent): void => {
    const marker = findMarker(event);
    if (!marker || marker !== this.hoveredWord) return;
    const related =
      event.relatedTarget instanceof Element
        ? event.relatedTarget.closest<HTMLElement>('.lexieng-word')
        : null;
    if (related !== marker) this.hoveredWord = undefined;
    if (this.hoverTimer !== undefined) window.clearTimeout(this.hoverTimer);
    this.hoverTimer = undefined;
  };

  private readonly handleClick = (event: MouseEvent): void => {
    const marker = findMarker(event);
    if (!marker) return;
    event.preventDefault();
    event.stopPropagation();
    void this.openElement(marker);
  };

  private readonly handleKeydown = (event: KeyboardEvent): void => {
    if (isTypingContext(event.target)) return;
    if (event.key === 'Escape' && this.isOpen) {
      event.preventDefault();
      this.close();
      return;
    }
    if (this.isOpen && /^Digit[1-4]$/.test(event.code)) {
      const ease = Number(event.code.slice(-1));
      const button = this.host?.shadowRoot?.querySelector<HTMLButtonElement>(
        `.anki-grade-${ease}:not(:disabled)`,
      );
      if (button) {
        event.preventDefault();
        event.stopPropagation();
        button.click();
      }
      return;
    }
    if (event.altKey && event.code === 'KeyL') {
      const lookup = selectionLookup();
      if (!lookup) return;
      event.preventDefault();
      event.stopPropagation();
      void this.openWord(lookup.word, lookup.anchor);
      return;
    }
    if (
      event.code !== 'KeyQ' ||
      event.repeat ||
      event.ctrlKey ||
      event.altKey ||
      event.metaKey
    ) {
      return;
    }

    const marker =
      (this.hoveredWord?.isConnected ? this.hoveredWord : undefined) ??
      markerAtPoint(this.lastPointer);
    const lookup = marker ? undefined : selectionLookup() ?? wordAtLastPointer(this.lastPointer);
    if (!marker && !lookup) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    if (marker) void this.openElement(marker);
    else if (lookup) void this.openWord(lookup.word, lookup.anchor);
  };

  private readonly handleOutsidePointer = (event: PointerEvent): void => {
    if (!this.host || event.composedPath().includes(this.host)) return;
    if (findMarker(event)) return;
    this.close();
  };

  private ensureHost(): void {
    if (this.host?.isConnected) return;
    const host = document.createElement('aside');
    host.id = 'lexieng-popup-host';
    host.dataset.lexiengIgnore = 'true';
    host.setAttribute('aria-label', 'LexiEng dictionary');
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.append(stylesheet('styles/base.css'), stylesheet('styles/popup.css'));

    const shell = document.createElement('section');
    shell.className = 'lexieng-popup-shell';
    shell.dataset.theme = this.settings?.theme ?? 'default';
    shell.style.width = `${this.settings?.popupWidth ?? 420}px`;
    shell.style.maxHeight = `${this.settings?.popupHeight ?? 520}px`;

    const close = document.createElement('button');
    close.className = 'lexieng-popup-close';
    close.type = 'button';
    close.textContent = 'Close';
    close.addEventListener('click', () => this.close());
    const results = document.createElement('div');
    results.className = 'lexieng-popup-results lookup-results';
    shell.append(close, results);
    shadow.append(shell);
    document.documentElement.append(host);
    this.host = host;
    this.results = results;
  }

  private renderLoading(): void {
    this.results?.replaceChildren(textElement('div', 'Looking up…', 'lexieng-popup-loading'));
  }

  private renderResult(result: LookupResult): void {
    if (!this.results) return;
    renderLookupResult(
      this.results,
      result,
      (nested) => void this.openWord(nested, this.activeAnchor),
      (known) => void this.setKnown(result.query, known),
      (cardId, ease) => this.reviewCard(cardId, ease, result.query),
      () => this.mineToAnki(result.query),
    );
  }

  private async setKnown(term: string, known: boolean): Promise<void> {
    await sendMessage({ type: 'setKnown', term, known });
    await this.openWord(term, this.activeAnchor);
    this.onStateChange();
  }

  private async reviewCard(cardId: number, ease: 1 | 2 | 3 | 4, term: string): Promise<void> {
    await sendMessage({ type: 'reviewAnkiCard', cardId, ease });
    await this.openWord(term, this.activeAnchor);
    this.onStateChange();
  }

  private async mineToAnki(term: string): Promise<void> {
    const sentence = this.getSentence();
    await sendMessage({ type: 'mineToAnki', term, sentence });
    await this.openWord(term, this.activeAnchor);
    this.onStateChange();
  }

  private getSentence(): string | undefined {
    const anchor = this.activeAnchor;
    let element: Element | null = null;
    if (anchor instanceof Element) {
      element = anchor;
    } else if (anchor instanceof Range) {
      element =
        anchor.commonAncestorContainer instanceof Element
          ? anchor.commonAncestorContainer
          : anchor.commonAncestorContainer.parentElement;
    }
    const sentence =
      element?.closest('p, li, blockquote, figcaption, td, article')?.textContent?.trim() ?? '';
    return sentence ? sentence.replace(/\s+/g, ' ').slice(0, 1200) : undefined;
  }

  private updateParsedMarkers(result: LookupResult): void {
    const settings = this.settings;
    if (!settings) return;
    const learningState = lookupLearningState(result, settings);
    const filterState = lookupFilterState(result, settings);
    const normalized = CSS.escape(result.matched || result.normalized);
    for (const marker of document.querySelectorAll<HTMLElement>(
      `.lexieng-word[data-normalized="${normalized}"]`,
    )) {
      for (const className of [...marker.classList]) {
        if (className.startsWith('lexieng-state-') || /^lexieng-(known|target|outside)/.test(className)) {
          marker.classList.remove(className);
        }
      }
      marker.classList.add(`lexieng-${filterState}`, `lexieng-state-${learningState}`);
      marker.dataset.filterState = filterState;
      marker.dataset.learningState = learningState;
      marker.dataset.ankiCardIds = result.ankiCards.map((card) => card.cardId).join(',');
    }
  }

  private position(): void {
    if (!this.host || !this.activeAnchor) return;
    const anchor = this.activeAnchor.getBoundingClientRect();
    const width = Math.min(this.settings?.popupWidth ?? 420, window.innerWidth - 20);
    this.host.style.width = `${width}px`;
    const maximumHeight = Math.min(this.settings?.popupHeight ?? 520, window.innerHeight - 20);
    const measuredHeight = Math.min(
      this.host.getBoundingClientRect().height || maximumHeight,
      maximumHeight,
    );
    const left = Math.max(10, Math.min(anchor.left, window.innerWidth - width - 10));
    const top =
      window.innerHeight - anchor.bottom >= measuredHeight + 8
        ? anchor.bottom + 6
        : Math.max(10, anchor.top - measuredHeight - 6);
    this.host.style.left = `${left}px`;
    this.host.style.top = `${top}px`;
  }
}

function lookupLearningState(result: LookupResult, settings: Settings): LearningState {
  if (result.knownSources.includes('manual')) return 'mastered';
  if (result.ankiCards.some((card) => card.state === 'suspended')) return 'suspended';
  if (result.ankiCards.some((card) => card.state === 'buried')) return 'buried';
  if (result.ankiCards.some((card) => card.state === 'due')) return 'due';
  if (result.ankiCards.some((card) => card.state === 'learning')) return 'learning';
  if (result.ankiCards.some((card) => card.state === 'new')) return 'new';
  const reviewCards = result.ankiCards.filter((card) => card.state === 'review');
  if (reviewCards.length > 0) {
    return reviewCards.some((card) => card.intervalDays >= settings.matureIntervalDays)
      ? 'mature'
      : 'young';
  }
  if (result.knownByFrequency) return 'frequency';
  const frequency = result.frequencyRank;
  if (
    (frequency === undefined && settings.highlightUnranked) ||
    (frequency !== undefined &&
      frequency >= settings.frequencyMin &&
      frequency <= settings.frequencyMax)
  ) {
    return 'target';
  }
  return 'outside-range';
}

function lookupFilterState(result: LookupResult, settings: Settings): string {
  if (result.knownSources.includes('manual')) return 'known-manual';
  if (result.knownSources.includes('anki')) return 'known-anki';
  if (result.knownByFrequency) return 'known-frequency';
  const frequency = result.frequencyRank;
  if (
    (frequency === undefined && settings.highlightUnranked) ||
    (frequency !== undefined &&
      frequency >= settings.frequencyMin &&
      frequency <= settings.frequencyMax)
  ) {
    return 'target';
  }
  return 'outside-range';
}

function findMarker(event: Event): HTMLElement | undefined {
  for (const item of event.composedPath()) {
    if (item instanceof HTMLElement && item.matches('.lexieng-word')) return item;
  }
  return event.target instanceof Element
    ? event.target.closest<HTMLElement>('.lexieng-word') ?? undefined
    : undefined;
}

function markerAtPoint(point: { x: number; y: number } | undefined): HTMLElement | undefined {
  if (!point) return undefined;
  return document.elementFromPoint(point.x, point.y)?.closest<HTMLElement>('.lexieng-word') ?? undefined;
}

function selectionLookup(): { word: string; anchor: Range } | undefined {
  const selection = window.getSelection();
  const word = selection?.toString().trim() ?? '';
  if (!word || word.length > 160 || !selection?.rangeCount) return undefined;
  return { word, anchor: selection.getRangeAt(0).cloneRange() };
}

function wordAtLastPointer(
  point: { x: number; y: number } | undefined,
): { word: string; anchor: Range } | undefined {
  if (!point) return undefined;
  return wordAtPoint(point.x, point.y);
}

function wordAtPoint(x: number, y: number): { word: string; anchor: Range } | undefined {
  let node: Node | null = null;
  let offset = 0;
  const caretDocument = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  const position = caretDocument.caretPositionFromPoint?.(x, y);
  if (position) {
    node = position.offsetNode;
    offset = position.offset;
  } else {
    const range = caretDocument.caretRangeFromPoint?.(x, y);
    if (range) {
      node = range.startContainer;
      offset = range.startOffset;
    }
  }
  if (!(node instanceof Text) || node.parentElement?.closest('[data-lexieng-ignore]')) {
    return undefined;
  }

  const matcher = /[\p{L}\p{M}\p{N}]+(?:['’\u2010-\u2015-][\p{L}\p{M}\p{N}]+)*/gu;
  for (const match of node.data.matchAll(matcher)) {
    const start = match.index;
    const end = start + match[0].length;
    if (offset < start || offset > end) continue;
    const range = document.createRange();
    range.setStart(node, start);
    range.setEnd(node, end);
    return { word: match[0], anchor: range };
  }
  return undefined;
}

function isTypingContext(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return Boolean(
    target.closest('input, textarea, select, [contenteditable="true"], [role="textbox"]'),
  );
}

function centeredAnchor(): PopupAnchor {
  return {
    getBoundingClientRect: () =>
      new DOMRect(window.innerWidth / 2 - 1, window.innerHeight / 3, 2, 2),
  };
}

function stylesheet(path: string): HTMLLinkElement {
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = chrome.runtime.getURL(path);
  return link;
}

function textElement(tag: keyof HTMLElementTagNameMap, text: string, className: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
}

async function sendMessage<T = unknown>(message: RuntimeRequest): Promise<T> {
  const response = (await chrome.runtime.sendMessage(message)) as T | { error?: string };
  if (response && typeof response === 'object' && 'error' in response && response.error) {
    throw new Error(response.error);
  }
  return response as T;
}
