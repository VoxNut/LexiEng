import { AnkiCardSnapshot, AnkiCardState, AnkiEase } from './types';
import { escapeAnkiSearch, normalizeTerm } from './util';

interface AnkiResponse<T> {
  result: T;
  error: string | null;
}

export interface AnkiNote {
  noteId: number;
  modelName: string;
  tags: string[];
  fields: Record<string, { value: string; order: number }>;
}

export interface AnkiCardInfo {
  cardId: number;
  note: number;
  modelName: string;
  deckName: string;
  fields: AnkiNote['fields'];
  interval: number;
  type: number;
  queue: number;
  due: number;
  reps: number;
  lapses: number;
}

export interface AnkiSyncSnapshot {
  words: Array<{ normalized: string; surface: string }>;
  cards: AnkiCardSnapshot[];
}

const PREFERRED_FIELDS = [
  'Word',
  'word',
  'Expression',
  'expression',
  'Term',
  'term',
  'Vocabulary',
  'vocabulary',
  'Front',
  'front',
];

export async function requestAnki<T>(
  url: string,
  action: string,
  params: Record<string, unknown> = {},
): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, version: 6, params }),
  });
  if (!response.ok) throw new Error(`AnkiConnect returned HTTP ${response.status}`);
  const payload = (await response.json()) as AnkiResponse<T>;
  if (payload.error) throw new Error(payload.error);
  return payload.result;
}

export async function inspectAnki(url: string, deck: string): Promise<{
  version: number;
  decks: string[];
  models: string[];
  fields: string[];
  noteCount: number;
}> {
  const [version, decks, models] = await Promise.all([
    requestAnki<number>(url, 'version'),
    requestAnki<string[]>(url, 'deckNames'),
    requestAnki<string[]>(url, 'modelNames'),
  ]);
  const noteIds = deck
    ? await requestAnki<number[]>(url, 'findNotes', {
        query: `deck:"${escapeAnkiSearch(deck)}"`,
      })
    : [];
  const sample = noteIds.length
    ? await requestAnki<AnkiNote[]>(url, 'notesInfo', { notes: noteIds.slice(0, 20) })
    : [];
  const fields = [...new Set(sample.flatMap((note) => Object.keys(note.fields)))];
  return { version, decks, models, fields, noteCount: noteIds.length };
}

export async function loadAnkiSnapshot(
  url: string,
  deck: string,
  selectedField: string,
  onProgress?: (completed: number, total: number) => void,
): Promise<AnkiSyncSnapshot> {
  const deckQuery = `deck:"${escapeAnkiSearch(deck)}"`;
  const [cardIds, dueCardIds, suspendedCardIds, buriedCardIds] = await Promise.all([
    requestAnki<number[]>(url, 'findCards', { query: deckQuery }),
    requestAnki<number[]>(url, 'findCards', { query: `${deckQuery} is:due` }),
    requestAnki<number[]>(url, 'findCards', { query: `${deckQuery} is:suspended` }),
    requestAnki<number[]>(url, 'findCards', { query: `${deckQuery} is:buried` }),
  ]);
  const due = new Set(dueCardIds);
  const suspended = new Set(suspendedCardIds);
  const buried = new Set(buriedCardIds);
  const words = new Map<string, string>();
  const cards: AnkiCardSnapshot[] = [];
  const batchSize = 250;
  for (let offset = 0; offset < cardIds.length; offset += batchSize) {
    const batch = await requestAnki<AnkiCardInfo[]>(url, 'cardsInfo', {
      cards: cardIds.slice(offset, offset + batchSize),
    });
    for (const card of batch) {
      const value = selectNoteValue(card, selectedField);
      if (!value) continue;
      const surface = htmlToPlainText(value);
      const normalized = normalizeTerm(surface);
      if (!normalized || !isPlausibleTerm(normalized)) continue;
      words.set(normalized, surface);
      cards.push(toCardSnapshot(card, normalized, surface, {
        due: due.has(card.cardId),
        suspended: suspended.has(card.cardId),
        buried: buried.has(card.cardId),
      }));
    }
    onProgress?.(Math.min(offset + batchSize, cardIds.length), cardIds.length);
  }
  return {
    words: [...words].map(([normalized, surface]) => ({ normalized, surface })),
    cards,
  };
}

