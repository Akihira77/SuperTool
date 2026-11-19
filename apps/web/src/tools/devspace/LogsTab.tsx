import { useEffect, useRef, useState } from 'react';
import { Badge, Button, CopyButton, Input, Select } from '../../components/ui';
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
  const aliveRef = useRef(true);
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
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
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
    if (!aliveRef.current) return;
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
  const levelOptions = [
    { value: '', label: t('logs.allLevels') + ' (' + lines.length + ')' },
    ...counts.map((entry) => ({ value: entry.item, label: entry.item + ' (' + entry.n + ')' })),
  ];
  const needle = filter.trim().toLowerCase();
  const shown = lines.filter((line) => {
    if (level && levelOf(line) !== level) return false;
    return !needle || line.toLowerCase().includes(needle);
  });
  const visibleText = shown.length ? shown.join(String.fromCharCode(10)) : t('logs.emptyFiltered');

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-4 md:p-5">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={path}
          onChange={(event) => setPath(event.target.value)}
          onKeyDown={(event) => event.key === 'Enter' && void load(path)}
          placeholder="/var/log/nginx/error.log"
          aria-label="Berkas log"
          className="mono min-w-0 flex-1 py-1.5"
          spellCheck={false}
        />
        <Button icon="refresh" loading={busy} onClick={() => void load(path)} disabled={busy}>
          {t('common.reload')}
        </Button>
        <Button
          variant={live ? 'primary' : 'default'}
          icon={live ? 'x' : 'play'}
          aria-pressed={live}
          onClick={() => (live ? stopLive() : void startLive())}
          disabled={!path.trim()}
        >
          {live ? 'Stop' : 'Live'}
        </Button>
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
            className="max-w-full cursor-pointer truncate rounded border border-line px-2 py-0.5 text-[12px] text-muted transition-colors hover:border-accent/50 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus"
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
              className="max-w-full cursor-pointer truncate rounded border border-line px-2 py-0.5 text-[12px] text-muted transition-colors hover:border-accent/50 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus"
              title={item.path}
            >
              {item.path.split('/').pop()}
            </button>
          ))}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-muted">
        <Input
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder={t('logs.searchHint')}
          aria-label={t('logs.searchHint')}
          className="mono w-56 py-1"
        />
        <Select value={level} onChange={(next) => setLevel(next as Level)} options={levelOptions} size="sm" label={t('logs.level')} className="w-40" />
        <span className="tabular-nums">{shown.length} {t('logs.rows')}</span>
        {info ? <span className="tabular-nums">· {bytes(info.size)} · {info.path}</span> : null}
        {live ? <Badge tone="ok">● live</Badge> : null}
        {error ? <span className="text-bad">{error}</span> : null}
        {shown.length ? <CopyButton text={visibleText} size="sm" /> : null}
      </div>

      <pre
        ref={boxRef}
        className="mono min-h-0 flex-1 overflow-auto rounded-lg border border-line bg-[#070d14] p-3 text-[13px] leading-relaxed whitespace-pre-wrap"
      >
        {visibleText}
      </pre>
    </div>
  );
}
