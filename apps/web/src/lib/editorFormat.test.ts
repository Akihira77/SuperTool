import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_FORMAT_PREFERENCES,
  FORMAT_PREFS_KEY,
  formatDocument,
  loadFormatPreferences,
  parseFormatPreferences,
  saveFormatPreferences,
} from './editorFormat';

function storage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
    data,
  };
}

describe('format preferences', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('memakai default saat localStorage kosong', () => {
    vi.stubGlobal('localStorage', storage());
    expect(loadFormatPreferences()).toEqual(DEFAULT_FORMAT_PREFERENCES);
  });

  it('memakai default saat localStorage melempar error', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    });
    expect(loadFormatPreferences()).toEqual(DEFAULT_FORMAT_PREFERENCES);
    expect(() => saveFormatPreferences(DEFAULT_FORMAT_PREFERENCES)).not.toThrow();
  });

  it('memakai default saat JSON rusak atau bukan objek', () => {
    vi.stubGlobal('localStorage', storage({ [FORMAT_PREFS_KEY]: '{bukan json' }));
    expect(loadFormatPreferences()).toEqual(DEFAULT_FORMAT_PREFERENCES);
    vi.stubGlobal('localStorage', storage({ [FORMAT_PREFS_KEY]: '"teks"' }));
    expect(loadFormatPreferences()).toEqual(DEFAULT_FORMAT_PREFERENCES);
  });

  it('memvalidasi per-field dan mempertahankan nilai yang sah', () => {
    const parsed = parseFormatPreferences({
      tabWidth: 4,
      singleQuote: false,
      semi: false,
      trailingComma: 'es5',
      bracketSpacing: false,
      printWidth: 120,
    });
    expect(parsed).toEqual({
      tabWidth: 4,
      singleQuote: false,
      semi: false,
      trailingComma: 'es5',
      bracketSpacing: false,
      printWidth: 120,
    });

    expect(
      parseFormatPreferences({
        tabWidth: 3,
        singleQuote: 'yes',
        semi: 0,
        trailingComma: 'alll',
        bracketSpacing: null,
        printWidth: 81,
      }),
    ).toEqual(DEFAULT_FORMAT_PREFERENCES);
  });

  it('menyimpan lalu memuat preferensi yang sama', () => {
    vi.stubGlobal('localStorage', storage());
    const next = { ...DEFAULT_FORMAT_PREFERENCES, tabWidth: 4 as const, printWidth: 80 as const };
    saveFormatPreferences(next);
    expect(loadFormatPreferences()).toEqual(next);
  });
});

describe('formatDocument', () => {
  const preferences = { ...DEFAULT_FORMAT_PREFERENCES };

  it('memformat HTML', async () => {
    const output = await formatDocument('<div><span>x</span></div>', 'html', preferences);
    expect(output).toBe('<div><span>x</span></div>\n');
  });

  it('memformat CSS', async () => {
    const output = await formatDocument('a{color:red}', 'css', preferences);
    expect(output).toContain('a {\n  color: red;\n}');
  });

  it('memformat JavaScript dan menjaga komentar', async () => {
    const output = await formatDocument('// catatan\nconst a={b:1}', 'js', preferences);
    expect(output).toContain('// catatan');
    expect(output).toContain("const a = { b: 1 };");
  });

  it('menerapkan indentasi 2 dan 4 spasi', async () => {
    const two = await formatDocument('a{color:red}', 'css', { ...preferences, tabWidth: 2 });
    const four = await formatDocument('a{color:red}', 'css', { ...preferences, tabWidth: 4 });
    expect(two).toContain('\n  color: red;');
    expect(four).toContain('\n    color: red;');
  });

  it('menerapkan kutip tunggal atau ganda pada JavaScript', async () => {
    const single = await formatDocument(`const a = "x";`, 'js', { ...preferences, singleQuote: true });
    const double = await formatDocument(`const a = 'x';`, 'js', { ...preferences, singleQuote: false });
    expect(single).toContain("const a = 'x';");
    expect(double).toContain('const a = "x";');
  });

  it('menerapkan semi dan trailing comma', async () => {
    const noSemi = await formatDocument('const a = 1', 'js', { ...preferences, semi: false });
    expect(noSemi.trim()).toBe('const a = 1');
    const noComma = await formatDocument('const o = { a: 1, b: 2 }', 'js', { ...preferences, trailingComma: 'none' });
    const allComma = await formatDocument('const o = { a: 1, b: 2 }', 'js', { ...preferences, trailingComma: 'all', printWidth: 80 });
    expect(noComma).toBe('const o = { a: 1, b: 2 };\n');
    expect(allComma).toBe('const o = { a: 1, b: 2 };\n');
    const multiline = await formatDocument('const o = { alpha: 111111, beta: 222222, gamma: 333333 }', 'js', {
      ...preferences,
      trailingComma: 'all',
      printWidth: 40 as 80,
    });
    expect(multiline).toContain('gamma: 333333,\n');
  });

  it('menerapkan bracket spacing', async () => {
    const spaced = await formatDocument('const o = {a: 1}', 'js', { ...preferences, bracketSpacing: true });
    const tight = await formatDocument('const o = { a: 1 }', 'js', { ...preferences, bracketSpacing: false });
    expect(spaced).toContain('{ a: 1 }');
    expect(tight).toContain('{a: 1}');
  });

  it('melempar error tanpa mengubah masukan pemanggil', async () => {
    const broken = 'const = ;';
    await expect(formatDocument(broken, 'js', preferences)).rejects.toThrow();
    expect(broken).toBe('const = ;');
  });
});
