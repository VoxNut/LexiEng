import {
  AnkiCardSnapshot,
  DictionaryRecord,
  KnownWordRecord,
  LookupEntry,
  LookupResult,
  MetaRecord,
  Settings,
  TermRecord,
  Token,
  WordState,
} from './types';
import { normalizeTerm } from './util';

// Keep the legacy database name so existing users retain imported dictionaries after the rename.
const DATABASE_NAME = 'lexijap';
const DATABASE_VERSION = 2;

const STORES = {
  dictionaries: 'dictionaries',
  terms: 'terms',
  metadata: 'metadata',
  knownWords: 'knownWords',
  ankiCards: 'ankiCards',
} as const;

let databasePromise: Promise<IDBDatabase> | undefined;

export function openDatabase(): Promise<IDBDatabase> {
  databasePromise ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onerror = () => reject(request.error ?? new Error('Could not open LexiEng storage'));
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORES.dictionaries)) {
        database.createObjectStore(STORES.dictionaries, { keyPath: 'id' });
      }
      if (!database.objectStoreNames.contains(STORES.terms)) {
        const terms = database.createObjectStore(STORES.terms, { keyPath: 'id', autoIncrement: true });
        terms.createIndex('lookupKeys', 'lookupKeys', { multiEntry: true });
        terms.createIndex('dictionaryId', 'dictionaryId');
      }
      if (!database.objectStoreNames.contains(STORES.metadata)) {
        const metadata = database.createObjectStore(STORES.metadata, {
          keyPath: 'id',
          autoIncrement: true,
        });
        metadata.createIndex('lookupKeys', 'lookupKeys', { multiEntry: true });
        metadata.createIndex('dictionaryId', 'dictionaryId');
        metadata.createIndex('mode', 'mode');
      }
      if (!database.objectStoreNames.contains(STORES.knownWords)) {
        const known = database.createObjectStore(STORES.knownWords, { keyPath: 'normalized' });
        known.createIndex('sources', 'sources', { multiEntry: true });
      }
      if (!database.objectStoreNames.contains(STORES.ankiCards)) {
        const cards = database.createObjectStore(STORES.ankiCards, { keyPath: 'cardId' });
        cards.createIndex('normalized', 'normalized');
        cards.createIndex('noteId', 'noteId');
      }
    };
    request.onsuccess = () => resolve(request.result);
  });
  return databasePromise;
}

export async function listDictionaries(): Promise<DictionaryRecord[]> {
  const database = await openDatabase();
  const transaction = database.transaction(STORES.dictionaries, 'readonly');
  const records = await requestResult<DictionaryRecord[]>(
    transaction.objectStore(STORES.dictionaries).getAll(),
  );
  await transactionDone(transaction);
  return records.sort((a, b) => b.importedAt - a.importedAt);
}

export async function putDictionary(dictionary: DictionaryRecord): Promise<void> {
  const database = await openDatabase();
  const transaction = database.transaction(STORES.dictionaries, 'readwrite', {
    durability: 'relaxed',
  });
  transaction.objectStore(STORES.dictionaries).put(dictionary);
  await transactionDone(transaction);
}

export async function updateDictionary(
  id: string,
  patch: Partial<DictionaryRecord>,
): Promise<DictionaryRecord> {
  const database = await openDatabase();
  const transaction = database.transaction(STORES.dictionaries, 'readwrite');
  const store = transaction.objectStore(STORES.dictionaries);
  const current = await requestResult<DictionaryRecord | undefined>(store.get(id));
  if (!current) {
    transaction.abort();
    throw new Error('Dictionary no longer exists');
  }
  const updated = { ...current, ...patch };
  store.put(updated);
  await transactionDone(transaction);
  return updated;
}

export async function addImportBatch(
  dictionaryId: string,
  kind: 'terms' | 'metadata',
  records: Array<Omit<TermRecord, 'dictionaryId'> | Omit<MetaRecord, 'dictionaryId'>>,
): Promise<void> {
  if (records.length === 0) return;
  const database = await openDatabase();
  const storeName = kind === 'terms' ? STORES.terms : STORES.metadata;
  const transaction = database.transaction(storeName, 'readwrite', { durability: 'relaxed' });
  const store = transaction.objectStore(storeName);
  for (const record of records) {
    store.add({ ...record, dictionaryId });
  }
  await transactionDone(transaction);
}

