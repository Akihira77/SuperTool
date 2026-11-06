import { useCallback, useEffect, useMemo, useState } from 'react';
import { Icon, Spinner, cn } from '../../components/ui';
import { api, ApiError, qs } from '../../lib/api';
import { useI18n } from '../../lib/i18n';
import { bytes } from '../../lib/format';

type TableInfo = { name: string; type: string; rows: number };
type Info = { path: string; size: number; mtime: number; tables: TableInfo[] };
type Grid = { columns: string[]; rows: Array<Record<string, unknown>>; total: number; limit?: number; offset?: number; truncated?: boolean };

function cell(value: unknown) {
  if (value === null || value === undefined) return <span className="text-muted/60 italic">NULL</span>;
  if (typeof value === 'string') {
    if (!value) return <span className="text-muted/60 italic">''</span>;
    return (
      <span className="block max-w-[360px] truncate" title={value}>
        {value}
      </span>
    );
  }
  if (typeof value === 'object') {
    const json = JSON.stringify(value);
    return (
      <span className="block max-w-[360px] truncate text-muted" title={json}>
        {json}
      </span>
    );
  }
  return <span>{String(value)}</span>;
}

function DataGrid({ grid, caption }: { grid: Grid; caption: string }) {
  const { t } = useI18n();
  return (
    <div className="card flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line bg-panel px-2.5 py-1.5 text-[11px] text-muted">
        <Icon name="db" size={13} className="text-accent" />
        <span className="font-medium text-ink/85">{caption}</span>
        <span className="chip">{grid.columns.length} {t('db.columns')}</span>
        <span className="chip">{grid.rows.length} {t('db.rows')}</span>
        {grid.truncated ? <span className="chip border-warn/30 text-warn">{t('db.truncated')}</span> : null}
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full border-collapse text-[11.5px]">
          <thead className="sticky top-0 z-10 bg-panel2 text-left text-[10.5px] tracking-wide text-muted uppercase">
            <tr>
              {grid.columns.map((column) => (
                <th key={column} className="border-b border-line px-2.5 py-1.5 font-medium whitespace-nowrap">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grid.rows.map((row, index) => (
              <tr key={index} className="odd:bg-panel/20 hover:bg-panel2/60">
                {grid.columns.map((column) => (
                  <td key={column} className="mono border-b border-line/40 px-2.5 py-1.5 align-top text-ink/90">
                    {cell(row[column])}
                  </td>
                ))}
              </tr>
            ))}
            {!grid.rows.length ? (
              <tr>
                <td colSpan={Math.max(1, grid.columns.length)} className="px-3 py-6 text-center text-[12px] text-muted">
                  {t('db.noRows')}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function SqliteTab() {
  const { t } = useI18n();
  const [info, setInfo] = useState<Info | null>(null);
  const [grid, setGrid] = useState<Grid | null>(null);
  const [caption, setCaption] = useState('');
  const [active, setActive] = useState('');
  const [tableQuery, setTableQuery] = useState('');
  const [limit, setLimit] = useState(100);
  const [offset, setOffset] = useState(0);
  const [sql, setSql] = useState('SELECT name, type FROM sqlite_master ORDER BY name');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const tables = useMemo(() => {
    const query = tableQuery.trim().toLowerCase();
    const list = info?.tables ?? [];
    return query ? list.filter((table) => table.name.toLowerCase().includes(query)) : list;
  }, [info, tableQuery]);

  const loadInfo = useCallback(async () => {
    setError('');
    try {
      setInfo(await api.get<Info>('/sqlite/info'));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('err.readDb'));
    }
  }, [t]);

  const loadTable = useCallback(async (name: string, nextOffset = 0, nextLimit = 100) => {
    setBusy(true);
    setError('');
    try {
      const data = await api.get<Grid>('/sqlite/table' + qs({ name, limit: nextLimit, offset: nextOffset }));
      setGrid(data);
      setCaption(name);
      setActive(name);
      setOffset(nextOffset);
      setLimit(nextLimit);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('err.readTable'));
    } finally {
      setBusy(false);
    }
  }, [t]);

  useEffect(() => {
    void loadInfo();
  }, [loadInfo]);

  const runSql = async () => {
    setBusy(true);
    setError('');
    try {
      const data = await api.post<Grid>('/sqlite/query', { sql });
      setGrid(data);
      setCaption(t('db.queryResult'));
      setActive('');
      setOffset(0);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('db.queryFail'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-3 md:p-4">
      <div className="card flex flex-wrap items-center gap-3 p-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
            <Icon name="db" size={16} />
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-[13px] font-semibold">super-tool.db</span>
              <span className="chip">{t('db.readOnly')}</span>
            </div>
            <div className="mono max-w-full truncate text-[10.5px] text-muted" title={info?.path}>
              {info?.path ?? t('db.loading')}
            </div>
          </div>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          {info ? (
            <>
              <span className="chip">{bytes(info.size)}</span>
              <span className="chip">{info.tables.length} {t('db.tables')}</span>
            </>
          ) : null}
          <button type="button" className="btn px-2 py-1" onClick={() => void loadInfo()} title={t('common.reload')} aria-label={t('common.reload')}>
            {busy ? <Spinner /> : <Icon name="refresh" size={13} />}
          </button>
        </div>
      </div>

      {error ? (
        <div className="rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-[12px] text-bad">{error}</div>
      ) : null}

      <div className="flex min-h-0 flex-1 flex-col gap-3 md:flex-row">
        <div className="card flex max-h-52 w-full shrink-0 flex-col gap-2 overflow-hidden p-2 md:max-h-none md:w-56">
          <div className="flex items-center justify-between px-1">
            <span className="label">{t('db.tables')}</span>
            <span className="text-[10px] text-muted">{tables.length}</span>
          </div>
          <div className="relative">
            <Icon name="search" size={12} className="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-muted/70" />
            <input
              value={tableQuery}
              onChange={(event) => setTableQuery(event.target.value)}
              className="input py-1 pl-7 text-[11.5px]"
              placeholder={t('db.searchTables')}
              aria-label={t('db.searchTables')}
            />
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-auto">
            {tables.map((table) => (
              <button
                key={table.name}
                type="button"
                onClick={() => void loadTable(table.name, 0, limit)}
                className={cn(
                  'flex cursor-pointer items-center gap-1 rounded-md px-2 py-1.5 text-left text-[11.5px] transition-colors',
                  active === table.name
                    ? 'border border-accent/25 bg-accent/12 text-accent'
                    : 'border border-transparent text-muted hover:bg-panel2 hover:text-ink',
                )}
              >
                <span className="min-w-0 flex-1 truncate">{table.name}</span>
                <span className="text-[10px] text-muted/70">{table.rows < 0 ? '?' : table.rows.toLocaleString()}</span>
              </button>
            ))}
            {!tables.length ? (
              <div className="px-1 py-2 text-[11.5px] text-muted">{t('db.noTables')}</div>
            ) : null}
          </div>
        </div>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2">
          <div className="card flex flex-wrap items-center gap-2 px-2.5 py-2 text-[11.5px] text-muted">
            <span className="label">{t('db.rows')}</span>
            <select
              value={limit}
              onChange={(event) => {
                const next = Number(event.target.value);
                if (active) void loadTable(active, 0, next);
                else setLimit(next);
              }}
              className="input w-auto py-0.5 text-[11.5px]"
            >
              {[50, 100, 250, 500].map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
            {grid && !grid.truncated ? (
              <>
                <button
                  type="button"
                  className="btn px-1.5 py-0.5"
                  disabled={!active || offset === 0 || busy}
                  onClick={() => active && void loadTable(active, Math.max(0, offset - limit), limit)}
                  aria-label="Previous page"
                >
                  ←
                </button>
                <span className="mono">
                  {grid.total === 0 ? '0' : `${offset + 1}–${Math.min(offset + limit, grid.total)}`} / {grid.total.toLocaleString()}
                </span>
                <button
                  type="button"
                  className="btn px-1.5 py-0.5"
                  disabled={!active || offset + limit >= grid.total || busy}
                  onClick={() => active && void loadTable(active, offset + limit, limit)}
                  aria-label="Next page"
                >
                  →
                </button>
              </>
            ) : null}
            {busy ? <Spinner /> : null}
          </div>

          {grid ? (
            <DataGrid grid={grid} caption={caption} />
          ) : (
            <div className="card flex min-h-40 flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
              <Icon name="db" size={22} className="text-muted/50" />
              <span className="text-[12px] text-muted">{t('db.pick')}</span>
            </div>
          )}

          <div className="card flex shrink-0 flex-col gap-2 p-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="label">SQL</span>
              <span className="hint">SELECT / WITH / PRAGMA / EXPLAIN · <span className="mono">Ctrl+Enter</span></span>
            </div>
            <textarea
              value={sql}
              onChange={(event) => setSql(event.target.value)}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') void runSql();
              }}
              spellCheck={false}
              className="input mono h-24 resize-none text-[11.5px]"
              aria-label="SQL"
            />
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className="btn btn-primary" onClick={() => void runSql()} disabled={busy || !sql.trim()}>
                {busy ? <Spinner /> : <Icon name="play" />} {t('common.run')}
              </button>
              <span className="hint">{t('db.queryHint')}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
