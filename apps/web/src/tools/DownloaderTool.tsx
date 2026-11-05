import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Icon, PageHeader, Spinner, cn } from '../components/ui';
import { useToast } from '../components/toast';
import { useI18n } from '../lib/i18n';

type Quality = 'best' | '1080' | '720' | '480' | '360';
type Stage = 'idle' | 'processing' | 'saving';
type SaveHandle = {
  createWritable: () => Promise<WritableStream<Uint8Array> & { abort?: () => Promise<void> }>;
};
type SavePicker = (
  this: Window,
  options: { suggestedName?: string; types?: Array<{ description: string; accept: Record<string, string[]> }> },
) => Promise<SaveHandle>;

const ALLOWED_HOSTS = ['youtube.com', 'youtu.be', 'facebook.com', 'fb.com', 'fb.watch', 'bilibili.com', 'b23.tv'];

function isSupportedHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return ALLOWED_HOSTS.some((domain) => host === domain || host.endsWith('.' + domain));
}

const QUALITIES: Array<{ value: Quality; key: 'downloader.qualityBest' | 'downloader.quality1080' | 'downloader.quality720' | 'downloader.quality480' | 'downloader.quality360' }> = [
  { value: 'best', key: 'downloader.qualityBest' },
  { value: '1080', key: 'downloader.quality1080' },
  { value: '720', key: 'downloader.quality720' },
  { value: '480', key: 'downloader.quality480' },
  { value: '360', key: 'downloader.quality360' },
];

function savePicker(): SavePicker | undefined {
  return (window as unknown as { showSaveFilePicker?: SavePicker }).showSaveFilePicker;
}

function filenameFromResponse(response: Response, fallback: string): string {
  const header = response.headers.get('content-disposition') ?? '';
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (encoded?.[1]) {
    try {
      return decodeURIComponent(encoded[1]);
    } catch {
      // pakai fallback di bawah
    }
  }
  const plain = /filename="([^"]+)"/i.exec(header);
  return plain?.[1] || fallback;
}

function saveBlob(blob: Blob, filename: string): void {
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.download = filename;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(href), 2000);
}

async function responseError(response: Response): Promise<string> {
  const text = await response.text().catch(() => '');
  try {
    const data = JSON.parse(text) as { message?: string | { message?: string } };
    const message = typeof data.message === 'string' ? data.message : data.message?.message;
    if (message) return message;
  } catch {
    // bukan JSON
  }
  return text.slice(0, 300) || 'HTTP ' + response.status;
}