export async function deleteDictionary(id: string): Promise<void> {
  const database = await openDatabase();
  const transaction = database.transaction(
    [STORES.dictionaries, STORES.terms, STORES.metadata],
    'readwrite',
  );
  transaction.objectStore(STORES.dictionaries).delete(id);
  deleteByIndex(transaction.objectStore(STORES.terms).index('dictionaryId'), id);
  deleteByIndex(transaction.objectStore(STORES.metadata).index('dictionaryId'), id);
  await transactionDone(transaction);
}

export async function removeDictionaryWithSameIdentity(
  title: string,
  revision: string,
): Promise<void> {
  const match = (await listDictionaries()).find(
    (dictionary) => dictionary.title === title && dictionary.revision === revision,
  );
  if (match) await deleteDictionary(match.id);
}

export async function getStorageStats(): Promise<{
  dictionaries: number;
  terms: number;
  metadata: number;
  knownAnki: number;
  ankiCards: number;
}> {
  const database = await openDatabase();
  const transaction = database.transaction(Object.values(STORES), 'readonly');
  const [dictionaries, terms, metadata, knownAnki, ankiCards] = await Promise.all([
    requestResult<number>(transaction.objectStore(STORES.dictionaries).count()),
    requestResult<number>(transaction.objectStore(STORES.terms).count()),
    requestResult<number>(transaction.objectStore(STORES.metadata).count()),
    requestResult<number>(transaction.objectStore(STORES.knownWords).index('sources').count('anki')),
    requestResult<number>(transaction.objectStore(STORES.ankiCards).count()),
  ]);
  await transactionDone(transaction);
  return { dictionaries, terms, metadata, knownAnki, ankiCards };
}

export async function replaceAnkiSnapshot(
  entries: Array<{ normalized: string; surface: string }>,
  cards: AnkiCardSnapshot[],
): Promise<number> {
  const database = await openDatabase();
  const removalTransaction = database.transaction([STORES.knownWords, STORES.ankiCards], 'readwrite', {
    durability: 'relaxed',
  });
  const removalStore = removalTransaction.objectStore(STORES.knownWords);
  removalTransaction.objectStore(STORES.ankiCards).clear();

  await new Promise<void>((resolve, reject) => {
    const cursorRequest = removalStore.openCursor();
    cursorRequest.onerror = () => reject(cursorRequest.error);
    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result;
      if (!cursor) {
        resolve();
        return;
      }
      const record = cursor.value as KnownWordRecord;
      if (record.sources.includes('anki')) {
        const sources = record.sources.filter((source) => source !== 'anki');
        if (sources.length === 0) cursor.delete();
        else cursor.update({ ...record, sources });
      }
      cursor.continue();
    };
  });
  await transactionDone(removalTransaction);

  const now = Date.now();
  const unique = new Map(entries.filter((entry) => entry.normalized).map((entry) => [entry.normalized, entry]));
  const insertionTransaction = database.transaction([STORES.knownWords, STORES.ankiCards], 'readwrite', {
    durability: 'relaxed',
  });
  const insertionStore = insertionTransaction.objectStore(STORES.knownWords);
  for (const entry of unique.values()) {
    const request = insertionStore.get(entry.normalized);
    request.onsuccess = () => {
      const current = request.result as KnownWordRecord | undefined;
      const sources = new Set(current?.sources ?? []);
      sources.add('anki');
      insertionStore.put({
        normalized: entry.normalized,
        surface: entry.surface,
        sources: [...sources],
        updatedAt: now,
      } satisfies KnownWordRecord);
    };
  }
  const cardStore = insertionTransaction.objectStore(STORES.ankiCards);
  for (const card of cards) cardStore.put(card);

  await transactionDone(insertionTransaction);
  return unique.size;
}

export async function updateAnkiCard(snapshot: AnkiCardSnapshot): Promise<AnkiCardSnapshot> {
  const database = await openDatabase();
  const transaction = database.transaction(STORES.ankiCards, 'readwrite');
  const store = transaction.objectStore(STORES.ankiCards);
  const current = await requestResult<AnkiCardSnapshot | undefined>(store.get(snapshot.cardId));
  const updated = {
    ...snapshot,
    normalized: snapshot.normalized || current?.normalized || '',
    surface: snapshot.surface || current?.surface || '',
  };
  store.put(updated);
  await transactionDone(transaction);
  return updated;
}

export async function setManualKnown(term: string, known: boolean): Promise<void> {
  const normalized = normalizeTerm(term);
  if (!normalized) return;
  const database = await openDatabase();
  const transaction = database.transaction(STORES.knownWords, 'readwrite');
  const store = transaction.objectStore(STORES.knownWords);
  const current = await requestResult<KnownWordRecord | undefined>(store.get(normalized));
  const sources = new Set(current?.sources ?? []);
  if (known) sources.add('manual');
  else sources.delete('manual');
  if (sources.size === 0) store.delete(normalized);
  else {
    store.put({
      normalized,
      surface: current?.surface ?? term,
      sources: [...sources],
      updatedAt: Date.now(),
    } satisfies KnownWordRecord);
  }
  await transactionDone(transaction);
}

