import { useEffect, useMemo, useState } from 'react';
import { CodeEditor } from '../components/CodeEditor';
import { CopyButton, Icon, PageHeader } from '../components/ui';
import { bytes } from '../lib/format';
import { highlightJson } from '../lib/highlight';

const KEY = 'st:json';
const SAMPLE = JSON.stringify(
  { id: 1, nama: 'Super Tool', aktif: true, tags: ['dev', 'local'], meta: { versi: '1.0.0', port: 3001 } },
  null,
  2,
);

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(source)
        .sort((a, b) => a.localeCompare(b))
        .map((key) => [key, sortDeep(source[key])]),
    );
  }
  return value;
}

function positionOf(message: string): string {
  const match = /position (\d+)/.exec(message);
  return match ? ' (karakter ke-' + match[1] + ')' : '';
}

export default function JsonTool() {
  const [text, setText] = useState(() => localStorage.getItem(KEY) ?? SAMPLE);

  useEffect(() => {
    const id = setTimeout(() => localStorage.setItem(KEY, text), 250);
    return () => clearTimeout(id);
  }, [text]);

  const parsed = useMemo(() => {
    if (!text.trim()) return { ok: false as const, error: '' };
    try {
      return { ok: true as const, value: JSON.parse(text) as unknown };
    } catch (err) {
      const message = (err as Error).message;
      return { ok: false as const, error: message + positionOf(message) };
    }
  }, [text]);

  const pretty = useMemo(() => (parsed.ok ? JSON.stringify(parsed.value, null, 2) : ''), [parsed]);
  const html = useMemo(() => (pretty ? highlightJson(pretty) : ''), [pretty]);

  const apply = (fn: (value: unknown) => string) => {
    if (parsed.ok) setText(fn(parsed.value));
  };

  const download = () => {
    if (!pretty) return;
    const url = URL.createObjectURL(new Blob([pretty], { type: 'application/json' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'data.json';
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="JSON"
        subtitle={
          parsed.ok
            ? bytes(new Blob([pretty]).size) + ' terformat · ' + pretty.split('\n').length + ' baris'
            : text.trim()
              ? 'JSON tidak valid'
              : 'Tempel JSON di kiri'
        }
      >
        <button type="button" className="btn" onClick={() => apply((v) => JSON.stringify(v, null, 2))} disabled={!parsed.ok}>
          <Icon name="sort" /> Rapikan
        </button>
        <button type="button" className="btn" onClick={() => apply((v) => JSON.stringify(v))} disabled={!parsed.ok}>
          <Icon name="minify" /> Minify
        </button>
        <button type="button" className="btn" onClick={() => apply((v) => JSON.stringify(sortDeep(v), null, 2))} disabled={!parsed.ok}>
          Urutkan kunci
        </button>
        <CopyButton text={pretty} />
        <button type="button" className="btn" onClick={download} disabled={!parsed.ok} title="Unduh JSON">
          <Icon name="download" />
        </button>
      </PageHeader>

      <div className="flex min-h-0 flex-1 divide-x divide-line">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col p-3">
          <CodeEditor value={text} onChange={setText} placeholder='{"hello": "world"}' />
        </div>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col p-3">
          {parsed.ok ? (
            <pre className="mono min-h-0 flex-1 overflow-auto rounded-lg border border-line bg-[#0b1118] p-3 text-[12.5px] leading-[1.55rem]">
              <code dangerouslySetInnerHTML={{ __html: html }} />
            </pre>
          ) : (
            <div className="flex min-h-0 flex-1 items-center justify-center rounded-lg border border-dashed border-line p-6 text-center">
              <div>
                <Icon name="json" size={22} className="mx-auto mb-2 text-muted/60" />
                <p className="mono max-w-md text-xs break-words text-muted">{parsed.error || 'Belum ada input'}</p>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2 border-t border-line px-3 py-1.5 text-[11px] text-muted">
        <button type="button" className="btn btn-ghost px-2 py-0.5 text-[11px]" onClick={() => setText(SAMPLE)}>
          Contoh
        </button>
        <button type="button" className="btn btn-ghost px-2 py-0.5 text-[11px]" onClick={() => setText('')}>
          Kosongkan
        </button>
        <span className="ml-auto">{parsed.ok ? 'JSON valid' : 'menunggu JSON valid'}</span>
      </div>
    </div>
  );
}
