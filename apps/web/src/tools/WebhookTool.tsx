import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Badge, Button, Card, CopyButton, Empty, Icon, IconButton, Input, PageHeader, cn } from '../components/ui';
import { api, ApiError, qs } from '../lib/api';
import { bytes, timeAgo } from '../lib/format';
import { useI18n } from '../lib/i18n';
import { useToast } from '../components/toast';
import { useConfirm } from '../components/confirm';

type Endpoint = { id: string; name: string; token: string; createdAt: number };

type HookItem = {
  id: string;
  endpointId: string;
  method: string;
  path: string;
  query: string;
  ip: string;
  at: number;
  size: number;
  contentType: string;
  headers: Array<{ key: string; value: string }>;
  body: string;
};

type Info = { endpoints: Endpoint[]; items: HookItem[] };

const urlOf = (endpoint: Endpoint) => window.location.origin + '/api/hook/' + endpoint.token;

function pretty(body: string, contentType: string) {
  if (!body) return '';
  if (!/json/i.test(contentType)) return body;
  try {
    return JSON.stringify(JSON.parse(body), null, 2);
  } catch {
    return body;
  }
}

export default function WebhookTool() {
  const { t } = useI18n();
  const toast = useToast();
  const confirm = useConfirm();
  const [info, setInfo] = useState<Info | null>(null);
  const [activeId, setActiveId] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [live, setLive] = useState(true);
  const [adding, setAdding] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [tokenDraft, setTokenDraft] = useState('');
  const [savingToken, setSavingToken] = useState(false);
  const [error, setError] = useState('');
  const source = useRef<EventSource | null>(null);

  useEffect(() => {
    api
      .get<Info>('/webhook')
      .then((data) => {
        setInfo(data);
        setActiveId((prev) => prev || data.endpoints[0]?.id || '');
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : t('webhook.errorLoad')));
  }, [t]);

  useEffect(() => {
    if (!live) {
      source.current?.close();
      source.current = null;
      return;
    }
    const stream = new EventSource('/api/webhook/stream');
    source.current = stream;
    stream.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as Info;
        setInfo(data);
        setActiveId((prev) => (data.endpoints.some((endpoint) => endpoint.id === prev) ? prev : data.endpoints[0]?.id ?? ''));
      } catch {
        // abaikan payload rusak
      }
    };
    stream.onerror = () => {
      if (stream.readyState === EventSource.CLOSED) setLive(false);
    };
    return () => stream.close();
  }, [live]);

  const active = useMemo(() => info?.endpoints.find((endpoint) => endpoint.id === activeId) ?? null, [activeId, info]);
  const items = useMemo(() => (info?.items ?? []).filter((item) => !activeId || item.endpointId === activeId), [activeId, info]);
  const current = items.find((item) => item.id === selected) ?? null;
  const urlPrefix = window.location.origin + '/api/hook/';
  const url = active ? urlOf(active) : '';
  const tokenValid = /^[A-Za-z0-9_-]{16,64}$/.test(tokenDraft);
  const tokenDirty = Boolean(active && tokenDraft !== active.token);

  useEffect(() => {
    setTokenDraft(active?.token ?? '');
  }, [active?.id, active?.token]);

  const saveToken = async () => {
    if (!active || !tokenDirty) return;
    setSavingToken(true);
    setError('');
    try {
      const endpoint = await api.put<Endpoint>('/webhook/e/' + active.id, { token: tokenDraft });
      setInfo((prev) =>
        prev ? { ...prev, endpoints: prev.endpoints.map((item) => (item.id === endpoint.id ? endpoint : item)) } : prev,
      );
      toast(t('webhook.endpointSaved'), 'ok');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('err.save'));
    } finally {
      setSavingToken(false);
    }
  };

  const clear = useCallback(async () => {
    if (!activeId) return;
    try {
      await api.del('/webhook/items' + qs({ endpoint: activeId }));
      setInfo((prev) => (prev ? { ...prev, items: prev.items.filter((item) => item.endpointId !== activeId) } : prev));
      setSelected(null);
      toast(t('webhook.cleared'), 'ok');
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t('err.delete'), 'error');
    }
  }, [activeId, t, toast]);

  const addEndpoint = async () => {
    try {
      const endpoint = await api.post<Endpoint>('/webhook', { name: nameDraft });
      setInfo((prev) => (prev ? { ...prev, endpoints: [...prev.endpoints, endpoint] } : { endpoints: [endpoint], items: [] }));
      setActiveId(endpoint.id);
      setNameDraft('');
      setAdding(false);
      toast(t('webhook.endpointAdded'), 'ok');
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t('err.save'), 'error');
    }
  };

  const removeEndpoint = async (endpoint: Endpoint) => {
    const ok = await confirm({ title: t('webhook.confirmDeleteEndpoint'), message: endpoint.name, danger: true, confirmLabel: t('common.delete') });
    if (!ok) return;
    try {
      const data = await api.del<Info>('/webhook/e/' + endpoint.id);
      setInfo(data);
      setActiveId(data.endpoints[0]?.id ?? '');
      setSelected(null);
      toast(t('common.deleted'), 'ok');
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t('err.delete'), 'error');
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title={t('webhook.title')} subtitle={t('webhook.subtitle')} icon="webhook">
        <Badge tone={live ? 'ok' : 'neutral'} className="py-1">
          <span aria-hidden="true" className={cn('size-1.5 rounded-full', live ? 'bg-ok' : 'bg-muted')} />
          {live ? t('webhook.live') : t('webhook.paused')}
        </Badge>
        <Button icon={live ? 'x' : 'play'} data-action="webhook:pause" onClick={() => setLive((prev) => !prev)}>
          {live ? t('webhook.pause') : t('webhook.resume')}
        </Button>
        <Button icon="trash" data-action="webhook:clear" onClick={() => void clear()} disabled={!items.length}>
          {t('webhook.clear')}
        </Button>
      </PageHeader>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden p-4 max-lg:overflow-y-auto md:p-5">
        <Card className="flex flex-col gap-3 bg-panel/80 p-4">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="label mr-1">{t('webhook.endpoints')}</span>
            {(info?.endpoints ?? []).map((endpoint) => {
              const count = (info?.items ?? []).filter((item) => item.endpointId === endpoint.id).length;
              const isActive = endpoint.id === activeId;
              return (
                <span
                  key={endpoint.id}
                  className={cn(
                    'flex items-center gap-1.5 rounded-control border px-2 py-1 text-[12.5px] transition-colors duration-[var(--duration-fast)]',
                    isActive ? 'border-accent/50 bg-accent/12 text-ink' : 'border-line text-muted hover:border-accent/30 hover:text-ink',
                  )}
                >
                  <button
                    type="button"
                    onClick={() => { setActiveId(endpoint.id); setSelected(null); }}
                    aria-current={isActive ? 'true' : undefined}
                    className="min-h-6 max-w-40 cursor-pointer truncate rounded-sm"
                  >
                    {endpoint.name}
                  </button>
                  <span className={cn('rounded px-1 text-[12.5px] tabular-nums', isActive ? 'bg-accent/20 text-accent' : 'bg-panel2')}>{count}</span>
                  {info && info.endpoints.length > 1 ? (
                    <IconButton icon="x" size="sm" tone="danger" label={t('webhook.deleteEndpoint')} onClick={() => void removeEndpoint(endpoint)} />
                  ) : null}
                </span>
              );
            })}
            {adding ? (
              <span className="flex items-center gap-1">
                <Input
                  autoFocus
                  value={nameDraft}
                  onChange={(event) => setNameDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') void addEndpoint();
                    if (event.key === 'Escape') { setAdding(false); setNameDraft(''); }
                  }}
                  placeholder={t('webhook.endpointPlaceholder')}
                  aria-label={t('webhook.endpointPlaceholder')}
                  className="w-52 py-1 text-[12.5px]"
                />
                <Button size="sm" variant="primary" onClick={() => void addEndpoint()}>{t('common.save')}</Button>
                <IconButton
                  icon="x"
                  label={t('common.close')}
                  onClick={() => { setAdding(false); setNameDraft(''); }}
                />
              </span>
            ) : (
              <Button variant="ghost" size="sm" icon="plus" data-action="webhook:addEndpoint" onClick={() => setAdding(true)}>
                {t('webhook.addEndpoint')}
              </Button>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="label">{t('webhook.endpoint')}</span>
            <div className="flex flex-wrap items-center gap-2">
              <span className="mono shrink-0 rounded-md border border-line bg-panel2 px-2 py-1.5 text-[12.5px] font-semibold text-accent">POST</span>
              <div className="flex min-w-0 flex-1 flex-col rounded-control border border-line bg-panel2/60 px-2 py-1.5 transition-colors duration-[var(--duration-fast)] focus-within:border-accent/50 max-sm:basis-full sm:flex-row sm:items-center">
                <span className="mono min-w-0 break-all text-[11.5px] text-muted/75 sm:shrink-0 sm:text-[12px]">{urlPrefix}</span>
                <input
                  value={tokenDraft}
                  onChange={(event) => setTokenDraft(event.target.value)}
                  onFocus={(event) => event.target.select()}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') void saveToken();
                    if (event.key === 'Escape') setTokenDraft(active?.token ?? '');
                  }}
                  disabled={!active || savingToken}
                  maxLength={64}
                  spellCheck={false}
                  aria-label={t('webhook.endpoint')}
                  aria-invalid={tokenDirty && !tokenValid}
                  className="mono min-h-6 w-full min-w-0 bg-transparent text-[13px] text-ink outline-none disabled:opacity-60 sm:flex-1"
                />
              </div>
              {tokenDirty && !tokenValid ? <span className="text-[12px] text-bad">{t('webhook.tokenRule')}</span> : null}
              {tokenDirty ? (
                <Button variant="primary" icon="check" onClick={() => void saveToken()} disabled={!tokenValid} loading={savingToken}>
                  {t('common.save')}
                </Button>
              ) : null}
              {url ? <CopyButton text={url} label={t('webhook.copy')} /> : null}
              {url ? (
                <a className="btn cursor-pointer" href={url} target="_blank" rel="noreferrer" title={t('webhook.open')}>
                  <Icon name="external" size={13} /> {t('webhook.open')}
                </a>
              ) : null}
            </div>
            <span className="hint">{t('webhook.hint')}</span>
          </div>
        </Card>

        {error ? <div role="alert" className="text-[13px] text-bad">{error}</div> : null}

        <div className="grid min-h-0 flex-1 gap-3 max-lg:max-h-[560px] max-lg:min-h-[420px] max-lg:flex-none max-lg:grid-rows-[minmax(0,2fr)_minmax(0,3fr)] lg:grid-cols-[320px_1fr]">
          <Card className="flex min-h-0 flex-col overflow-hidden bg-panel/60">
            <div className="flex shrink-0 items-center gap-2 border-b border-line bg-panel/70 px-3 py-2 text-[12px] text-muted">
              {t('webhook.requests')}
              <span className="rounded bg-panel2 px-1 tabular-nums text-ink">{items.length}</span>
              {active ? <span className="ml-auto truncate text-[12.5px]">{active.name}</span> : null}
            </div>
            <div tabIndex={0} role="region" aria-label={t('webhook.requests')} className="min-h-0 flex-1 overflow-y-auto">
              {items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setSelected(item.id)}
                  aria-current={selected === item.id ? 'true' : undefined}
                  className={cn(
                    'flex w-full cursor-pointer flex-col gap-0.5 border-b border-line/60 px-3 py-2 text-left transition-colors duration-[var(--duration-fast)]',
                    selected === item.id ? 'bg-accent/10' : 'hover:bg-panel2 focus-visible:bg-panel2',
                  )}
                >
                  <span className="flex items-center gap-1.5">
                    <span className="mono rounded bg-panel2 px-1 text-[12.5px] text-accent">{item.method}</span>
                    <span title={item.path} className="min-w-0 flex-1 truncate text-[12.5px] text-ink/85">{item.path}</span>
                  </span>
                  <span className="flex items-center gap-2 text-[12.5px] tabular-nums text-muted">
                    {timeAgo(item.at)} · {bytes(item.size)}
                  </span>
                </button>
              ))}
              {!items.length ? <Empty icon="webhook" text={t('webhook.empty')} /> : null}
            </div>
          </Card>

          <Card
            tabIndex={0}
            role="region"
            aria-label={t('webhook.detail')}
            className="min-h-0 overflow-auto bg-panel/60"
          >
            {current ? (
              <div className="flex flex-col gap-3 p-3">
                <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-muted">
                  <Badge tone="accent" className="mono">{current.method}</Badge>
                  <span className="mono truncate text-ink/85">{current.path}</span>
                  <span className="ml-auto tabular-nums">{new Date(current.at).toLocaleString()}</span>
                </div>
                <div>
                  <div className="mb-1 label">{t('webhook.headers')}</div>
                  <div className="rounded-control border border-line bg-panel2/60 p-2">
                    {current.headers.map((header) => (
                      <div key={header.key} className="mono flex gap-2 text-[12.5px]">
                        <span className="w-44 shrink-0 text-muted">{header.key}</span>
                        <span className="min-w-0 break-all text-ink/85">{header.value}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="min-w-0">
                  <div className="mb-1 flex items-center gap-2 label">
                    {t('webhook.body')}
                    {current.body ? <CopyButton text={pretty(current.body, current.contentType)} label={t('webhook.copy')} /> : null}
                  </div>
                  {current.body ? (
                    <pre
                      tabIndex={0}
                      role="region"
                      aria-label={t('webhook.body')}
                      className="mono max-h-[45vh] overflow-auto rounded-panel border border-line bg-[#070d14] p-3 text-[12.5px] whitespace-pre-wrap text-ink/85"
                    >
                      {pretty(current.body, current.contentType)}
                    </pre>
                  ) : (
                    <div className="text-[12.5px] text-muted">{t('webhook.noBody')}</div>
                  )}
                </div>
              </div>
            ) : items.length ? (
              // Daftar sudah punya empty state sendiri; jangan minta memilih
              // request yang belum ada.
              <Empty icon="webhook" text={t('webhook.select')} />
            ) : null}
          </Card>
        </div>
      </div>
    </div>
  );
}
