import { useCallback, useEffect, useMemo, useState } from 'react';
import { Icon, PageHeader, Spinner, cn } from '../components/ui';
import { api, ApiError, qs } from '../lib/api';
import { useI18n } from '../lib/i18n';

type View = { id: string; name: string; url: string; proxy: boolean; createdAt?: number };
type Status = { ok: boolean; status?: number; error?: string };

const ACTIVE_KEY = 'st:urls:active';
const DEFAULTS = [
  { name: '9router', url: 'http://127.0.0.1:20128', proxy: false },
  { name: 'Termix', url: 'http://127.0.0.1:8080', proxy: true },
  { name: 'Docmost', url: 'http://127.0.0.1:3000', proxy: false },
];

// localhost bisa resolve ke ::1 sementara service sering hanya bind IPv4.
const fixHost = (value: string) => value.replace(/\/\/localhost(?=[/:]|$)/gi, '//127.0.0.1');

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

/** Token backend: base64url dari origin target (mode path). */
function proxySrc(url: string): string {
  try {
    const origin = new URL(url).origin;
    const token = btoa(origin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    return '/api/proxy/b/' + token + '/';
  } catch {
    return url;
  }
}

/**
 * Mode subdomain: tiap target dapat origin sendiri (`<hex>.localhost:3001`).
 * Cookie, localStorage, dan path absolut `/api/...` jadi milik target, bukan milik aplikasi ini.
 */
function subdomainSrc(url: string): string | null {
  try {
    const origin = new URL(url).origin;
    const token = Array.from(new TextEncoder().encode(origin))
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
    if (token.length > 63) return null;
    const port = location.port ? ':' + location.port : '';
    return 'http://' + token + '.localhost' + port + '/';
  } catch {
    return null;
  }
}

export default function UrlTool() {
  const { t } = useI18n();
  const [views, setViews] = useState<View[]>([]);
  const [ready, setReady] = useState(false);
  const [activeId, setActiveId] = useState<string>(() => localStorage.getItem(ACTIVE_KEY) ?? '');
  const [draft, setDraft] = useState({ name: '', url: '' });
  const [editingId, setEditingId] = useState('');
  const [nonces, setNonces] = useState<Record<string, number>>({});
  const [opened, setOpened] = useState<string[]>([]);

  const bump = (id: string) => {
    setNonces((prev) => ({ ...prev, [id]: (prev[id] ?? 0) + 1 }));
    setLoaded((prev) => ({ ...prev, [id]: false }));
  };
  const [status, setStatus] = useState<Status | null>(null);
  const [checking, setChecking] = useState(false);
  const [loaded, setLoaded] = useState<Record<string, boolean>>({});
  const [error, setError] = useState('');
  const [mode, setMode] = useState<'sub' | 'path'>(() => (localStorage.getItem('st:urls:mode') === 'path' ? 'path' : 'sub'));

  useEffect(() => {
    localStorage.setItem('st:urls:mode', mode);
  }, [mode]);

  const refresh = useCallback(async () => {
    try {
      const data = await api.get<{ urls: View[] }>('/urls');
      if (data.urls.length) {
        setViews(data.urls);
      } else {
        const seeded = await Promise.all(
          DEFAULTS.map((item) => api.post<{ url: View }>('/urls', item).then((res) => res.url).catch(() => null)),
        );
        setViews(seeded.filter((item): item is View => Boolean(item)));
      }
      setError('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('err.loadUrls'));
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!ready) return;
    if (!views.length) {
      setActiveId('');
      return;
    }
    if (!views.some((view) => view.id === activeId)) setActiveId(views[0].id);
  }, [ready, views, activeId]);

  useEffect(() => {
    if (activeId) localStorage.setItem(ACTIVE_KEY, activeId);
  }, [activeId]);

  const active = views.find((view) => view.id === activeId) ?? null;

  const probe = useCallback(async (view: View) => {
    setChecking(true);
    try {
      setStatus(await api.get<Status>('/proxy/probe' + qs({ u: fixHost(view.url) })));
    } catch (err) {
      setStatus({ ok: false, error: (err as Error).message });
    } finally {
      setChecking(false);
    }
  }, []);

  // probe hanya untuk view aktif
  useEffect(() => {
    if (!active) {
      setStatus(null);
      return;
    }
    setStatus(null);
    void probe(active);
  }, [active?.id, probe]);



  // Tiap view yang pernah dibuka tetap hidup (iframe-nya tidak dilepas).
  useEffect(() => {
    if (!active?.id) return;
    setOpened((prev) => (prev.includes(active.id) ? prev : [...prev, active.id]));
  }, [active?.id]);

  const submit = async () => {
    const url = normalize(draft.url);
    if (!url) {
      setError('URL tidak valid');
      return;
    }
    const name = draft.name.trim() || new URL(url).host;
    try {
      if (editingId) {
        const result = await api.put<{ url: View }>('/urls/' + editingId, { name, url });
        setViews((prev) => prev.map((view) => (view.id === editingId ? result.url : view)));
        setEditingId('');
      } else {
        const result = await api.post<{ url: View }>('/urls', { name, url });
        setViews((prev) => [...prev, result.url]);
        setActiveId(result.url.id);
      }
      setDraft({ name: '', url: '' });
      setError('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('err.saveUrl'));
    }
  };

  const startEdit = (view: View) => {
    setEditingId(view.id);
    setDraft({ name: view.name, url: view.url });
  };

  const remove = async (id: string) => {
    if (!window.confirm(t('viewer.confirmDelete'))) return;
    try {
      await api.del('/urls/' + id);
      setViews((prev) => prev.filter((view) => view.id !== id));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('err.deleteUrl'));
    }
  };

  const toggleProxy = async (view: View) => {
    try {
      const result = await api.put<{ url: View }>('/urls/' + view.id, { proxy: !view.proxy });
      setViews((prev) => prev.map((item) => (item.id === view.id ? result.url : item)));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('err.proxyMode'));
    }
  };

  const srcFor = (view: View) => {
    if (!view.proxy) return fixHost(view.url);
    const sub = mode === 'sub' ? subdomainSrc(view.url) : null;
    return sub ?? proxySrc(view.url);
  };

  const subSrc = useMemo(() => (active ? subdomainSrc(active.url) : null), [active?.url]);
  const usbSub = mode === 'sub' && !!subSrc;
  const src = useMemo(() => (active ? srcFor(active) : ''), [active?.url, active?.proxy, mode, subSrc]);
  const openUrl = active ? (active.proxy ? src : fixHost(active.url)) : '#';
  const openViews = views.filter((view) => opened.includes(view.id));

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="URL Viewer" subtitle={active ? active.url : t('viewer.subtitle')}>
        <button type="button" className="btn" onClick={() => active && bump(active.id)} disabled={!active} title={t('common.reload')}>
          <Icon name="refresh" /> {t('common.reload')}
        </button>
        <button type="button" className="btn" onClick={() => active && void probe(active)} disabled={!active || checking} title="Cek koneksi">
          {checking ? <Spinner /> : <Icon name="play" />} Cek
        </button>
        {active ? (
          <button
            type="button"
            className={cn('btn cursor-pointer', active.proxy && 'btn-primary')}
            onClick={() => void toggleProxy(active)}
            title="Lewat server ini: melepas X-Frame-Options/CSP dan mem-proxy aset + WebSocket"
          >
            Proxy
          </button>
        ) : null}
        {active?.proxy ? (
          <div className="flex overflow-hidden rounded-md border border-line">
            {([
              ['sub', 'Subdomain', 'Tiap target dapat origin sendiri: cookie, localStorage, dan /api/... bekerja normal'],
              ['path', 'Path', 'Satu origin, URL ditulis ulang. Cukup untuk halaman statis'],
            ] as const).map(([id, label, hint]) => (
              <button
                key={id}
                type="button"
                onClick={() => {
                  setMode(id);
                  active && bump(active.id);
                }}
                title={hint}
                className={cn(
                  'cursor-pointer px-2 py-1 text-[11.5px] transition-colors',
                  mode === id ? 'bg-accent/15 text-accent' : 'text-muted hover:bg-panel2 hover:text-ink',
                )}
              >
                {label}
              </button>
            ))}
          </div>
        ) : null}
        {active ? (
          <a className="btn" href={openUrl} target="_blank" rel="noreferrer" title={active.proxy ? 'Buka lewat proxy di tab baru' : 'Buka tab baru'}>
            <Icon name="external" />
          </a>
        ) : null}
      </PageHeader>

      {error ? <div className="shrink-0 border-b border-line bg-bad/10 px-3 py-1.5 text-[12px] text-bad">{error}</div> : null}

      {active && !active.proxy ? (
        <div className="shrink-0 border-b border-line bg-accent/5 px-3 py-1.5 text-[11.5px] text-muted">
          {t('viewer.proxyTip')} <span className="text-ink">Proxy</span> + <span className="text-ink">Subdomain</span>: <span className="mono">/api/...</span>
        </div>
      ) : null}

      {active?.proxy && mode === 'sub' && !subSrc ? (
        <div className="shrink-0 border-b border-line bg-warn/10 px-3 py-1.5 text-[12px] text-warn">
          Target terlalu panjang untuk mode subdomain, memakai mode path.
        </div>
      ) : null}

      {active && status && !status.ok ? (
        <div className="flex shrink-0 items-center gap-2 border-b border-line bg-bad/10 px-3 py-1.5 text-[12px] text-bad">
          <Icon name="x" size={13} />
          <span className="min-w-0 flex-1 truncate">
            {t('viewer.cannotConnect')} {active.url}. {status.error ?? t('viewer.status') + ' ' + status.status}
          </span>
          {!active.proxy ? (
            <button type="button" className="btn btn-ghost px-2 py-0.5 text-[11px]" onClick={() => void toggleProxy(active)}>
              Coba mode proxy
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1">
        <div className="flex w-56 shrink-0 flex-col border-r border-line">
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {!ready ? (
              <div className="flex justify-center p-6">
                <Spinner />
              </div>
            ) : (
              views.map((view) => (
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
                  <button type="button" onClick={() => void remove(view.id)} className="btn btn-ghost shrink-0 px-1 opacity-0 group-hover:opacity-100" title="Hapus">
                    <Icon name="x" size={13} />
                  </button>
                </div>
              ))
            )}
          </div>

          <form
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
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
              <Icon name={editingId ? 'check' : 'plus'} /> {editingId ? t('common.save') : t('viewer.addUrl')}
            </button>
          </form>
        </div>

        <div className="relative min-w-0 flex-1 bg-[#0b1118]">
          {active && !loaded[active.id] ? (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-[#0b1118]/70">
              <Spinner />
            </div>
          ) : null}
          {/*
            Iframe non-aktif sengaja tidak di-display:none: viewport 0x0 membuat SPA
            macet di layar loading saat tab kembali dibuka.
          */}
          {openViews.length ? (
            openViews.map((view) => (
              <iframe
                key={view.id + ':' + (nonces[view.id] ?? 0)}
                src={srcFor(view)}
                title={view.name}
                onLoad={() => setLoaded((prev) => ({ ...prev, [view.id]: true }))}
                className={cn(
                  'absolute inset-0 h-full w-full border-0',
                  view.id !== active?.id && 'pointer-events-none opacity-0',
                )}
                allow="clipboard-read; clipboard-write; fullscreen; microphone; camera"
              />
            ))
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-muted">{ready ? t('viewer.addToStart') : ''}</div>
          )}
        </div>
      </div>
    </div>
  );
}
