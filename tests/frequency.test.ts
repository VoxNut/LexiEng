import { describe, expect, it } from 'vitest';
import { selectFrequencyRank, selectWordState } from '../src/shared/db';
import { DEFAULT_SETTINGS } from '../src/shared/settings';
import { MetaRecord } from '../src/shared/types';

function frequency(dictionaryId: string, rank: number): MetaRecord {
  return {
    dictionaryId,
    headword: 'test',
    normalized: 'test',
    lookupKeys: ['test'],
    mode: 'freq',
    data: { frequency: rank },
    frequencyRank: rank,
  };
}

describe('frequency filtering', () => {
  it('uses the selected frequency dictionary', () => {
    const settings = { ...DEFAULT_SETTINGS, frequencyDictionaryId: 'preferred' };
    expect(selectFrequencyRank([frequency('other', 50), frequency('preferred', 25_000)], settings)).toBe(
      25_000,
    );
  });

  it('always treats Anki entries as known', () => {
    const state = selectWordState(
      { normalized: 'rare', surface: 'rare', sources: ['anki'], updatedAt: 0 },
      50_000,
      DEFAULT_SETTINGS,
    );
    expect(state).toBe('known-anki');
  });

  it('excludes the first 20,000 and targets the next range', () => {
    expect(selectWordState(undefined, 20_000, DEFAULT_SETTINGS)).toBe('known-frequency');
    expect(selectWordState(undefined, 20_001, DEFAULT_SETTINGS)).toBe('target');
    expect(selectWordState(undefined, 100_001, DEFAULT_SETTINGS)).toBe('outside-range');
  });
});
