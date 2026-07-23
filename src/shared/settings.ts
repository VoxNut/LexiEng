import { Settings, THEMES, Theme } from './types';

export const DEFAULT_SETTINGS: Settings = {
  theme: 'default',
  ankiUrl: 'http://127.0.0.1:8765',
  ankiDeck: 'English Mining',
  ankiField: '',
  knownFrequencyCeiling: 20_000,
  frequencyMin: 20_001,
  frequencyMax: 100_000,
  frequencyDictionaryId: '',
  highlightUnranked: true,
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
    ankiField: stringValue(input.ankiField, DEFAULT_SETTINGS.ankiField),
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
