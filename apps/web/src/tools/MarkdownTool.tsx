import { useEffect, useMemo, useRef, useState } from 'react';
import { CodeEditor } from '../components/CodeEditor';
import { CopyButton, Icon, PageHeader, cn } from '../components/ui';
import { useI18n } from '../lib/i18n';
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
  const { t } = useI18n();
  const [text, setText] = useState(() => localStorage.getItem(KEY) ?? SAMPLE);
  const [view, setView] = useState<View>(() =>
    window.matchMedia('(max-width: 1023px)').matches ? 'edit' : 'split',
  );
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Di layar sempit, paksa mode satu panel agar tidak ada dua pane sempit.
  useEffect(() => {
    const query = window.matchMedia('(max-width: 1023px)');
    const onChange = () => {
      if (query.matches) setView((current) => (current === 'split' ? 'edit' : current));
    };
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  // Penanda untuk command palette (data-action) tanpa mengubah CodeEditor.
  useEffect(() => {
    areaRef.current?.setAttribute('data-action', 'markdown:editor');
  }, [view]);

  const download = () => {
    const blob = new Blob([text], { type: 'text/markdown' });
    const anchor = document.createElement('a');
    anchor.href = URL.createObjectURL(blob);
    anchor.download = 'catatan.md';
    anchor.click();
    URL.revokeObjectURL(anchor.href);
  };

  const upload = async (file: File | undefined) => {
    if (!file) return;
    setText(await file.text());
  };

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
    { label: 'H1', title: t('markdown.h1'), run: () => prefixLines('# ') },
    { label: 'H2', title: t('markdown.h2'), run: () => prefixLines('## ') },
    { label: 'H3', title: t('markdown.h3'), run: () => prefixLines('### ') },
    { label: 'B', title: t('markdown.bold'), run: () => wrap('**', '**') },
    { label: 'I', title: t('markdown.italic'), run: () => wrap('*', '*') },
    { label: t('markdown.code'), title: t('markdown.code'), run: () => wrap(TICK, TICK) },
    { label: t('markdown.link'), title: t('markdown.link'), run: () => wrap('[', '](https://)') },
    { label: t('markdown.bullet'), title: t('markdown.bullet'), run: () => prefixLines('- ') },
    { label: '1.', title: t('markdown.numbered'), run: () => prefixLines('1. ') },
    { label: t('markdown.quote'), title: t('markdown.quote'), run: () => prefixLines('> ') },
    { label: t('markdown.table'), title: t('markdown.table'), run: () => wrap('\n| Kolom | Nilai |\n| --- | --- |\n| ', ' |  |\n') },
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="Markdown"
        subtitle={
          stats.chars + ' ' + t('markdown.chars') + ' · ' + stats.words + ' ' + t('markdown.words') +
          ' · ' + stats.lines + ' ' + t('markdown.lines') + ' · ~' + stats.minutes + ' ' + t('markdown.minutes')
        }
        icon="markdown"
      >
        <div className="flex items-center gap-0.5 rounded-[10px] border border-line bg-panel2/55 p-0.5">
          {(['split', 'edit', 'preview'] as View[]).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setView(mode)}
              className={cn(
                'min-h-8 rounded-md px-2.5 py-1 text-[12.5px] font-medium capitalize transition-colors',
                view === mode ? 'bg-panel text-ink shadow-sm' : 'text-muted hover:text-ink',
              )}
            >
              {mode === 'split' ? t('markdown.modeSplit') : mode === 'edit' ? t('markdown.modeEdit') : t('markdown.modePreview')}
            </button>
          ))}
        </div>
        <CopyButton text={html} label="HTML" />
        <button type="button" className="btn" data-action="markdown:upload" onClick={() => fileRef.current?.click()} title={t('common.upload')} aria-label={t('common.upload')}>
          <Icon name="folderPlus" size={13} />
        </button>
        <button type="button" className="btn" data-action="markdown:export" onClick={download} title={t('palette.act.export')} aria-label={t('palette.act.export')}>
          <Icon name="download" size={13} />
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".md,.markdown,text/plain,text/markdown"
          hidden
          onChange={(event) => void upload(event.target.files?.[0])}
        />
      </PageHeader>

      {view !== 'preview' ? (
        <div className="flex shrink-0 flex-nowrap items-center gap-1 overflow-x-auto border-b border-line bg-panel/20 px-3 py-1.5">
          {buttons.map((button) => (
            <button key={button.label} type="button" title={button.title} onClick={button.run} className="btn btn-ghost min-h-8 shrink-0 px-2 py-1 text-[12.5px]">
              {button.label}
            </button>
          ))}
          <div className="ml-auto flex items-center gap-1">
            <button type="button" className="btn btn-ghost btn-sm" data-action="markdown:sample" onClick={() => setText(SAMPLE)}>
              {t('common.sample')}
            </button>
            <button type="button" className="btn btn-ghost btn-sm" data-action="markdown:clear" onClick={() => setText('')}>
              {t('common.clear')}
            </button>
          </div>
        </div>
      ) : null}

      <div className={cn('flex min-h-0 flex-1 flex-col lg:flex-row', view === 'split' && 'divide-y divide-line lg:divide-x lg:divide-y-0')}>
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