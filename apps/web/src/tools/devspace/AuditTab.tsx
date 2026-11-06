import { useEffect, useRef, useState } from 'react';
import { api, qs } from '../../lib/api';
import { Empty, Icon, Spinner, cn } from '../../components/ui';
import { useI18n } from '../../lib/i18n';

type AuditItem = {
  id: number;
  ts: number;
  source: 'web' | 'telegram_bot';
  actor: string;
  feature: string;
  action: string;
  method: string | null;
  path: string | null;
  status: number | null;
  durationMs: number;
  ip: string | null;
  userAgent: string | null;
  payload: unknown;
  error: string | null;
};

type AuditResponse = { items: AuditItem[]; total: number; limit: number; offset: number };

const PAGE_SIZE = 100;

function prettyPayload(payload: unknown): string {
  if (payload === null || payload === undefined) return '—';
  if (typeof payload === 'string') return payload;
  try {
    return JSON.stringify(payload, null, 2);
  } catch {
    return String(payload);
  }
}

function statusTone(status: number | null): string {
  if (!status || status < 400) return 'bg-ok/10 text-ok';
  if (status < 500) return 'bg-warn/10 text-warn';
  return 'bg-bad/10 text-bad';
}

function formatTime(ts: number): { date: string; time: string; iso: string } {
  const value = new Date(ts);
  return {
    date: value.toLocaleDateString(),
    time: value.toLocaleTimeString(undefined, { hour12: false }),
    iso: value.toISOString(),
  };
}

