import { describe, expect, it, vi } from 'vitest';

/**
 * `prettier/standalone` dipalsukan supaya test bisa memeriksa plugin apa saja
 * yang benar-benar dioper untuk tiap bahasa, tanpa memuat parser asli.
 */
const fake = vi.hoisted(() => ({
  format: vi.fn(async (_code: string, options: { parser: string; plugins: unknown[] }) => options.parser),
  plugins: [] as string[],
}));
vi.mock('prettier/standalone', () => ({ format: fake.format }));
vi.mock('prettier/plugins/html', () => ({ name: 'html' }));
vi.mock('prettier/plugins/postcss', () => ({ name: 'postcss' }));
vi.mock('prettier/plugins/babel', () => ({ name: 'babel' }));
vi.mock('prettier/plugins/estree', () => ({ name: 'estree' }));

const { formatDocument } = await import('./editorFormat');

/** Nama plugin yang dioper ke Prettier pada panggilan terakhir. */
async function pluginsFor(code: string, language: 'html' | 'css' | 'js') {
  fake.format.mockClear();
  await formatDocument(code, language);
  const options = fake.format.mock.calls[0][1] as { parser: string; plugins: Array<{ name: string }> };
  return { parser: options.parser, plugins: options.plugins.map((plugin) => plugin.name) };
}

describe('plugin Prettier per bahasa', () => {
  it('HTML hanya memuat parser HTML', async () => {
    expect(await pluginsFor('<div></div>', 'html')).toEqual({ parser: 'html', plugins: ['html'] });
  });

  it('CSS hanya memuat parser PostCSS', async () => {
    expect(await pluginsFor('a{color:red}', 'css')).toEqual({ parser: 'css', plugins: ['postcss'] });
  });

  it('JavaScript memuat Babel beserta printer AST estree', async () => {
    expect(await pluginsFor('const a = 1', 'js')).toEqual({
      parser: 'babel',
      plugins: ['babel', 'estree'],
    });
  });
});
