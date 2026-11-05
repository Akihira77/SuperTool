import { useEffect, useState } from 'react';
import { Icon, PageHeader, cn } from '../components/ui';

type View = { id: string; name: string; url: string; proxy: boolean };

const KEY = 'st:urls';

const PRESETS: View[] = [
  { id: 'p1', name: '9router', url: 'http://localhost:3000', proxy: false },
  { id: 'p2', name: 'Termix', url: 'http://localhost:8080', proxy: false },
  { id: 'p3', name: 'Docmost', url: 'http://localhost:3000/docmost', proxy: false },
];

function load(): View[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return PRESETS;
    const parsed = JSON.parse(raw) as View[];
    return Array.isArray(parsed) ? parsed : PRESETS;
  } catch {
    return PRESETS;
  }
}

export default function UrlTool() {
  const [views, setViews] = useState<View[]>(load);
  const [activeId, setActiveId] = useState<string>(() => load()[0]?.id ?? '');
  const [draft, setDraft] = useState({ name: '', url: '' });
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    localStorage.setItem(KEY, JSON.stringify(views));
  }, [views]);

  const active = views.find((view) => view.id === activeId) ?? null;

  const add = () => {
    const url = draft.url.trim();
    if (!url) return;
    const normalized = /^https?:\/\//i.test(url) ? url : 'http://' + url;
    let host = normalized;
    try {
      host = new URL(normalized).host;
    } catch {
      return;
    }
    const view: View = { id: crypto.randomUUID(), name: draft.name.trim() || host, url: normalized, proxy: false };
    setViews((prev) => [...prev, view]);
    setActiveId(view.id);
    setDraft({ name: '', url: '' });
    setNonce((n) => n + 1);
  };

  const patch = (id: string, partial: Partial<View>) => {
    setViews((prev) => prev.map((view) => (view.id === id ? { ...view, ...partial } : view)));
  };

  const remove = (id: string) => {
    setViews((prev) => prev.filter((view) => view.id !== id));
    if (activeId === id) setActiveId(views.find((view) => view.id !== id)?.id ?? '');
  };

  const src = active ? (active.proxy ? '/api/proxy?u=' + encodeURIComponent(active.url) : active.url) : '';

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="URL Viewer" subtitle={active ? active.url : 'Simpan URL tool lain lalu buka di sini'}>
        <button type="button" className="btn" onClick={() => setNonce((n) => n + 1)} disabled={!active} title="Muat ulang">
          <Icon name="refresh" /> Muat ulang
        </button>
        {active ? (
          <button
            type="button"
            className={cn('btn', active.proxy && 'btn-primary')}
            onClick={() => patch(active.id, { proxy: !active.proxy })}
            title="Lewat proxy server untuk melepas X-Frame-Options"
          >
            Proxy
          </button>
        ) : null}
        {active ? (
          <a className="btn" href={active.url} target="_blank" rel="noreferrer" title="Buka tab baru">
            <Icon name="external" />
          </a>
        ) : null}
      </PageHeader>

      <div className="flex min-h-0 flex-1">
        <div className="flex w-60 shrink-0 flex-col border-r border-line">
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {views.map((view) => (
              <div key={view.id} className={cn('group mb-0.5 flex items-center rounded-lg pr-1', activeId === view.id ? 'bg-accent/12' : 'hover:bg-panel2')}>
                <button type="button" onClick={() => setActiveId(view.id)} className="min-w-0 flex-1 px-2.5 py-2 text-left">
                  <div className="truncate text-[13px] font-medium">{view.name}</div>
                  <div className="truncate text-[11px] text-muted">{view.url}</div>
                </button>
                <button
                  type="button"
                  onClick={() => remove(view.id)}
                  className="btn btn-ghost shrink-0 px-1 opacity-0 group-hover:opacity-100"
                  title="Hapus"
                >
                  <Icon name="x" size={14} />
                </button>
              </div>
            ))}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              add();
            }}
            className="shrink-0 space-y-1.5 border-t border-line p-2"
          >
            <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Nama (opsional)" className="input py-1.5 text-[12px]" />
            <input value={draft.url} onChange={(e) => setDraft({ ...draft, url: e.target.value })} placeholder="http://localhost:3000" className="input py-1.5 text-[12px]" />
            <button type="submit" className="btn btn-primary w-full justify-center py-1.5 text-[12px]">
              <Icon name="plus" /> Tambah URL
            </button>
          </form>
        </div>

        <div className="min-w-0 flex-1 bg-[#0b1118]">
          {active ? (
            <iframe
              key={active.id + ':' + nonce + ':' + (active.proxy ? 'p' : 'd')}
              src={src}
              title={active.name}
              className="h-full w-full border-0"
              allow="clipboard-read; clipboard-write; fullscreen; microphone; camera"
            />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-muted">Tambah URL untuk mulai</div>
          )}
        </div>
      </div>
    </div>
  );
}