export async function reviewAnkiCard(
  url: string,
  cardId: number,
  ease: AnkiEase,
): Promise<AnkiCardSnapshot> {
  const answered = await requestAnki<boolean[]>(url, 'answerCards', {
    answers: [{ cardId, ease }],
  });
  if (!answered[0]) throw new Error('Anki could not review this card');

  const [cards, due, suspended] = await Promise.all([
    requestAnki<AnkiCardInfo[]>(url, 'cardsInfo', { cards: [cardId] }),
    requestAnki<boolean[]>(url, 'areDue', { cards: [cardId] }),
    requestAnki<Array<boolean | null>>(url, 'areSuspended', { cards: [cardId] }),
  ]);
  const card = cards[0];
  if (!card?.cardId) throw new Error('Anki reviewed the card but did not return its new schedule');
  return toCardSnapshot(card, '', '', {
    due: Boolean(due[0]),
    suspended: Boolean(suspended[0]),
    buried: card.queue === -2 || card.queue === -3,
  });
}

export async function reviewAnkiCards(
  url: string,
  cardIds: number[],
  ease: AnkiEase,
): Promise<AnkiCardSnapshot[]> {
  const uniqueCardIds = [...new Set(cardIds)].filter(Number.isFinite);
  if (uniqueCardIds.length === 0) return [];

  const answered = await requestAnki<boolean[]>(url, 'answerCards', {
    answers: uniqueCardIds.map((cardId) => ({ cardId, ease })),
  });
  const accepted = uniqueCardIds.filter((_cardId, index) => answered[index]);
  if (accepted.length === 0) throw new Error('Anki did not accept any of the selected reviews');

  const [cards, due, suspended] = await Promise.all([
    requestAnki<AnkiCardInfo[]>(url, 'cardsInfo', { cards: accepted }),
    requestAnki<boolean[]>(url, 'areDue', { cards: accepted }),
    requestAnki<Array<boolean | null>>(url, 'areSuspended', { cards: accepted }),
  ]);
  const dueById = new Map(accepted.map((cardId, index) => [cardId, Boolean(due[index])]));
  const suspendedById = new Map(
    accepted.map((cardId, index) => [cardId, Boolean(suspended[index])]),
  );

  return cards.map((card) =>
    toCardSnapshot(card, '', '', {
      due: dueById.get(card.cardId) ?? false,
      suspended: suspendedById.get(card.cardId) ?? false,
      buried: card.queue === -2 || card.queue === -3,
    }),
  );
}

export interface AnkiMiningNote {
  deck: string;
  model: string;
  wordField: string;
  meaningField: string;
  sentenceField: string;
  ipaField: string;
  frequencyField: string;
  word: string;
  meaning: string;
  sentence: string;
  ipa: string;
  frequency: string;
}

export async function mineAnkiNote(
  url: string,
  note: AnkiMiningNote,
): Promise<{ noteId: number; cards: AnkiCardSnapshot[]; modelName: string }> {
  const modelName = note.model || (await detectDeckModel(url, note.deck));
  if (!modelName) {
    throw new Error('Choose an Anki note type in LexiEng settings before mining');
  }

  const fieldNames = await requestAnki<string[]>(url, 'modelFieldNames', { modelName });
  const wordField = resolveFieldName(fieldNames, note.wordField, PREFERRED_FIELDS);
  if (!wordField) {
    throw new Error(`Could not find a word field in the Anki note type “${modelName}”`);
  }

  const fields = Object.fromEntries(fieldNames.map((field) => [field, '']));
  fields[wordField] = note.word;
  assignExistingField(fields, note.meaningField, note.meaning);
  assignExistingField(fields, note.sentenceField, note.sentence);
  assignExistingField(fields, note.ipaField, note.ipa);
  assignExistingField(fields, note.frequencyField, note.frequency);

  const noteId = await requestAnki<number | null>(url, 'addNote', {
    note: {
      deckName: note.deck,
      modelName,
      fields,
      options: { allowDuplicate: false },
      tags: ['lexieng'],
    },
  });
  if (!noteId) throw new Error('Anki did not create the note. It may already exist.');

  const cardIds = await requestAnki<number[]>(url, 'findCards', { query: `nid:${noteId}` });
  const cards = await loadCardSnapshots(url, cardIds, note.word);
  return { noteId, cards, modelName };
}

