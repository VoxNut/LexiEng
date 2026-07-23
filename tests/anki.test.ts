import { describe, expect, it } from 'vitest';
import { htmlToPlainText, selectNoteValue } from '../src/shared/anki';

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
});
