/**
 * Preferensi format + pembungkus Prettier 3 standalone.
 *
 * Semua proses berjalan lokal di browser: Prettier & plugin diimpor dinamis
 * (chunk terpisah) dan tidak ada kode pengguna yang dikirim keluar.
 */

export type FormatLanguage = 'html' | 'css' | 'js';
export type TabWidth = 2 | 4;
export type TrailingComma = 'none' | 'es5' | 'all';
export type PrintWidth = 80 | 100 | 120;

export type FormatPreferences = {
  tabWidth: TabWidth;
  singleQuote: boolean;
  semi: boolean;
  trailingComma: TrailingComma;
  bracketSpacing: boolean;
  printWidth: PrintWidth;
};

export const FORMAT_PREFS_KEY = 'st:editor:format-preferences:v1';

export const DEFAULT_FORMAT_PREFERENCES: FormatPreferences = {
  tabWidth: 2,
  singleQuote: true,
  semi: true,
  trailingComma: 'all',
  bracketSpacing: true,
  printWidth: 100,
};

const TAB_WIDTHS: readonly TabWidth[] = [2, 4];
const PRINT_WIDTHS: readonly PrintWidth[] = [80, 100, 120];
const TRAILING_COMMAS: readonly TrailingComma[] = ['none', 'es5', 'all'];

function pick<T extends string | number>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

function pickBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

/** Validasi per-field: data rusak tidak membatalkan seluruh preferensi. */
export function parseFormatPreferences(input: unknown): FormatPreferences {
  const raw = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  return {
    tabWidth: pick(raw.tabWidth, TAB_WIDTHS, DEFAULT_FORMAT_PREFERENCES.tabWidth),
    singleQuote: pickBoolean(raw.singleQuote, DEFAULT_FORMAT_PREFERENCES.singleQuote),
    semi: pickBoolean(raw.semi, DEFAULT_FORMAT_PREFERENCES.semi),
    trailingComma: pick(raw.trailingComma, TRAILING_COMMAS, DEFAULT_FORMAT_PREFERENCES.trailingComma),
    bracketSpacing: pickBoolean(raw.bracketSpacing, DEFAULT_FORMAT_PREFERENCES.bracketSpacing),
    printWidth: pick(raw.printWidth, PRINT_WIDTHS, DEFAULT_FORMAT_PREFERENCES.printWidth),
  };
}

export function loadFormatPreferences(): FormatPreferences {
  try {
    const raw = localStorage.getItem(FORMAT_PREFS_KEY);
    if (!raw) return { ...DEFAULT_FORMAT_PREFERENCES };
    return parseFormatPreferences(JSON.parse(raw));
  } catch {
    // localStorage diblokir atau JSON rusak: pakai default, jangan crash.
    return { ...DEFAULT_FORMAT_PREFERENCES };
  }
}

export function saveFormatPreferences(preferences: FormatPreferences): void {
  try {
    localStorage.setItem(FORMAT_PREFS_KEY, JSON.stringify(preferences));
  } catch {
    // Preferensi bersifat lokal dan opsional; kegagalan simpan tidak fatal.
  }
}

const parserOptions = (preferences: FormatPreferences) => ({
  printWidth: preferences.printWidth,
  tabWidth: preferences.tabWidth,
  useTabs: false,
});

/**
 * Format satu dokumen sesuai bahasanya. Melempar error parser Prettier apa
 * adanya supaya pemanggil bisa mempertahankan konten lama.
 */
export async function formatDocument(
  code: string,
  language: FormatLanguage,
  preferences: FormatPreferences = DEFAULT_FORMAT_PREFERENCES,
): Promise<string> {
  const [{ format }, htmlPlugin, postcssPlugin, babelPlugin, estreePlugin] = await Promise.all([
    import('prettier/standalone'),
    import('prettier/plugins/html'),
    import('prettier/plugins/postcss'),
    import('prettier/plugins/babel'),
    // Parser babel memakai AST estree; plugin-nya wajib didaftarkan di standalone.
    import('prettier/plugins/estree'),
  ]);
  if (language === 'html') {
    return format(code, { parser: 'html', ...parserOptions(preferences), plugins: [htmlPlugin] });
  }
  if (language === 'css') {
    return format(code, { parser: 'css', ...parserOptions(preferences), plugins: [postcssPlugin] });
  }
  return format(code, {
    parser: 'babel',
    ...parserOptions(preferences),
    singleQuote: preferences.singleQuote,
    semi: preferences.semi,
    trailingComma: preferences.trailingComma,
    bracketSpacing: preferences.bracketSpacing,
    plugins: [babelPlugin, estreePlugin],
  });
}
