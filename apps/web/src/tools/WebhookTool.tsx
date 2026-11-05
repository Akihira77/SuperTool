import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CopyButton, Empty, Icon, PageHeader, Spinner, cn } from '../components/ui';
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
  const url = active ? urlOf(active) : '';

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
        <span className={cn('flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px]', live ? 'bg-ok/15 text-ok' : 'bg-panel2 text-muted')}>
          <span className={cn('h-1.5 w-1.5 rounded-full', live ? 'bg-ok' : 'bg-muted')} />
          {live ? t('webhook.live') : t('webhook.paused')}
        </span>
        <button type="button" className="btn cursor-pointer" data-action="webhook:pause" onClick={() => setLive((prev) => !prev)}>
          <Icon name={live ? 'x' : 'play'} size={13} /> {live ? t('webhook.pause') : t('webhook.resume')}
        </button>
        <button type="button" className="btn cursor-pointer" data-action="webhook:clear" onClick={() => void clear()} disabled={!items.length}>
          <Icon name="trash" size={13} /> {t('webhook.clear')}
        </button>
      </PageHeader>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden p-4 md:p-5">
        <div className="card flex flex-col gap-3 bg-panel/80 p-4">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="label mr-1">{t('webhook.endpoints')}</span>
            {(info?.endpoints ?? []).map((endpoint) => {
              const count = (info?.items ?? []).filter((item) => item.endpointId === endpoint.id).length;
              const isActive = endpoint.id === activeId;
              return (
                <span
                  key={endpoint.id}
                  className={cn(
                    'flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[11.5px] transition-colors',
                    isActive ? 'border-accent/50 bg-accent/12 text-ink' : 'border-line text-muted hover:border-accent/30 hover:text-ink',
                  )}
                >
                  <button type="button" onClick={() => { setActiveId(endpoint.id); setSelected(null); }} className="max-w-40 cursor-pointer truncate">
                    {endpoint.name}
                  </button>
                  <span className={cn('rounded px-1 text-[10px]', isActive ? 'bg-accent/20 text-accent' : 'bg-panel2')}>{count}</span>
                  {info && info.endpoints.length > 1 ? (
                    <button type="button" onClick={() => void removeEndpoint(endpoint)} title={t('webhook.deleteEndpoint')} className="cursor-pointer text-muted hover:text-bad">
                      <Icon name="x" size={11} />
                    </button>
                  ) : null}
                </span>
              );
            })}
            {adding ? (
              <span className="flex items-center gap-1">
                <input
                  autoFocus
                  value={nameDraft}
                  onChange={(event) => setNameDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') void addEndpoint();
                    if (event.key === 'Escape') { setAdding(false); setNameDraft(''); }
                  }}
                  placeholder={t('webhook.endpointPlaceholder')}
                  className="input w-52 py-1 text-[11.5px]"
                />
                <button type="button" className="btn btn-primary cursor-pointer px-2 py-1 text-[11.5px]" onClick={() => void addEndpoint()}>{t('common.save')}</button>
                <button type="button" className="btn btn-ghost cursor-pointer px-1 py-1" onClick={() => { setAdding(false); setNameDraft(''); }}><Icon name="x" size={12} /></button>
              </span>
            ) : (
              <button type="button" className="btn btn-ghost cursor-pointer px-2 py-1 text-[11.5px]" data-action="webhook:addEndpoint" onClick={() => setAdding(true)}>
                <Icon name="plus" size={12} /> {t('webhook.addEndpoint')}
              </button>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="label">{t('webhook.endpoint')}</span>
            <div className="flex flex-wrap items-center gap-2">
              <span className="mono shrink-0 rounded-md border border-line bg-panel2 px-2 py-1.5 text-[10.5px] font-semibold text-accent">POST</span>
              <input
                readOnly
                value={url || '…'}
                onFocus={(event) => event.target.select()}
                spellCheck={false}
                aria-label={t('webhook.endpoint')}
                className="input mono min-w-0 flex-1 py-1.5 text-[12px]"
              />
              {url ? <CopyButton text={url} label={t('webhook.copy')} /> : null}
              {url ? (
                <a className="btn cursor-pointer" href={url} target="_blank" rel="noreferrer" title={t('webhook.open')}>
                  <Icon name="external" size={13} /> {t('webhook.open')}
                </a>
              ) : null}
            </div>
            <span className="hint">{t('webhook.hint')}</span>
          </div>
        </div>

        {error ? <div className="text-[12px] text-bad">{error}</div> : null}

        <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[320px_1fr]">
          <div className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-line bg-panel/60">
            <div className="flex shrink-0 items-center gap-2 border-b border-line bg-panel/70 px-3 py-2 text-[11px] text-muted">
              {t('webhook.requests')}
              <span className="rounded bg-panel2 px-1 text-ink">{items.length}</span>
              {active ? <span className="ml-auto truncate text-[10.5px]">{active.name}</span> : null}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setSelected(item.id)}
                  className={cn(
                    'flex w-full cursor-pointer flex-col gap-0.5 border-b border-line/60 px-3 py-2 text-left transition-colors',
                    selected === item.id ? 'bg-accent/10' : 'hover:bg-panel2',
                  )}
                >
                  <span className="flex items-center gap-1.5">
                    <span className="mono rounded bg-panel2 px-1 text-[10px] text-accent">{item.method}</span>
                    <span className="min-w-0 flex-1 truncate text-[11.5px] text-ink/85">{item.path}</span>
                  </span>
                  <span className="flex items-center gap-2 text-[10.5px] text-muted">
                    {timeAgo(item.at)} · {bytes(item.size)}
                  </span>
                </button>
              ))}
              {!items.length ? <Empty icon="webhook" text={t('webhook.empty')} /> : null}
            </div>
          </div>

          <div className="min-h-0 overflow-auto rounded-xl border border-line bg-panel/60">
            {current ? (
              <div className="flex flex-col gap-3 p-3">
                <div className="flex flex-wrap items-center gap-2 text-[11.5px] text-muted">
                  <span className="mono rounded bg-accent/15 px-1.5 py-0.5 text-accent">{current.method}</span>
                  <span className="mono truncate text-ink/85">{current.path}</span>
                  <span className="ml-auto">{new Date(current.at).toLocaleString()}</span>
                </div>
                <div>
                  <div className="mb-1 label">{t('webhook.headers')}</div>
                  <div className="rounded border border-line bg-panel2/60 p-2">
                    {current.headers.map((header) => (
                      <div key={header.key} className="mono flex gap-2 text-[11.5px]">
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
                    <pre className="mono max-h-[45vh] overflow-auto rounded-lg border border-line bg-[#070d14] p-3 text-[11.5px] whitespace-pre-wrap text-ink/85">
                      {pretty(current.body, current.contentType)}
                    </pre>
                  ) : (
                    <div className="text-[11.5px] text-muted">{t('webhook.noBody')}</div>
                  )}
                </div>
              </div>
            ) : (
              <Empty icon="webhook" text={t('webhook.select')} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