export default function DownloaderTool() {
  const { t } = useI18n();
  const toast = useToast();
  const [url, setUrl] = useState('');
  const [quality, setQuality] = useState<Quality>('best');
  const [audioOnly, setAudioOnly] = useState(false);
  const [stage, setStage] = useState<Stage>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState('');
  const controllerRef = useRef<AbortController | null>(null);
  const busy = stage !== 'idle';

  useEffect(() => {
    if (!busy) return;
    const started = Date.now();
    setElapsed(0);
    const id = window.setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => window.clearInterval(id);
  }, [busy]);

  useEffect(() => () => controllerRef.current?.abort(), []);

  const cancel = () => controllerRef.current?.abort();

  const run = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;

    const raw = url.trim();
    try {
      const parsed = new URL(raw);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('protocol');
      if (!isSupportedHost(parsed.hostname)) {
        setError(t('downloader.unsupported'));
        return;
      }
    } catch {
      setError(t('downloader.invalidUrl'));
      return;
    }

    setError('');
    setStage('processing');
    setElapsed(0);
    const controller = new AbortController();
    controllerRef.current = controller;
    let handle: SaveHandle | null = null;

    try {
      const picker = savePicker();
      if (picker) {
        try {
          handle = await picker.call(window, {
            suggestedName: audioOnly ? 'audio.mp3' : 'video.mp4',
            types: [
              audioOnly
                ? { description: 'MP3 audio', accept: { 'audio/mpeg': ['.mp3'] } }
                : { description: 'MP4 video', accept: { 'video/mp4': ['.mp4'] } },
            ],
          });
        } catch (err) {
          if ((err as DOMException)?.name === 'AbortError') return;
          // Picker tidak tersedia/izinkan: lanjut dengan unduhan blob biasa.
          handle = null;
        }
      }
      if (controller.signal.aborted) return;

      const response = await fetch('/api/downloader/proxy', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-st-csrf': '1' },
        credentials: 'include',
        body: JSON.stringify({ url: raw, quality, audioOnly }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(await responseError(response));
      if (controller.signal.aborted) return;

      setStage('saving');
      if (handle && response.body) {
        const writable = await handle.createWritable();
        try {
          await response.body.pipeTo(writable);
        } catch (err) {
          await writable.abort?.().catch(() => undefined);
          throw err;
        }
      } else {
        // Fallback browser tanpa File System Access API: satu blob di memori.
        saveBlob(await response.blob(), filenameFromResponse(response, audioOnly ? 'audio.mp3' : 'video.mp4'));
      }

      toast(audioOnly ? t('downloader.doneAudio') : t('downloader.done'), 'ok');
    } catch (err) {
      if (controller.signal.aborted || (err as Error)?.name === 'AbortError') {
        toast(t('downloader.cancelled'), 'ok');
      } else {
        setError((err as Error)?.message || t('downloader.error'));
      }
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null;
      setStage('idle');
    }
  };

  return (
    <div className="flex h-full flex-col">
      <PageHeader title={t('downloader.title')} subtitle={t('downloader.subtitle')}>
        <span className="rounded-md border border-line bg-panel2 px-2 py-1 text-[10.5px] text-muted">MP4 · MP3</span>
      </PageHeader>

      <div className="min-h-0 flex-1 overflow-y-auto p-4 md:p-6">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-3">
          <form onSubmit={run} noValidate className="card flex flex-col gap-4 p-4 md:p-5">
            <div>
              <label htmlFor="downloader-url" className="label">
                {t('downloader.url')}
              </label>
              <div className="mt-1 flex flex-col gap-2 sm:flex-row">
                <input
                  id="downloader-url"
                  className="input min-w-0 flex-1"
                  type="url"
                  inputMode="url"
                  autoFocus
                  autoComplete="off"
                  spellCheck={false}
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                  placeholder={t('downloader.placeholder')}
                  disabled={busy}
                />
                <button type="submit" className="btn btn-primary shrink-0 justify-center" disabled={busy}>
                  {busy ? <Spinner /> : <Icon name="download" size={14} />}
                  {t('downloader.download')}
                </button>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex min-w-0 flex-col">
                <span className="label">{t('downloader.quality')}</span>
                <select
                  className="input mt-1"
                  value={quality}
                  onChange={(event) => setQuality(event.target.value as Quality)}
                  disabled={busy || audioOnly}
                >
                  {QUALITIES.map((item) => (
                    <option key={item.value} value={item.value}>
                      {t(item.key)}
                    </option>
                  ))}
                </select>
              </label>

              <label
                className={cn(
                  'flex cursor-pointer items-start gap-2.5 rounded-lg border p-2.5 transition-colors',
                  audioOnly ? 'border-accent/50 bg-accent/5' : 'border-line bg-panel2/40 hover:border-line/80',
                  busy && 'cursor-not-allowed opacity-70',
                )}
              >
                <input
                  type="checkbox"
                  checked={audioOnly}
                  onChange={(event) => setAudioOnly(event.target.checked)}
                  disabled={busy}
                  className="mt-0.5 size-4"
                />
                <span className="min-w-0">
                  <span className="flex items-center gap-1 text-[12.5px] font-medium">
                    <Icon name="music" size={13} className="text-accent/80" /> {t('downloader.audioOnly')}
                  </span>
                  <span className="mt-0.5 block text-[11px] text-muted">{t('downloader.audioOnlyHint')}</span>
                </span>
              </label>
            </div>

            {error ? (
              <div role="alert" className="rounded-lg border border-bad/40 bg-bad/5 px-3 py-2 text-[12px] break-words text-bad">
                {error}
              </div>
            ) : null}

            {busy ? (
              <div
                role="status"
                aria-live="polite"
                className="flex flex-wrap items-center gap-2 rounded-lg border border-accent/30 bg-accent/5 px-3 py-2 text-[12px] text-ink"
              >
                <Spinner />
                <span>{stage === 'saving' ? t('downloader.saving') : audioOnly ? t('downloader.processingAudio') : t('downloader.processing')}</span>
                <span className="mono text-muted">{t('downloader.elapsed').replace('{s}', String(elapsed))}</span>
                <button
                  type="button"
                  className="btn btn-ghost ml-auto px-2 py-1 text-[11px]"
                  onClick={cancel}
                  disabled={!controllerRef.current}
                >
                  {t('common.cancel')}
                </button>
              </div>
            ) : null}

            <p className="flex items-start gap-2 text-[11px] text-muted">
              <Icon name="lock" size={13} className="mt-0.5 shrink-0 text-accent/70" />
              <span>{t('downloader.hint')} {t('downloader.note')}</span>
            </p>
          </form>

          <div className="card flex flex-col gap-3 p-4 text-[12px]">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[10.5px] font-medium tracking-wide text-muted uppercase">{t('downloader.supported')}</span>
              {['YouTube', 'Facebook', 'Bilibili'].map((site) => (
                <span key={site} className="rounded-md border border-line bg-panel2 px-2 py-1 text-[11px]">
                  {site}
                </span>
              ))}
            </div>
            <p className="text-muted">{t('downloader.tip')}</p>
            <p className="text-[11px] text-muted/80">{t('downloader.chooseFolder')}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
