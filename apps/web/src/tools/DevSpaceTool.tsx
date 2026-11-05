import { Suspense, lazy, useState, type ComponentType, type LazyExoticComponent } from 'react';
import { PageHeader, Spinner, cn } from '../components/ui';
import { useI18n } from '../lib/i18n';

type Tab = { id: string; key: string; label: string; component: LazyExoticComponent<ComponentType> };

const TABS: Tab[] = [
  { id: 'regex', key: 'dev.regex', label: 'Regex Tester', component: lazy(() => import('./devspace/RegexTab')) },
  { id: 'encode', key: 'dev.encode', label: 'Encode/Decode & Hash', component: lazy(() => import('./devspace/EncodeTab')) },
  { id: 'http', key: 'dev.http', label: 'HTTP Client', component: lazy(() => import('./devspace/HttpTab')) },
  { id: 'logs', key: 'dev.logs', label: 'Log Tailer', component: lazy(() => import('./devspace/LogsTab')) },
  { id: 'docker', key: 'dev.docker', label: 'Docker', component: lazy(() => import('./devspace/DockerTab')) },
  { id: 'git', key: 'dev.git', label: 'Git Status', component: lazy(() => import('./devspace/GitTab')) },
  { id: 'cron', key: 'dev.cron', label: 'Cron Job', component: lazy(() => import('./devspace/CronTab')) },
  { id: 'dns', key: 'dev.dns', label: 'DNS/IP Lookup', component: lazy(() => import('./devspace/DnsTab')) },
];

export default function DevSpaceTool() {
  const [tab, setTab] = useState('regex');
  const { t } = useI18n();
  const active = TABS.find((item) => item.id === tab) ?? TABS[0];
  const Active = active.component;

  return (
    <div className="flex h-full flex-col">
      <PageHeader title={t('dev.title')} subtitle={t('dev.subtitle')} />

      <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-line px-3 py-1.5">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id)}
            className={cn(
              'shrink-0 cursor-pointer rounded-md px-2.5 py-1 text-[12px] transition-colors',
              active.id === item.id ? 'bg-accent/15 text-accent' : 'text-muted hover:bg-panel2 hover:text-ink',
            )}
          >
            {t(item.key as 'dev.regex', item.label)}
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
