import { useEffect, useRef, useState } from 'react';
import { Icon, Spinner, cn } from '../../components/ui';
import { api, ApiError, qs } from '../../lib/api';
import { useI18n } from '../../lib/i18n';
import { bytes } from '../../lib/format';

type TailReply = { path: string; size: number; mtime: number; lines: string[] };

const LEVELS = ['FATAL', 'ERROR', 'WARN', 'INFO', 'DEBUG', 'TRACE'] as const;
type Level = (typeof LEVELS)[number] | '';
function levelOf(line: string): Level {
  const match = /\b(fatal|critical|error|warn(?:ing)?|info|debug|trace)\b/i.exec(line);
  if (!match) return '';
  const word = match[1].toLowerCase();
  if (word === 'fatal' || word === 'critical') return 'FATAL';
  if (word === 'warning') return 'WARN';
  return word.toUpperCase() as Level;
}

export default function LogsTab() {
  const { t } = useI18n();
  const [path, setPath] = useState('');
  const [lines, setLines] = useState<string[]>([]);
  const [info, setInfo] = useState<{ size: number; path: string } | null>(null);
  const [live, setLive] = useState(false);
  const [filter, setFilter] = useState('');
  const [level, setLevel] = useState<Level>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [available, setAvailable] = useState<Array<{ path: string; openedAt: number }>>([]);
  const streamRef = useRef<EventSource | null>(null);
  const boxRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    api
      .get<{ paths: Array<{ path: string; openedAt: number }> }>('/recent?kind=file')
      .then((data) => setAvailable(data.paths.slice(0, 8)))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (boxRef.current) boxRef.current.scrollTop = boxRef.current.scrollHeight;
  }, [lines, live]);

  useEffect(() => {
    return () => {
      streamRef.current?.close();
      streamRef.current = null;
    };
  }, []);

  const stopLive = () => {
    streamRef.current?.close();
    streamRef.current = null;
    setLive(false);
  };

  const load = async (target: string) => {
    if (!target.trim()) return;
    setBusy(true);
    setError('');
    try {
      const result = await api.get<TailReply>('/dev/logs' + qs({ path: target, lines: 400 }));
      setLines(result.lines);
      setInfo({ size: result.size, path: result.path });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('err.log'));
    } finally {
      setBusy(false);
    }
  };

  const startLive = async () => {
    const target = path.trim();
    if (!target) return;
    streamRef.current?.close();
    setBusy(true);
    setError('');
    // Cek dulu lewat endpoint biasa: EventSource tidak bisa membaca pesan error server.
    try {
      const result = await api.get<TailReply>('/dev/logs' + qs({ path: target, lines: 400 }));
      setLines(result.lines);
      setInfo({ size: result.size, path: result.path });
    } catch (err) {
      setBusy(false);
      setError(err instanceof ApiError ? err.message : t('err.log'));
      return;
    }
    setBusy(false);
    const source = new EventSource('/api/dev/logs/stream' + qs({ path: target }));
    streamRef.current = source;
    setLive(true);
    source.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data) as { line?: string; reset?: boolean };
        if (payload.reset) {
          setLines(['--- berkas diputar ulang ---']);
          return;
        }
        if (typeof payload.line === 'string') {
          setLines((current) => (current.length > 4000 ? [...current.slice(-3000), payload.line!] : [...current, payload.line!]));
        }
      } catch {
        // abaikan baris rusak
      }
    };
    source.onerror = () => {
      // EventSource menyambung ulang sendiri; beri tahu sekali saja.
      if (source.readyState === EventSource.CLOSED) {
        setError('Live berhenti: server menutup stream');
        stopLive();
      } else {
        setError('Stream terputus, mencoba menyambung ulang');
      }
    };
  };

  const counts = LEVELS.map((item) => ({ item, n: lines.filter((line) => levelOf(line) === item).length }));
  const needle = filter.trim().toLowerCase();
  const shown = lines.filter((line) => {
    if (level && levelOf(line) !== level) return false;
    return !needle || line.toLowerCase().includes(needle);
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-4 md:p-5">
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={path}
          onChange={(event) => setPath(event.target.value)}
          onKeyDown={(event) => event.key === 'Enter' && void load(path)}
          placeholder="/var/log/nginx/error.log"
          className="input mono flex-1 py-1.5"
          spellCheck={false}
        />
        <button type="button" className="btn" onClick={() => void load(path)} disabled={busy}>
          {busy ? <Spinner /> : <Icon name="refresh" />} {t('common.reload')}
        </button>
        <button
          type="button"
          className={cn('btn cursor-pointer', live && 'btn-primary')}
          onClick={() => (live ? stopLive() : void startLive())}
          disabled={!path.trim()}
        >
          <Icon name={live ? 'x' : 'play'} /> {live ? 'Stop' : 'Live'}
        </button>
      </div>

      <div className="flex flex-wrap gap-1">
        {['/var/log/nginx/error.log', '/var/log/nginx/access.log', '/var/log/syslog'].map((preset) => (
          <button
            key={preset}
            type="button"
            onClick={() => {
              setPath(preset);
              void load(preset);
            }}
            className="max-w-full cursor-pointer truncate rounded border border-line px-2 py-0.5 text-[11px] text-muted hover:border-accent/50 hover:text-ink"
            title={preset}
          >
            {preset.replace('/var/log/', '')}
          </button>
        ))}
      </div>

      {available.length ? (
        <div className="flex flex-wrap gap-1">
          {available.map((item) => (
            <button
              key={item.path}
              type="button"
              onClick={() => { setPath(item.path); void load(item.path); }}
              className="max-w-full cursor-pointer truncate rounded border border-line px-2 py-0.5 text-[11px] text-muted hover:border-accent/50 hover:text-ink"
              title={item.path}
            >
              {item.path.split('/').pop()}
            </button>
          ))}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2 text-[11.5px] text-muted">
        <input
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder={t('logs.searchHint')}
          className="input mono w-56 py-1"
        />
        <select value={level} onChange={(event) => setLevel(event.target.value as Level)} className="input w-32 py-1 text-[11.5px]" aria-label={t('logs.level')}>
          <option value="">{t('logs.allLevels')} ({lines.length})</option>
          {counts.map((entry) => <option key={entry.item} value={entry.item}>{entry.item} ({entry.n})</option>)}
        </select>
        <span>{shown.length} {t('logs.rows')}</span>
        {info ? <span>· {bytes(info.size)} · {info.path}</span> : null}
        {live ? <span className="text-ok">● live</span> : null}
        {error ? <span className="text-bad">{error}</span> : null}
      </div>

      <pre
        ref={boxRef}
        className="mono min-h-0 flex-1 overflow-auto rounded-lg border border-line bg-[#070d14] p-3 text-[12px] leading-relaxed whitespace-pre-wrap"
      >
        {shown.length ? shown.join(String.fromCharCode(10)) : t('logs.emptyFiltered')}
      </pre>
    </div>
  );
}