export default function AuditTab() {
  const { t } = useI18n();
  const [source, setSource] = useState('');
  const [query, setQuery] = useState('');
  const [appliedQuery, setAppliedQuery] = useState('');
  const [items, setItems] = useState<AuditItem[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState<number | null>(null);
  const requestId = useRef(0);

  const load = async (reset: boolean, nextSource = source, nextQuery = appliedQuery): Promise<void> => {
    const request = ++requestId.current;
    const nextOffset = reset ? 0 : offset;
    setLoading(true);
    setError('');
    try {
      const data = await api.get<AuditResponse>(
        '/audit' + qs({ source: nextSource, q: nextQuery, limit: PAGE_SIZE, offset: nextOffset }),
      );
      if (request !== requestId.current) return;
      setItems((previous) => (reset ? data.items : [...previous, ...data.items]));
      setTotal(data.total);
      setOffset(nextOffset + data.items.length);
    } catch (err) {
      if (request !== requestId.current) return;
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (request === requestId.current) setLoading(false);
    }
  };

  useEffect(() => {
    void load(true, '', '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const nextQuery = query.trim();
    setAppliedQuery(nextQuery);
    void load(true, source, nextQuery);
  };

  const reset = () => {
    setSource('');
    setQuery('');
    setAppliedQuery('');
    setExpanded(null);
    void load(true, '', '');
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto p-3 md:p-4">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-3">
        <div className="card flex flex-wrap items-center gap-2 p-2.5">
          <form onSubmit={submit} className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
            <select
              value={source}
              onChange={(event) => {
                const next = event.target.value;
                setSource(next);
                setExpanded(null);
                void load(true, next, appliedQuery);
              }}
              className="input w-36 py-1.5 text-[12px]"
              aria-label={t('audit.source')}
            >
              <option value="">{t('audit.allSources')}</option>
              <option value="web">{t('audit.web')}</option>
              <option value="telegram_bot">{t('audit.telegram')}</option>
            </select>
            <div className="relative min-w-44 flex-1">
              <Icon
                name="search"
                size={13}
                className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-muted/70"
              />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="input py-1.5 pl-8 text-[12px]"
                placeholder={t('audit.searchPlaceholder')}
                aria-label={t('audit.searchPlaceholder')}
              />
            </div>
            <button type="submit" className="btn btn-primary py-1.5 text-[12px]">
              <Icon name="search" size={13} /> {t('audit.search')}
            </button>
          </form>
          <button type="button" className="btn btn-ghost py-1.5 text-[12px]" onClick={reset} disabled={loading}>
            {t('audit.reset')}
          </button>
          <button
            type="button"
            className="btn py-1.5 text-[12px]"
            onClick={() => void load(true, source, appliedQuery)}
            disabled={loading}
          >
            {loading ? <Spinner /> : <Icon name="refresh" size={13} />} {t('audit.refresh')}
          </button>
          <span className="chip">{total.toLocaleString()} {t('audit.total')}</span>
        </div>

        {error ? (
          <div className="rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-[12px] text-bad">{error}</div>
        ) : null}

        {!items.length && !loading ? (
          <Empty icon="notes" text={t('audit.empty')} />
        ) : (
          <div className="flex flex-col gap-1.5">
            {items.map((item) => {
              const open = expanded === item.id;
              const when = formatTime(item.ts);
              return (
                <div
                  key={item.id}
                  className={cn(
                    'card overflow-hidden transition-colors',
                    open ? 'border-accent/35 bg-panel' : 'hover:border-line/80',
                  )}
                >
                  <button
                    type="button"
                    className="group flex w-full cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 text-left outline-none transition-colors hover:bg-panel2/55 focus-visible:bg-panel2/55"
                    onClick={() => setExpanded(open ? null : item.id)}
                    aria-expanded={open}
                  >
                    <span className="mono w-24 shrink-0 leading-4" title={when.iso}>
                      <span className="block text-[10.5px] text-ink/85">{when.time}</span>
                      <span className="block text-[9.5px] text-muted">{when.date}</span>
                    </span>
                    <span
                      className={cn(
                        'flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium',
                        item.source === 'telegram_bot' ? 'bg-accent/10 text-accent' : 'bg-panel2 text-muted',
                      )}
                    >
                      <span
                        className={cn(
                          'h-1.5 w-1.5 rounded-full',
                          item.source === 'telegram_bot' ? 'bg-accent' : 'bg-muted/70',
                        )}
                      />
                      {item.source === 'telegram_bot' ? t('audit.telegram') : t('audit.web')}
                    </span>
                    <span className="min-w-0 max-w-52 truncate text-[11.5px] font-medium" title={item.actor}>
                      {item.actor}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[11px] text-muted" title={item.action}>
                      <span className="text-ink/80">{item.feature}</span> · {item.action}
                    </span>
                    <span className={cn('mono rounded px-1.5 py-0.5 text-[10px] font-medium', statusTone(item.status))}>
                      {item.status ?? '—'}
                    </span>
                    <span className="mono w-16 text-right text-[10px] text-muted">{item.durationMs} ms</span>
                    <Icon
                      name={open ? 'chevronDown' : 'chevronRight'}
                      size={12}
                      className="shrink-0 text-muted transition-transform group-hover:text-ink/80"
                    />
                  </button>
                  {open ? (
                    <div className="border-t border-line bg-panel/25 px-3 py-2.5">
                      <div className="mb-2 flex flex-wrap items-center gap-1.5">
                        <span className="chip">{item.method ?? '—'} {item.path ?? ''}</span>
                        {item.ip ? <span className="chip">IP {item.ip}</span> : null}
                        {item.userAgent ? (
                          <span className="chip max-w-full truncate" title={item.userAgent}>{item.userAgent}</span>
                        ) : null}
                        <span className="chip">#{item.id}</span>
                      </div>
                      {item.error ? (
                        <div className="mb-2 rounded-lg border border-bad/30 bg-bad/10 px-2.5 py-2 text-[11px] text-bad">
                          {item.error}
                        </div>
                      ) : null}
                      <div className="label mb-1">{t('audit.payload')}</div>
                      <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-line bg-panel2/50 p-2.5 font-mono text-[10.5px] leading-5 text-ink/85">
                        {prettyPayload(item.payload)}
                      </pre>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}

        {items.length > 0 && items.length < total ? (
          <button type="button" className="btn self-center" onClick={() => void load(false, source, appliedQuery)} disabled={loading}>
            {loading ? <Spinner /> : <Icon name="chevronDown" size={13} />} {t('audit.loadMore')}
          </button>
        ) : null}
      </div>
    </div>
  );
}
