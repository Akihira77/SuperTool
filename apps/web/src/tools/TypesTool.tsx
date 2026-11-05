import { useEffect, useMemo, useState } from 'react';
import { CodeEditor } from '../components/CodeEditor';
import { CopyButton, Empty, Icon, PageHeader } from '../components/ui';
import { jsonToTs } from '../lib/json2ts';
import { useI18n } from '../lib/i18n';

const KEY = 'st:types';
const SAMPLE = JSON.stringify(
  {
    id: 12,
    nama: 'Budi',
    email: 'budi@mail.com',
    aktif: true,
    alamat: { jalan: 'Jl. Merdeka 1', kota: 'Bandung', kodePos: '40111' },
    pesanan: [
      { id: 1, total: 25000, status: 'selesai', item: [{ sku: 'A1', qty: 2 }] },
      { id: 2, total: 99000, status: 'pending', catatan: null },
    ],
  },
  null,
  2,
);

export default function TypesTool() {
  const { t } = useI18n();
  const [text, setText] = useState(() => localStorage.getItem(KEY) ?? SAMPLE);
  const [root, setRoot] = useState('Root');

  useEffect(() => {
    const id = setTimeout(() => localStorage.setItem(KEY, text), 250);
    return () => clearTimeout(id);
  }, [text]);

  const result = useMemo(() => {
    if (!text.trim()) return { ok: false as const, output: '', error: 'Belum ada input', count: 0 };
    try {
      const value = JSON.parse(text) as unknown;
      const output = jsonToTs(value, root || 'Root');
      const count = (output.match(/export interface /g) ?? []).length;
      return { ok: true as const, output, error: '', count };
    } catch (err) {
      return { ok: false as const, output: '', error: (err as Error).message, count: 0 };
    }
  }, [text, root]);

  const download = () => {
    if (!result.ok) return;
    const url = URL.createObjectURL(new Blob([result.output], { type: 'text/plain' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = (root || 'types') + '.ts';
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="JSON ke TypeScript"
        icon="types"
        subtitle={result.ok ? result.count + ' interface digenerate' : 'Tempel JSON, tipe dibuat otomatis'}
      >
        <input
          value={root}
          onChange={(e) => setRoot(e.target.value.replace(/[^A-Za-z0-9_$]/g, ''))}
          placeholder="Nama root"
          className="input w-36 py-1.5 text-[13px]"
          aria-label="Nama root"
        />
        <CopyButton text={result.output} label={t('common.copy') + ' TS'} />
        <button type="button" className="btn" data-action="types:download" onClick={download} disabled={!result.ok} title="Unduh .ts">
          <Icon name="download" />
        </button>
      </PageHeader>

      <div className="flex min-h-0 flex-1 divide-x divide-line">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-panel/[0.12] p-3 md:p-4">
          <CodeEditor value={text} onChange={setText} placeholder="Tempel objek JSON di sini" />
        </div>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-panel/[0.12] p-3 md:p-4">
          {result.ok ? (
            <pre className="mono min-h-0 flex-1 overflow-auto rounded-lg border border-line bg-[#070d14] p-3 text-[12.5px] leading-[1.55rem] text-ink/90">
              {result.output}
            </pre>
          ) : (
            <Empty icon="types" text={result.error} />
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
        <span className="ml-auto">array objek digabung jadi satu interface</span>
      </div>
    </div>
  );
}
