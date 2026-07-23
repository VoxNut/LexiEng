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
  ankiModel: string;
  ankiField: string;
  ankiMeaningField: string;
  ankiSentenceField: string;
  ankiIpaField: string;
  ankiFrequencyField: string;
  matureIntervalDays: number;
  knownFrequencyCeiling: number;
  frequencyMin: number;
  frequencyMax: number;
  frequencyDictionaryId: string;
  highlightUnranked: boolean;
  parseDynamicContent: boolean;
  showPopupOnHover: boolean;
  popupWidth: number;
  popupHeight: number;
  statusBarEnabled: boolean;
  statusBarAutoHide: boolean;
  statusBarPosition: 'top' | 'bottom';
  massReviewNew: boolean;
  massReviewDue: boolean;
  massReviewLearning: boolean;
  massReviewYoung: boolean;
  massReviewMature: boolean;
  massReviewRequireConfirm: boolean;
  readerFontSize: number;
  readerWidth: number;
  readerLineHeight: number;
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

export type LearningState =
  | 'new'
  | 'learning'
  | 'young'
  | 'mature'
  | 'due'
  | 'mastered'
  | 'suspended'
  | 'buried'
  | 'frequency'
  | 'target'
  | 'outside-range';

export interface ClassifiedToken extends Token {
  state: WordState;
  learningState: LearningState;
  frequencyRank?: number;
  hasDefinition: boolean;
  matched: string;
  ankiCardIds: number[];
}

export interface ScanStats {
  total: number;
  unique: number;
  uniqueKnown: number;
  known: number;
  knownAnki: number;
  knownFrequency: number;
  targets: number;
  outsideRange: number;
  unranked: number;
  coverage: number;
  uniqueCoverage: number;
  states: Partial<Record<LearningState, number>>;
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

export interface PageState {
  parsed: boolean;
  parsing: boolean;
  readerOpen: boolean;
  statusBarVisible: boolean;
  stats?: ScanStats;
}

export type RuntimeRequest =
  | { type: 'tokenizeAndClassify'; nodes: string[] }
  | { type: 'lookup'; query: string }
  | { type: 'setKnown'; term: string; known: boolean }
  | { type: 'reviewAnkiCard'; cardId: number; ease: AnkiEase }
  | { type: 'reviewAnkiCards'; cardIds: number[]; ease: AnkiEase }
  | { type: 'mineToAnki'; term: string; sentence?: string }
  | { type: 'scanActivePage' }
  | { type: 'scanActiveSelection' }
  | { type: 'clearActivePage' }
  | { type: 'openReaderActivePage'; text?: string }
  | { type: 'toggleStatusBarActivePage' }
  | { type: 'getActivePageState' }
  | { type: 'scanPage' }
  | { type: 'scanSelection' }
  | { type: 'clearPage' }
  | { type: 'openReaderMode'; text?: string }
  | { type: 'openLookup'; word: string }
  | { type: 'toggleStatusBar' }
  | { type: 'getPageState' }
  | { type: 'scanStats'; stats: ScanStats }
  | { type: 'wordSelected'; word: string };
