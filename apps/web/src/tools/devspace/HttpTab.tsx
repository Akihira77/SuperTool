import { useState } from 'react';
import { CopyButton, Icon, Spinner, cn } from '../../components/ui';
import { api, ApiError } from '../../lib/api';
import { bytes } from '../../lib/format';

type Row = { key: string; value: string };
type Reply = {
  status: number;
  statusText: string;
  ms: number;
  size: number;
  headers: Record<string, string>;
  body: string;
  truncated: boolean;
  url: string;
};

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'];

export default function HttpTab() {
  const [method, setMethod] = useState('GET');
  const [url, setUrl] = useState('http://127.0.0.1:3001/api/health');
  const [headers, setHeaders] = useState<Row[]>([{ key: 'Accept', value: 'application/json' }]);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [reply, setReply] = useState<Reply | null>(null);

  const send = async () => {
    setBusy(true);
    setError('');
    try {
      const result = await api.post<Reply>('/dev/http', {
        method,
        url,
        headers: headers.filter((row) => row.key.trim()),
        body,
      });
      setReply(result);
    } catch (err) {
      setReply(null);
      setError(err instanceof ApiError ? err.message : 'Request gagal');
    } finally {
      setBusy(false);
    }
  };

  const pretty = (() => {
    if (!reply) return '';
    if (!(reply.headers['content-type'] ?? '').includes('json')) return reply.body;
    try {
      return JSON.stringify(JSON.parse(reply.body), null, 2);
    } catch {
      return reply.body;
    }
  })();

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-4">
      <div className="flex flex-wrap items-center gap-2">
        <select value={method} onChange={(event) => setMethod(event.target.value)} className="input w-auto py-1.5">
          {METHODS.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
        <input
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          onKeyDown={(event) => event.key === 'Enter' && void send()}
          placeholder="http://127.0.0.1:3000/api/..."
          className="input mono flex-1 py-1.5"
          spellCheck={false}
        />
        <button type="button" className="btn btn-primary" onClick={() => void send()} disabled={busy || !url.trim()}>
          {busy ? <Spinner /> : <Icon name="play" />} Kirim
        </button>
      </div>

      <div className="card flex flex-col gap-2 p-3">
        <div className="flex items-center gap-2">
          <span className="text-[11px] tracking-wide text-muted uppercase">Header</span>
          <button type="button" className="btn px-1.5 py-0.5" onClick={() => setHeaders([...headers, { key: '', value: '' }])}>
            <Icon name="plus" size={13} />
          </button>
        </div>
        {headers.map((row, index) => (
          <div key={index} className="flex items-center gap-2">
            <input
              value={row.key}
              onChange={(event) => setHeaders(headers.map((item, at) => (at === index ? { ...item, key: event.target.value } : item)))}
              placeholder="Nama"
              className="input mono w-48 py-1"
              spellCheck={false}
            />
            <input
              value={row.value}
              onChange={(event) => setHeaders(headers.map((item, at) => (at === index ? { ...item, value: event.target.value } : item)))}
              placeholder="Nilai"
              className="input mono flex-1 py-1"
              spellCheck={false}
            />
            <button type="button" className="btn btn-ghost px-1.5 py-1" onClick={() => setHeaders(headers.filter((_, at) => at !== index))}>
              <Icon name="x" size={13} />
            </button>
          </div>
        ))}
      </div>

      {!['GET', 'HEAD'].includes(method) ? (
        <label className="flex flex-col gap-1">
          <span className="text-[11px] tracking-wide text-muted uppercase">Body</span>
          <textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            spellCheck={false}
            className="input mono min-h-[120px] resize-y"
            placeholder='{"hello": "world"}'
          />
        </label>
      ) : null}

      {error ? <div className="text-[12px] text-bad">{error}</div> : null}

      {reply ? (
        <div className="flex min-h-0 flex-col gap-2">
          <div className="flex flex-wrap items-center gap-3 text-[12.5px]">
            <span className={cn('rounded px-1.5 py-0.5 font-medium', reply.status < 400 ? 'bg-ok/15 text-ok' : 'bg-bad/15 text-bad')}>
              {reply.status} {reply.statusText}
            </span>
            <span className="text-muted">{reply.ms} ms</span>
            <span className="text-muted">{bytes(reply.size)}</span>
            <span className="mono truncate text-muted">{reply.url}</span>
            <CopyButton text={reply.body} label="Salin body" />
          </div>

          <details className="card px-3 py-2">
            <summary className="cursor-pointer text-[12px] text-muted">Header respons ({Object.keys(reply.headers).length})</summary>
            <div className="mt-2 flex flex-col gap-0.5">
              {Object.entries(reply.headers).map(([key, value]) => (
                <div key={key} className="mono flex gap-2 text-[11.5px]">
                  <span className="text-accent/80">{key}:</span>
                  <span className="break-all text-ink/85">{value}</span>
                </div>
              ))}
            </div>
          </details>

          <pre className="input mono min-h-[200px] flex-1 overflow-auto whitespace-pre-wrap text-[12.5px]">{pretty}</pre>
          {reply.truncated ? <div className="text-[11px] text-warn">Body dipotong 1 MB</div> : null}
        </div>
      ) : null}
    </div>
  );
}
