import { AnkiCardSnapshot, AnkiEase, LookupResult } from './types';
import { formatNumber, isRecord } from './util';

const ALLOWED_TAGS = new Set([
  'a',
  'br',
  'code',
  'details',
  'div',
  'em',
  'li',
  'ol',
  'p',
  'rp',
  'rt',
  'ruby',
  'small',
  'span',
  'strong',
  'sub',
  'summary',
  'sup',
  'table',
  'tbody',
  'td',
  'th',
  'thead',
  'tr',
  'ul',
]);

const ALLOWED_STYLES = new Set([
  'backgroundColor',
  'borderBottom',
  'borderColor',
  'borderStyle',
  'borderWidth',
  'color',
  'display',
  'fontFamily',
  'fontSize',
  'fontStyle',
  'fontWeight',
  'lineHeight',
  'margin',
  'marginBottom',
  'marginLeft',
  'marginRight',
  'marginTop',
  'padding',
  'paddingBottom',
  'paddingLeft',
  'paddingRight',
  'paddingTop',
  'textAlign',
  'textDecorationLine',
  'verticalAlign',
  'whiteSpace',
]);

export function renderLookupResult(
  container: HTMLElement,
  result: LookupResult,
  onLookup: (term: string) => void,
  onKnownChange: (known: boolean) => void,
  onAnkiReview?: (cardId: number, ease: AnkiEase) => Promise<void>,
  onMine?: () => Promise<void>,
): void {
  container.replaceChildren();

  const header = element('div', 'lookup-header');
  const wordLine = element('div', 'lookup-word-line');
  const heading = document.createElement('h3');
  heading.textContent = result.query;
  wordLine.append(heading);
  if (result.frequencyRank !== undefined) {
    const frequency = element('span', 'frequency-badge');
    frequency.textContent = `Frequency #${formatNumber(Math.round(result.frequencyRank))}`;
    wordLine.append(frequency);
  }
  header.append(wordLine);

  if (result.ipa.length > 0) {
    const ipaList = element('div', 'ipa-list');
    for (const transcription of result.ipa) {
      const item = document.createElement('span');
      item.textContent = `${transcription.ipa}${transcription.tags.length ? ` ${transcription.tags.join(' ')}` : ''}`;
      item.title = transcription.dictionaryTitle;
      ipaList.append(item);
    }
    header.append(ipaList);
  }

  const isKnown = result.knownSources.length > 0;
  const isManual = result.knownSources.includes('manual');
  const knownLine = element('div', 'known-line');
  const knownText = document.createElement('span');
  knownText.textContent = isKnown
    ? `Known via ${result.knownSources.join(' + ')}`
    : result.knownByFrequency
      ? 'Excluded by frequency floor'
      : 'Not in your known-word list';
  knownLine.append(knownText);
  const knownActions = element('div', 'known-actions');
  if (!isKnown && onMine) {
    const mineButton = element('button', 'primary-button');
    mineButton.type = 'button';
    mineButton.textContent = 'Add to Anki';
    mineButton.addEventListener('click', () => {
      mineButton.disabled = true;
      mineButton.textContent = 'Adding…';
      void onMine().catch((error: unknown) => {
        mineButton.disabled = false;
        mineButton.textContent = error instanceof Error ? error.message : String(error);
      });
    });
    knownActions.append(mineButton);
  }
  if (isManual || !isKnown) {
    const knownButton = element('button', isManual ? 'danger-button' : 'secondary-button');
    knownButton.type = 'button';
    knownButton.textContent = isManual ? 'Unmark manual' : 'Mark known';
    knownButton.addEventListener('click', () => onKnownChange(!isManual));
    knownActions.append(knownButton);
  }
  knownLine.append(knownActions);
  header.append(knownLine);
  container.append(header);

  renderAnkiCards(container, result, onAnkiReview);

  if (result.entries.length === 0) {
    const empty = element('div', 'empty-state');
    empty.append(
      textElement('strong', 'No definition found.'),
      textElement('span', 'Try importing or enabling another Yomitan dictionary.'),
    );
    container.append(empty);
    return;
  }

  const grouped = new Map<string, typeof result.entries>();
  for (const entry of result.entries) {
    const key = `${entry.dictionaryId}\u0000${entry.dictionaryTitle}`;
    const values = grouped.get(key) ?? [];
    values.push(entry);
    grouped.set(key, values);
  }

  for (const entries of grouped.values()) {
    const section = element('section', 'dictionary-result');
    const title = element('div', 'dictionary-title');
    title.textContent = `${entries[0]?.dictionaryTitle ?? 'Dictionary'} · ${entries.length} ${entries.length === 1 ? 'entry' : 'entries'}`;
    section.append(title);
    for (const entry of entries.slice(0, 12)) {
      const definition = element('div', 'dictionary-definition');
      if (entry.reading && entry.reading !== entry.headword) {
        definition.append(textElement('div', entry.reading));
      }
      renderStructuredValue(definition, entry.glossary, onLookup);
      section.append(definition);
    }
    container.append(section);
  }
}

function renderAnkiCards(
  container: HTMLElement,
  result: LookupResult,
  onReview?: (cardId: number, ease: AnkiEase) => Promise<void>,
): void {
  if (result.ankiCards.length === 0) {
    if (!result.knownSources.includes('anki')) return;
    const missing = element('section', 'anki-review-panel anki-review-missing');
    missing.append(
      textElement('strong', 'Anki schedule not loaded'),
      textElement('span', 'Sync the deck again in LexiEng settings to add FSRS state and review buttons.'),
    );
    container.append(missing);
    return;
  }

  const panel = element('section', 'anki-review-panel');
  const title = element('div', 'anki-review-title');
  title.append(
    textElement('strong', 'Anki / FSRS'),
    textElement('span', 'Your grade goes to Anki; its active scheduler sets the interval.'),
  );
  panel.append(title);

  for (const card of result.ankiCards) panel.append(renderAnkiCard(card, onReview));
  container.append(panel);
}

