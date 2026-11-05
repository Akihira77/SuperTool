import { useCallback, useEffect, useMemo, useState } from 'react';
import { Icon, PageHeader, Spinner, cn } from '../components/ui';
import { api, qs } from '../lib/api';

type View = { id: string; name: string; url: string; proxy: boolean };
type Status = { ok: boolean; status?: number; error?: string };

const KEY = 'st:urls';
const ACTIVE_KEY = 'st:urls:active';

// localhost bisa resolve ke ::1 sementara service sering hanya bind IPv4 → pakai 127.0.0.1.
const PRESETS: View[] = [
  { id: 'p1', name: '9router', url: 'http://127.0.0.1:20128', proxy: false },
  { id: 'p2', name: 'Termix', url: 'http://127.0.0.1:8080', proxy: true },
  { id: 'p3', name: 'Docmost', url: 'http://127.0.0.1:3000', proxy: false },
];

const fixHost = (value: string) => value.replace(/\/\/localhost(?=[/:]|$)/gi, '//127.0.0.1');

function load(): View[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return PRESETS;
    const parsed = JSON.parse(raw) as View[];
    if (!Array.isArray(parsed) || !parsed.length) return PRESETS;
    // data lama masih menyimpan localhost → benahi sekali di sini
    return parsed.map((view) => ({ ...view, url: fixHost(view.url) }));
  } catch {
    return PRESETS;
  }
}

function normalize(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : 'http://' + trimmed;
  try {
    const url = new URL(fixHost(withScheme));
    return (url.origin + url.pathname).replace(/\/$/, '');
  } catch {
    return null;
  }
}

/** Token yang dipakai backend: base64url dari origin target. */
function proxySrc(url: string): string {
  try {
    const origin = new URL(url).origin;
    const token = btoa(origin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    return '/api/proxy/b/' + token + '/';
  } catch {
    return url;
  }
}

export default function UrlTool() {
  const [views, setViews] = useState<View[]>(load);
  const [activeId, setActiveId] = useState<string>(() => {
    const saved = localStorage.getItem(ACTIVE_KEY);
    const list = load();
    return saved && list.some((view) => view.id === saved) ? saved : list[0]?.id ?? '';
  });
  const [draft, setDraft] = useState({ name: '', url: '' });
  const [editingId, setEditingId] = useState('');
  const [nonce, setNonce] = useState(0);
  const [status, setStatus] = useState<Status | null>(null);
  const [checking, setChecking] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    localStorage.setItem(KEY, JSON.stringify(views));
  }, [views]);

  useEffect(() => {
    if (activeId) localStorage.setItem(ACTIVE_KEY, activeId);
  }, [activeId]);

  const active = views.find((view) => view.id === activeId) ?? null;

  const probe = useCallback(async (view: View) => {
    setChecking(true);
    try {
      setStatus(await api.get<Status>('/proxy/probe' + qs({ u: view.url })));
    } catch (err) {
      setStatus({ ok: false, error: (err as Error).message });
    } finally {
      setChecking(false);
    }
  }, []);

  // probe hanya untuk view aktif, supaya tidak ada request beruntun tiap buka tool
  useEffect(() => {
    if (!active) {
      setStatus(null);
      return;
    }
    setStatus(null);
    void probe(active);
  }, [active?.id, probe]);

  useEffect(() => {
    setLoading(true);
  }, [active?.id, nonce, active?.proxy]);

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

  const src = useMemo(() => (active ? (active.proxy ? proxySrc(active.url) : active.url) : ''), [active?.url, active?.proxy]);
  const openUrl = active ? (active.proxy ? proxySrc(active.url) : active.url) : '#';

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="URL Viewer" subtitle={active ? active.url : 'Simpan URL tool lain lalu buka di sini'}>
        <button type="button" className="btn" onClick={() => setNonce((n) => n + 1)} disabled={!active} title="Muat ulang">
          <Icon name="refresh" /> Muat ulang
        </button>
        <button type="button" className="btn" onClick={() => active && void probe(active)} disabled={!active || checking} title="Cek koneksi">
          {checking ? <Spinner /> : <Icon name="play" />} Cek
        </button>
        {active ? (
          <button
            type="button"
            className={cn('btn', active.proxy && 'btn-primary')}
            onClick={() => patch(active.id, { proxy: !active.proxy })}
            title="Lewat server ini: melepas X-Frame-Options/CSP dan mem-proxy aset + WebSocket"
          >
            Proxy
          </button>
        ) : null}
        {active ? (
          <a className="btn" href={openUrl} target="_blank" rel="noreferrer" title={active.proxy ? 'Buka lewat proxy di tab baru' : 'Buka tab baru'}>
            <Icon name="external" />
          </a>
        ) : null}
      </PageHeader>

      {active && status && !status.ok ? (
        <div className="flex shrink-0 items-center gap-2 border-b border-line bg-bad/10 px-3 py-1.5 text-[12px] text-bad">
          <Icon name="x" size={13} />
          <span className="min-w-0 flex-1 truncate">
            Tidak bisa terhubung ke {active.url}. {status.error ?? 'Status ' + status.status}
          </span>
          {!active.proxy ? (
            <button type="button" className="btn btn-ghost px-2 py-0.5 text-[11px]" onClick={() => patch(active.id, { proxy: true })}>
              Coba mode proxy
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1">
        <div className="flex w-56 shrink-0 flex-col border-r border-line">
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {views.map((view) => (
              <div key={view.id} className={cn('group mb-0.5 flex items-center rounded-lg pr-1', activeId === view.id ? 'bg-accent/12' : 'hover:bg-panel2')}>
                <button type="button" onClick={() => setActiveId(view.id)} className="min-w-0 flex-1 px-2.5 py-2 text-left">
                  <div className="flex items-center gap-1.5">
                    <span
                      className={cn(
                        'h-1.5 w-1.5 shrink-0 rounded-full',
                        activeId !== view.id ? 'bg-muted/40' : !status ? 'bg-muted/40' : status.ok ? 'bg-ok' : 'bg-bad',
                      )}
                    />
                    <span className="truncate text-[13px] font-medium">{view.name}</span>
                    {view.proxy ? <span className="rounded bg-accent/15 px-1 text-[9px] text-accent">proxy</span> : null}
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
            ))}
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

        <div className="relative min-w-0 flex-1 bg-[#0b1118]">
          {loading && active ? (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-[#0b1118]/70">
              <Spinner />
            </div>
          ) : null}
          {active ? (
            <iframe
              key={active.id + ':' + nonce}
              src={src}
              title={active.name}
              onLoad={() => setLoading(false)}
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
