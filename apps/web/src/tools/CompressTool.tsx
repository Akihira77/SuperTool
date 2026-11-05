import { useEffect, useRef, useState } from 'react';
import { Icon, PageHeader, Spinner, cn } from '../components/ui';
import { api, ApiError, qs } from '../lib/api';
import { bytes } from '../lib/format';
import { useI18n } from '../lib/i18n';

type Result = {
  input: { path: string; size: number };
  output: { path: string; size: number };
  saved: number;
  percent: number;
  note?: string;
};
type Job = { id: string; state: 'running' | 'done' | 'error'; result?: Result; error?: string };

const IMAGE = new Set(['jpg', 'jpeg', 'png', 'webp', 'avif', 'tif', 'tiff']);

/**
 * Kartu berkas dengan pratinjau besar: gambar tampil penuh supaya perbandingan
 * ukuran/ketajaman terlihat. Berkas non-gambar (PDF dsb) cukup info saja.
 */
function FileCard({
  label,
  path,
  size,
  highlight,
  download,
  noPreview,
}: {
  label: string;
  path: string;
  size: number;
  highlight?: boolean;
  download?: boolean;
  noPreview?: boolean;
}) {
  const ext = (path.split('.').pop() ?? '').toLowerCase();
  const isImage = IMAGE.has(ext);
  const show = isImage && !noPreview;
  const src = RAW + encodeURIComponent(path) + '&v=' + size;
  return (
    <div
      className={cn(
        'card flex min-w-0 flex-col gap-2 p-3',
        highlight ? 'border-accent/40 bg-accent/5' : undefined,
      )}
    >
      <div className="flex items-center gap-2 text-[11px] tracking-wide text-muted uppercase">
        {label}
        {highlight ? <span className="rounded bg-accent/15 px-1 text-[10px] text-accent normal-case">baru</span> : null}
        <span className="ml-auto text-[10.5px] normal-case">{ext || 'berkas'}</span>
      </div>
      {show ? (
        <a
          href={src}
          target="_blank"
          rel="noreferrer"
          title="Buka ukuran penuh"
          className="block overflow-hidden rounded-md border border-line bg-[#0b1118]"
        >
          <img src={src} alt={path} className="h-56 w-full object-contain" loading="lazy" />
        </a>
      ) : (
        <div className="flex h-28 flex-col items-center justify-center gap-1 rounded-md border border-line bg-panel2 text-muted">
          <Icon name={ext === 'pdf' ? 'files' : 'markdown'} size={26} />
          <span className="text-[11px] uppercase">.{ext || 'berkas'}</span>
          {isImage && noPreview ? <span className="text-[10.5px]">pratinjau tidak ditampilkan</span> : null}
        </div>
      )}
      <div className="min-w-0">
        <div className="truncate text-[12.5px] text-ink">{path.split('/').pop()}</div>
        {size > 0 ? <div className="mono text-[11px] text-muted">{bytes(size)}</div> : null}
        <div className="mono truncate text-[10.5px] text-muted/70" title={path}>
          {path}
        </div>
      </div>
      {download ? (
        <a className="btn cursor-pointer justify-center" data-action="compress:download" href={RAW + encodeURIComponent(path) + '&download=1'} download>
          <Icon name="download" size={13} /> Unduh
        </a>
      ) : null}
    </div>
  );
}
const RAW = '/api/fs/raw?path=';
const DROP_DIR = '.super-tool-drop';

