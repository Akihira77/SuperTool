import { Suspense, lazy, useState, type ComponentType, type LazyExoticComponent } from 'react';
import { PageHeader, Spinner, cn } from '../components/ui';

type Tab = { id: string; label: string; component: LazyExoticComponent<ComponentType> };

const TABS: Tab[] = [
  { id: 'regex', label: 'Regex Tester', component: lazy(() => import('./devspace/RegexTab')) },
  { id: 'encode', label: 'Encode/Decode & Hash', component: lazy(() => import('./devspace/EncodeTab')) },
  { id: 'http', label: 'HTTP Client', component: lazy(() => import('./devspace/HttpTab')) },
  { id: 'logs', label: 'Log Tailer', component: lazy(() => import('./devspace/LogsTab')) },
  { id: 'docker', label: 'Docker', component: lazy(() => import('./devspace/DockerTab')) },
  { id: 'git', label: 'Git Status', component: lazy(() => import('./devspace/GitTab')) },
  { id: 'cron', label: 'Cron Job', component: lazy(() => import('./devspace/CronTab')) },
  { id: 'dns', label: 'DNS/IP Lookup', component: lazy(() => import('./devspace/DnsTab')) },
];

export default function DevSpaceTool() {
  const [tab, setTab] = useState('regex');
  const active = TABS.find((item) => item.id === tab) ?? TABS[0];
  const Active = active.component;

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Dev Space" subtitle="Alat harian developer dalam satu tempat" />

      <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-line px-3 py-1.5">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id)}
            className={cn(
              'shrink-0 rounded-md px-2.5 py-1 text-[12px] transition-colors',
              active.id === item.id ? 'bg-accent/15 text-accent' : 'text-muted hover:bg-panel2 hover:text-ink',
            )}
          >
            {item.label}
          </button>
        ))}
      </div>

      <Suspense
        fallback={
          <div className="flex flex-1 items-center justify-center">
            <Spinner />
          </div>
        }
      >
        <Active />
      </Suspense>
    </div>
  );
}
