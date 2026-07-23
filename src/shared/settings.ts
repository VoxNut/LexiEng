import { Settings, THEMES, Theme } from './types';

export const DEFAULT_SETTINGS: Settings = {
  theme: 'default',
  ankiUrl: 'http://127.0.0.1:8765',
  ankiDeck: 'English Mining',
  ankiModel: '',
  ankiField: '',
  ankiMeaningField: 'Meaning',
  ankiSentenceField: 'Sentence',
  ankiIpaField: 'IPA',
  ankiFrequencyField: 'Frequency',
  matureIntervalDays: 21,
  knownFrequencyCeiling: 20_000,
  frequencyMin: 20_001,
  frequencyMax: 100_000,
  frequencyDictionaryId: '',
  highlightUnranked: true,
  parseDynamicContent: true,
  showPopupOnHover: false,
  popupWidth: 420,
  popupHeight: 520,
  statusBarEnabled: true,
  statusBarAutoHide: false,
  statusBarPosition: 'bottom',
  massReviewNew: true,
  massReviewDue: true,
  massReviewLearning: true,
  massReviewYoung: false,
  massReviewMature: false,
  massReviewRequireConfirm: true,
  readerFontSize: 20,
  readerWidth: 46,
  readerLineHeight: 1.7,
};

const SETTINGS_KEY = 'settings';

export async function getSettings(): Promise<Settings> {
  const stored = await chrome.storage.local.get(SETTINGS_KEY);
  return sanitizeSettings(stored[SETTINGS_KEY]);
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const settings = { ...(await getSettings()), ...patch };
  const sanitized = sanitizeSettings(settings);
  await chrome.storage.local.set({ [SETTINGS_KEY]: sanitized });
  return sanitized;
}

export function sanitizeSettings(value: unknown): Settings {
  const input = isRecord(value) ? value : {};
  const theme = THEMES.includes(input.theme as Theme) ? (input.theme as Theme) : DEFAULT_SETTINGS.theme;
  const knownFrequencyCeiling = positiveInteger(
    input.knownFrequencyCeiling,
    DEFAULT_SETTINGS.knownFrequencyCeiling,
    true,
  );
  const frequencyMin = Math.max(
    knownFrequencyCeiling + 1,
    positiveInteger(input.frequencyMin, Math.max(1, knownFrequencyCeiling + 1)),
  );
  const frequencyMax = Math.max(
    frequencyMin,
    positiveInteger(input.frequencyMax, DEFAULT_SETTINGS.frequencyMax),
  );

  return {
    theme,
    ankiUrl: stringValue(input.ankiUrl, DEFAULT_SETTINGS.ankiUrl),
    ankiDeck: stringValue(input.ankiDeck, DEFAULT_SETTINGS.ankiDeck),
    ankiModel: stringValue(input.ankiModel, DEFAULT_SETTINGS.ankiModel),
    ankiField: stringValue(input.ankiField, DEFAULT_SETTINGS.ankiField),
    ankiMeaningField: stringValue(input.ankiMeaningField, DEFAULT_SETTINGS.ankiMeaningField),
    ankiSentenceField: stringValue(input.ankiSentenceField, DEFAULT_SETTINGS.ankiSentenceField),
    ankiIpaField: stringValue(input.ankiIpaField, DEFAULT_SETTINGS.ankiIpaField),
    ankiFrequencyField: stringValue(
      input.ankiFrequencyField,
      DEFAULT_SETTINGS.ankiFrequencyField,
    ),
    matureIntervalDays: boundedNumber(input.matureIntervalDays, DEFAULT_SETTINGS.matureIntervalDays, 1, 3650),
    knownFrequencyCeiling,
    frequencyMin,
    frequencyMax,
    frequencyDictionaryId: stringValue(
      input.frequencyDictionaryId,
      DEFAULT_SETTINGS.frequencyDictionaryId,
    ),
    highlightUnranked:
      typeof input.highlightUnranked === 'boolean'
        ? input.highlightUnranked
        : DEFAULT_SETTINGS.highlightUnranked,
    parseDynamicContent: booleanValue(input.parseDynamicContent, DEFAULT_SETTINGS.parseDynamicContent),
    showPopupOnHover: booleanValue(input.showPopupOnHover, DEFAULT_SETTINGS.showPopupOnHover),
    popupWidth: boundedNumber(input.popupWidth, DEFAULT_SETTINGS.popupWidth, 280, 900),
    popupHeight: boundedNumber(input.popupHeight, DEFAULT_SETTINGS.popupHeight, 220, 900),
    statusBarEnabled: booleanValue(input.statusBarEnabled, DEFAULT_SETTINGS.statusBarEnabled),
    statusBarAutoHide: booleanValue(input.statusBarAutoHide, DEFAULT_SETTINGS.statusBarAutoHide),
    statusBarPosition: input.statusBarPosition === 'top' ? 'top' : 'bottom',
    massReviewNew: booleanValue(input.massReviewNew, DEFAULT_SETTINGS.massReviewNew),
    massReviewDue: booleanValue(input.massReviewDue, DEFAULT_SETTINGS.massReviewDue),
    massReviewLearning: booleanValue(input.massReviewLearning, DEFAULT_SETTINGS.massReviewLearning),
    massReviewYoung: booleanValue(input.massReviewYoung, DEFAULT_SETTINGS.massReviewYoung),
    massReviewMature: booleanValue(input.massReviewMature, DEFAULT_SETTINGS.massReviewMature),
    massReviewRequireConfirm: booleanValue(
      input.massReviewRequireConfirm,
      DEFAULT_SETTINGS.massReviewRequireConfirm,
    ),
    readerFontSize: boundedNumber(input.readerFontSize, DEFAULT_SETTINGS.readerFontSize, 12, 40),
    readerWidth: boundedNumber(input.readerWidth, DEFAULT_SETTINGS.readerWidth, 24, 90),
    readerLineHeight: boundedNumber(input.readerLineHeight, DEFAULT_SETTINGS.readerLineHeight, 1.1, 2.6),
  };
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function positiveInteger(value: unknown, fallback: number, allowZero = false): number {
  const number = typeof value === 'number' ? value : Number(value);
  const minimum = allowZero ? 0 : 1;
  return Number.isFinite(number) ? Math.max(minimum, Math.round(number)) : fallback;
}

function boundedNumber(value: unknown, fallback: number, minimum: number, maximum: number): number {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, number)) : fallback;
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}