export async function classifyTokens(
  tokens: Token[],
  settings: Settings,
): Promise<Array<Token & { state: WordState; frequencyRank?: number; hasDefinition: boolean; matched: string }>> {
  const database = await openDatabase();
  const dictionaries = await listDictionaries();
  const enabled = new Set(
    dictionaries.filter((dictionary) => dictionary.enabled && dictionary.importComplete).map(({ id }) => id),
  );
  const transaction = database.transaction([STORES.knownWords, STORES.terms, STORES.metadata], 'readonly');
  const knownStore = transaction.objectStore(STORES.knownWords);
  const termIndex = transaction.objectStore(STORES.terms).index('lookupKeys');
  const metaIndex = transaction.objectStore(STORES.metadata).index('lookupKeys');
  const cache = new Map<string, Promise<WordClassification>>();

  const classified = await Promise.all(
    tokens.map(async (token) => {
      const key = token.candidates.join('\u0000');
      let promise = cache.get(key);
      if (!promise) {
        promise = classifyCandidates(token.candidates, knownStore, termIndex, metaIndex, enabled, settings);
        cache.set(key, promise);
      }
      return { ...token, ...(await promise) };
    }),
  );
  await transactionDone(transaction);
  return classified;
}

export async function lookupTerm(
  query: string,
  candidates: string[],
  settings: Settings,
): Promise<LookupResult> {
  const database = await openDatabase();
  const dictionaries = await listDictionaries();
  const enabledDictionaries = dictionaries.filter(
    (dictionary) => dictionary.enabled && dictionary.importComplete,
  );
  const enabled = new Set(enabledDictionaries.map(({ id }) => id));
  const dictionaryMap = new Map(enabledDictionaries.map((dictionary) => [dictionary.id, dictionary]));
  const transaction = database.transaction(
    [STORES.knownWords, STORES.terms, STORES.metadata, STORES.ankiCards],
    'readonly',
  );
  const knownStore = transaction.objectStore(STORES.knownWords);
  const termIndex = transaction.objectStore(STORES.terms).index('lookupKeys');
  const metaIndex = transaction.objectStore(STORES.metadata).index('lookupKeys');
  const ankiIndex = transaction.objectStore(STORES.ankiCards).index('normalized');

  const [known, terms, metadata, ankiCards] = await Promise.all([
    firstKnownRecord(candidates, knownStore),
    getAllUnique<TermRecord>(candidates, termIndex),
    getAllUnique<MetaRecord>(candidates, metaIndex),
    getAllUnique<AnkiCardSnapshot>(candidates, ankiIndex, (entry) => entry.cardId),
  ]);
  await transactionDone(transaction);

  const enabledTerms = terms.filter((entry) => enabled.has(entry.dictionaryId));
  const enabledMetadata = metadata.filter((entry) => enabled.has(entry.dictionaryId));
  const frequencyRank = selectFrequencyRank(enabledMetadata, settings);
  const matched =
    candidates.find((candidate) => enabledTerms.some((entry) => entry.lookupKeys.includes(candidate))) ??
    candidates[0] ??
    normalizeTerm(query);
  const entries: LookupEntry[] = enabledTerms
    .sort((a, b) => b.score - a.score)
    .slice(0, 80)
    .map((entry) => ({
      ...entry,
      dictionaryTitle: dictionaryMap.get(entry.dictionaryId)?.title ?? 'Dictionary',
      dictionaryRevision: dictionaryMap.get(entry.dictionaryId)?.revision ?? '',
    }));
  const ipa = extractIpa(enabledMetadata, dictionaryMap);

  return {
    query,
    normalized: normalizeTerm(query),
    matched,
    frequencyRank,
    knownSources: known?.sources ?? [],
    knownByFrequency: frequencyRank !== undefined && frequencyRank <= settings.knownFrequencyCeiling,
    ankiCards: ankiCards.sort((a, b) => a.cardId - b.cardId),
    ipa,
    entries,
  };
}

interface WordClassification {
  state: WordState;
  frequencyRank?: number;
  hasDefinition: boolean;
  matched: string;
}

