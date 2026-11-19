import { useEffect, useRef, useState } from 'react';
import { api, qs } from '../../lib/api';
import { Badge, Button, Card, CopyButton, Empty, Icon, Input, Select, Skeleton, cn } from '../../components/ui';
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
const SKELETON_ROWS = [0, 1, 2, 3];

function prettyPayload(payload: unknown): string {
  if (payload === null || payload === undefined) return '—';
  if (typeof payload === 'string') return payload;
  try {
    return JSON.stringify(payload, null, 2);
  } catch {
    return String(payload);
  }
}

function statusTone(status: number | null): 'ok' | 'warn' | 'bad' {
  if (!status || status < 400) return 'ok';
  if (status < 500) return 'warn';
  return 'bad';
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
        <Card className="flex flex-wrap items-center gap-2 p-2.5">
          <form onSubmit={submit} className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
            <Select
              value={source}
              onChange={(next) => {
                setSource(next);
                setExpanded(null);
                void load(true, next, appliedQuery);
              }}
              options={[
                { value: '', label: t('audit.allSources') },
                { value: 'web', label: t('audit.web') },
                { value: 'telegram_bot', label: t('audit.telegram') },
              ]}
              size="sm"
              label={t('audit.source')}
              className="w-36"
            />
            <div className="relative min-w-44 flex-1">
              <Icon
                name="search"
                size={13}
                className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-muted/70"
              />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="py-1.5 pl-8 text-[13px]"
                placeholder={t('audit.searchPlaceholder')}
                aria-label={t('audit.searchPlaceholder')}
              />
            </div>
            <Button type="submit" variant="primary" icon="search" className="py-1.5 text-[13px]">
              {t('audit.search')}
            </Button>
          </form>
          <Button variant="ghost" className="py-1.5 text-[13px]" onClick={reset} disabled={loading}>
            {t('audit.reset')}
          </Button>
          <Button
            icon="refresh"
            loading={loading}
            className="py-1.5 text-[13px]"
            onClick={() => void load(true, source, appliedQuery)}
            disabled={loading}
          >
            {t('audit.refresh')}
          </Button>
          <Badge className="tabular-nums">{total.toLocaleString()} {t('audit.total')}</Badge>
        </Card>

        {error ? (
          <div className="rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-[13px] text-bad">{error}</div>
        ) : null}

        {!items.length && loading ? (
          <div className="flex flex-col gap-1.5">
            {SKELETON_ROWS.map((row) => (
              <Skeleton key={row} className="h-[52px] w-full" />
            ))}
          </div>
        ) : !items.length ? (
          <Empty icon="notes" text={t('audit.empty')} />
        ) : (
          <div className="flex flex-col gap-1.5">
            {items.map((item) => {
              const open = expanded === item.id;
              const when = formatTime(item.ts);
              const payload = open ? prettyPayload(item.payload) : '';
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
                    <span className="mono w-24 shrink-0 leading-4 tabular-nums" title={when.iso}>
                      <span className="block text-[12.5px] text-ink/85">{when.time}</span>
                      <span className="block text-[12.5px] text-muted">{when.date}</span>
                    </span>
                    <Badge tone={item.source === 'telegram_bot' ? 'accent' : 'neutral'} className="shrink-0">
                      <span
                        className={cn(
                          'size-1.5 rounded-full',
                          item.source === 'telegram_bot' ? 'bg-accent' : 'bg-muted/70',
                        )}
                      />
                      {item.source === 'telegram_bot' ? t('audit.telegram') : t('audit.web')}
                    </Badge>
                    <span className="min-w-0 max-w-52 truncate text-[12.5px] font-medium" title={item.actor}>
                      {item.actor}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[12px] text-muted" title={item.action}>
                      <span className="text-ink/80">{item.feature}</span> · {item.action}
                    </span>
                    <Badge tone={statusTone(item.status)} className="mono tabular-nums px-1.5">
                      {item.status ?? '—'}
                    </Badge>
                    <span className="mono w-16 text-right text-[12.5px] tabular-nums text-muted">{item.durationMs} ms</span>
                    <Icon
                      name={open ? 'chevronDown' : 'chevronRight'}
                      size={12}
                      className="shrink-0 text-muted transition-transform group-hover:text-ink/80"
                    />
                  </button>
                  {open ? (
                    <div className="border-t border-line bg-panel/25 px-3 py-2.5">
                      <div className="mb-2 flex flex-wrap items-center gap-1.5">
                        <Badge>{item.method ?? '—'} {item.path ?? ''}</Badge>
                        {item.ip ? <Badge>IP {item.ip}</Badge> : null}
                        {item.userAgent ? (
                          <span className="block max-w-full" title={item.userAgent}>
                            <Badge className="max-w-full truncate">{item.userAgent}</Badge>
                          </span>
                        ) : null}
                        <Badge>#{item.id}</Badge>
                      </div>
                      {item.error ? (
                        <div className="mb-2 rounded-lg border border-bad/30 bg-bad/10 px-2.5 py-2 text-[12px] text-bad">
                          {item.error}
                        </div>
                      ) : null}
                      <div className="label mb-1 flex items-center gap-2">
                        {t('audit.payload')}
                        {payload ? <CopyButton text={payload} size="sm" /> : null}
                      </div>
                      <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-line bg-panel2/50 p-2.5 font-mono text-[12.5px] leading-5 text-ink/85">
                        {payload}
                      </pre>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}

        {items.length > 0 && items.length < total ? (
          <Button icon="chevronDown" loading={loading} className="self-center" onClick={() => void load(false, source, appliedQuery)} disabled={loading}>
            {t('audit.loadMore')}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
