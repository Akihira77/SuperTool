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
    setAppliedQuery(query.trim());
    void load(true, source, query.trim());
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto p-3">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-3">
        <div className="flex flex-wrap items-end gap-2">
          <form onSubmit={submit} className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
            <select
              value={source}
              onChange={(event) => {
                const next = event.target.value;
                setSource(next);
                void load(true, next, appliedQuery);
              }}
              className="input w-40 py-1.5 text-[12px]"
              aria-label={t('audit.source')}
            >
              <option value="">{t('audit.allSources')}</option>
              <option value="web">{t('audit.web')}</option>
              <option value="telegram_bot">{t('audit.telegram')}</option>
            </select>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="input min-w-48 flex-1 py-1.5 text-[12px]"
              placeholder={t('audit.searchPlaceholder')}
              aria-label={t('audit.searchPlaceholder')}
            />
            <button type="submit" className="btn btn-primary py-1.5 text-[12px]">
              <Icon name="search" size={13} /> {t('audit.search')}
            </button>
          </form>
          <button
            type="button"
            className="btn py-1.5 text-[12px]"
            onClick={() => void load(true, source, appliedQuery)}
            disabled={loading}
          >
            {loading ? <Spinner /> : <Icon name="refresh" size={13} />} {t('audit.refresh')}
          </button>
          <span className="text-[11px] text-muted">{total} {t('audit.total')}</span>
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
              return (
                <div key={item.id} className={cn('card overflow-hidden', open && 'border-accent/35')}>
                  <button
                    type="button"
                    className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-left"
                    onClick={() => setExpanded(open ? null : item.id)}
                    aria-expanded={open}
                  >
                    <span className="mono w-40 shrink-0 text-[10px] text-muted" title={new Date(item.ts).toISOString()}>
                      {new Date(item.ts).toLocaleString('id-ID')}
                    </span>
                    <span
                      className={cn(
                        'rounded px-1.5 py-0.5 text-[10px] font-medium',
                        item.source === 'telegram_bot' ? 'bg-accent/10 text-accent' : 'bg-panel2 text-muted',
                      )}
                    >
                      {item.source === 'telegram_bot' ? t('audit.telegram') : t('audit.web')}
                    </span>
                    <span className="min-w-0 max-w-56 truncate text-[11.5px] font-medium" title={item.actor}>
                      {item.actor}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[11px] text-muted" title={item.action}>
                      {item.feature} · {item.action}
                    </span>
                    <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-medium', statusTone(item.status))}>
                      {item.status ?? '—'}
                    </span>
                    <span className="mono w-14 text-right text-[10px] text-muted">{item.durationMs} ms</span>
                    <Icon name={open ? 'chevronDown' : 'chevronRight'} size={12} className="shrink-0 text-muted" />
                  </button>
                  {open ? (
                    <div className="border-t border-line bg-panel/20 px-3 py-2.5">
                      <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-[10.5px] text-muted">
                        <span>{item.method ?? '—'} {item.path ?? ''}</span>
                        {item.ip ? <span>IP {item.ip}</span> : null}
                        {item.userAgent ? <span className="max-w-full truncate" title={item.userAgent}>{item.userAgent}</span> : null}
                        <span className="mono">{item.id}</span>
                      </div>
                      {item.error ? (
                        <div className="mb-2 rounded border border-bad/30 bg-bad/10 px-2 py-1.5 text-[11px] text-bad">
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
