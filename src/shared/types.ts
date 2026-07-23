export const THEMES = [
  'default',
  'sepia',
  'rose-pine',
  'nord',
  'catppuccin-mocha',
  'monochrome',
] as const;

export type Theme = (typeof THEMES)[number];

export interface Settings {
  theme: Theme;
  ankiUrl: string;
  ankiDeck: string;
  ankiField: string;
  knownFrequencyCeiling: number;
  frequencyMin: number;
  frequencyMax: number;
  frequencyDictionaryId: string;
  highlightUnranked: boolean;
}

export interface DictionaryRecord {
  id: string;
  title: string;
  revision: string;
  format: number;
  sequenced: boolean;
  author?: string;
  url?: string;
  description?: string;
  attribution?: string;
  stylesheet?: string;
  bankCount: number;
  enabled: boolean;
  importedAt: number;
  importComplete: boolean;
  termCount: number;
  metaCount: number;
  modes: string[];
  sourceFile: string;
}

export interface TermRecord {
  id?: number;
  dictionaryId: string;
  headword: string;
  normalized: string;
  lookupKeys: string[];
  reading: string;
  definitionTags: string;
  rules: string;
  score: number;
  glossary: unknown;
  sequence: number;
  termTags: string;
}

export interface MetaRecord {
  id?: number;
  dictionaryId: string;
  headword: string;
  normalized: string;
  lookupKeys: string[];
  mode: string;
  data: unknown;
  frequencyRank?: number;
}

export interface KnownWordRecord {
  normalized: string;
  surface: string;
  sources: Array<'anki' | 'manual'>;
  updatedAt: number;
}

export type AnkiCardState = 'new' | 'learning' | 'due' | 'review' | 'suspended' | 'buried';

export type AnkiEase = 1 | 2 | 3 | 4;

export interface AnkiCardSnapshot {
  cardId: number;
  noteId: number;
  normalized: string;
  surface: string;
  deckName: string;
  modelName: string;
  state: AnkiCardState;
  intervalDays: number;
  reps: number;
  lapses: number;
  due: number;
  nextReviews: string[];
  updatedAt: number;
}

export interface Token {
  nodeIndex: number;
  start: number;
  end: number;
  surface: string;
  normalized: string;
  candidates: string[];
}

export type WordState = 'known-anki' | 'known-manual' | 'known-frequency' | 'target' | 'outside-range';

export interface ClassifiedToken extends Token {
  state: WordState;
  frequencyRank?: number;
  hasDefinition: boolean;
  matched: string;
}

export interface ScanStats {
  total: number;
  unique: number;
  known: number;
  knownAnki: number;
  knownFrequency: number;
  targets: number;
  outsideRange: number;
  unranked: number;
  coverage: number;
}

export interface LookupEntry extends TermRecord {
  dictionaryTitle: string;
  dictionaryRevision: string;
}

export interface IpaTranscription {
  ipa: string;
  tags: string[];
  dictionaryTitle: string;
}

export interface LookupResult {
  query: string;
  normalized: string;
  matched: string;
  frequencyRank?: number;
  knownSources: KnownWordRecord['sources'];
  knownByFrequency: boolean;
  ankiCards: AnkiCardSnapshot[];
  ipa: IpaTranscription[];
  entries: LookupEntry[];
}

export type RuntimeRequest =
  | { type: 'tokenizeAndClassify'; nodes: string[] }
  | { type: 'lookup'; query: string }
  | { type: 'setKnown'; term: string; known: boolean }
  | { type: 'reviewAnkiCard'; cardId: number; ease: AnkiEase }
  | { type: 'scanActivePage' }
  | { type: 'clearActivePage' }
  | { type: 'scanPage' }
  | { type: 'clearPage' }
  | { type: 'scanStats'; stats: ScanStats }
  | { type: 'wordSelected'; word: string };
