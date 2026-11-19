import { useEffect, useRef, useState } from 'react';
import { Badge, Button, Card, Field, Icon, Input, PageHeader, Select, Spinner, Tabs, cn } from '../components/ui';
import { api, ApiError, qs } from '../lib/api';
import { usePaletteIntent } from '../lib/palette';
import { bytes } from '../lib/format';
import { useI18n } from '../lib/i18n';
import { useToast } from '../components/toast';

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
}: {
  label: string;
  path: string;
  size: number;
  highlight?: boolean;
  download?: boolean;
}) {
  const ext = (path.split('.').pop() ?? '').toLowerCase();
  const isImage = IMAGE.has(ext);
  const show = isImage;
  const src = RAW + encodeURIComponent(path) + '&v=' + size;
  return (
    <Card className={cn('flex min-w-0 flex-col gap-2 p-3', highlight && 'border-accent/40 bg-accent/5')}>
      <div className="flex items-center gap-2 text-[12px] tracking-wide text-muted uppercase">
        {label}
        {highlight ? <Badge tone="accent" className="normal-case">baru</Badge> : null}
        <span className="ml-auto text-[12.5px] normal-case">{ext || 'berkas'}</span>
      </div>
      {show ? (
        <a
          href={src}
          target="_blank"
          rel="noreferrer"
          title="Buka ukuran penuh"
          className="block overflow-hidden rounded-md border border-line bg-[#070d14]"
        >
          <img src={src} alt={path} className="h-56 w-full object-contain" loading="lazy" />
        </a>
      ) : (
        <div className="flex h-28 flex-col items-center justify-center gap-1 rounded-md border border-line bg-panel2 text-muted">
          <Icon name={ext === 'pdf' ? 'files' : 'markdown'} size={26} />
          <span className="text-[12px] uppercase">.{ext || 'berkas'}</span>
        </div>
      )}
      <div className="min-w-0">
        <div className="truncate text-[13.5px] text-ink">{path.split('/').pop()}</div>
        {size > 0 ? <div className="mono text-[12px] text-muted">{bytes(size)}</div> : null}
        <div className="mono truncate text-[12.5px] text-muted/70" title={path}>
          {path}
        </div>
      </div>
      {download ? (
        <a className="btn cursor-pointer justify-center" data-action="compress:download" href={RAW + encodeURIComponent(path) + '&download=1'} download>
          <Icon name="download" size={13} /> Unduh
        </a>
      ) : null}
    </Card>
  );
}
const RAW = '/api/fs/raw?path=';
const DROP_DIR = '.super-tool-drop';

