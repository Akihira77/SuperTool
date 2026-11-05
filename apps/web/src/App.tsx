import { Suspense, lazy, useEffect, useState, type ComponentType, type LazyExoticComponent } from 'react';
import ChangePassword from './components/ChangePassword';
import Login from './components/Login';
import { Icon, Spinner, cn } from './components/ui';
import { api } from './lib/api';
import { useRoute } from './lib/router';

type Tool = {
  id: string;
  label: string;
  desc: string;
  icon: string;
  component: LazyExoticComponent<ComponentType>;
};

const TOOLS: Tool[] = [
  { id: 'markdown', label: 'Markdown', desc: 'Editor + live preview', icon: 'markdown', component: lazy(() => import('./tools/MarkdownTool')) },
  { id: 'json', label: 'JSON', desc: 'Formatter & beautify', icon: 'json', component: lazy(() => import('./tools/JsonTool')) },
  { id: 'types', label: 'JSON ke TS', desc: 'Generate tipe TypeScript', icon: 'types', component: lazy(() => import('./tools/TypesTool')) },
  { id: 'notes', label: 'Catatan', desc: 'Notepad tersimpan', icon: 'notes', component: lazy(() => import('./tools/NotesTool')) },
  { id: 'viewer', label: 'URL Viewer', desc: 'Buka tool lain via iframe', icon: 'url', component: lazy(() => import('./tools/UrlTool')) },
  { id: 'nginx', label: 'Nginx', desc: 'Edit konfigurasi', icon: 'nginx', component: lazy(() => import('./tools/NginxTool')) },
  { id: 'ports', label: 'Port', desc: 'App yang sedang jalan', icon: 'ports', component: lazy(() => import('./tools/PortsTool')) },
  { id: 'files', label: 'File Explorer', desc: 'Jelajah & lihat file', icon: 'files', component: lazy(() => import('./tools/FilesTool')) },
];

type AuthState = 'loading' | 'anon' | 'must-change' | 'ready';

export default function App() {
  const [auth, setAuth] = useState<AuthState>('loading');
  const [route, navigate] = useRoute();

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
    <div className="flex h-full">
      <aside className="flex w-14 shrink-0 flex-col border-r border-line bg-panel/50 md:w-56">
        <div className="flex items-center gap-2.5 px-3 py-3.5 md:px-4">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent text-[15px] font-bold text-white">
            S
          </div>
          <div className="hidden min-w-0 md:block">
            <div className="truncate text-[13px] font-semibold leading-tight">Super Tool</div>
            <div className="truncate text-[10.5px] text-muted">local developer kit</div>
          </div>
        </div>

        <nav className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2 py-2">
          {TOOLS.map((tool) => (
            <button
              key={tool.id}
              type="button"
              onClick={() => navigate(tool.id)}
              title={tool.label}
              className={cn('nav-item', active.id === tool.id && 'nav-item-active')}
            >
              <Icon name={tool.icon} className="shrink-0" />
              <span className="hidden truncate md:inline">{tool.label}</span>
            </button>
          ))}
        </nav>

        <div className="border-t border-line p-2">
          <button type="button" onClick={() => navigate('password')} className="nav-item w-full" title="Ganti password">
            <Icon name="lock" className="shrink-0" />
            <span className="hidden truncate md:inline">Ganti password</span>
          </button>
          <button type="button" onClick={logout} className="nav-item w-full" title="Keluar">
            <Icon name="logout" className="shrink-0" />
            <span className="hidden truncate md:inline">Keluar</span>
          </button>
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
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
            <ActiveComponent />
          </Suspense>
        )}
      </main>
    </div>
  );
}
