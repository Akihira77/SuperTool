import { useCallback, useEffect, useState } from 'react';
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
    return (
      <span className="block max-w-[360px] truncate" title={value}>
        {value}
      </span>
    );
  }
  if (typeof value === 'object') return <span className="text-muted">{JSON.stringify(value)}</span>;
  return <span>{String(value)}</span>;
}

function DataGrid({ grid, caption }: { grid: Grid; caption: string }) {
  const { t } = useI18n();
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-line">
      <div className="flex shrink-0 items-center gap-2 border-b border-line bg-panel px-2 py-1 text-[11px] text-muted">
        <span className="text-ink/80">{caption}</span>
        <span>· {grid.rows.length} baris</span>
        {grid.truncated ? <span className="text-warn">· dipotong</span> : null}
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full border-collapse text-[11.5px]">
          <thead className="sticky top-0 z-10 bg-panel2 text-left text-[10.5px] tracking-wide text-muted uppercase">
            <tr>
              {grid.columns.map((column) => (
                <th key={column} className="border-b border-line px-2 py-1 font-medium whitespace-nowrap">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grid.rows.map((row, index) => (
              <tr key={index} className="hover:bg-panel2/50">
                {grid.columns.map((column) => (
                  <td key={column} className="mono border-b border-line/50 px-2 py-1 align-top text-ink/90">
                    {cell(row[column])}
                  </td>
                ))}
              </tr>
            ))}
            {!grid.rows.length ? (
              <tr>
                <td colSpan={Math.max(1, grid.columns.length)} className="px-3 py-4 text-center text-[12px] text-muted">
                  {t("db.noRows")}
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
  const [limit, setLimit] = useState(100);
  const [offset, setOffset] = useState(0);
  const [sql, setSql] = useState('SELECT name, type FROM sqlite_master ORDER BY name');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const loadInfo = useCallback(async () => {
    try {
      setInfo(await api.get<Info>('/sqlite/info'));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('err.readDb'));
    }
  }, []);

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
  }, []);

  useEffect(() => {
    void loadInfo();
  }, [loadInfo]);

  const runSql = async () => {
    setBusy(true);
    setError('');
    try {
      const data = await api.post<Grid>('/sqlite/query', { sql });
      setGrid(data);
      setCaption('hasil query');
      setActive('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Query gagal');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden p-4">
      <div className="card flex flex-wrap items-center gap-2 p-3 text-[12px]">
        <Icon name="db" size={14} className="text-accent" />
        <span className="text-ink">super-tool.db</span>
        {info ? (
          <>
            <span className="text-muted">· {bytes(info.size)}</span>
            <span className="text-muted">· {info.tables.length} tabel</span>
            <span className="mono max-w-full truncate text-[11px] text-muted" title={info.path}>
              {info.path}
            </span>
          </>
        ) : null}
        <span className="ml-auto flex items-center gap-2 text-[11px] text-muted">
          read-only
          <button type="button" className="btn cursor-pointer px-1.5 py-0.5" onClick={() => void loadInfo()} title={t('common.reload')}>
            <Icon name="refresh" size={13} />
          </button>
        </span>
      </div>

      {error ? <div className="text-[12px] text-bad">{error}</div> : null}

      <div className="flex min-h-0 flex-1 gap-3">
        <div className="flex w-44 shrink-0 flex-col gap-1 overflow-auto rounded-lg border border-line p-2">
          <div className="px-1 pb-1 text-[10px] tracking-wide text-muted uppercase">Tabel</div>
          {(info?.tables ?? []).map((table) => (
            <button
              key={table.name}
              type="button"
              onClick={() => void loadTable(table.name, 0, limit)}
              className={cn(
                'flex cursor-pointer items-center gap-1 rounded px-1.5 py-1 text-left text-[11.5px] transition-colors',
                active === table.name ? 'bg-accent/15 text-accent' : 'text-muted hover:bg-panel2 hover:text-ink',
              )}
            >
              <span className="min-w-0 flex-1 truncate">{table.name}</span>
              <span className="text-[10px] text-muted/70">{table.rows < 0 ? '?' : table.rows}</span>
            </button>
          ))}
          {!info?.tables.length ? <div className="text-[11.5px] text-muted">{t("db.noTables")}</div> : null}
        </div>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2 text-[11.5px] text-muted">
            <span className="text-[10px] tracking-wide uppercase">Baris</span>
            <select
              value={limit}
              onChange={(event) => {
                const next = Number(event.target.value);
                if (active) void loadTable(active, 0, next);
                else setLimit(next);
              }}
              className="input w-auto cursor-pointer py-0.5 text-[11.5px]"
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
                  className="btn cursor-pointer px-1.5 py-0.5"
                  disabled={!active || offset === 0}
                  onClick={() => active && void loadTable(active, Math.max(0, offset - limit), limit)}
                >
                  ←
                </button>
                <span className="mono">
                  {offset + 1}–{Math.min(offset + limit, grid.total)} / {grid.total}
                </span>
                <button
                  type="button"
                  className="btn cursor-pointer px-1.5 py-0.5"
                  disabled={!active || offset + limit >= grid.total}
                  onClick={() => active && void loadTable(active, offset + limit, limit)}
                >
                  →
                </button>
              </>
            ) : null}
            {busy ? <Spinner /> : null}
          </div>

          {grid ? <DataGrid grid={grid} caption={caption} /> : <div className="text-[12px] text-muted">{t("db.pick")}</div>}

          <div className="card flex shrink-0 flex-col gap-2 p-2">
            <textarea
              value={sql}
              onChange={(event) => setSql(event.target.value)}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') void runSql();
              }}
              spellCheck={false}
              className="input mono h-20 resize-none text-[11.5px]"
            />
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className="btn btn-primary cursor-pointer" onClick={() => void runSql()} disabled={busy || !sql.trim()}>
                {busy ? <Spinner /> : <Icon name="play" />} {t('common.run')}
              </button>
              <span className="text-[11px] text-muted">
                SELECT / WITH / PRAGMA / EXPLAIN saja · <span className="mono">Ctrl+Enter</span>
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
