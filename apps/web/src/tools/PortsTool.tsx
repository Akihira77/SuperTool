import { useCallback, useEffect, useState } from 'react';
import { Icon, PageHeader, Spinner, cn } from '../components/ui';
import { api, ApiError } from '../lib/api';
import { duration } from '../lib/format';

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

export default function PortsTool() {
  const [ports, setPorts] = useState<Port[]>([]);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [auto, setAuto] = useState(true);
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState(0);

  const load = useCallback(async () => {
    try {
      const result = await api.get<{ ports: Port[]; generatedAt: number }>('/ports');
      setPorts(result.ports);
      setUpdatedAt(result.generatedAt);
      setError('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Gagal membaca daftar port');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!auto) return;
    const id = setInterval(() => void load(), 5000);
    return () => clearInterval(id);
  }, [auto, load]);

  const filtered = ports.filter((row) => {
    if (!query) return true;
    const needle = query.toLowerCase();
    return (
      String(row.port).includes(needle) ||
      row.process.toLowerCase().includes(needle) ||
      row.cmd.toLowerCase().includes(needle) ||
      row.address.includes(needle)
    );
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="Port & Proses" subtitle={ports.length + ' port listening · diperbarui ' + (updatedAt ? new Date(updatedAt).toLocaleTimeString('id-ID') : '-')}>
        <div className="relative">
          <Icon name="search" className="absolute top-2 left-2 text-muted" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter port / proses" className="input w-52 py-1.5 pl-7 text-[13px]" />
        </div>
        <button type="button" className={cn('btn', auto && 'btn-primary')} onClick={() => setAuto(!auto)} title="Auto refresh 5 detik">
          Auto
        </button>
        <button type="button" className="btn" onClick={() => void load()}>
          <Icon name="refresh" /> Refresh
        </button>
      </PageHeader>

      {error ? (
        <div className="p-4 text-sm text-bad">{error}</div>
      ) : loading ? (
        <div className="flex flex-1 items-center justify-center">
          <Spinner />
        </div>
      ) : (
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
              {filtered.map((row) => (
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
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 ? <p className="p-6 text-center text-sm text-muted">Tidak ada port yang cocok</p> : null}
        </div>
      )}
    </div>
  );
}
