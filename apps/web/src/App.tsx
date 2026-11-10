import { Fragment, Suspense, lazy, memo, useEffect, useLayoutEffect, useRef, useState, type ComponentType, type LazyExoticComponent } from 'react';
import ChangePassword from './components/ChangePassword';
import CommandPalette, { type PaletteNode } from './components/CommandPalette';
import { ToastProvider } from './components/toast';
import { ConfirmProvider } from './components/confirm';
import { ProjectProvider } from './lib/project';
import { PlayerProvider } from './lib/player';
import { ProjectPicker } from './components/ProjectPicker';
import { PrayerWidget } from './components/PrayerWidget';
import { SessionTabs } from './components/SessionTabs';
import Login from './components/Login';
import { Icon, Spinner, cn } from './components/ui';
import { api } from './lib/api';
import { I18nProvider, useI18n } from './lib/i18n';
import { useRoute } from './lib/router';
import { useSidebar } from './lib/useSidebar';
import { useFocusTrap } from './lib/useFocusTrap';
import { dispatchIntent, runClick, runFocus, type FilesSearchPayload } from './lib/palette';
import { actionsFor, findAction } from './lib/actions';
import { onWorkflow } from './lib/workflow';
import {
  MAX_SESSIONS,
  loadSessionStore,
  newSession,
  saveSessionStore,
  subscribeSessionStore,
  type SessionStore,
} from './lib/sessions';

type ToolGroup = 'workspace' | 'build' | 'ops';
type Tool = {
  id: string;
  label: string;
  desc: string;
  icon: string;
  group: ToolGroup;
  component: LazyExoticComponent<ComponentType>;
};

const TOOLS: Array<Tool & { key: string }> = [
  { id: 'markdown', key: 'nav.markdown', label: 'Markdown', desc: 'Editor + live preview', icon: 'markdown', group: 'workspace', component: lazy(() => import('./tools/MarkdownTool')) },
  { id: 'notes', key: 'nav.notes', label: 'Catatan', desc: 'Notepad tersimpan', icon: 'notes', group: 'workspace', component: lazy(() => import('./tools/NotesTool')) },
  { id: 'files', key: 'nav.files', label: 'File Explorer', desc: 'Jelajah & lihat file', icon: 'files', group: 'workspace', component: lazy(() => import('./tools/FilesTool')) },
  { id: 'viewer', key: 'nav.viewer', label: 'URL Viewer', desc: 'Buka tool lain via iframe', icon: 'url', group: 'workspace', component: lazy(() => import('./tools/UrlTool')) },
  { key: 'nav.json', id: 'json', label: 'JSON', desc: 'Formatter & beautify', icon: 'json', group: 'build', component: lazy(() => import('./tools/JsonTool')) },
  { key: 'nav.types', id: 'types', label: 'JSON ke TS', desc: 'Generate tipe TypeScript', icon: 'types', group: 'build', component: lazy(() => import('./tools/TypesTool')) },
  { key: 'nav.compress', id: 'compress', label: 'Kompresor', desc: 'Perkecil PDF & gambar', icon: 'compress', group: 'build', component: lazy(() => import('./tools/CompressTool')) },
  { key: 'nav.downloader', id: 'downloader', label: 'Downloader', desc: 'YouTube, Facebook, Bilibili', icon: 'download', group: 'build', component: lazy(() => import('./tools/DownloaderTool')) },
  { key: 'nav.devspace', id: 'devspace', label: 'Dev Space', desc: 'Regex, hash, HTTP, log, docker, git', icon: 'dev', group: 'ops', component: lazy(() => import('./tools/DevSpaceTool')) },
  { key: 'nav.storage', id: 'storage', label: 'Storage Monitor', desc: 'Pemakaian disk & bersihkan', icon: 'storage', group: 'ops', component: lazy(() => import('./tools/StorageTool')) },
  { key: 'nav.nginx', id: 'nginx', label: 'Nginx', desc: 'Edit konfigurasi', icon: 'nginx', group: 'ops', component: lazy(() => import('./tools/NginxTool')) },
  { key: 'nav.ports', id: 'ports', label: 'Port', desc: 'App yang sedang jalan', icon: 'ports', group: 'ops', component: lazy(() => import('./tools/PortsTool')) },
  { key: 'nav.webhook', id: 'webhook', label: 'Webhook Receiver', desc: 'Tangkap request HTTP masuk', icon: 'webhook', group: 'ops', component: lazy(() => import('./tools/WebhookTool')) },
  { key: 'nav.calendar', id: 'calendar', label: 'Calendar', desc: 'Agenda Google Calendar', icon: 'calendar', group: 'ops', component: lazy(() => import('./tools/CalendarTool')) },
  { key: 'nav.settings', id: 'settings', label: 'Settings', desc: 'Backup & restore data', icon: 'save', group: 'ops', component: lazy(() => import('./tools/SettingsTool')) },
];