async function classifyCandidates(
  candidates: string[],
  knownStore: IDBObjectStore,
  termIndex: IDBIndex,
  metaIndex: IDBIndex,
  enabled: Set<string>,
  settings: Settings,
): Promise<WordClassification> {
  const [known, terms, metadata] = await Promise.all([
    firstKnownRecord(candidates, knownStore),
    getAllUnique<TermRecord>(candidates, termIndex),
    getAllUnique<MetaRecord>(candidates, metaIndex),
  ]);
  const enabledTerms = terms.filter((entry) => enabled.has(entry.dictionaryId));
  const enabledMetadata = metadata.filter((entry) => enabled.has(entry.dictionaryId));
  const frequencyRank = selectFrequencyRank(enabledMetadata, settings);
  const state = selectWordState(known, frequencyRank, settings);
  const matched =
    candidates.find((candidate) => enabledTerms.some((entry) => entry.lookupKeys.includes(candidate))) ??
    candidates[0] ??
    '';
  return { state, frequencyRank, hasDefinition: enabledTerms.length > 0, matched };
}

export function selectWordState(
  known: KnownWordRecord | undefined,
  frequencyRank: number | undefined,
  settings: Settings,
): WordState {
  if (known?.sources.includes('manual')) return 'known-manual';
  if (known?.sources.includes('anki')) return 'known-anki';
  if (frequencyRank !== undefined && frequencyRank <= settings.knownFrequencyCeiling) {
    return 'known-frequency';
  }
  if (frequencyRank === undefined) {
    return settings.highlightUnranked ? 'target' : 'outside-range';
  }
  return frequencyRank >= settings.frequencyMin && frequencyRank <= settings.frequencyMax
    ? 'target'
    : 'outside-range';
}

export function selectFrequencyRank(metadata: MetaRecord[], settings: Settings): number | undefined {
  const ranked = metadata.filter(
    (entry) => entry.mode === 'freq' && Number.isFinite(entry.frequencyRank),
  );
  const preferred = settings.frequencyDictionaryId
    ? ranked.filter((entry) => entry.dictionaryId === settings.frequencyDictionaryId)
    : ranked;
  const pool = preferred.length > 0 ? preferred : ranked;
  const values = pool.map((entry) => entry.frequencyRank as number);
  return values.length > 0 ? Math.min(...values) : undefined;
}

function extractIpa(
  metadata: MetaRecord[],
  dictionaries: Map<string, DictionaryRecord>,
): LookupResult['ipa'] {
  const result: LookupResult['ipa'] = [];
  const seen = new Set<string>();
  for (const entry of metadata) {
    if (entry.mode !== 'ipa' || typeof entry.data !== 'object' || entry.data === null) continue;
    const transcriptions = (entry.data as { transcriptions?: unknown }).transcriptions;
    if (!Array.isArray(transcriptions)) continue;
    for (const item of transcriptions) {
      if (typeof item !== 'object' || item === null) continue;
      const ipa = (item as { ipa?: unknown }).ipa;
      if (typeof ipa !== 'string' || seen.has(ipa)) continue;
      seen.add(ipa);
      const tags = (item as { tags?: unknown }).tags;
      result.push({
        ipa,
        tags: Array.isArray(tags) ? tags.filter((tag): tag is string => typeof tag === 'string') : [],
        dictionaryTitle: dictionaries.get(entry.dictionaryId)?.title ?? 'IPA',
      });
    }
  }
  return result.slice(0, 12);
}

async function firstKnownRecord(
  candidates: string[],
  store: IDBObjectStore,
): Promise<KnownWordRecord | undefined> {
  const requests = candidates.map((candidate) => requestResult<KnownWordRecord | undefined>(store.get(candidate)));
  return (await Promise.all(requests)).find(Boolean);
}

async function getAllUnique<T extends object>(
  candidates: string[],
  index: IDBIndex,
  getKey?: (entry: T) => number | string,
): Promise<T[]> {
  const groups = await Promise.all(
    candidates.map((candidate) => requestResult<T[]>(index.getAll(IDBKeyRange.only(candidate)))),
  );
  const unique = new Map<number | string, T>();
  for (const entry of groups.flat()) {
    unique.set(getKey?.(entry) ?? (entry as { id?: number }).id ?? JSON.stringify(entry), entry);
  }
  return [...unique.values()];
}

function deleteByIndex(index: IDBIndex, value: string): void {
  const request = index.openKeyCursor(IDBKeyRange.only(value));
  request.onsuccess = () => {
    const cursor = request.result;
    if (!cursor) return;
    index.objectStore.delete(cursor.primaryKey);
    cursor.continue();
  };
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted'));
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed'));
  });
}
