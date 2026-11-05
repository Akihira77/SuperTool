import { useEffect, useMemo, useRef, useState } from 'react';
import { CodeEditor } from '../components/CodeEditor';
import { CopyButton, PageHeader, cn } from '../components/ui';
import { renderMarkdown } from '../lib/markdown';

const KEY = 'st:markdown';
const TICK = '\u0060';

const SAMPLE = [
  '# Catatan Rilis',
  '',
  'Tulis **Markdown** di kiri, preview langsung di kanan.',
  '',
  '- [x] Live preview',
  '- [x] Auto simpan ke browser',
  '- [ ] Ekspor PDF',
  '',
  '> Tip: tekan Ctrl+S untuk salin HTML.',
  '',
  '~~~ts',
  'const halo = (nama: string) => "Halo " + nama;',
  '~~~',
  '',
  '| Tool | Status |',
  '| --- | --- |',
  '| Markdown | siap |',
  '| JSON | siap |',
].join('\n');

type View = 'split' | 'edit' | 'preview';

export default function MarkdownTool() {
  const [text, setText] = useState(() => localStorage.getItem(KEY) ?? SAMPLE);
  const [view, setView] = useState<View>('split');
  const areaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const id = setTimeout(() => localStorage.setItem(KEY, text), 250);
    return () => clearTimeout(id);
  }, [text]);

  const html = useMemo(() => renderMarkdown(text), [text]);
  const stats = useMemo(() => {
    const words = text.trim() ? text.trim().split(/\s+/).length : 0;
    return { words, chars: text.length, lines: text.split('\n').length, minutes: Math.max(1, Math.round(words / 200)) };
  }, [text]);

  const wrap = (before: string, after = '') => {
    const area = areaRef.current;
    if (!area) return;
    const start = area.selectionStart;
    const end = area.selectionEnd;
    const selected = text.slice(start, end);
    setText(text.slice(0, start) + before + selected + after + text.slice(end));
    requestAnimationFrame(() => {
      area.focus();
      area.setSelectionRange(start + before.length, start + before.length + selected.length);
    });
  };

  const prefixLines = (prefix: string) => {
    const area = areaRef.current;
    if (!area) return;
    const start = text.lastIndexOf('\n', area.selectionStart - 1) + 1;
    const endIndex = text.indexOf('\n', area.selectionEnd);
    const end = endIndex < 0 ? text.length : endIndex;
    const block = text
      .slice(start, end)
      .split('\n')
      .map((line) => prefix + line)
      .join('\n');
    setText(text.slice(0, start) + block + text.slice(end));
    requestAnimationFrame(() => {
      area.focus();
      area.setSelectionRange(start, start + block.length);
    });
  };

  const buttons: Array<{ label: string; title: string; run: () => void }> = [
    { label: 'H1', title: 'Judul 1', run: () => prefixLines('# ') },
    { label: 'H2', title: 'Judul 2', run: () => prefixLines('## ') },
    { label: 'H3', title: 'Judul 3', run: () => prefixLines('### ') },
    { label: 'B', title: 'Tebal', run: () => wrap('**', '**') },
    { label: 'I', title: 'Miring', run: () => wrap('*', '*') },
    { label: 'Kode', title: 'Kode inline', run: () => wrap(TICK, TICK) },
    { label: 'Tautan', title: 'Tautan', run: () => wrap('[', '](https://)') },
    { label: 'Daftar', title: 'Bullet list', run: () => prefixLines('- ') },
    { label: '1.', title: 'Numbered list', run: () => prefixLines('1. ') },
    { label: 'Kutip', title: 'Blockquote', run: () => prefixLines('> ') },
    { label: 'Tabel', title: 'Tabel', run: () => wrap('\n| Kolom | Nilai |\n| --- | --- |\n| ', ' |  |\n') },
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="Markdown" subtitle={stats.chars + ' karakter · ' + stats.words + ' kata · ' + stats.lines + ' baris · ~' + stats.minutes + ' menit baca'}>
        <div className="flex overflow-hidden rounded-lg border border-line">
          {(['split', 'edit', 'preview'] as View[]).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setView(mode)}
              className={cn(
                'px-2.5 py-1.5 text-[12px] capitalize transition-colors',
                view === mode ? 'bg-accent/15 text-accent' : 'text-muted hover:bg-panel2 hover:text-ink',
              )}
            >
              {mode === 'split' ? 'Split' : mode === 'edit' ? 'Editor' : 'Preview'}
            </button>
          ))}
        </div>
        <CopyButton text={html} label="HTML" />
      </PageHeader>

      {view !== 'preview' ? (
        <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-line px-3 py-1.5">
          {buttons.map((button) => (
            <button key={button.label} type="button" title={button.title} onClick={button.run} className="btn btn-ghost px-2 py-1 text-[12px]">
              {button.label}
            </button>
          ))}
          <div className="ml-auto flex items-center gap-1">
            <button type="button" className="btn btn-ghost px-2 py-1 text-[12px]" onClick={() => setText(SAMPLE)}>
              Contoh
            </button>
            <button type="button" className="btn btn-ghost px-2 py-1 text-[12px]" onClick={() => setText('')}>
              Kosongkan
            </button>
          </div>
        </div>
      ) : null}

      <div className={cn('flex min-h-0 flex-1', view === 'split' && 'divide-x divide-line')}>
        {view !== 'preview' ? (
          <div className="flex min-h-0 min-w-0 flex-1 flex-col p-3">
            <CodeEditor value={text} onChange={setText} areaRef={areaRef} wrap placeholder="# Mulai menulis..." />
          </div>
        ) : null}
        {view !== 'edit' ? (
          <div className="min-h-0 min-w-0 flex-1 overflow-y-auto p-5">
            <div className="md mx-auto max-w-3xl" dangerouslySetInnerHTML={{ __html: html }} />
          </div>
        ) : null}
      </div>
    </div>
  );
}
