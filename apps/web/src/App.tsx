import { Fragment, Suspense, lazy, useEffect, useState, type ComponentType, type LazyExoticComponent } from 'react';
import ChangePassword from './components/ChangePassword';
import CommandPalette, { type PaletteNode } from './components/CommandPalette';
import { ToastProvider } from './components/toast';
import { ConfirmProvider } from './components/confirm';
import { ProjectProvider } from './lib/project';
import { PlayerProvider } from './lib/player';
import { ProjectPicker } from './components/ProjectPicker';
import { PrayerWidget } from './components/PrayerWidget';
import Login from './components/Login';
import { Icon, Spinner, cn } from './components/ui';
import { api } from './lib/api';
import { I18nProvider, useI18n } from './lib/i18n';
import { useRoute } from './lib/router';
import { useSidebar } from './lib/useSidebar';
import { dispatchIntent, runClick, runFocus, type FilesSearchPayload } from './lib/palette';

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
  const { t, lang, setLang } = useI18n();
  const ViewerComponent = TOOLS.find((tool) => tool.id === 'viewer')!.component;
  const [paletteOpen, setPaletteOpen] = useState(false);

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

  // Aksi per tool untuk submenu palette. Tombolnya di tool ditandai
  // data-action="tool:aksi" supaya palette tinggal mengklik.
  const act = (tool: string, action: string, icon = 'chevronRight'): PaletteNode => ({
    id: tool + ':' + action,
    label: t(('palette.act.' + action) as 'palette.act.write'),
    icon,
  });

  const toolActions: Record<string, PaletteNode[]> = {
    markdown: [act('markdown', 'write', 'markdown'), act('markdown', 'upload', 'download'), act('markdown', 'export', 'download'), act('markdown', 'sample', 'notes'), act('markdown', 'clear', 'trash')],
    json: [act('json', 'write', 'json'), act('json', 'format', 'check'), act('json', 'minify', 'compress'), act('json', 'sort', 'types'), act('json', 'upload', 'download'), act('json', 'download', 'download')],
    types: [act('types', 'download', 'download')],
    notes: [act('notes', 'new', 'plus'), act('notes', 'search', 'search'), act('notes', 'delete', 'trash'), act('notes', 'list', 'notes')],
    nginx: [act('nginx', 'save', 'save'), act('nginx', 'new', 'plus')],
    ports: [act('ports', 'refresh', 'refresh'), act('ports', 'tabPorts', 'ports'), act('ports', 'tabProcs', 'dev'), act('ports', 'auto', 'play')],
    compress: [act('compress', 'pick', 'files'), act('compress', 'run', 'play'), act('compress', 'download', 'download')],
    devspace: ['regex', 'encode', 'http', 'log', 'docker', 'git', 'cron', 'dns', 'sqlite', 'audit'].map((tab) =>
      act('devspace', tab, 'chevronRight'),
    ),
    webhook: [act('webhook', 'pause', 'play'), act('webhook', 'clear', 'trash')],
    settings: [act('settings', 'backup', 'download'), act('settings', 'restore', 'upload')],
  };

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
            act('viewer', 'add', 'plus'),
            { id: 'viewer:access', label: t('palette.act.access'), desc: t('palette.act.accessDesc'), icon: 'url', children: loadUrls },
            { id: 'viewer:edit', label: t('palette.act.edit'), desc: t('palette.act.editDesc'), icon: 'edit', children: async () => (await loadUrls()).map((node) => ({ ...node, id: node.id.replace('viewer:open:', 'viewer:edit:') })) },
          ],
        };
      }
      return { ...base, children: toolActions[id] };
    }),
    { id: 'action:lang', label: lang === 'id' ? 'Bahasa: English' : 'Bahasa: Indonesia', desc: t('palette.act.langDesc'), icon: 'dev' },
    { id: 'action:password', label: t('nav.password'), desc: t('palette.act.passwordDesc'), icon: 'lock' },
    { id: 'action:logout', label: t('nav.logout'), desc: t('palette.act.logoutDesc'), icon: 'logout' },
  ];

  const runPalette = (path: PaletteNode[], node: PaletteNode, payload?: FilesSearchPayload) => {
    if (node.id === 'files:search-run' && payload) {
      navigate('files');
      dispatchIntent({ tool: 'files', action: 'search', payload });
      return;
    }
    if (node.id.startsWith('viewer:open:') || node.id.startsWith('viewer:edit:')) {
      const [, action, target] = node.id.split(':');
      navigate('viewer');
      dispatchIntent({ tool: 'viewer', action: action === 'edit' ? 'edit' : 'open', payload: target });
      return;
    }
    if (node.id.startsWith('tool:')) {
      navigate(node.id.slice(5));
      return;
    }
    if (node.id.startsWith('action:')) {
      if (node.id === 'action:lang') setLang(lang === 'id' ? 'en' : 'id');
      else if (node.id === 'action:password') navigate('password');
      else if (node.id === 'action:logout') void logout();
      return;
    }
    const [tool, action] = node.id.split(':');
    navigate(tool);
    const focusTarget: Record<string, string> = { 'markdown:write': 'editor', 'json:write': 'editor', 'notes:search': 'search' };
    if (focusTarget[node.id]) void runFocus(tool, focusTarget[node.id]);
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

  const active = TOOLS.find((tool) => tool.id === route) ?? TOOLS[0];
  const ActiveComponent = active.component;

  return (
    <div className="flex h-full overflow-hidden">
      <aside
        className={cn(
          'flex shrink-0 flex-col border-r border-line bg-panel/55 transition-[width] duration-200',
          navOpen ? 'w-60' : 'w-14',
        )}
      >
        <div className={cn('flex items-center gap-2.5 px-2.5 py-3', !navOpen && 'flex-col gap-1.5 px-2')}>
          <div className="flex size-8 shrink-0 items-center justify-center rounded-[10px] border border-accent/30 bg-gradient-to-br from-accent to-accent2 text-[14px] font-bold text-white shadow-[0_8px_24px_-14px_rgb(107_150_255/0.9)]">
            S
          </div>
          {navOpen ? (
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] leading-tight font-semibold">Super Tool</div>
              <div className="truncate text-[10.5px] text-muted">{t('app.tagline')}</div>
            </div>
          ) : null}
          <button
            type="button"
            onClick={toggleNav}
            className={cn('btn btn-ghost shrink-0 px-1.5', navOpen && 'ml-auto')}
            title={navOpen ? t('nav.hideSidebar') : t('nav.showSidebar')}
            aria-label={navOpen ? t('nav.hideSidebar') : t('nav.showSidebar')}
          >
            <Icon name={navOpen ? 'back' : 'panel'} />
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
                  <div className={cn('px-2 pt-2 pb-1 text-[9.5px] font-semibold tracking-[0.12em] text-muted/65 uppercase', !navOpen && 'mx-auto h-px w-6 overflow-hidden bg-line p-0 text-transparent')}>
                    {navOpen ? t(group?.key ?? 'nav.group.workspace') : '•'}
                  </div>
                ) : null}
                <button
                  type="button"
                  onClick={() => navigate(tool.id)}
                  title={t(tool.key as 'nav.markdown', tool.label)}
                  aria-current={active.id === tool.id ? 'page' : undefined}
                  className={cn('nav-item w-full', active.id === tool.id && 'nav-item-active', !navOpen && 'justify-center px-0')}
                >
                  <Icon name={tool.icon} className="shrink-0" />
                  {navOpen ? <span className="truncate">{t(tool.key as 'nav.markdown', tool.label)}</span> : null}
                </button>
              </Fragment>
            );
          })}
        </nav>

        <div className="border-t border-line p-2">
          {navOpen ? (
            <div className="mb-1 flex items-center gap-1 px-1">
              <span className="text-[10px] tracking-wide text-muted uppercase">{t('nav.language')}</span>
              {(['id', 'en'] as const).map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => setLang(item)}
                  className={cn(
                    'cursor-pointer rounded border px-1.5 py-0.5 text-[11px] transition-colors',
                    lang === item ? 'border-accent/60 bg-accent/15 text-accent' : 'border-line text-muted hover:text-ink',
                  )}
                >
                  {item.toUpperCase()}
                </button>
              ))}
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setLang(lang === 'id' ? 'en' : 'id')}
              className="mb-1 flex w-full cursor-pointer justify-center rounded py-1 text-[9.5px] font-semibold tracking-wide text-muted hover:bg-panel2 hover:text-ink"
              title={t('nav.language')}
            >
              {lang.toUpperCase()}
            </button>
          )}
          <button type="button" onClick={() => navigate('password')} className={cn('nav-item w-full', !navOpen && 'justify-center px-0')} title={t('nav.password')}>
            <Icon name="lock" className="shrink-0" />
            {navOpen ? <span className="truncate">{t('nav.password')}</span> : null}
          </button>
          <button type="button" onClick={logout} className={cn('nav-item w-full', !navOpen && 'justify-center px-0')} title={t('nav.logout')}>
            <Icon name="logout" className="shrink-0" />
            {navOpen ? <span className="truncate">{t('nav.logout')}</span> : null}
          </button>
        </div>
      </aside>

      <main className="relative flex min-w-0 flex-1 flex-col">
        <ProjectPicker right={<PrayerWidget />} />
        {route === 'password' ? (
          <div className="flex-1 overflow-y-auto">
            <ChangePassword forced={false} onDone={() => navigate('markdown')} />
          </div>
        ) : (
          <Suspense
            fallback={
              <div className="flex flex-1 items-center justify-center">
                <Spinner />
              </div>
            }
          >
            {/*
              URL Viewer sengaja tetap ter-mount walau pindah tab: iframe di dalamnya
              (terminal ssh, pm2 log, dsb) tidak boleh reload hanya karena menu lain dibuka.
            */}
            {/* visibility (bukan display:none) supaya iframe tetap punya ukuran dan prosesnya jalan. */}
            <div
              className={cn(
                'flex min-h-0 flex-1 flex-col',
                route !== 'viewer' && 'pointer-events-none invisible absolute inset-0',
              )}
            >
              <ViewerComponent />
            </div>
            {route !== 'viewer' ? (
              <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                <ActiveComponent />
              </div>
            ) : null}
          </Suspense>
        )}
      </main>

      <CommandPalette open={paletteOpen} root={paletteTree} onClose={() => setPaletteOpen(false)} onRun={runPalette} />
    </div>
  );
}
