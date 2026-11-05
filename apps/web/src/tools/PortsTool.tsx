import { useCallback, useEffect, useState } from 'react';
import { Icon, PageHeader, Spinner, cn } from '../components/ui';
import { api, ApiError } from '../lib/api';
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
      setError(err instanceof ApiError ? err.message : 'Gagal membaca data proses');
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
    if (!window.confirm('Kirim SIGTERM ke PID ' + pid + '?\n\n' + label + '\n\nProses akan berhenti.')) return;
    try {
      await api.post('/ports/kill', { pid });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Gagal menghentikan proses');
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
        title="Port & Proses"
        subtitle={
          (tab === 'ports' ? ports.length + ' port listening' : procs.length + ' proses teratas') +
          ' · diperbarui ' +
          (updatedAt ? new Date(updatedAt).toLocaleTimeString('id-ID') : '-')
        }
      >
        <div className="flex overflow-hidden rounded-lg border border-line">
          {(['ports', 'procs'] as const).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setTab(item)}
              className={cn(
                'px-2.5 py-1.5 text-[12px] transition-colors',
                tab === item ? 'bg-accent/15 text-accent' : 'text-muted hover:bg-panel2 hover:text-ink',
              )}
            >
              {item === 'ports' ? 'Port' : 'Proses'}
            </button>
          ))}
        </div>
        <div className="relative">
          <Icon name="search" className="absolute top-2 left-2 text-muted" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter" className="input w-44 py-1.5 pl-7 text-[13px]" />
        </div>
        <button type="button" className={cn('btn', auto && 'btn-primary')} onClick={() => setAuto(!auto)} title="Auto refresh 5 detik">
          Auto
        </button>
        <button type="button" className="btn" onClick={() => void load()}>
          <Icon name="refresh" /> Refresh
        </button>
      </PageHeader>

      {system ? (
        <div className="flex shrink-0 flex-wrap items-center gap-4 border-b border-line px-3 py-1.5 text-[11.5px] text-muted">
          <span>
            load <span className="mono text-ink/80">{system.load.join(' / ')}</span>
          </span>
          <span>
            CPU <span className="mono text-ink/80">{system.cpus}</span>
          </span>
          <span>
            RAM <span className="mono text-ink/80">{bytes(memUsed)}</span> / {bytes(system.memTotal)}
          </span>
          <span>
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
            <thead className="sticky top-0 z-10 bg-panel text-left text-[11px] tracking-wide text-muted uppercase">
              <tr>
                <th className="border-b border-line px-3 py-2 font-medium">Port</th>
                <th className="border-b border-line px-3 py-2 font-medium">Alamat</th>
                <th className="border-b border-line px-3 py-2 font-medium">Proses</th>
                <th className="border-b border-line px-3 py-2 font-medium">PID</th>
                <th className="border-b border-line px-3 py-2 font-medium">Uptime</th>
                <th className="border-b border-line px-3 py-2 font-medium">Koneksi</th>
                <th className="border-b border-line px-3 py-2 text-right font-medium">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {filteredPorts.map((row) => (
                <tr key={row.port + row.address} className="group hover:bg-panel2/60">
                  <td className="mono border-b border-line/60 px-3 py-1.5 font-medium text-accent">{row.port}</td>
                  <td className="mono border-b border-line/60 px-3 py-1.5 text-muted">{row.address}</td>
                  <td className="max-w-[22rem] border-b border-line/60 px-3 py-1.5">
                    <div className="truncate">{row.process || '-'}</div>
                    <div className="truncate text-[11px] text-muted" title={row.cmd}>
                      {row.cmd}
                    </div>
                  </td>
                  <td className="mono border-b border-line/60 px-3 py-1.5 text-muted">{row.pid ?? '-'}</td>
                  <td className="border-b border-line/60 px-3 py-1.5 text-muted">{duration(row.uptimeSec)}</td>
                  <td className="border-b border-line/60 px-3 py-1.5 text-muted">{row.established}</td>
                  <td className="border-b border-line/60 px-3 py-1.5 text-right whitespace-nowrap">
                    <a
                      className="btn btn-ghost px-1.5 py-0.5 text-[11px]"
                      href={'http://127.0.0.1:' + row.port}
                      target="_blank"
                      rel="noreferrer"
                      title="Buka di tab baru"
                    >
                      <Icon name="external" size={13} /> buka
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
          {filteredPorts.length === 0 ? <p className="p-6 text-center text-sm text-muted">Tidak ada port yang cocok</p> : null}
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full border-collapse text-[12.5px]">
            <thead className="sticky top-0 z-10 bg-panel text-left text-[11px] tracking-wide text-muted uppercase">
              <tr>
                <SortTh label="PID" sortKey="pid" sort={sort} onSort={toggleSort} />
                <SortTh label="User" sortKey="user" sort={sort} onSort={toggleSort} />
                <SortTh label="CPU%" sortKey="cpu" sort={sort} onSort={toggleSort} right />
                <SortTh label="MEM%" sortKey="mem" sort={sort} onSort={toggleSort} right />
                <SortTh label="RSS" sortKey="rssKb" sort={sort} onSort={toggleSort} right />
                <SortTh label="Waktu" sortKey="elapsed" sort={sort} onSort={toggleSort} />
                <th className="border-b border-line px-3 py-2 text-left font-medium text-muted">Perintah</th>
                <th className="border-b border-line px-3 py-2 text-right font-medium text-muted">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {sortedProcs.map((row) => (
                <tr key={row.pid} className="group hover:bg-panel2/60">
                  <td className="mono border-b border-line/60 px-3 py-1.5 text-muted">{row.pid}</td>
                  <td className="border-b border-line/60 px-3 py-1.5 text-muted">{row.user}</td>
                  <td className={cn('mono border-b border-line/60 px-3 py-1.5 text-right', row.cpu > 30 && 'text-warn')}>{row.cpu.toFixed(1)}</td>
                  <td className="mono border-b border-line/60 px-3 py-1.5 text-right">{row.mem.toFixed(1)}</td>
                  <td className="mono border-b border-line/60 px-3 py-1.5 text-right text-muted">{bytes(row.rssKb * 1024)}</td>
                  <td className="mono border-b border-line/60 px-3 py-1.5 text-muted">{row.elapsed}</td>
                  <td className="max-w-[26rem] border-b border-line/60 px-3 py-1.5">
                    <div className="truncate font-medium">{row.command}</div>
                    <div className="truncate text-[11px] text-muted" title={row.args}>
                      {row.args}
                    </div>
                  </td>
                  <td className="border-b border-line/60 px-3 py-1.5 text-right">
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
          {filteredProcs.length === 0 ? <p className="p-6 text-center text-sm text-muted">Tidak ada proses yang cocok</p> : null}
        </div>
      )}
    </div>
  );
}
