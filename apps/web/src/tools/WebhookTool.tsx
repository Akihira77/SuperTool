import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon, PageHeader, Spinner, cn } from '../components/ui';
import { CopyButton } from '../components/ui';
import { api, ApiError } from '../lib/api';
import { bytes, timeAgo } from '../lib/format';
import { useI18n } from '../lib/i18n';
import { useToast } from '../components/toast';

type HookItem = {
  id: string;
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

type Info = { token: string; path: string; items: HookItem[] };

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
  const [info, setInfo] = useState<Info | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [live, setLive] = useState(true);
  const [error, setError] = useState('');
  const source = useRef<EventSource | null>(null);

  useEffect(() => {
    api
      .get<Info>('/webhook')
      .then((data) => setInfo(data))
      .catch((err) => setError(err instanceof ApiError ? err.message : t('webhook.errorLoad')));
  }, []);

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
        const data = JSON.parse(event.data) as { items: HookItem[] };
        setInfo((prev) => (prev ? { ...prev, items: data.items } : prev));
      } catch {
        // abaikan payload rusak
      }
    };
    stream.onerror = () => {
      // EventSource reconnect sendiri; hanya matikan kalau memang ditutup.
      if (stream.readyState === EventSource.CLOSED) setLive(false);
    };
    return () => stream.close();
  }, [live]);

  const url = info ? window.location.origin + info.path : '';

  const clear = useCallback(async () => {
    try {
      await api.del('/webhook');
      setInfo((prev) => (prev ? { ...prev, items: [] } : prev));
      setSelected(null);
      toast(t('webhook.cleared'), 'ok');
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t('err.delete'), 'error');
    }
  }, [t, toast]);

  const current = info?.items.find((item) => item.id === selected) ?? null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title={t('webhook.title')} subtitle={t('webhook.subtitle')}>
        <span className={cn('flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px]', live ? 'bg-ok/15 text-ok' : 'bg-panel2 text-muted')}>
          <span className={cn('h-1.5 w-1.5 rounded-full', live ? 'bg-ok' : 'bg-muted')} />
          {live ? t('webhook.live') : t('webhook.paused')}
        </span>
        <button type="button" className="btn cursor-pointer" onClick={() => setLive((prev) => !prev)}>
          <Icon name={live ? 'x' : 'play'} size={13} /> {live ? t('webhook.pause') : t('webhook.resume')}
        </button>
        <button type="button" className="btn cursor-pointer" onClick={() => void clear()} disabled={!info?.items.length}>
          <Icon name="trash" size={13} /> {t('webhook.clear')}
        </button>
      </PageHeader>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden p-4">
        <div className="card flex flex-wrap items-center gap-2 p-3">
          <span className="text-[11px] tracking-wide text-muted uppercase">{t('webhook.endpoint')}</span>
          <code className="mono min-w-0 flex-1 truncate rounded bg-panel2 px-2 py-1 text-[12px] text-accent">{url || '…'}</code>
          {url ? <CopyButton text={url} label={t('webhook.copy')} /> : null}
          <span className="text-[11px] text-muted">{t('webhook.hint')}</span>
        </div>

        {error ? <div className="text-[12px] text-bad">{error}</div> : null}

        <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[320px_1fr]">
          <div className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-line">
            <div className="flex shrink-0 items-center gap-2 border-b border-line px-2 py-1.5 text-[11px] text-muted">
              {t('webhook.requests')}
              <span className="rounded bg-panel2 px-1 text-ink">{info?.items.length ?? 0}</span>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {(info?.items ?? []).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setSelected(item.id)}
                  className={cn(
                    'flex w-full cursor-pointer flex-col gap-0.5 border-b border-line/60 px-2 py-1.5 text-left',
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
              {!info?.items.length ? (
                <div className="px-3 py-6 text-center text-[11.5px] text-muted">{t('webhook.empty')}</div>
              ) : null}
            </div>
          </div>

          <div className="min-h-0 overflow-auto rounded-lg border border-line">
            {current ? (
              <div className="flex flex-col gap-3 p-3">
                <div className="flex flex-wrap items-center gap-2 text-[11.5px] text-muted">
                  <span className="mono rounded bg-accent/15 px-1.5 py-0.5 text-accent">{current.method}</span>
                  <span className="mono truncate text-ink/85">{current.path}</span>
                  <span className="ml-auto">{new Date(current.at).toLocaleString()}</span>
                </div>
                <div>
                  <div className="mb-1 text-[10.5px] tracking-wide text-muted uppercase">{t('webhook.headers')}</div>
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
                  <div className="mb-1 flex items-center gap-2 text-[10.5px] tracking-wide text-muted uppercase">
                    {t('webhook.body')}
                    {current.body ? <CopyButton text={pretty(current.body, current.contentType)} label={t('webhook.copy')} /> : null}
                  </div>
                  {current.body ? (
                    <pre className="mono max-h-[45vh] overflow-auto rounded border border-line bg-[#0b1118] p-2 text-[11.5px] whitespace-pre-wrap text-ink/85">
                      {pretty(current.body, current.contentType)}
                    </pre>
                  ) : (
                    <div className="text-[11.5px] text-muted">{t('webhook.noBody')}</div>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex h-full items-center justify-center p-8 text-center text-[12px] text-muted">
                {t('webhook.select')}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
