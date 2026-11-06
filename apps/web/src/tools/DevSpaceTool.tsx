import { Suspense, lazy, useState, type ComponentType, type LazyExoticComponent } from 'react';
import { PageHeader, Spinner, Tabs } from '../components/ui';
import { useI18n } from '../lib/i18n';

type Tab = { id: string; key: string; label: string; icon: string; component: LazyExoticComponent<ComponentType> };

const TABS: Tab[] = [
  { id: 'regex', key: 'dev.regex', label: 'Regex Tester', icon: 'filter', component: lazy(() => import('./devspace/RegexTab')) },
  { id: 'encode', key: 'dev.encode', label: 'Encode/Decode & Hash', icon: 'types', component: lazy(() => import('./devspace/EncodeTab')) },
  { id: 'http', key: 'dev.http', label: 'HTTP Client', icon: 'webhook', component: lazy(() => import('./devspace/HttpTab')) },
  { id: 'logs', key: 'dev.logs', label: 'Log Tailer', icon: 'notes', component: lazy(() => import('./devspace/LogsTab')) },
  { id: 'docker', key: 'dev.docker', label: 'Docker', icon: 'dev', component: lazy(() => import('./devspace/DockerTab')) },
  { id: 'git', key: 'dev.git', label: 'Git Status', icon: 'sort', component: lazy(() => import('./devspace/GitTab')) },
  { id: 'cron', key: 'dev.cron', label: 'Cron Job', icon: 'clock', component: lazy(() => import('./devspace/CronTab')) },
  { id: 'dns', key: 'dev.dns', label: 'DNS/IP Lookup', icon: 'url', component: lazy(() => import('./devspace/DnsTab')) },
  { id: 'sqlite', key: 'dev.sqlite', label: 'Database', icon: 'db', component: lazy(() => import('./devspace/SqliteTab')) },
  { id: 'audit', key: 'dev.audit', label: 'Audit Log', icon: 'notes', component: lazy(() => import('./devspace/AuditTab')) },
];

export default function DevSpaceTool() {
  const [tab, setTab] = useState('regex');
  const { t } = useI18n();
  const active = TABS.find((item) => item.id === tab) ?? TABS[0];
  const Active = active.component;

  return (
    <div className="flex h-full flex-col">
      <PageHeader title={t('dev.title')} subtitle={t('dev.subtitle')} icon="dev" />

      <Tabs
        value={active.id}
        onChange={setTab}
        items={TABS.map((item) => ({
          id: item.id,
          label: t(item.key as 'dev.regex', item.label),
          icon: item.icon,
          action: 'devspace:' + item.id,
        }))}
      />

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
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
    </div>
  );
}
