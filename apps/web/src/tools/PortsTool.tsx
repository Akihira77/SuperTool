import { useCallback, useEffect, useState } from 'react';
import { Empty, Icon, PageHeader, Spinner, Tabs, cn } from '../components/ui';
import { api, ApiError } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { useConfirm } from '../components/confirm';
import { bytes, duration } from '../lib/format';

type Port = {
  proto: string;
  address: string;
  port: number;
  pid: number | null;
  process: string;
  cmd: string;
  uptimeSec: number | null;
  established: number;
};

type Proc = {
  pid: number;
  ppid: number;
  user: string;
  cpu: number;
  mem: number;
  rssKb: number;
  elapsed: string;
  command: string;
  args: string;
};

type System = { load: number[]; cpus: number; memTotal: number; memFree: number; uptime: number };
type SortKey = 'pid' | 'user' | 'cpu' | 'mem' | 'rssKb' | 'elapsed';

/** Bar tipis untuk metrik (0-100%). */
function Meter({ value, label, text, tone }: { value: number; label: string; text: string; tone?: 'warn' | 'bad' }) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div className="flex min-w-32 flex-col gap-0.5">
      <div className="flex items-baseline gap-1.5 text-[11px] text-muted">
        <span className="tracking-wide uppercase">{label}</span>
        <span className="mono text-ink/85">{text}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-panel2">
        <div
          className={cn('h-full rounded-full transition-[width]', tone === 'bad' ? 'bg-bad' : tone === 'warn' ? 'bg-warn' : 'bg-accent')}
          style={{ width: pct + '%' }}
        />
      </div>
    </div>
  );
}

/** Sel metrik: angka + bar latar sesuai nilai. */
function MetricCell({ value, danger = 30 }: { value: number; danger?: number }) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <td className="relative border-b border-line/60 px-3 py-1.5 text-right">
      <span
        className={cn('absolute inset-y-1 left-1 rounded-sm opacity-20', value >= danger ? 'bg-warn' : 'bg-accent')}
        style={{ width: 'calc(' + pct + '% - 8px)' }}
        aria-hidden="true"
      />
      <span className={cn('mono relative', value >= danger ? 'text-warn' : 'text-ink/85')}>{value.toFixed(1)}</span>
    </td>
  );
}

const elapsedSeconds = (value: string) => {
  const parts = value.split(':').map((part) => Number(part.replace(/[^0-9.]/g, '')) || 0);
  return parts.reduce((total, part) => total * 60 + part, 0);
};

function SortTh({
  label,
  sortKey,
  sort,
  onSort,
  right,
}: {
  label: string;
  sortKey: SortKey;
  sort: { key: SortKey; dir: 1 | -1 };
  onSort: (key: SortKey) => void;
  right?: boolean;
}) {
  const active = sort.key === sortKey;
  return (
    <th className={cn('border-b border-line px-3 py-2 font-medium', right ? 'text-right' : 'text-left')}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={cn('inline-flex items-center gap-1 hover:text-ink', active ? 'text-ink' : 'text-muted')}
        title={'Urutkan ' + label}
      >
        {label}
        <span className="text-[9px] opacity-70">{active ? (sort.dir === 1 ? '▲' : '▼') : '↕'}</span>
      </button>
    </th>
  );
}

