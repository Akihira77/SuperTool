import { useCallback, useEffect, useMemo, useState } from 'react';
import { Badge, Button, Empty, Icon, IconButton, Input, PageHeader, Spinner, cn } from '../components/ui';
import { api, ApiError, qs } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { usePaletteIntent } from '../lib/palette';
import { useConfirm } from '../components/confirm';
import { useToast } from '../components/toast';

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
    if (!url.hostname || /[%\s]/.test(url.hostname)) return null;
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
function subdomainSrc(url: string, ticket?: string): string | null {
  try {
    const origin = new URL(url).origin;
    const token = Array.from(new TextEncoder().encode(origin))
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
    if (token.length > 63) return null;
    const port = location.port ? ':' + location.port : '';
    const suffix = ticket ? '?st_ticket=' + encodeURIComponent(ticket) : '';
    return 'http://' + token + '.localhost' + port + '/' + suffix;
  } catch {
    return null;
  }
}

function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

export default function UrlTool() {
  const { t } = useI18n();
  const confirm = useConfirm();
  const toast = useToast();
  const [views, setViews] = useState<View[]>([]);
  const [ready, setReady] = useState(false);
  const [activeId, setActiveId] = useState<string>(() => localStorage.getItem(ACTIVE_KEY) ?? '');
  const [draft, setDraft] = useState({ name: '', url: '' });
  const [editingId, setEditingId] = useState('');
  const [nonces, setNonces] = useState<Record<string, number>>({});
  const [opened, setOpened] = useState<string[]>([]);
  const [tickets, setTickets] = useState<Record<string, string>>({});

  const bump = (id: string) => {
    setOpened((prev) => (prev.includes(id) ? prev : [...prev, id]));
    setNonces((prev) => ({ ...prev, [id]: (prev[id] ?? 0) + 1 }));
    setLoaded((prev) => ({ ...prev, [id]: false }));
  };

  const unload = () => {
    if (!active) return;
    setOpened((prev) => prev.filter((id) => id !== active.id));
    setLoaded((prev) => {
      const next = { ...prev };
      delete next[active.id];
      return next;
    });
  };
  const [status, setStatus] = useState<Status | null>(null);
  const [checking, setChecking] = useState(false);
  const [loaded, setLoaded] = useState<Record<string, boolean>>({});
  const [error, setError] = useState('');
  const [mode, setMode] = useState<'sub' | 'path'>(() => (localStorage.getItem('st:urls:mode') === 'path' ? 'path' : 'sub'));
  const draftUrl = normalize(draft.url);
  const draftInvalid = Boolean(draft.url.trim()) && !draftUrl;

  useEffect(() => {
    localStorage.setItem('st:urls:mode', mode);
  }, [mode]);

  // Mode subdomain tidak membawa cookie sesi (host berbeda), jadi minta tiket
  // bearer per origin target. Hanya untuk tab yang benar-benar dibuka.
  useEffect(() => {
    if (mode !== 'sub') return;
    let alive = true;
    for (const view of views) {
      if (!view.proxy || !opened.includes(view.id)) continue;
      const origin = originOf(view.url);
      if (!origin || tickets[origin]) continue;
      api
        .post<{ ticket: string }>('/proxy/ticket', { origin })
        .then((data) => {
          if (alive && data.ticket) setTickets((prev) => (prev[origin] ? prev : { ...prev, [origin]: data.ticket }));
        })
        .catch(() => {
          // Biarkan iframe menampilkan 401; pengguna bisa menekan Muat ulang.
        });
    }
    return () => {
      alive = false;
    };
  }, [mode, views, opened, tickets]);

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
      toast(t('common.saved'), 'ok');
        setViews((prev) => prev.map((view) => (view.id === editingId ? result.url : view)));
        setEditingId('');
      } else {
        const result = await api.post<{ url: View }>('/urls', { name, url });
      toast(t('common.created'), 'ok');
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

  // Perintah dari command palette: buka/edit URL tersimpan.
  usePaletteIntent('viewer', (action, payload) => {
    const view = views.find((item) => item.id === String(payload ?? ''));
    if (!view) return;
    if (action === 'edit') startEdit(view);
    else {
      setActiveId(view.id);
      bump(view.id);
    }
  });

  const remove = async (id: string) => {
    const ok = await confirm({ title: t('viewer.confirmDelete'), danger: true, confirmLabel: t('common.delete') });
    if (!ok) return;
    try {
      await api.del('/urls/' + id);
      toast(t('common.deleted'), 'ok');
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

  const canSub = (view: View) => mode === 'sub' && Boolean(subdomainSrc(view.url));
  const srcFor = (view: View) => {
    if (!view.proxy) return fixHost(view.url);
    const origin = originOf(view.url);
    const sub = canSub(view) ? subdomainSrc(view.url, origin ? tickets[origin] : undefined) : null;
    if (sub && !sub.includes('st_ticket=')) return 'about:blank';
    return sub ?? proxySrc(view.url);
  };

  const subSrc = useMemo(() => (active && mode === 'sub' ? subdomainSrc(active.url) : null), [active?.url, mode]);
  const src = useMemo(
    () => (active ? srcFor(active) : ''),
    [active?.url, active?.proxy, mode, subSrc, tickets],
  );
  const openOrigin = active && canSub(active) ? originOf(active.url) : null;
  const openTicket = openOrigin ? tickets[openOrigin] : undefined;
  const openUrl = active
    ? active.proxy
      ? openTicket
        ? subdomainSrc(active.url, openTicket) ?? ''
        : ''
      : fixHost(active.url)
    : '';
  const openViews = views.filter((view) => opened.includes(view.id));

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="URL Viewer" subtitle={active ? active.url : t('viewer.subtitle')} icon="url">
        <Button icon="refresh" onClick={() => active && bump(active.id)} disabled={!active} title={t('common.reload')}>
          {t('common.reload')}
        </Button>
        <Button icon="play" loading={checking} onClick={() => active && void probe(active)} disabled={!active} title="Cek koneksi">
          Cek
        </Button>
        {active && opened.includes(active.id) ? (
          <Button icon="x" variant="subtle" onClick={unload} title={t('viewer.unloadHint')}>
            {t('viewer.unload')}
          </Button>
        ) : null}
        {active ? (
          <Button
            variant={active.proxy ? 'primary' : 'subtle'}
            aria-pressed={active.proxy}
            onClick={() => void toggleProxy(active)}
            title="Lewat server ini: melepas X-Frame-Options/CSP dan mem-proxy aset + WebSocket"
          >
            Proxy
          </Button>
        ) : null}
        {active?.proxy ? (
          <div role="group" aria-label="Mode proxy" className="seg">
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
                aria-pressed={mode === id}
                className="seg-item"
              >
                {label}
              </button>
            ))}
          </div>
        ) : null}
        {active && openUrl ? (
          <a className="btn" href={openUrl} target="_blank" rel="noreferrer" title={active.proxy ? 'Buka lewat proxy di tab baru' : 'Buka tab baru'} aria-label={active.proxy ? 'Buka lewat proxy di tab baru' : 'Buka tab baru'}>
            <Icon name="external" />
          </a>
        ) : null}
      </PageHeader>

      {error ? <div role="alert" className="shrink-0 border-b border-line bg-bad/10 px-3 py-1.5 text-[13px] text-bad">{error}</div> : null}

      {active && !active.proxy ? (
        <div className="shrink-0 border-b border-line bg-accent/5 px-3 py-1.5 text-[12.5px] text-muted">
          {t('viewer.proxyTip')} <span className="text-ink">Proxy</span> + <span className="text-ink">Subdomain</span>: <span className="mono">/api/...</span>
        </div>
      ) : null}

      {active?.proxy && mode === 'sub' && !subSrc ? (
        <div role="status" className="shrink-0 border-b border-line bg-warn/10 px-3 py-1.5 text-[13px] text-warn">
          Target terlalu panjang untuk mode subdomain, memakai mode path.
        </div>
      ) : null}

      {active?.proxy && mode === 'path' ? (
        <div role="status" className="shrink-0 border-b border-line bg-warn/10 px-3 py-1.5 text-[13px] text-warn">
          Mode path berjalan di origin aplikasi. Iframe disandbox tanpa akses same-origin;
          aplikasi yang butuh cookie/localStorage penuh sebaiknya pakai mode Subdomain.
        </div>
      ) : null}

      {active && status && !status.ok ? (
        <div role="alert" className="flex shrink-0 items-center gap-2 border-b border-line bg-bad/10 px-3 py-1.5 text-[13px] text-bad">
          <Icon name="x" size={13} className="shrink-0" />
          <span className="min-w-0 flex-1 truncate">
            {t('viewer.cannotConnect')} {active.url}. {status.error ?? t('viewer.status') + ' ' + status.status}
          </span>
          {!active.proxy ? (
            <Button size="sm" variant="ghost" onClick={() => void toggleProxy(active)}>
              Coba mode proxy
            </Button>
          ) : null}
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1">
        <div className="flex w-56 shrink-0 flex-col border-r border-line bg-panel/25">
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {!ready ? (
              <div className="flex justify-center p-6">
                <Spinner />
              </div>
            ) : (
              views.map((view) => (
                <div
                  key={view.id}
                  className={cn(
                    'group mb-0.5 flex items-center rounded-panel pr-1 transition-colors duration-[var(--duration-fast)]',
                    activeId === view.id ? 'bg-accent/12 ring-1 ring-accent/25' : 'hover:bg-panel2/80 focus-within:bg-panel2/80',
                  )}
                >
                  <button
                    type="button"
                    onClick={() => setActiveId(view.id)}
                    aria-current={activeId === view.id ? 'true' : undefined}
                    className="min-w-0 flex-1 rounded-panel px-2.5 py-2 text-left"
                  >
                    <div className="flex items-center gap-1.5">
                      <span
                        aria-hidden="true"
                        className={cn(
                          'h-1.5 w-1.5 shrink-0 rounded-full',
                          activeId !== view.id ? 'bg-muted/40' : !status ? 'bg-muted/40' : status.ok ? 'bg-ok' : 'bg-bad',
                        )}
                      />
                      <span className="truncate text-[13.5px] font-medium">{view.name}</span>
                      {view.proxy ? <Badge tone="accent" className="px-1.5 py-0 text-[11.5px]">proxy</Badge> : null}
                    </div>
                    <div className="truncate text-[12px] text-muted">{view.url}</div>
                  </button>
                  <IconButton
                    icon="edit"
                    size="sm"
                    className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                    onClick={() => startEdit(view)}
                    label={'Ubah ' + view.name}
                    tooltip="Ubah"
                  />
                  <IconButton
                    icon="x"
                    size="sm"
                    tone="danger"
                    className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                    onClick={() => void remove(view.id)}
                    label={'Hapus ' + view.name}
                    tooltip="Hapus"
                  />
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
              <div className="flex items-center justify-between text-[12px] text-accent">
                <span>Ubah URL</span>
                <Button variant="ghost" size="sm" data-action="viewer:add" onClick={() => { setEditingId(''); setDraft({ name: '', url: '' }); }}>
                  batal
                </Button>
              </div>
            ) : null}
            <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Nama (opsional)" aria-label={t("viewer.name")} className="min-h-8 py-1.5 text-[13px]" />
            <Input
              value={draft.url}
              onChange={(e) => setDraft({ ...draft, url: e.target.value })}
              placeholder="http://127.0.0.1:3000" aria-label={t("viewer.url")}
              invalid={draftInvalid}
              className="min-h-8 py-1.5 text-[13px]"
            />
            {draftInvalid ? <span className="text-[12.5px] text-bad">URL tidak valid</span> : null}
            <Button
              type="submit"
              variant="primary"
              icon={editingId ? 'check' : 'plus'}
              className="w-full justify-center"
              disabled={!draftUrl}
            >
              {editingId ? t('common.save') : t('viewer.addUrl')}
            </Button>
          </form>
        </div>

        <div className="relative min-w-0 flex-1 bg-[#070d14]">
          {active && opened.includes(active.id) && !loaded[active.id] ? (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-[#070d14]/70">
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
                sandbox={
                  view.proxy && !(mode === 'sub' && subdomainSrc(view.url))
                    ? 'allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads allow-modals'
                    : undefined
                }
              />
            ))
          ) : (
            <Empty icon="url" text={ready ? (active ? t('viewer.closed') : t('viewer.addToStart')) : ''} />
          )}
        </div>
      </div>
    </div>
  );
}
