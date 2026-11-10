import { describe, expect, it } from 'vitest';
import { fuzzyMatch, splitHighlight } from './fuzzy';

describe('fuzzyMatch', () => {
  it('prefers direct substrings', () => {
    expect(fuzzyMatch('File Explorer', 'file')?.score).toBeGreaterThan(fuzzyMatch('File Explorer', 'flx')?.score ?? 0);
  });
  it('matches subsequences in order', () => {
    expect(fuzzyMatch('Command Palette', 'cp')?.hits).toEqual([0, 8]);
    expect(fuzzyMatch('Command Palette', 'pc')).toBeNull();
  });
  it('splits highlighted runs', () => {
    expect(splitHighlight('abcd', [1, 2])).toEqual([
      { text: 'a', hit: false },
      { text: 'bc', hit: true },
      { text: 'd', hit: false },
    ]);
  });
});