export default function PortsTool() {
  const [tab, setTab] = useState<'ports' | 'procs'>('ports');
  const [ports, setPorts] = useState<Port[]>([]);
  const [procs, setProcs] = useState<Proc[]>([]);
  const [system, setSystem] = useState<System | null>(null);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [auto, setAuto] = useState(true);
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState(0);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'cpu', dir: -1 });
  const { t } = useI18n();
  const confirm = useConfirm();

  const load = useCallback(async () => {
    try {
      if (tab === 'ports') {
        const result = await api.get<{ ports: Port[]; generatedAt: number }>('/ports');
        setPorts(result.ports);
        setUpdatedAt(result.generatedAt);
      } else {
        const result = await api.get<{ rows: Proc[]; system: System; generatedAt: number }>('/ports/processes?limit=80');
        setProcs(result.rows);
        setSystem(result.system);
        setUpdatedAt(result.generatedAt);
      }
      setError('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('ports.error'));
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  useEffect(() => {
    if (!auto) return;
    const id = setInterval(() => void load(), 5000);
    return () => clearInterval(id);
  }, [auto, load]);

  const kill = async (pid: number, label: string) => {
    const ok = await confirm({ title: t('ports.confirmKill'), message: pid + '\n' + label, danger: true, confirmLabel: t('ports.kill') });
    if (!ok) return;
    try {
      await api.post('/ports/kill', { pid });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('err.kill'));
    }
  };

  const needle = query.toLowerCase();
  const filteredPorts = ports.filter(
    (row) =>
      !needle ||
      String(row.port).includes(needle) ||
      row.process.toLowerCase().includes(needle) ||
      row.cmd.toLowerCase().includes(needle) ||
      row.address.includes(needle),
  );
  const filteredProcs = procs.filter(
    (row) => !needle || String(row.pid).includes(needle) || row.command.toLowerCase().includes(needle) || row.args.toLowerCase().includes(needle),
  );

  const toggleSort = (key: SortKey) =>
    setSort((prev) => ({ key, dir: prev.key === key ? (prev.dir === 1 ? -1 : 1) : key === 'user' ? 1 : -1 }));
  const valueOf = (row: Proc, key: SortKey) => (key === 'elapsed' ? elapsedSeconds(row.elapsed) : row[key]);
  const sortedProcs = [...filteredProcs].sort((a, b) => {
    const left = valueOf(a, sort.key);
    const right = valueOf(b, sort.key);
    if (typeof left === 'string' || typeof right === 'string') {
      return String(left).localeCompare(String(right)) * sort.dir;
    }
    return (Number(left) - Number(right)) * sort.dir;
  });

  const memUsed = system ? system.memTotal - system.memFree : 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title={t('ports.title')}
        icon="ports"
        subtitle={
          (tab === 'ports' ? ports.length + ' ' + t('ports.listening') : procs.length + ' ' + t('ports.topProcs')) +
          ' · ' +
          t('ports.updated') +
          ' ' +
          (updatedAt ? new Date(updatedAt).toLocaleTimeString() : '-')
        }
      >
        <div className="relative">
          <Icon name="search" className="absolute top-2 left-2 text-muted" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('ports.filter')} className="input w-44 py-1.5 pl-7 text-[13px]" />
        </div>
        <button type="button" className={cn('btn', auto && 'btn-primary')} data-action="ports:auto" onClick={() => setAuto(!auto)} title={t('ports.autoHint')}>
          {t('ports.auto')}
        </button>
        <button type="button" className="btn" data-action="ports:refresh" onClick={() => void load()}>
          <Icon name="refresh" /> {t('ports.refresh')}
        </button>
      </PageHeader>

      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { id: 'ports', label: t('ports.tabPorts'), icon: 'ports', action: 'ports:tabPorts' },
          { id: 'procs', label: t('ports.tabProcs'), icon: 'dev', action: 'ports:tabProcs' },
        ]}
      />

      {system ? (
        <div className="flex shrink-0 flex-wrap items-center gap-5 border-b border-line px-3 py-2">
          <Meter
            label="load"
            value={(system.load[0] / system.cpus) * 100}
            text={system.load.map((item) => item.toFixed(2)).join(' / ')}
            tone={system.load[0] / system.cpus > 1 ? 'warn' : undefined}
          />
          <Meter
            label="RAM"
            value={(memUsed / system.memTotal) * 100}
            text={bytes(memUsed) + ' / ' + bytes(system.memTotal)}
            tone={memUsed / system.memTotal > 0.9 ? 'bad' : memUsed / system.memTotal > 0.75 ? 'warn' : undefined}
          />
          <span className="text-[11.5px] text-muted">
            {t('ports.cpu')} <span className="mono text-ink/80">{system.cpus}</span>
          </span>
          <span className="text-[11.5px] text-muted">
            {t('ports.procs')} <span className="mono text-ink/80">{procs.length}</span>
          </span>
          <span className="text-[11.5px] text-muted">
            uptime <span className="mono text-ink/80">{duration(Math.round(system.uptime))}</span>
          </span>
        </div>
      ) : null}

      {error ? <div className="border-b border-line px-3 py-2 text-xs text-bad">{error}</div> : null}

      {loading ? (
        <div className="flex flex-1 items-center justify-center">
          <Spinner />
        </div>
      ) : tab === 'ports' ? (
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full border-collapse text-[12.5px]">
            <thead className="sticky top-0 z-10 bg-panel/95 text-left text-[11px] backdrop-blur tracking-wide text-muted uppercase">
              <tr>
                <th className="border-b border-line px-3 py-2 font-medium">Port</th>
                <th className="border-b border-line px-3 py-2 font-medium">Alamat</th>
                <th className="border-b border-line px-3 py-2 font-medium">{t('ports.tabProcs')}</th>
                <th className="border-b border-line px-3 py-2 font-medium">PID</th>
                <th className="border-b border-line px-3 py-2 font-medium">Uptime</th>
                <th className="border-b border-line px-3 py-2 font-medium">Koneksi</th>
                <th className="border-b border-line px-3 py-2 text-right font-medium">{t('ports.action')}</th>
              </tr>
            </thead>
            <tbody>
              {filteredPorts.map((row) => (
                <tr key={row.port + row.address} className="group transition-colors hover:bg-accent/[0.045]">
                  <td className="mono border-b border-line/60 px-3 py-2 font-medium text-accent">{row.port}</td>
                  <td className="mono border-b border-line/60 px-3 py-2 text-muted">{row.address}</td>
                  <td className="max-w-[22rem] border-b border-line/60 px-3 py-2">
                    <div className="truncate">{row.process || '-'}</div>
                    <div className="truncate text-[11px] text-muted" title={row.cmd}>
                      {row.cmd}
                    </div>
                  </td>
                  <td className="mono border-b border-line/60 px-3 py-2 text-muted">{row.pid ?? '-'}</td>
                  <td className="border-b border-line/60 px-3 py-2 text-muted">{duration(row.uptimeSec)}</td>
                  <td className="border-b border-line/60 px-3 py-2 text-muted">{row.established}</td>
                  <td className="border-b border-line/60 px-3 py-2 text-right whitespace-nowrap">
                    <a
                      className="btn btn-ghost px-1.5 py-0.5 text-[11px]"
                      href={'http://127.0.0.1:' + row.port}
                      target="_blank"
                      rel="noreferrer"
                      title="Buka di tab baru"
                    >
                      <Icon name="external" size={13} /> {t('common.open')}
                    </a>
                    <button
                      type="button"
                      className="btn btn-ghost px-1.5 py-0.5 text-[11px]"
                      onClick={() => void navigator.clipboard.writeText('http://127.0.0.1:' + row.port)}
                      title="Salin URL"
                    >
                      <Icon name="copy" size={13} />
                    </button>
                    <button
                      type="button"
                      className="btn btn-danger px-1.5 py-0.5 text-[11px]"
                      onClick={() => row.pid && kill(row.pid, row.process + ' · port ' + row.port + '\n' + row.cmd)}
                      disabled={!row.pid}
                      title="Kirim SIGTERM"
                    >
                      <Icon name="x" size={13} /> kill
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filteredPorts.length === 0 ? <Empty icon="search" text={t('ports.noMatch')} /> : null}
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full border-collapse text-[12.5px]">
            <thead className="sticky top-0 z-10 bg-panel/95 text-left text-[11px] backdrop-blur tracking-wide text-muted uppercase">
              <tr>
                <SortTh label={t('ports.pid')} sortKey="pid" sort={sort} onSort={toggleSort} />
                <SortTh label={t('ports.user')} sortKey="user" sort={sort} onSort={toggleSort} />
                <SortTh label="CPU%" sortKey="cpu" sort={sort} onSort={toggleSort} right />
                <SortTh label="MEM%" sortKey="mem" sort={sort} onSort={toggleSort} right />
                <SortTh label="RSS" sortKey="rssKb" sort={sort} onSort={toggleSort} right />
                <SortTh label={t('ports.time')} sortKey="elapsed" sort={sort} onSort={toggleSort} />
                <th className="border-b border-line px-3 py-2 text-left font-medium text-muted">{t('ports.command')}</th>
                <th className="border-b border-line px-3 py-2 text-right font-medium text-muted">{t('ports.action')}</th>
              </tr>
            </thead>
            <tbody>
              {sortedProcs.map((row) => (
                <tr key={row.pid} className="group transition-colors hover:bg-accent/[0.045]">
                  <td className="mono border-b border-line/60 px-3 py-2 text-muted">{row.pid}</td>
                  <td className="border-b border-line/60 px-3 py-2 text-muted">{row.user}</td>
                  <MetricCell value={row.cpu} />
                  <MetricCell value={row.mem} danger={50} />
                  <td className="mono border-b border-line/60 px-3 py-2 text-right text-muted">{bytes(row.rssKb * 1024)}</td>
                  <td className="mono border-b border-line/60 px-3 py-2 text-muted">{row.elapsed}</td>
                  <td className="max-w-[26rem] border-b border-line/60 px-3 py-2">
                    <div className="truncate font-medium">{row.command}</div>
                    <div className="truncate text-[11px] text-muted" title={row.args}>
                      {row.args}
                    </div>
                  </td>
                  <td className="border-b border-line/60 px-3 py-2 text-right">
                    <button
                      type="button"
                      className="btn btn-danger px-1.5 py-0.5 text-[11px]"
                      onClick={() => kill(row.pid, row.command + '\n' + row.args)}
                      title="Kirim SIGTERM"
                    >
                      <Icon name="x" size={13} /> kill
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filteredProcs.length === 0 ? <Empty icon="search" text={t('ports.noMatch')} /> : null}
        </div>
      )}
    </div>
  );
}
