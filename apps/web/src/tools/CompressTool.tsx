import { useEffect, useRef, useState } from 'react';
import { Icon, PageHeader, Spinner, cn } from '../components/ui';
import { api, ApiError, qs } from '../lib/api';
import { bytes } from '../lib/format';

type Result = {
  input: { path: string; size: number };
  output: { path: string; size: number };
  saved: number;
  percent: number;
  note?: string;
};
type Job = { id: string; state: 'running' | 'done' | 'error'; result?: Result; error?: string; startedAt: number };

const IMAGE = new Set(['jpg', 'jpeg', 'png', 'webp', 'avif', 'tif', 'tiff']);
const RAW = '/api/fs/raw?path=';
const DROP_DIR = '.super-tool-drop';

export default function CompressTool() {
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
  const [recents, setRecents] = useState<Array<{ path: string; openedAt: number }>>([]);
  const rootRef = useRef('');
  const pollRef = useRef<number | null>(null);

  const ext = (path.split('.').pop() ?? '').toLowerCase();
  const isImage = IMAGE.has(ext);
  const isPdf = ext === 'pdf';
  const convertTargets = isImage
    ? ['pdf', 'png', 'jpg', 'webp']
    : isPdf
      ? caps?.pdfToImage
        ? ['png', 'jpg', 'webp']
        : ['png']
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
      .get<{ paths: Array<{ path: string; openedAt: number }> }>('/recent?kind=file')
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
        if (job.state === 'error') setError(job.error ?? 'Gagal memproses');
        else if (job.result) setResult(job.result);
      } catch (err) {
        if (pollRef.current) window.clearInterval(pollRef.current);
        pollRef.current = null;
        setBusy(false);
        setError(err instanceof ApiError ? err.message : 'Gagal memantau proses');
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
      setError(err instanceof ApiError ? err.message : 'Gagal memproses');
    }
  };

  const handleDrop = async (files: FileList | null) => {
    setDragging(false);
    if (!files || !files.length || !rootRef.current) return;
    setBusy(true);
    setError('');
    try {
      const dir = rootRef.current + '/' + DROP_DIR;
      await api.post('/fs/mkdir', { path: dir }).catch(() => undefined);
      const file = files[0];
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
      setResult(null);
      setBusy(false);
    } catch (err) {
      setBusy(false);
      setError((err as Error).message);
    }
  };

  const canRun = tab === 'compress' ? isImage || isPdf : convertTargets.includes(target);

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Kompresor" subtitle="Kompres & konversi PDF dan gambar, berkas asli tidak diubah">
        <span className="text-[11px] text-muted">
          PDF: {caps?.pdf === 'ghostscript' ? 'ghostscript' : 'pdf-lib'}
          {caps?.pdfToImage ? ' · poppler ada' : ' · poppler tidak ada'}
        </span>
      </PageHeader>

      <div className="flex shrink-0 gap-1 border-b border-line px-3 py-1.5">
        {([
          ['compress', 'Kompres'],
          ['convert', 'Konversi'],
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
              'rounded-md px-2.5 py-1 text-[12px] transition-colors',
              tab === id ? 'bg-accent/15 text-accent' : 'text-muted hover:bg-panel2 hover:text-ink',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="mx-auto flex max-w-3xl flex-col gap-4">
          <div
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              void handleDrop(event.dataTransfer.files);
            }}
            className={cn(
              'flex flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed p-6 text-center transition-colors',
              dragging ? 'border-accent bg-accent/10' : 'border-line',
            )}
          >
            <Icon name="upload" size={20} className="text-muted" />
            <div className="text-[12.5px] text-muted">
              Tarik berkas ke sini (diunggah ke <span className="mono">{DROP_DIR}</span>) atau isi path di bawah
            </div>
          </div>

          <div className="card flex flex-col gap-3 p-4">
            <label className="flex flex-col gap-1">
              <span className="text-[11px] tracking-wide text-muted uppercase">Path berkas</span>
              <input
                value={path}
                onChange={(event) => {
                  setPath(event.target.value);
                  setResult(null);
                }}
                placeholder="/home/user/Documents/laporan.pdf"
                className="input mono"
              />
            </label>

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
                    className="max-w-full truncate rounded border border-line px-2 py-0.5 text-[11px] text-muted hover:border-accent/50 hover:text-ink"
                    title={item.path}
                  >
                    {item.path.split('/').pop()}
                  </button>
                ))}
              </div>
            ) : null}

            <div className="text-[11px] text-muted">
              Jenis: <span className="text-ink">{ext || '-'}</span>
              {isImage ? ' (gambar)' : isPdf ? ' (pdf)' : ' (tidak didukung)'}
            </div>

            {tab === 'compress' && isImage ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] tracking-wide text-muted uppercase">Kualitas ({quality})</span>
                  <input type="range" min={30} max={95} value={quality} onChange={(event) => setQuality(Number(event.target.value))} className="accent-accent" />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] tracking-wide text-muted uppercase">Lebar maksimum (px)</span>
                  <input type="number" min={200} max={8000} value={maxWidth} onChange={(event) => setMaxWidth(Number(event.target.value))} className="input" />
                </label>
                <label className="flex flex-col gap-1 sm:col-span-2">
                  <span className="text-[11px] tracking-wide text-muted uppercase">Format keluaran</span>
                  <select value={format} onChange={(event) => setFormat(event.target.value)} className="input">
                    <option value="">Sama seperti asli</option>
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
                <span className="text-[11px] tracking-wide text-muted uppercase">Tingkat kompresi</span>
                <select value={pdfMode} onChange={(event) => setPdfMode(event.target.value)} className="input">
                  <option value="printer">Standar (kualitas cetak)</option>
                  <option value="max">Kecil (kualitas ebook)</option>
                </select>
              </label>
            ) : null}

            {tab === 'convert' ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] tracking-wide text-muted uppercase">Ubah ke</span>
                  <select value={target} onChange={(event) => setTarget(event.target.value)} className="input">
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
                    <input type="range" min={72} max={300} step={6} value={dpi} onChange={(event) => setDpi(Number(event.target.value))} className="accent-accent" />
                  </label>
                ) : null}
                {!convertTargets.length ? (
                  <div className="text-[11.5px] text-warn sm:col-span-2">Konversi belum tersedia untuk jenis berkas ini.</div>
                ) : null}
              </div>
            ) : null}

            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className="btn btn-primary" onClick={() => void run()} disabled={busy || !canRun || !path.trim()}>
                {busy ? <Spinner /> : <Icon name="compress" />} {tab === 'convert' ? 'Konversi' : 'Kompres'}
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

          {result ? (
            <div className="card flex flex-col gap-3 p-4">
              <div className="flex flex-wrap items-center gap-3 text-[13px]">
                <span className="text-muted">Sebelum</span>
                <span className="mono">{bytes(result.input.size)}</span>
                <Icon name="chevronRight" size={13} className="text-muted" />
                <span className="text-muted">Sesudah</span>
                <span className="mono text-ink">{bytes(result.output.size)}</span>
                <span className={cn('rounded px-1.5 py-0.5 text-[11px]', result.saved > 0 ? 'bg-ok/15 text-ok' : 'bg-warn/15 text-warn')}>
                  {result.saved > 0 ? '-' + result.percent + '%' : '+' + Math.abs(result.percent) + '%'}
                </span>
              </div>
              <div className="mono break-all text-[11.5px] text-muted">{result.output.path}</div>
              {result.note ? <div className="text-[11.5px] text-muted">{result.note}</div> : null}
              <div className="flex gap-2">
                <a className="btn" href={RAW + encodeURIComponent(result.output.path) + '&download=1'} download>
                  <Icon name="download" /> Unduh hasil
                </a>
              </div>
            </div>
          ) : null}

          <div className="text-[11.5px] text-muted">
            Hasil ditulis di folder yang sama dengan akhiran <span className="mono">-min</span> (kompres) atau{' '}
            <span className="mono">-conv</span> (konversi). Proses berjalan di latar belakang, jadi halaman tidak terkunci.
          </div>
        </div>
      </div>
    </div>
  );
}