export default function CompressTool() {
  const { t } = useI18n();
  const [tab, setTab] = useState<'compress' | 'convert'>('compress');
  const [path, setPath] = useState('');
  const [quality, setQuality] = useState(78);
  const [maxWidth, setMaxWidth] = useState(2000);
  const [format, setFormat] = useState('');
  const [pdfMode, setPdfMode] = useState('printer');
  const [target, setTarget] = useState('pdf');
  const [dpi, setDpi] = useState(150);
  const [caps, setCaps] = useState<{ pdf: string; pdfToImage: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState('');
  const [result, setResult] = useState<Result | null>(null);
  const [dragging, setDragging] = useState(false);
  const [recents, setRecents] = useState<Array<{ path: string }>>([]);
  const rootRef = useRef('');
  const pollRef = useRef<number | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const ext = (path.split('.').pop() ?? '').toLowerCase();
  const isImage = IMAGE.has(ext);
  const isPdf = ext === 'pdf';
  const convertTargets = isImage
    ? ['pdf', 'png', 'jpg', 'webp']
    : isPdf
      ? caps?.pdfToImage
        ? ['png', 'jpg', 'webp']
        : []
      : [];

  useEffect(() => {
    api
      .get<{ pdf: string; pdfToImage: boolean }>('/compress/info')
      .then((info) => setCaps({ pdf: info.pdf, pdfToImage: info.pdfToImage }))
      .catch(() => undefined);
    api
      .get<Array<{ path: string }>>('/fs/roots')
      .then((roots) => {
        rootRef.current = roots[0]?.path ?? '';
      })
      .catch(() => undefined);
    api
      .get<{ paths: Array<{ path: string }> }>('/recent?kind=file')
      .then((data) => setRecents(data.paths.slice(0, 8)))
      .catch(() => undefined);
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
    };
  }, []);

  const poll = (jobId: string) => {
    const started = Date.now();
    setElapsed(0);
    pollRef.current = window.setInterval(async () => {
      setElapsed(Math.round((Date.now() - started) / 1000));
      try {
        const job = await api.get<Job>('/compress/job' + qs({ id: jobId }));
        if (job.state === 'running') return;
        if (pollRef.current) window.clearInterval(pollRef.current);
        pollRef.current = null;
        setBusy(false);
        if (job.state === 'error') setError(job.error ?? t('err.process'));
        else if (job.result) setResult(job.result);
      } catch (err) {
        if (pollRef.current) window.clearInterval(pollRef.current);
        pollRef.current = null;
        setBusy(false);
        setError(err instanceof ApiError ? err.message : t('err.monitor'));
      }
    }, 700);
  };

  const run = async () => {
    if (!path.trim()) return;
    setBusy(true);
    setError('');
    setResult(null);
    try {
      const body =
        tab === 'convert'
          ? await api.post<{ jobId: string }>('/compress/convert', { path: path.trim(), target, quality, dpi })
          : isImage
            ? await api.post<{ jobId: string }>('/compress/image', {
                path: path.trim(),
                quality,
                maxWidth,
                format: format || undefined,
              })
            : await api.post<{ jobId: string }>('/compress/pdf', { path: path.trim(), mode: pdfMode });
      poll(body.jobId);
    } catch (err) {
      setBusy(false);
      setError(err instanceof ApiError ? err.message : t('err.process'));
    }
  };

  const upload = async (file: File | undefined) => {
    setDragging(false);
    if (!file || !rootRef.current) return;
    setBusy(true);
    setError('');
    setResult(null);
    try {
      const dir = rootRef.current + '/' + DROP_DIR;
      await api.post('/fs/mkdir', { path: dir }).catch(() => undefined);
      const form = new FormData();
      form.append('file', file);
      const response = await fetch('/api/fs/upload' + qs({ path: dir }), {
        method: 'POST',
        headers: { 'x-st-csrf': '1' },
        body: form,
      });
      const data = (await response.json()) as { path?: string; message?: string };
      if (!response.ok || !data.path) throw new Error(data.message ?? 'Upload gagal');
      setPath(data.path);
      setBusy(false);
    } catch (err) {
      setBusy(false);
      setError((err as Error).message);
    }
  };

  const canRun = tab === 'compress' ? isImage || isPdf : convertTargets.includes(target);
  // Konversi yang menyentuh PDF tidak perlu pratinjau isi, cukup info berkas.
  const involvesPdf =
    !!result && [result.input.path, result.output.path].some((item) => item.toLowerCase().endsWith('.pdf'));

  return (
    <div className="flex h-full flex-col">
      <PageHeader title={t('compress.title')} subtitle={t('compress.subtitle')}>
        <span className="text-[11px] text-muted">
          PDF: {caps?.pdf === 'ghostscript' ? 'ghostscript' : 'pdf-lib'}
          {caps?.pdfToImage ? ' · poppler' : ' · poppler tidak ada'}
        </span>
      </PageHeader>

      <div className="flex shrink-0 gap-1 border-b border-line px-3 py-1.5">
        {([
          ['compress', t('compress.compress')],
          ['convert', t('compress.convert')],
        ] as const).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => {
              setTab(id);
              setResult(null);
              setError('');
            }}
            className={cn(
              'cursor-pointer rounded-md px-2.5 py-1 text-[12px] transition-colors',
              tab === id ? 'bg-accent/15 text-accent' : 'text-muted hover:bg-panel2 hover:text-ink',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="mx-auto flex max-w-3xl flex-col gap-4">
          <input
            ref={fileRef}
            type="file"
            className="hidden"
            onChange={(event) => void upload(event.target.files?.[0])}
          />
          <button
            type="button"
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              void upload(event.dataTransfer.files?.[0]);
            }}
            data-action="compress:pick" onClick={() => fileRef.current?.click()}
            className={cn(
              'flex cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed p-6 text-center transition-colors',
              dragging ? 'border-accent bg-accent/10' : 'border-line hover:border-accent/50',
            )}
          >
            {busy ? <Spinner /> : <Icon name="upload" size={20} className="text-muted" />}
            <span className="text-[12.5px] text-muted">{path ? path.split('/').pop() : t('compress.drop')}</span>
            {path ? <span className="mono max-w-full truncate text-[11px] text-muted/70">{path}</span> : null}
          </button>

          {recents.length ? (
            <div className="flex flex-wrap gap-1">
              {recents.map((item) => (
                <button
                  key={item.path}
                  type="button"
                  onClick={() => {
                    setPath(item.path);
                    setResult(null);
                  }}
                  className="max-w-full cursor-pointer truncate rounded border border-line px-2 py-0.5 text-[11px] text-muted hover:border-accent/50 hover:text-ink"
                  title={item.path}
                >
                  {item.path.split('/').pop()}
                </button>
              ))}
            </div>
          ) : null}

          {path ? (
            <div className="card flex flex-col gap-3 p-4">
              <div className="text-[11px] text-muted">
                {ext || '-'}
                {isImage ? ' · gambar' : isPdf ? ' · pdf' : ' · tidak didukung'}
              </div>

              {tab === 'compress' && isImage ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="flex flex-col gap-1">
                    <span className="text-[11px] tracking-wide text-muted uppercase">
                      {t('compress.quality')} ({quality})
                    </span>
                    <input type="range" min={30} max={95} value={quality} onChange={(event) => setQuality(Number(event.target.value))} className="accent-accent cursor-pointer" />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-[11px] tracking-wide text-muted uppercase">{t('compress.maxWidth')}</span>
                    <input type="number" min={200} max={8000} value={maxWidth} onChange={(event) => setMaxWidth(Number(event.target.value))} className="input" />
                  </label>
                  <label className="flex flex-col gap-1 sm:col-span-2">
                    <span className="text-[11px] tracking-wide text-muted uppercase">{t('compress.format')}</span>
                    <select value={format} onChange={(event) => setFormat(event.target.value)} className="input cursor-pointer">
                      <option value="">{t('compress.sameAsSource')}</option>
                      <option value="webp">WebP</option>
                      <option value="jpg">JPEG</option>
                      <option value="avif">AVIF</option>
                      <option value="png">PNG</option>
                    </select>
                  </label>
                </div>
              ) : null}

              {tab === 'compress' && isPdf ? (
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] tracking-wide text-muted uppercase">{t('compress.level')}</span>
                  <select value={pdfMode} onChange={(event) => setPdfMode(event.target.value)} className="input cursor-pointer">
                    <option value="printer">{t('compress.standard')}</option>
                    <option value="max">{t('compress.small')}</option>
                  </select>
                </label>
              ) : null}

              {tab === 'convert' ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="flex flex-col gap-1">
                    <span className="text-[11px] tracking-wide text-muted uppercase">{t('compress.to')}</span>
                    <select value={target} onChange={(event) => setTarget(event.target.value)} className="input cursor-pointer">
                      {convertTargets.length ? (
                        convertTargets.map((item) => (
                          <option key={item} value={item}>
                            {item.toUpperCase()}
                          </option>
                        ))
                      ) : (
                        <option value="">-</option>
                      )}
                    </select>
                  </label>
                  {isPdf ? (
                    <label className="flex flex-col gap-1">
                      <span className="text-[11px] tracking-wide text-muted uppercase">DPI ({dpi})</span>
                      <input type="range" min={72} max={300} step={6} value={dpi} onChange={(event) => setDpi(Number(event.target.value))} className="accent-accent cursor-pointer" />
                    </label>
                  ) : null}
                  {!convertTargets.length ? (
                    <div className="text-[11.5px] text-warn sm:col-span-2">{t('compress.notSupported')}</div>
                  ) : null}
                </div>
              ) : null}

              <div className="flex flex-wrap items-center gap-2">
                <button type="button" className="btn btn-primary cursor-pointer" data-action="compress:run" onClick={() => void run()} disabled={busy || !canRun}>
                  {busy ? <Spinner /> : <Icon name="compress" />}
                  {tab === 'convert' ? t('compress.convert') : t('compress.compress')}
                </button>
                {busy ? (
                  <div className="flex min-w-40 flex-1 items-center gap-2">
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-panel2">
                      <div className="h-full w-1/2 animate-pulse rounded-full bg-accent" />
                    </div>
                    <span className="text-[11px] text-muted">{elapsed}s</span>
                  </div>
                ) : null}
                {error ? <span className="text-[12px] text-bad">{error}</span> : null}
              </div>
            </div>
          ) : error ? (
            <div className="text-[12px] text-bad">{error}</div>
          ) : null}

          {result ? (
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-3 text-[13px]">
                <span className="text-muted">{t('compress.before')}</span>
                <span className="mono">{bytes(result.input.size)}</span>
                <Icon name="chevronRight" size={13} className="text-muted" />
                <span className="text-muted">{t('compress.after')}</span>
                <span className="mono text-ink">{bytes(result.output.size)}</span>
                <span className={cn('rounded px-1.5 py-0.5 text-[11px]', result.saved > 0 ? 'bg-ok/15 text-ok' : 'bg-warn/15 text-warn')}>
                  {result.saved > 0 ? '-' + result.percent + '%' : result.saved === 0 ? t('compress.noChange') : '+' + Math.abs(result.percent) + '%'}
                </span>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <FileCard
                  label={t('compress.original')}
                  path={result.input.path}
                  size={result.input.size}
                  download
                  noPreview={involvesPdf}
                />
                <FileCard
                  label={t('compress.result')}
                  path={result.output.path}
                  size={result.output.size}
                  highlight
                  download
                  noPreview={involvesPdf}
                />
              </div>
              {result.note ? <div className="text-[11.5px] text-muted">{result.note}</div> : null}
            </div>
          ) : path && !busy ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <FileCard label={t('compress.original')} path={path} size={0} />
            </div>
          ) : null}

          <div className="text-[11.5px] text-muted">{t('compress.hint')}</div>
        </div>
      </div>
    </div>
  );
}