const GROUPS: Array<{ id: ToolGroup; key: 'nav.group.workspace' | 'nav.group.build' | 'nav.group.ops' }> = [
  { id: 'workspace', key: 'nav.group.workspace' },
  { id: 'build', key: 'nav.group.build' },
  { id: 'ops', key: 'nav.group.ops' },
];

type AuthState = 'loading' | 'anon' | 'must-change' | 'ready';

/** Isi sesi tidak ikut re-render saat tab lain diaktifkan; elemennya tetap sama. */
const SessionContent = memo(function SessionContent({
  component: Component,
}: {
  component: LazyExoticComponent<ComponentType>;
}) {
  return <Component />;
});

function toolById(id: string): Tool | undefined {
  return TOOLS.find((tool) => tool.id === id);
}

/** Satu sesi per tool; buang tool yang sudah tidak ada di katalog. */
function normalizeSessions(store: SessionStore): SessionStore {
  const seen = new Set<string>();
  const sessions = store.sessions
    .filter((session) => {
      if (!toolById(session.tool) || seen.has(session.tool)) return false;
      seen.add(session.tool);
      return true;
    })
    .slice(0, MAX_SESSIONS);
  const activeId = sessions.some((session) => session.id === store.activeId)
    ? store.activeId
    : sessions[0]?.id ?? null;
  return { sessions, activeId };
}

function initialSessionStore(route: string): SessionStore {
  const stored = loadSessionStore();
  if (stored) {
    const clean = normalizeSessions(stored);
    if (clean.sessions.length || !stored.sessions.length) return clean;
  }
  const tool = toolById(route) ?? TOOLS[0];
  const session = newSession(tool.id);
  return { sessions: [session], activeId: session.id };
}

export default function App() {
  return (
    <I18nProvider>
      <ToastProvider>
        <ConfirmProvider>
          <ProjectProvider>
            <PlayerProvider>
              <Shell />
            </PlayerProvider>
          </ProjectProvider>
        </ConfirmProvider>
      </ToastProvider>
    </I18nProvider>
  );
}

