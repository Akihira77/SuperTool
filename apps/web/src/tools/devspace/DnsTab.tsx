import { useState } from 'react';
import { Icon, Spinner } from '../../components/ui';
import { api, ApiError, qs } from '../../lib/api';
import { useI18n } from '../../lib/i18n';

type Geo = { status?: string; country?: string; regionName?: string; city?: string; isp?: string; org?: string; timezone?: string; query?: string } | null;
type Result = {
  host: string;
  a: string[];
  aaaa: string[];
  mx: string[];
  cname: string[];
  ns: string[];
  txt: string[];
  geo: Geo;
};

function Group({ title, rows }: { title: string; rows: string[] }) {
  return (
    <div className="card flex flex-col gap-1 p-3">
      <div className="flex items-center gap-2 text-[11px] tracking-wide text-muted uppercase">
        {title}
        <span className="text-ink">{rows.length}</span>
      </div>
      <div className="mono max-h-40 overflow-auto text-[11.5px]">
        {rows.length ? rows.map((row) => <div key={row} className="truncate text-ink/85">{row}</div>) : <div className="text-muted/70">-</div>}
      </div>
    </div>
  );
}

export default function DnsTab() {
  const { t } = useI18n();
  const [host, setHost] = useState('github.com');
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const lookup = async () => {
    if (!host.trim()) return;
    setBusy(true);
    setError('');
    try {
      const data = await api.get<Result>('/dev/dns' + qs({ host: host.trim() }));
      setResult(data);
    } catch (err) {
      setResult(null);
      setError(err instanceof ApiError ? err.message : t('err.lookup'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-4">
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={host}
          onChange={(event) => setHost(event.target.value)}
          onKeyDown={(event) => event.key === 'Enter' && void lookup()}
          placeholder="contoh: github.com"
          className="input mono flex-1 py-1.5"
          spellCheck={false}
        />
        <button type="button" className="btn btn-primary" onClick={() => void lookup()} disabled={busy || !host.trim()}>
          {busy ? <Spinner /> : <Icon name="search" />} Lookup
        </button>
      </div>

      {error ? <div className="text-[12px] text-bad">{error}</div> : null}

      {result ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Group title="A" rows={result.a} />
            <Group title="AAAA" rows={result.aaaa} />
            <Group title="CNAME" rows={result.cname} />
            <Group title="NS" rows={result.ns} />
            <Group title="MX" rows={result.mx} />
            <Group title="TXT" rows={result.txt} />
            {result.geo ? (
              <div className="card col-span-1 flex flex-col gap-1 p-3 sm:col-span-2">
                <div className="text-[11px] tracking-wide text-muted uppercase">Lokasi</div>
                <div className="text-[12.5px] text-ink">
                  {[result.geo.city, result.geo.regionName, result.geo.country].filter(Boolean).join(', ') || '-'}
                </div>
                <div className="text-[11.5px] text-muted">
                  {result.geo.isp ?? '-'} · {result.geo.org ?? '-'} · {result.geo.timezone ?? '-'}
                </div>
                <div className="mono text-[11px] text-muted">{result.geo.query}</div>
              </div>
            ) : null}
          </div>
          <div className="text-[11px] text-muted">
            Lokasi berdasarkan ip-api.com (butuh internet). Server: {result.host}
          </div>
        </>
      ) : null}
    </div>
  );
}
