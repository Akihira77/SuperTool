import { useCallback, useEffect, useState } from 'react';
import { Icon, PageHeader, cn } from '../components/ui';
import { api, qs } from '../lib/api';

type View = { id: string; name: string; url: string; proxy: boolean };
type Status = { ok: boolean; status?: number; error?: string };

const KEY = 'st:urls';

// localhost bisa resolve ke ::1 sementara service sering hanya bind IPv4 → pakai 127.0.0.1.
const PRESETS: View[] = [
  { id: 'p1', name: '9router', url: 'http://127.0.0.1:20128', proxy: false },
  { id: 'p2', name: 'Termix', url: 'http://127.0.0.1:8080', proxy: false },
  { id: 'p3', name: 'Docmost', url: 'http://127.0.0.1:3000', proxy: false },
];

function load(): View[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return PRESETS;
    const parsed = JSON.parse(raw) as View[];
    return Array.isArray(parsed) && parsed.length ? parsed : PRESETS;
  } catch {
    return PRESETS;
  }
}

function normalize(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : 'http://' + trimmed;
  try {
    const url = new URL(withScheme);
    if (url.hostname === 'localhost') url.hostname = '127.0.0.1';
    return url.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}

export default function UrlTool() {
  const [views, setViews] = useState<View[]>(load);
  const [activeId, setActiveId] = useState<string>(() => load()[0]?.id ?? '');
  const [draft, setDraft] = useState({ name: '', url: '' });
  const [editingId, setEditingId] = useState('');
  const [nonce, setNonce] = useState(0);
  const [status, setStatus] = useState<Record<string, Status>>({});
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    localStorage.setItem(KEY, JSON.stringify(views));
  }, [views]);

  const active = views.find((view) => view.id === activeId) ?? null;

  const probe = useCallback(async (view: View) => {
    try {
      const result = await api.get<Status>('/proxy/probe' + qs({ u: view.url }));
      setStatus((prev) => ({ ...prev, [view.id]: result }));
    } catch (err) {
      setStatus((prev) => ({ ...prev, [view.id]: { ok: false, error: (err as Error).message } }));
    }
  }, []);

  const checkAll = useCallback(async () => {
    setChecking(true);
    await Promise.all(views.map((view) => probe(view)));
    setChecking(false);
  }, [probe, views]);

  useEffect(() => {
    void checkAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = () => {
    const url = normalize(draft.url);
    if (!url) return;
    const name = draft.name.trim() || new URL(url).host;
    if (editingId) {
      setViews((prev) => prev.map((view) => (view.id === editingId ? { ...view, name, url } : view)));
      setEditingId('');
    } else {
      const view: View = { id: crypto.randomUUID(), name, url, proxy: false };
      setViews((prev) => [...prev, view]);
      setActiveId(view.id);
      setNonce((n) => n + 1);
      void probe(view);
    }
    setDraft({ name: '', url: '' });
  };

  const startEdit = (view: View) => {
    setEditingId(view.id);
    setDraft({ name: view.name, url: view.url });
  };

  const remove = (id: string) => {
    if (!window.confirm('Hapus URL ini dari daftar?')) return;
    setViews((prev) => prev.filter((view) => view.id !== id));
    if (activeId === id) setActiveId(views.find((view) => view.id !== id)?.id ?? '');
  };

  const patch = (id: string, partial: Partial<View>) => {
    setViews((prev) => prev.map((view) => (view.id === id ? { ...view, ...partial } : view)));
  };

  const src = active ? (active.proxy ? '/api/proxy?u=' + encodeURIComponent(active.url) : active.url) : '';
  const activeStatus = active ? status[active.id] : undefined;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="URL Viewer" subtitle={active ? active.url : 'Simpan URL tool lain lalu buka di sini'}>
        <button type="button" className="btn" onClick={() => setNonce((n) => n + 1)} disabled={!active} title="Muat ulang">
          <Icon name="refresh" /> Muat ulang
        </button>
        <button type="button" className="btn" onClick={() => active && void probe(active)} disabled={!active || checking} title="Cek koneksi">
          <Icon name="play" /> Cek
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

      {active && activeStatus && !activeStatus.ok ? (
        <div className="flex shrink-0 items-center gap-2 border-b border-line bg-bad/10 px-3 py-1.5 text-[12px] text-bad">
          <Icon name="x" size={13} />
          Tidak bisa terhubung ke {active.url}. {activeStatus.error ?? 'Status ' + activeStatus.status}
          <button type="button" className="btn btn-ghost ml-auto px-2 py-0.5 text-[11px]" onClick={() => void probe(active)}>
            Coba lagi
          </button>
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1">
        <div className="flex w-60 shrink-0 flex-col border-r border-line">
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {views.map((view) => {
              const state = status[view.id];
              return (
                <div key={view.id} className={cn('group mb-0.5 flex items-center rounded-lg pr-1', activeId === view.id ? 'bg-accent/12' : 'hover:bg-panel2')}>
                  <button type="button" onClick={() => setActiveId(view.id)} className="min-w-0 flex-1 px-2.5 py-2 text-left">
                    <div className="flex items-center gap-1.5">
                      <span
                        className={cn('h-1.5 w-1.5 shrink-0 rounded-full', !state ? 'bg-muted/40' : state.ok ? 'bg-ok' : 'bg-bad')}
                        title={state ? (state.ok ? 'terhubung' : state.error ?? 'status ' + state.status) : 'belum dicek'}
                      />
                      <span className="truncate text-[13px] font-medium">{view.name}</span>
                    </div>
                    <div className="truncate text-[11px] text-muted">{view.url}</div>
                  </button>
                  <button type="button" onClick={() => startEdit(view)} className="btn btn-ghost shrink-0 px-1 opacity-0 group-hover:opacity-100" title="Ubah">
                    <Icon name="edit" size={13} />
                  </button>
                  <button type="button" onClick={() => remove(view.id)} className="btn btn-ghost shrink-0 px-1 opacity-0 group-hover:opacity-100" title="Hapus">
                    <Icon name="x" size={13} />
                  </button>
                </div>
              );
            })}
          </div>

          <form
            onSubmit={(event) => {
              event.preventDefault();
              submit();
            }}
            className="shrink-0 space-y-1.5 border-t border-line p-2"
          >
            {editingId ? (
              <div className="flex items-center justify-between text-[11px] text-accent">
                <span>Ubah URL</span>
                <button type="button" className="btn btn-ghost px-1 py-0 text-[11px]" onClick={() => { setEditingId(''); setDraft({ name: '', url: '' }); }}>
                  batal
                </button>
              </div>
            ) : null}
            <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Nama (opsional)" className="input py-1.5 text-[12px]" />
            <input value={draft.url} onChange={(e) => setDraft({ ...draft, url: e.target.value })} placeholder="http://127.0.0.1:3000" className="input py-1.5 text-[12px]" />
            <button type="submit" className="btn btn-primary w-full justify-center py-1.5 text-[12px]">
              <Icon name={editingId ? 'check' : 'plus'} /> {editingId ? 'Simpan' : 'Tambah URL'}
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