export default function CompressTool() {
  const { t } = useI18n();
  const toast = useToast();
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
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
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
  const widthValid = Number.isFinite(maxWidth) && maxWidth >= 200 && maxWidth <= 8000;
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
        if (job.state === 'error') {
          setError(job.error ?? t('err.process'));
          toast(job.error ?? t('err.process'), 'error');
        } else if (job.result) {
          setResult(job.result);
          toast(t('compress.done'), 'ok');
        }
      } catch (err) {
        if (pollRef.current) window.clearInterval(pollRef.current);
        pollRef.current = null;
        setBusy(false);
        setError(err instanceof ApiError ? err.message : t('err.monitor'));
      }
    }, 700);
  };

  // Workflow: terima path dari File Explorer lalu isi kolom sumber.
  usePaletteIntent('compress', (action, payload) => {
    if (action === 'pick' && typeof payload === 'string') {
      setPath(payload);
      setResult(null);
      setError('');
    }
  });

  const run = async () => {
    if (!path.trim()) return;
    if (tab === 'compress' && isImage && !widthValid) {
      setError(t('compress.maxWidthError'));
      return;
    }
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
    setUploadProgress(0);
    setError('');
    setResult(null);
    try {
      const dir = rootRef.current + '/' + DROP_DIR;
      await api.post('/fs/mkdir', { path: dir }).catch(() => undefined);
      const form = new FormData();
      form.append('file', file);
      const data = await new Promise<{ path?: string; message?: string }>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', '/api/fs/upload' + qs({ path: dir }));
        xhr.setRequestHeader('x-st-csrf', '1');
        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable && event.total > 0) {
            setUploadProgress(Math.min(100, Math.round((event.loaded / event.total) * 100)));
          }
        };
        xhr.onload = () => {
          let body: { path?: string; message?: string } = {};
          try {
            body = JSON.parse(xhr.responseText) as { path?: string; message?: string };
          } catch {
            // respons bukan JSON (mis. 413 dari proxy)
          }
          if (xhr.status < 200 || xhr.status >= 300 || !body.path) {
            reject(new Error(body.message ?? 'Upload gagal (HTTP ' + xhr.status + ')'));
            return;
          }
          resolve(body);
        };
        xhr.onerror = () => reject(new Error('Upload gagal: koneksi terputus'));
        xhr.onabort = () => reject(new Error('Upload dibatalkan'));
        xhr.send(form);
      });
      setPath(data.path as string);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
      setUploadProgress(null);
    }
  };

  const canRun = tab === 'compress' ? (isImage ? widthValid : isPdf) : convertTargets.includes(target);

  return (
    <div className="flex h-full flex-col">
      <PageHeader title={t('compress.title')} subtitle={t('compress.subtitle')} icon="compress">
        <span className="text-[12px] text-muted">
          PDF: {caps?.pdf === 'ghostscript' ? 'ghostscript' : 'pdf-lib'}
          {caps && caps.pdf !== 'ghostscript' ? ' · ' + t('compress.gsLarge') : ''}
          {caps?.pdfToImage ? ' · poppler' : ' · poppler tidak ada'}
        </span>
      </PageHeader>

      <Tabs
        value={tab}
        onChange={(next) => {
          setTab(next);
          setResult(null);
          setError('');
        }}
        items={[
          { id: 'compress', label: t('compress.compress'), icon: 'compress' },
          { id: 'convert', label: t('compress.convert'), icon: 'types' },
        ]}
      />

      <div className="min-h-0 flex-1 overflow-y-auto p-4 md:p-5">
        <div className="mx-auto flex max-w-3xl flex-col gap-4">
          <input
            ref={fileRef}
            type="file"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              void upload(file);
            }}
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
              'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-panel border border-dashed bg-panel/[0.14] p-8 text-center transition-colors duration-[var(--duration-fast)] focus-visible:border-accent/60',
              dragging ? 'border-accent bg-accent/10' : 'border-line hover:border-accent/50 hover:bg-panel2/30',
            )}
          >
            <span className="grid size-11 place-items-center rounded-panel border border-line bg-panel2/60 text-muted">
              {busy ? <Spinner /> : <Icon name="upload" size={20} />}
            </span>
            <span className="text-[13.5px] text-muted">
              {uploadProgress !== null
                ? t('compress.uploading') + ' ' + uploadProgress + '%'
                : path
                  ? path.split('/').pop()
                  : t('compress.drop')}
            </span>
            {path ? <span className="mono max-w-full truncate text-[12px] text-muted/70">{path}</span> : null}
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
                  className="max-w-full cursor-pointer truncate rounded-control border border-line bg-panel2/40 px-2 py-1 text-[12px] text-muted transition-colors duration-[var(--duration-fast)] hover:border-accent/50 hover:text-ink focus-visible:border-accent/60 focus-visible:text-ink"
                  title={item.path}
                >
                  {item.path.split('/').pop()}
                </button>
              ))}
            </div>
          ) : null}

          {path ? (
            <Card className="flex flex-col gap-3 p-4">
              <div className="text-[12px] text-muted">
                {ext || '-'}
                {isImage ? ' · gambar' : isPdf ? ' · pdf' : ' · tidak didukung'}
              </div>

              {tab === 'compress' && isImage ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field id="compress-quality" label={t('compress.quality') + ' (' + quality + ')'}>
                    <input
                      id="compress-quality"
                      type="range"
                      min={30}
                      max={95}
                      value={quality}
                      onChange={(event) => setQuality(Number(event.target.value))}
                      className="accent-accent cursor-pointer"
                    />
                  </Field>
                  <Field
                    id="compress-max-width"
                    label={t('compress.maxWidth')}
                    error={!widthValid ? t('compress.maxWidthError') : undefined}
                  >
                    <Input
                      id="compress-max-width"
                      type="number"
                      min={200}
                      max={8000}
                      value={Number.isFinite(maxWidth) ? maxWidth : ''}
                      onChange={(event) => setMaxWidth(event.target.value === '' ? Number.NaN : Number(event.target.value))}
                      invalid={!widthValid}
                      aria-describedby={!widthValid ? 'compress-max-width-error' : undefined}
                    />
                  </Field>
                  <Field id="compress-format" label={t('compress.format')} className="sm:col-span-2">
                    <Select
                      id="compress-format"
                      value={format}
                      onChange={setFormat}
                      label={t('compress.format')}
                      options={[
                        { value: '', label: t('compress.sameAsSource') },
                        { value: 'webp', label: 'WebP' },
                        { value: 'jpg', label: 'JPEG' },
                        { value: 'avif', label: 'AVIF' },
                        { value: 'png', label: 'PNG' },
                      ]}
                    />
                  </Field>
                </div>
              ) : null}

              {tab === 'compress' && isPdf ? (
                <Field id="compress-level" label={t('compress.level')}>
                  <Select
                    id="compress-level"
                    value={pdfMode}
                    onChange={setPdfMode}
                    label={t('compress.level')}
                    options={[
                      { value: 'printer', label: t('compress.standard') },
                      { value: 'max', label: t('compress.small') },
                    ]}
                  />
                </Field>
              ) : null}

              {tab === 'convert' ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field id="compress-target" label={t('compress.to')}>
                    <Select
                      id="compress-target"
                      value={target}
                      onChange={setTarget}
                      placeholder="-"
                      label={t('compress.to')}
                      options={
                        convertTargets.length
                          ? convertTargets.map((item) => ({ value: item, label: item.toUpperCase() }))
                          : [{ value: '', label: '-' }]
                      }
                    />
                  </Field>
                  {isPdf ? (
                    <Field id="compress-dpi" label={'DPI (' + dpi + ')'}>
                      <input
                        id="compress-dpi"
                        type="range"
                        min={72}
                        max={300}
                        step={6}
                        value={dpi}
                        onChange={(event) => setDpi(Number(event.target.value))}
                        className="accent-accent cursor-pointer"
                      />
                    </Field>
                  ) : null}
                  {!convertTargets.length ? (
                    <div className="text-[12.5px] text-warn sm:col-span-2">{t('compress.notSupported')}</div>
                  ) : null}
                </div>
              ) : null}

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="primary"
                  icon="compress"
                  data-action="compress:run"
                  onClick={() => void run()}
                  disabled={!canRun}
                  loading={busy}
                >
                  {tab === 'convert' ? t('compress.convert') : t('compress.compress')}
                </Button>
                {busy ? (
                  <div className="flex min-w-40 flex-1 items-center gap-2">
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-panel2">
                      <div
                        className={cn(
                          'h-full rounded-full bg-accent',
                          uploadProgress === null ? 'w-1/2 animate-pulse' : 'transition-[width] duration-200',
                        )}
                        style={uploadProgress === null ? undefined : { width: uploadProgress + '%' }}
                      />
                    </div>
                    <span className="text-[12px] text-muted">
                      {uploadProgress === null ? elapsed + 's' : uploadProgress + '%'}
                    </span>
                  </div>
                ) : null}
                {error ? <span className="text-[13px] text-bad">{error}</span> : null}
              </div>
            </Card>
          ) : error ? (
            <div role="alert" className="text-[13px] text-bad">{error}</div>
          ) : null}

          {result ? (
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-3 text-[13.5px]">
                <span className="text-muted">{t('compress.before')}</span>
                <span className="mono">{bytes(result.input.size)}</span>
                <Icon name="chevronRight" size={13} className="text-muted" />
                <span className="text-muted">{t('compress.after')}</span>
                <span className="mono text-ink">{bytes(result.output.size)}</span>
                <Badge tone={result.saved > 0 ? 'ok' : 'warn'}>
                  {result.saved > 0 ? '-' + result.percent + '%' : result.saved === 0 ? t('compress.noChange') : '+' + Math.abs(result.percent) + '%'}
                </Badge>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <FileCard
                  label={t('compress.original')}
                  path={result.input.path}
                  size={result.input.size}
                  download
                />
                <FileCard
                  label={t('compress.result')}
                  path={result.output.path}
                  size={result.output.size}
                  highlight
                  download
                />
              </div>
              {result.note ? <div className="text-[12.5px] text-muted">{result.note}</div> : null}
            </div>
          ) : path && !busy ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <FileCard label={t('compress.original')} path={path} size={0} />
            </div>
          ) : null}

          <div className="text-[12.5px] text-muted">{t('compress.hint')}</div>
        </div>
      </div>
    </div>
  );
}
