import { describe, expect, it } from 'vitest';
import { getAnkiCardState, htmlToPlainText, selectNoteValue } from '../src/shared/anki';

describe('Anki import', () => {
  it('prefers an explicit lexical field over Front', () => {
    const note = {
      noteId: 1,
      modelName: 'Mining',
      tags: [],
      fields: {
        Front: { value: 'A complete example sentence.', order: 0 },
        Word: { value: '<b>inexorable</b>', order: 1 },
      },
    };
    expect(selectNoteValue(note, '')).toBe('<b>inexorable</b>');
  });

  it('normalizes common Anki HTML and media markers', () => {
    expect(htmlToPlainText('<b>hello</b><br>[sound:hello.mp3]&nbsp;world')).toBe('hello world');
  });

  it('maps Anki queues to reader scheduling states', () => {
    expect(getAnkiCardState({ type: 0, queue: 0 }, { due: false, suspended: false, buried: false })).toBe('new');
    expect(getAnkiCardState({ type: 2, queue: 2 }, { due: true, suspended: false, buried: false })).toBe('due');
    expect(getAnkiCardState({ type: 2, queue: -1 }, { due: true, suspended: true, buried: false })).toBe('suspended');
    expect(getAnkiCardState({ type: 2, queue: 2 }, { due: false, suspended: false, buried: false })).toBe('review');
  });
});
