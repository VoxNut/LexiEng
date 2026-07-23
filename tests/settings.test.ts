import { describe, expect, it } from 'vitest';
import { sanitizeSettings } from '../src/shared/settings';

describe('settings', () => {
  it('defaults to the requested 20,000-word exclusion', () => {
    const settings = sanitizeSettings(undefined);
    expect(settings.knownFrequencyCeiling).toBe(20_000);
    expect(settings.frequencyMin).toBe(20_001);
    expect(settings.frequencyMax).toBe(100_000);
    expect(settings.ankiDeck).toBe('English Mining');
  });

  it('keeps the target range above the known ceiling', () => {
    const settings = sanitizeSettings({
      knownFrequencyCeiling: 40_000,
      frequencyMin: 20_001,
      frequencyMax: 30_000,
    });
    expect(settings.frequencyMin).toBe(40_001);
    expect(settings.frequencyMax).toBe(40_001);
  });
});