async function detectDeckModel(url: string, deck: string): Promise<string> {
  const noteIds = await requestAnki<number[]>(url, 'findNotes', {
    query: `deck:"${escapeAnkiSearch(deck)}"`,
  });
  if (noteIds.length === 0) return '';
  const notes = await requestAnki<AnkiNote[]>(url, 'notesInfo', { notes: [noteIds[0]] });
  return notes[0]?.modelName ?? '';
}

async function loadCardSnapshots(
  url: string,
  cardIds: number[],
  surface: string,
): Promise<AnkiCardSnapshot[]> {
  if (cardIds.length === 0) return [];
  const [cards, due, suspended] = await Promise.all([
    requestAnki<AnkiCardInfo[]>(url, 'cardsInfo', { cards: cardIds }),
    requestAnki<boolean[]>(url, 'areDue', { cards: cardIds }),
    requestAnki<Array<boolean | null>>(url, 'areSuspended', { cards: cardIds }),
  ]);
  const normalized = normalizeTerm(surface);
  return cards.map((card, index) =>
    toCardSnapshot(card, normalized, surface, {
      due: Boolean(due[index]),
      suspended: Boolean(suspended[index]),
      buried: card.queue === -2 || card.queue === -3,
    }),
  );
}

function resolveFieldName(
  fields: string[],
  selected: string,
  preferred: string[],
): string | undefined {
  if (selected && fields.includes(selected)) return selected;
  return preferred.find((field) => fields.includes(field)) ?? fields[0];
}

function assignExistingField(
  fields: Record<string, string>,
  requestedName: string,
  value: string,
): void {
  if (requestedName && requestedName in fields && value) fields[requestedName] = value;
}

export function selectNoteValue(note: Pick<AnkiNote, 'fields'>, selectedField: string): string {
  if (selectedField && note.fields[selectedField]) return note.fields[selectedField].value;
  for (const name of PREFERRED_FIELDS) {
    if (note.fields[name]?.value) return note.fields[name].value;
  }
  return Object.values(note.fields)
    .sort((a, b) => a.order - b.order)
    .find(({ value }) => isPlausibleTerm(normalizeTerm(htmlToPlainText(value))))?.value ?? '';
}

export function getAnkiCardState(
  card: Pick<AnkiCardInfo, 'type' | 'queue'>,
  flags: { due: boolean; suspended: boolean; buried: boolean },
): AnkiCardState {
  if (flags.suspended || card.queue === -1) return 'suspended';
  if (flags.buried || card.queue === -2 || card.queue === -3) return 'buried';
  if (card.type === 0 || card.queue === 0) return 'new';
  if (card.type === 1 || card.type === 3 || card.queue === 1 || card.queue === 3) return 'learning';
  return flags.due ? 'due' : 'review';
}

export function htmlToPlainText(value: string): string {
  const withoutMedia = value
    .replace(/\[sound:[^\]]+\]/gi, ' ')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, ' ');
  return decodeEntities(withoutMedia).replace(/\s+/g, ' ').trim();
}

function isPlausibleTerm(value: string): boolean {
  if (!value || value.length > 100) return false;
  const words = value.match(/[\p{L}\p{N}]+/gu) ?? [];
  return words.length > 0 && words.length <= 6;
}

function toCardSnapshot(
  card: AnkiCardInfo,
  normalized: string,
  surface: string,
  flags: { due: boolean; suspended: boolean; buried: boolean },
): AnkiCardSnapshot {
  return {
    cardId: card.cardId,
    noteId: card.note,
    normalized,
    surface,
    deckName: card.deckName,
    modelName: card.modelName,
    state: getAnkiCardState(card, flags),
    intervalDays: Number.isFinite(card.interval) ? card.interval : 0,
    reps: Number.isFinite(card.reps) ? card.reps : 0,
    lapses: Number.isFinite(card.lapses) ? card.lapses : 0,
    due: Number.isFinite(card.due) ? card.due : 0,
    updatedAt: Date.now(),
  };
}

function decodeEntities(value: string): string {
  const entities: Record<string, string> = {
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'",
    '&nbsp;': ' ',
  };
  return value.replace(/&(amp|lt|gt|quot|#39|nbsp);/gi, (entity) => entities[entity.toLowerCase()] ?? entity);
}