function Shell() {
  const [auth, setAuth] = useState<AuthState>('loading');
  const [route, navigate] = useRoute();
  const [navOpen, toggleNav] = useSidebar('nav');
  const [mobileNav, setMobileNav] = useState(false);
  const sidebarRef = useRef<HTMLElement | null>(null);
  useFocusTrap(mobileNav, sidebarRef);
  const expanded = navOpen || mobileNav;
  const { t, lang, setLang } = useI18n();
  const [store, setStore] = useState<SessionStore>(() => initialSessionStore(route));
  const [booted, setBooted] = useState(false);
  const [mounted, setMounted] = useState<Set<string>>(
    () => new Set(store.activeId ? [store.activeId] : []),
  );
  const [paletteOpen, setPaletteOpen] = useState(false);
  const routeRef = useRef(route);

  useEffect(() => {
    if (!mobileNav) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileNav(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [mobileNav]);
  const lastRoute = useRef(route);
  const lastSaved = useRef('');
  routeRef.current = route;

  const activeSession = store.sessions.find((session) => session.id === store.activeId) ?? null;
  const activeToolId = activeSession?.tool ?? null;

  // Ctrl/Cmd + K membuka command palette.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPaletteOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const loadUrls = async (): Promise<PaletteNode[]> => {
    const data = await api.get<{ urls: Array<{ id: string; name: string; url: string }> }>('/urls').catch(() => ({ urls: [] }));
    const list = data.urls ?? [];
    return list.map((item) => ({ id: 'viewer:open:' + item.id, label: item.name || item.url, desc: item.url, icon: 'url' }));
  };

  const paletteTree: PaletteNode[] = [
    ...TOOLS.map<PaletteNode>((tool) => {
      const id = tool.id;
      const base: PaletteNode = { id: 'tool:' + id, label: t(tool.key as 'nav.markdown', tool.label), desc: t(('nav.' + id + '.desc') as 'nav.markdown.desc', tool.desc), icon: tool.icon };
      if (id === 'files') {
        return { ...base, children: [{ id: 'files:search', label: t('palette.searchFiles'), desc: t('palette.searchFilesDesc'), icon: 'search', form: 'files-search' }] };
      }
      if (id === 'viewer') {
        return {
          ...base,
          children: [
            { id: 'viewer:add', label: t(('palette.act.add') as 'palette.act.write'), icon: 'plus' },
            { id: 'viewer:access', label: t('palette.act.access'), desc: t('palette.act.accessDesc'), icon: 'url', children: loadUrls },
            { id: 'viewer:edit', label: t('palette.act.edit'), desc: t('palette.act.editDesc'), icon: 'edit', children: async () => (await loadUrls()).map((node) => ({ ...node, id: node.id.replace('viewer:open:', 'viewer:edit:') })) },
          ],
        };
      }
      return {
        ...base,
        children: actionsFor(id).map<PaletteNode>((action) => ({
          id: action.tool + ':' + action.action,
          label: t(('palette.act.' + action.action) as 'palette.act.write'),
          icon: action.icon,
        })),
      };
    }),
    { id: 'action:lang', label: lang === 'id' ? 'Bahasa: English' : 'Bahasa: Indonesia', desc: t('palette.act.langDesc'), icon: 'dev' },
    { id: 'action:password', label: t('nav.password'), desc: t('palette.act.passwordDesc'), icon: 'lock' },
    { id: 'action:logout', label: t('nav.logout'), desc: t('palette.act.logoutDesc'), icon: 'logout' },
  ];

  const runPalette = (path: PaletteNode[], node: PaletteNode, payload?: FilesSearchPayload) => {
    if (node.id === 'files:search-run' && payload) {
      openTool('files');
      dispatchIntent({ tool: 'files', action: 'search', payload });
      return;
    }
    if (node.id.startsWith('viewer:open:') || node.id.startsWith('viewer:edit:')) {
      const [, action, target] = node.id.split(':');
      openTool('viewer');
      dispatchIntent({ tool: 'viewer', action: action === 'edit' ? 'edit' : 'open', payload: target });
      return;
    }
    if (node.id.startsWith('tool:')) {
      openTool(node.id.slice(5));
      return;
    }
    if (node.id.startsWith('action:')) {
      if (node.id === 'action:lang') setLang(lang === 'id' ? 'en' : 'id');
      else if (node.id === 'action:password') navigate('password');
      else if (node.id === 'action:logout') void logout();
      return;
    }
    const [tool, action] = node.id.split(':');
    openTool(tool);
    const spec = findAction(tool, action);
    if (spec?.focus) void runFocus(tool, spec.focus);
    else void runClick(tool, action);
    void path;
  };

  useEffect(() => {
    let alive = true;
    api
      .get<{ mustChange: boolean }>('/auth/me')
      .then((me) => alive && setAuth(me.mustChange ? 'must-change' : 'ready'))
      .catch(() => alive && setAuth('anon'));
    return () => {
      alive = false;
    };
  }, []);

  // Sesi yang sudah pernah aktif tetap di-mount saat pindah tab, jadi scan,
  // unduhan, SSE, atau proses lain di sesi lama tidak ikut dibatalkan.
  useLayoutEffect(() => {
    const id = store.activeId;
    if (!id) return;
    setMounted((previous) => (previous.has(id) ? previous : new Set(previous).add(id)));
  }, [store.activeId]);

  useEffect(() => {
    const serialized = JSON.stringify({ sessions: store.sessions, activeId: store.activeId });
    if (lastSaved.current === serialized) return;
    lastSaved.current = serialized;
    saveSessionStore(store);
  }, [store]);

  useEffect(() => {
    return subscribeSessionStore((incoming) => {
      const clean = normalizeSessions(incoming);
      lastSaved.current = JSON.stringify({ sessions: clean.sessions, activeId: clean.activeId });
      setStore(clean);
      const active = clean.sessions.find((session) => session.id === clean.activeId);
      if (active && active.tool !== routeRef.current) navigate(active.tool);
    });
  }, [navigate]);

  useEffect(() => {
    const active = store.sessions.find((session) => session.id === store.activeId);
    if (active && active.tool !== routeRef.current && routeRef.current !== 'password') navigate(active.tool);
    const frame = requestAnimationFrame(() => setBooted(true));
    return () => cancelAnimationFrame(frame);
    // Hanya saat mount: hash awal diselaraskan dengan sesi yang di-restore.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!booted || lastRoute.current === route) return;
    lastRoute.current = route;
    if (!store.sessions.length) return;
    const active = store.sessions.find((session) => session.id === store.activeId);
    if (active?.tool === route) return;
    const existing = store.sessions.find((session) => session.tool === route);
    if (existing) {
      setStore((previous) => (previous.activeId === existing.id ? previous : { ...previous, activeId: existing.id }));
      return;
    }
    const tool = toolById(route);
    if (!tool) return;
    const session = newSession(tool.id);
    setStore((previous) => {
      if (previous.sessions.some((item) => item.tool === tool.id)) return previous;
      return { sessions: [...previous.sessions, session], activeId: session.id };
    });
  }, [booted, route, store, navigate]);

  const activateSession = (id: string) => {
    const session = store.sessions.find((item) => item.id === id);
    if (!session) return;
    setStore((previous) => ({ ...previous, activeId: session.id }));
    if (routeRef.current !== session.tool) navigate(session.tool);
  };

  const closeSession = (id: string) => {
    const index = store.sessions.findIndex((session) => session.id === id);
    if (index < 0) return;
    const remaining = store.sessions.filter((session) => session.id !== id);
    const closingActive = store.activeId === id;
    const nextActiveId = closingActive
      ? remaining[Math.min(index, remaining.length - 1)]?.id ?? null
      : store.activeId;
    setStore({ sessions: remaining, activeId: nextActiveId });
    if (closingActive) {
      const next = remaining.find((session) => session.id === nextActiveId);
      if (next) navigate(next.tool);
    }
  };

  const renameSession = (id: string, name: string) => {
    const nextName = name.trim().slice(0, 80);
    if (!nextName) return;
    setStore((previous) => ({
      ...previous,
      sessions: previous.sessions.map((session) =>
        session.id === id ? { ...session, name: nextName } : session,
      ),
    }));
  };

  const reorderSessions = (fromId: string, toId: string) => {
    setStore((previous) => {
      const from = previous.sessions.findIndex((session) => session.id === fromId);
      const to = previous.sessions.findIndex((session) => session.id === toId);
      if (from < 0 || to < 0 || from === to) return previous;
      const sessions = [...previous.sessions];
      const [moved] = sessions.splice(from, 1);
      sessions.splice(to, 0, moved);
      return { ...previous, sessions };
    });
  };

  const addSession = (toolId: string) => {
    const existing = store.sessions.find((session) => session.tool === toolId);
    if (existing) {
      activateSession(existing.id);
      return;
    }
    if (store.sessions.length >= MAX_SESSIONS) return;
    const tool = toolById(toolId);
    if (!tool) return;
    const session = newSession(tool.id);
    setStore((previous) => {
      if (previous.sessions.some((item) => item.tool === toolId)) return previous;
      return { sessions: [...previous.sessions, session], activeId: session.id };
    });
    if (routeRef.current !== toolId) navigate(toolId);
  };

  /** Navigasi dari sidebar/palette: fokus sesi yang sudah ada atau buat baru. */
  const openTool = (toolId: string) => {
    const existing = store.sessions.find((session) => session.tool === toolId);
    if (existing) activateSession(existing.id);
    else addSession(toolId);
  };

  // Workflow lintas tool: buka sesi tujuan lalu teruskan aksi + payload.
  const openToolRef = useRef(openTool);
  openToolRef.current = openTool;
  useEffect(
    () =>
      onWorkflow((intent) => {
        openToolRef.current(intent.tool);
        dispatchIntent(intent);
      }),
    [],
  );

  const logout = async () => {
    await api.post('/auth/logout').catch(() => undefined);
    setAuth('anon');
  };

  if (auth === 'loading') {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    );
  }
  if (auth === 'anon') return <Login onSuccess={(mustChange) => setAuth(mustChange ? 'must-change' : 'ready')} />;
  if (auth === 'must-change') return <ChangePassword forced onDone={() => setAuth('ready')} />;


  return (
    <div className="flex h-full overflow-hidden">
      <a
        href="#main-content"
        className="sr-only z-[100] rounded-md bg-panel px-3 py-2 text-[13px] text-ink focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:border focus:border-accent"
      >
        {t('nav.skip')}
      </a>
      {mobileNav ? (
        <button
          type="button"
          aria-label={t('nav.close')}
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-[1px] md:hidden"
          onClick={() => setMobileNav(false)}
        />
      ) : null}
      <aside
        ref={sidebarRef}
        id="app-sidebar"
        role={mobileNav ? 'dialog' : undefined}
        aria-modal={mobileNav || undefined}
        aria-label="Super Tool"
        className={cn(
          'fixed inset-y-0 left-0 z-[60] flex w-72 shrink-0 flex-col border-r border-line bg-panel shadow-2xl transition-[width,transform] duration-200 md:static md:z-auto md:translate-x-0 md:bg-panel/55 md:shadow-none',
          mobileNav ? 'translate-x-0' : '-translate-x-full',
          navOpen ? 'md:w-14 lg:w-60' : 'md:w-14',
        )}
      >
        <div className={cn('flex items-center gap-2.5 px-2.5 py-3', !expanded && 'flex-col gap-1.5 px-2')}>
          <div className="flex size-8 shrink-0 items-center justify-center rounded-[10px] border border-accent/30 bg-gradient-to-br from-accent to-accent2 text-[14px] font-bold text-white shadow-[0_8px_24px_-14px_rgb(107_150_255/0.9)]">
            S
          </div>
          {expanded ? (
            <div className="min-w-0 flex-1 md:hidden lg:block">
              <div className="truncate text-[14px] leading-tight font-semibold">Super Tool</div>
              <div className="truncate text-[12.5px] text-muted">{t('app.tagline')}</div>
            </div>
          ) : null}
          <button
            type="button"
            onClick={() => (mobileNav ? setMobileNav(false) : toggleNav())}
            className={cn(
              'btn btn-ghost btn-icon shrink-0',
              expanded && 'ml-auto',
              mobileNav ? 'inline-flex' : 'hidden lg:inline-flex',
            )}
            title={mobileNav || navOpen ? t('nav.hideSidebar') : t('nav.showSidebar')}
            aria-label={mobileNav || navOpen ? t('nav.hideSidebar') : t('nav.showSidebar')}
            aria-expanded={expanded}
            aria-controls="app-sidebar"
          >
            <Icon name={mobileNav || navOpen ? 'back' : 'panel'} />
          </button>
        </div>

        <nav className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-x-hidden overflow-y-auto px-2 py-2">
          {TOOLS.map((tool, index) => {
            const previous = TOOLS[index - 1];
            const newGroup = !previous || previous.group !== tool.group;
            const group = GROUPS.find((item) => item.id === tool.group);
            return (
              <Fragment key={tool.id}>
                {newGroup ? (
                  <div className={cn('px-2 pt-2 pb-1 text-[12.5px] font-semibold tracking-[0.1em] text-muted/70 uppercase', !expanded && 'mx-auto h-px w-6 overflow-hidden bg-line p-0 text-transparent')}>
                    <span className={cn(expanded && 'md:hidden lg:inline')}>{t(group?.key ?? 'nav.group.workspace')}</span>
                  </div>
                ) : null}
                <button
                  type="button"
                  onClick={() => {
                    openTool(tool.id);
                    setMobileNav(false);
                  }}
                  title={t(tool.key as 'nav.markdown', tool.label)}
                  aria-current={activeToolId === tool.id ? 'page' : undefined}
                  className={cn(
                    'nav-item w-full',
                    activeToolId === tool.id && 'nav-item-active',
                    !expanded && 'justify-center px-0',
                    expanded && 'md:justify-center lg:justify-start',
                  )}
                >
                  <Icon name={tool.icon} className="shrink-0" />
                  {expanded ? <span className="inline truncate md:hidden lg:inline">{t(tool.key as 'nav.markdown', tool.label)}</span> : null}
                </button>
              </Fragment>
            );
          })}
        </nav>

        <div className="border-t border-line p-2">
          {expanded ? (
            <div className="mb-1 hidden items-center gap-1 px-1 lg:flex">
              <span className="text-[12.5px] tracking-wide text-muted uppercase">{t('nav.language')}</span>
              {(['id', 'en'] as const).map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => setLang(item)}
                  className={cn(
                    'cursor-pointer rounded border px-1.5 py-0.5 text-[12px] transition-colors',
                    lang === item ? 'border-accent/60 bg-accent/15 text-accent' : 'border-line text-muted hover:text-ink',
                  )}
                >
                  {item.toUpperCase()}
                </button>
              ))}
            </div>
          ) : null}
          <button
            type="button"
            onClick={() => setLang(lang === 'id' ? 'en' : 'id')}
            className={cn(
              'mb-1 w-full cursor-pointer justify-center rounded-md py-1.5 text-[12.5px] font-semibold tracking-wide text-muted hover:bg-panel2 hover:text-ink',
              expanded ? 'flex lg:hidden' : 'flex',
            )}
            title={t('nav.language')}
            aria-label={t('nav.language')}
          >
            {lang.toUpperCase()}
          </button>
          <button
            type="button"
            onClick={() => {
              navigate('password');
              setMobileNav(false);
            }}
            className={cn('nav-item w-full', !expanded && 'justify-center px-0', expanded && 'md:justify-center lg:justify-start')}
            title={t('nav.password')}
          >
            <Icon name="lock" className="shrink-0" />
            {expanded ? <span className="inline truncate md:hidden lg:inline">{t('nav.password')}</span> : null}
          </button>
          <button
            type="button"
            onClick={logout}
            className={cn('nav-item w-full', !expanded && 'justify-center px-0', expanded && 'md:justify-center lg:justify-start')}
            title={t('nav.logout')}
          >
            <Icon name="logout" className="shrink-0" />
            {expanded ? <span className="inline truncate md:hidden lg:inline">{t('nav.logout')}</span> : null}
          </button>
        </div>
      </aside>

      <main id="main-content" tabIndex={-1} className="relative flex min-h-0 min-w-0 flex-1 flex-col outline-none">
        <ProjectPicker right={<PrayerWidget />} onMenu={() => setMobileNav(true)} menuOpen={mobileNav} />
        {route === 'password' ? (
          <div className="flex-1 overflow-y-auto">
            <ChangePassword forced={false} onDone={() => openTool('markdown')} />
          </div>
        ) : (
          <>
            <SessionTabs
              tools={TOOLS}
              sessions={store.sessions}
              activeId={store.activeId}
              max={MAX_SESSIONS}
              onActivate={activateSession}
              onClose={closeSession}
              onRename={renameSession}
              onReorder={reorderSessions}
              onAdd={addSession}
            />
            {/*
              Sesi yang sudah pernah aktif tetap di-mount walau tidak aktif, supaya
              proses yang sedang jalan (scan, unduh, SSE, terminal) tidak batal.
              Sesi yang belum pernah aktif baru di-mount saat pertama dibuka.
            */}
            <div className="relative min-h-0 min-w-0 flex-1">
              {store.sessions.map((session) => {
                const active = session.id === store.activeId;
                const Component = toolById(session.tool)?.component;
                if (!Component) return null;
                if (!active && !mounted.has(session.id)) return null;
                return (
                  <Suspense
                    key={session.id}
                    fallback={
                      active ? (
                        <div className="absolute inset-0 flex items-center justify-center">
                          <Spinner />
                        </div>
                      ) : null
                    }
                  >
                    {/* Kotak sesi selalu absolute dengan ukuran sama; pindah tab
                        hanya mengubah visibility, bukan layout flex/absolute. */}
                    <div
                      className={cn(
                        'absolute inset-0 flex min-h-0 min-w-0 flex-col',
                        !active && 'pointer-events-none invisible',
                      )}
                      aria-hidden={active ? undefined : true}
                    >
                      <SessionContent component={Component} />
                    </div>
                  </Suspense>
                );
              })}
              {!activeSession ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-6 text-center text-muted">
                  <Icon name="panel" size={26} />
                  <div className="text-[13.5px] font-medium text-ink">{t('session.empty')}</div>
                  <div className="text-[12.5px]">{t('session.emptyHint')}</div>
                </div>
              ) : null}
            </div>
          </>
        )}
      </main>

      <CommandPalette open={paletteOpen} root={paletteTree} onClose={() => setPaletteOpen(false)} onRun={runPalette} />
    </div>
  );
}