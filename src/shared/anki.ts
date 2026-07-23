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
  fields: string[];
  noteCount: number;
}> {
  const [version, decks] = await Promise.all([
    requestAnki<number>(url, 'version'),
    requestAnki<string[]>(url, 'deckNames'),
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
  return { version, decks, fields, noteCount: noteIds.length };
}

export async function loadAnkiKnownWords(
  url: string,
  deck: string,
  selectedField: string,
  onProgress?: (completed: number, total: number) => void,
): Promise<Array<{ normalized: string; surface: string }>> {
  const noteIds = await requestAnki<number[]>(url, 'findNotes', {
    query: `deck:"${escapeAnkiSearch(deck)}"`,
  });
  const words = new Map<string, string>();
  const batchSize = 500;
  for (let offset = 0; offset < noteIds.length; offset += batchSize) {
    const notes = await requestAnki<AnkiNote[]>(url, 'notesInfo', {
      notes: noteIds.slice(offset, offset + batchSize),
    });
    for (const note of notes) {
      const value = selectNoteValue(note, selectedField);
      if (!value) continue;
      const surface = htmlToPlainText(value);
      const normalized = normalizeTerm(surface);
      if (normalized && isPlausibleTerm(normalized)) words.set(normalized, surface);
    }
    onProgress?.(Math.min(offset + batchSize, noteIds.length), noteIds.length);
  }
  return [...words].map(([normalized, surface]) => ({ normalized, surface }));
}

export function selectNoteValue(note: AnkiNote, selectedField: string): string {
  if (selectedField && note.fields[selectedField]) return note.fields[selectedField].value;
  for (const name of PREFERRED_FIELDS) {
    if (note.fields[name]?.value) return note.fields[name].value;
  }
  return Object.values(note.fields)
    .sort((a, b) => a.order - b.order)
    .find(({ value }) => isPlausibleTerm(normalizeTerm(htmlToPlainText(value))))?.value ?? '';
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
