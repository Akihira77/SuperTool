import { useEffect, useMemo, useRef, useState } from 'react';
import { CodeEditor } from '../components/CodeEditor';
import { CopyButton, Empty, Icon, PageHeader } from '../components/ui';
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
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    areaRef.current?.setAttribute('data-action', 'json:editor');
  }, []);

  const upload = async (file: File | undefined) => {
    if (file) setText(await file.text());
  };

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
        icon="json"
        subtitle={
          parsed.ok
            ? bytes(new Blob([pretty]).size) + ' terformat · ' + pretty.split('\n').length + ' baris'
            : text.trim()
              ? 'JSON tidak valid'
              : 'Tempel JSON di kiri'
        }
      >
        <button type="button" className="btn" data-action="json:format" onClick={() => apply((v) => JSON.stringify(v, null, 2))} disabled={!parsed.ok}>
          <Icon name="sort" /> Rapikan
        </button>
        <button type="button" className="btn" data-action="json:minify" onClick={() => apply((v) => JSON.stringify(v))} disabled={!parsed.ok}>
          <Icon name="minify" /> Minify
        </button>
        <button type="button" className="btn" data-action="json:sort" onClick={() => apply((v) => JSON.stringify(sortDeep(v), null, 2))} disabled={!parsed.ok}>
          Urutkan kunci
        </button>
        <CopyButton text={pretty} />
        <button type="button" className="btn" data-action="json:upload" onClick={() => fileRef.current?.click()} title="Unggah berkas JSON">
          <Icon name="folderPlus" />
        </button>
        <button type="button" className="btn" data-action="json:download" onClick={download} disabled={!parsed.ok} title="Unduh JSON">
          <Icon name="download" />
        </button>
        <input ref={fileRef} type="file" accept=".json,application/json,text/plain" hidden onChange={(event) => void upload(event.target.files?.[0])} />
      </PageHeader>

      <div className="flex min-h-0 flex-1 divide-x divide-line">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-panel/[0.12] p-3 md:p-4">
          <CodeEditor value={text} onChange={setText} areaRef={areaRef} placeholder='{"hello": "world"}' />
        </div>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-panel/[0.12] p-3 md:p-4">
          {parsed.ok ? (
            <pre className="mono min-h-0 flex-1 overflow-auto rounded-lg border border-line bg-[#070d14] p-3 text-[12.5px] leading-[1.55rem]">
              <code dangerouslySetInnerHTML={{ __html: html }} />
            </pre>
          ) : (
            <Empty icon="json" text={parsed.error || 'Belum ada input'} />
          )}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2 border-t border-line bg-panel/20 px-3 py-2 text-[11px] text-muted">
        <button type="button" className="btn btn-ghost px-2 py-0.5 text-[11px]" data-action="json:sample" onClick={() => setText(SAMPLE)}>
          Contoh
        </button>
        <button type="button" className="btn btn-ghost px-2 py-0.5 text-[11px]" data-action="json:clear" onClick={() => setText('')}>
          Kosongkan
        </button>
        <span className="ml-auto">{parsed.ok ? 'JSON valid' : 'menunggu JSON valid'}</span>
      </div>
    </div>
  );
}