function renderAnkiCard(
  card: AnkiCardSnapshot,
  onReview?: (cardId: number, ease: AnkiEase) => Promise<void>,
): HTMLElement {
  const cardNode = element('article', 'anki-card');
  const summary = element('div', 'anki-card-summary');
  const state = element('span', `anki-state anki-state-${card.state}`);
  state.textContent = cardStateLabel(card.state);
  const metrics = element('span', 'anki-card-metrics');
  const interval = card.intervalDays > 0 ? `${formatNumber(card.intervalDays)}d interval` : 'No interval';
  metrics.textContent = `${interval} · ${formatNumber(card.reps)} reviews · ${formatNumber(card.lapses)} lapses`;
  summary.append(state, metrics);
  cardNode.append(summary);

  if (!onReview || card.state === 'suspended' || card.state === 'buried') return cardNode;

  const actions = element('div', 'anki-grade-actions');
  const status = element('div', 'anki-review-status');
  const grades: Array<{ ease: AnkiEase; label: string }> = [
    { ease: 1, label: 'Again' },
    { ease: 2, label: 'Hard' },
    { ease: 3, label: 'Good' },
    { ease: 4, label: 'Easy' },
  ];
  const buttons: HTMLButtonElement[] = [];

  for (const { ease, label } of grades) {
    const button = element('button', `anki-grade anki-grade-${ease}`);
    button.type = 'button';
    button.append(textElement('strong', label));
    button.addEventListener('click', () => {
      for (const item of buttons) item.disabled = true;
      status.textContent = `Saving ${label.toLowerCase()} to Anki…`;
      void onReview(card.cardId, ease)
        .then(() => {
          if (status.isConnected) status.textContent = 'Reviewed in Anki.';
        })
        .catch((error: unknown) => {
          status.textContent = error instanceof Error ? error.message : String(error);
          for (const item of buttons) item.disabled = false;
        });
    });
    buttons.push(button);
    actions.append(button);
  }
  cardNode.append(actions, status);
  return cardNode;
}

function cardStateLabel(state: AnkiCardSnapshot['state']): string {
  switch (state) {
    case 'new': return 'New';
    case 'learning': return 'Learning';
    case 'due': return 'Due now';
    case 'review': return 'Not due';
    case 'suspended': return 'Suspended';
    case 'buried': return 'Buried';
  }
}

export function renderStructuredValue(
  parent: HTMLElement,
  value: unknown,
  onLookup: (term: string) => void,
): void {
  if (value === null || value === undefined) return;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    parent.append(document.createTextNode(String(value)));
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((child, index) => {
      renderStructuredValue(parent, child, onLookup);
      if (index < value.length - 1 && shouldSeparate(value[index], value[index + 1])) {
        parent.append(document.createElement('br'));
      }
    });
    return;
  }
  if (!isRecord(value)) return;

  if (value.type === 'structured-content') {
    renderStructuredValue(parent, value.content, onLookup);
    return;
  }
  if (value.type === 'text' && typeof value.text === 'string') {
    parent.append(document.createTextNode(value.text));
    return;
  }

  const requestedTag = typeof value.tag === 'string' ? value.tag.toLowerCase() : 'span';
  const tag = ALLOWED_TAGS.has(requestedTag) ? requestedTag : 'span';
  const node = document.createElement(tag);
  applySafeStyle(node, value.style);
  applySafeClasses(node, value.data);

  if (tag === 'a') {
    node.setAttribute('href', '#');
    node.addEventListener('click', (event) => {
      event.preventDefault();
      const href = typeof value.href === 'string' ? value.href : '';
      const query = new URLSearchParams(href.split('?')[1] ?? '').get('query') ?? node.textContent ?? '';
      if (query) onLookup(query);
    });
  }
  if (tag === 'details' && value.open === true) node.setAttribute('open', '');

  renderStructuredValue(node, value.content ?? value.text, onLookup);
  parent.append(node);
}

function applySafeStyle(node: HTMLElement, value: unknown): void {
  if (!isRecord(value)) return;
  for (const [property, raw] of Object.entries(value)) {
    if (!ALLOWED_STYLES.has(property) || (typeof raw !== 'string' && typeof raw !== 'number')) continue;
    const styleValue = String(raw);
    if (/url\s*\(|expression\s*\(/i.test(styleValue)) continue;
    node.style.setProperty(camelToKebab(property), styleValue);
  }
}

function applySafeClasses(node: HTMLElement, value: unknown): void {
  if (!isRecord(value) || typeof value.class !== 'string') return;
  for (const className of value.class.split(/\s+/).filter(Boolean)) {
    if (/^[a-zA-Z_][\w-]{0,80}$/.test(className)) node.classList.add(className);
  }
}

function shouldSeparate(current: unknown, next: unknown): boolean {
  return typeof current === 'string' && typeof next === 'string' && current.includes('\n');
}

function camelToKebab(value: string): string {
  return value.replace(/[A-Z]/g, (character) => `-${character.toLowerCase()}`);
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}

function textElement<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.textContent = text;
  return node;
}
