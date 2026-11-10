import { useEffect, useState } from 'react';
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
type Saved = { id: string; name: string; collectionId: string | null; method: string; url: string; headers: Row[]; body: string; updatedAt: number };
type Collection = { id: string; name: string; count: number };
type Env = { id: string; name: string; variables: Row[] };
type History = { id: number; ts: number; method: string; url: string; status: number | null; durationMs: number; size: number; error: string | null };

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'];
const ENV_KEY = 'st:http:env';

function fillVars(value: string, env: Env | null): string {
  if (!env) return value;
  return value.replace(/\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g, (match, key: string) => {
    const found = env.variables.find((item) => item.key === key);
    return found ? found.value : match;
  });
}

function timeAgo(ts: number): string {
  const diff = Math.max(0, Date.now() - ts);
  if (diff < 60_000) return Math.round(diff / 1000) + 's';
  if (diff < 3_600_000) return Math.round(diff / 60_000) + 'm';
  return Math.round(diff / 3_600_000) + 'j';
}

export default function HttpTab() {
  const [method, setMethod] = useState('GET');
  const [url, setUrl] = useState('http://127.0.0.1:3001/api/health');
  const [headers, setHeaders] = useState<Row[]>([{ key: 'Accept', value: 'application/json' }]);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [reply, setReply] = useState<Reply | null>(null);

  const [saved, setSaved] = useState<Saved[]>([]);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [envs, setEnvs] = useState<Env[]>([]);
  const [history, setHistory] = useState<History[]>([]);
  const [savedQuery, setSavedQuery] = useState('');
  const [saveName, setSaveName] = useState('');
  const [activeSaved, setActiveSaved] = useState('');
  const [collectionId, setCollectionId] = useState('');
  const [newCollection, setNewCollection] = useState('');
  const [envId, setEnvId] = useState(() => localStorage.getItem(ENV_KEY) ?? '');
  const [envDraft, setEnvDraft] = useState<Env | null>(null);

  const activeEnv = envs.find((item) => item.id === envId) ?? null;

  const refresh = async () => {
    try {
      const [nextSaved, nextCollections, nextEnvs, nextHistory] = await Promise.all([
        api.get<Saved[]>('/dev/http/saved'),
        api.get<Collection[]>('/dev/http/collections'),
        api.get<Env[]>('/dev/http/environments'),
        api.get<History[]>('/dev/http/history?limit=20'),
      ]);
      setSaved(nextSaved);
      setCollections(nextCollections);
      setEnvs(nextEnvs);
      setHistory(nextHistory);
      if (envId && !nextEnvs.some((item) => item.id === envId)) {
        setEnvId('');
        localStorage.removeItem(ENV_KEY);
      }
    } catch {
      /* daftar opsional; error request tetap terlihat saat mengirim */
    }
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const send = async () => {
    setBusy(true);
    setError('');
    try {
      const result = await api.post<Reply>('/dev/http', {
        method,
        url: fillVars(url, activeEnv),
        headers: headers.filter((row) => row.key.trim()).map((row) => ({ key: row.key, value: fillVars(row.value, activeEnv) })),
        body: fillVars(body, activeEnv),
      });
      setReply(result);
      void refresh();
    } catch (err) {
      setReply(null);
      setError(err instanceof ApiError ? err.message : 'Request gagal');
    } finally {
      setBusy(false);
    }
  };

  const loadSaved = (item: Saved) => {
    setMethod(item.method);
    setUrl(item.url);
    setHeaders(item.headers.length ? item.headers : [{ key: '', value: '' }]);
    setBody(item.body);
    setSaveName(item.name);
    setCollectionId(item.collectionId ?? '');
    setActiveSaved(item.id);
    setReply(null);
    setError('');
  };

  const saveRequest = async () => {
    try {
      const savedItem = await api.post<Saved>('/dev/http/saved', {
        id: activeSaved || undefined,
        collectionId: collectionId || undefined,
        name: saveName || method + ' ' + url,
        method,
        url,
        headers,
        body,
      });
      setActiveSaved(savedItem.id);
      setSaveName(savedItem.name);
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Gagal menyimpan request');
    }
  };

  const removeSaved = async (item: Saved) => {
    await api.del('/dev/http/saved/' + encodeURIComponent(item.id)).catch(() => undefined);
    if (activeSaved === item.id) setActiveSaved('');
    await refresh();
  };

  const addCollection = async () => {
    if (!newCollection.trim()) return;
    try {
      const created = await api.post<Collection>('/dev/http/collections', { name: newCollection.trim() });
      setNewCollection('');
      setCollectionId(created.id);
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Gagal membuat koleksi');
    }
  };

  const saveEnv = async () => {
    if (!envDraft || !envDraft.name.trim()) return;
    try {
      const savedEnv = await api.post<Env>('/dev/http/environments', {
        id: envDraft.id || undefined,
        name: envDraft.name,
        variables: envDraft.variables,
      });
      setEnvDraft(null);
      setEnvId(savedEnv.id);
      localStorage.setItem(ENV_KEY, savedEnv.id);
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Gagal menyimpan environment');
    }
  };

  const removeEnv = async (id: string) => {
    await api.del('/dev/http/environments/' + encodeURIComponent(id)).catch(() => undefined);
    if (envId === id) {
      setEnvId('');
      localStorage.removeItem(ENV_KEY);
    }
    setEnvDraft(null);
    await refresh();
  };

  const shownSaved = saved.filter((item) => {
    const term = savedQuery.trim().toLowerCase();
    return !term || item.name.toLowerCase().includes(term) || item.url.toLowerCase().includes(term);
  });

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
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden md:flex-row">
      <aside className="flex w-full shrink-0 flex-col gap-2 overflow-y-auto border-b border-line p-3 md:w-64 md:border-r md:border-b-0">
        <div className="flex items-center gap-2">
          <span className="text-[11px] tracking-wide text-muted uppercase">Koleksi</span>
          <button type="button" className="btn ml-auto px-1.5 py-0.5" title="Koleksi baru" onClick={() => setNewCollection((value) => (value ? '' : ' '))}>
            <Icon name="plus" size={13} />
          </button>
        </div>
        {newCollection ? (
          <div className="flex items-center gap-1">
            <input
              autoFocus
              value={newCollection.trimStart()}
              onChange={(event) => setNewCollection(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void addCollection();
                if (event.key === 'Escape') setNewCollection('');
              }}
              placeholder="Nama koleksi"
              className="input py-1 text-[11.5px]"
            />
            <button type="button" className="btn px-1.5 py-1" onClick={() => void addCollection()}>
              <Icon name="check" size={13} />
            </button>
          </div>
        ) : null}
        <div className="flex flex-col gap-0.5">
          {collections.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setCollectionId(collectionId === item.id ? '' : item.id)}
              className={cn(
                'flex items-center gap-1 rounded px-1.5 py-1 text-left text-[11.5px]',
                collectionId === item.id ? 'bg-accent/12 text-accent' : 'text-muted hover:bg-panel2',
              )}
            >
              <Icon name="folder" size={12} />
              <span className="truncate">{item.name}</span>
              <span className="ml-auto text-[10px] text-muted/60">{item.count}</span>
            </button>
          ))}
          {!collections.length ? <span className="px-1 text-[11px] text-muted/70">Belum ada koleksi</span> : null}
        </div>

        <div className="mt-1 flex items-center gap-2 border-t border-line pt-2">
          <span className="text-[11px] tracking-wide text-muted uppercase">Tersimpan</span>
          <span className="ml-auto text-[10px] text-muted/60">{saved.length}</span>
        </div>
        <input value={savedQuery} onChange={(event) => setSavedQuery(event.target.value)} placeholder="Cari request" className="input py-1 text-[11.5px]" />
        <div className="flex flex-col gap-0.5">
          {shownSaved.map((item) => (
            <div key={item.id} className={cn('group flex items-center gap-1 rounded px-1.5 py-1', activeSaved === item.id ? 'bg-accent/12' : 'hover:bg-panel2')}>
              <button type="button" onClick={() => loadSaved(item)} className="min-w-0 flex-1 text-left" title={item.url}>
                <div className="flex items-center gap-1 text-[11.5px]">
                  <span className="text-accent/80">{item.method}</span>
                  <span className="truncate text-ink/85">{item.name}</span>
                </div>
                <div className="mono truncate text-[10px] text-muted/65">{item.url}</div>
              </button>
              <button type="button" className="btn btn-ghost px-1 py-0.5 opacity-0 group-hover:opacity-100" title="Hapus" onClick={() => void removeSaved(item)}>
                <Icon name="x" size={12} />
              </button>
            </div>
          ))}
          {!shownSaved.length ? <span className="px-1 text-[11px] text-muted/70">Belum ada request tersimpan</span> : null}
        </div>

        <div className="mt-1 flex items-center gap-2 border-t border-line pt-2">
          <span className="text-[11px] tracking-wide text-muted uppercase">Environment</span>
          <button type="button" className="btn ml-auto px-1.5 py-0.5" title="Environment baru" onClick={() => setEnvDraft({ id: '', name: '', variables: [{ key: '', value: '' }] })}>
            <Icon name="plus" size={13} />
          </button>
        </div>
        <select
          value={envId}
          onChange={(event) => {
            setEnvId(event.target.value);
            if (event.target.value) localStorage.setItem(ENV_KEY, event.target.value);
            else localStorage.removeItem(ENV_KEY);
          }}
          className="input py-1 text-[11.5px]"
        >
          <option value="">Tanpa environment</option>
          {envs.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
        {activeEnv ? (
          <button type="button" className="btn justify-center px-2 py-1 text-[11px]" onClick={() => setEnvDraft(activeEnv)}>
            Edit environment aktif
          </button>
        ) : null}

        <div className="mt-1 flex items-center gap-2 border-t border-line pt-2">
          <span className="text-[11px] tracking-wide text-muted uppercase">Riwayat</span>
          <button
            type="button"
            className="ml-auto text-[10.5px] text-muted hover:text-ink"
            onClick={() => void api.del('/dev/http/history').then(refresh).catch(() => undefined)}
          >
            Bersihkan
          </button>
        </div>
        <div className="flex flex-col gap-0.5">
          {history.slice(0, 8).map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                setMethod(item.method);
                setUrl(item.url);
                setError('');
              }}
              className="flex items-center gap-1 rounded px-1 py-0.5 text-left text-[10.5px] hover:bg-panel2"
              title={item.url}
            >
              <span className={item.error || (item.status ?? 0) >= 400 ? 'text-bad' : 'text-ok'}>{item.status ?? 'ERR'}</span>
              <span className="text-muted">{item.method}</span>
              <span className="mono truncate text-muted/75">{item.url}</span>
              <span className="ml-auto shrink-0 text-muted/50">{timeAgo(item.ts)}</span>
            </button>
          ))}
          {!history.length ? <span className="px-1 text-[11px] text-muted/70">Belum ada riwayat</span> : null}
        </div>
      </aside>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-auto p-4 md:p-5">
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
            placeholder="http://127.0.0.1:3001/api/... atau {{baseUrl}}/api"
            className="input mono flex-1 py-1.5"
            spellCheck={false}
          />
          <button type="button" className="btn btn-primary" onClick={() => void send()} disabled={busy || !url.trim()}>
            {busy ? <Spinner /> : <Icon name="play" />} Kirim
          </button>
        </div>

        <div className="card flex flex-wrap items-center gap-2 p-2.5">
          <input value={saveName} onChange={(event) => setSaveName(event.target.value)} placeholder="Nama request" className="input min-w-32 flex-1 py-1 text-[11.5px]" />
          <select value={collectionId} onChange={(event) => setCollectionId(event.target.value)} className="input w-auto py-1 text-[11.5px]">
            <option value="">Tanpa koleksi</option>
            {collections.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
          <button type="button" className="btn px-2 py-1 text-[11px]" onClick={() => void saveRequest()} disabled={!url.trim()} title="Simpan ke SQLite">
            <Icon name="save" size={12} /> {activeSaved ? 'Perbarui' : 'Simpan'}
          </button>
          <span className="text-[10.5px] text-muted/70">Authorization/Cookie tidak disimpan</span>
        </div>

        {envDraft ? (
          <div className="card flex flex-col gap-2 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={envDraft.name}
                onChange={(event) => setEnvDraft({ ...envDraft, name: event.target.value })}
                placeholder="Nama environment"
                className="input min-w-40 flex-1 py-1 text-[12px]"
              />
              <button type="button" className="btn px-2 py-1 text-[11.5px]" onClick={() => void saveEnv()}>
                <Icon name="save" size={12} /> Simpan
              </button>
              {envDraft.id ? (
                <button type="button" className="btn btn-danger px-2 py-1 text-[11.5px]" onClick={() => void removeEnv(envDraft.id)}>
                  <Icon name="trash" size={12} /> Hapus
                </button>
              ) : null}
              <button type="button" className="btn px-2 py-1 text-[11.5px]" onClick={() => setEnvDraft(null)}>
                Batal
              </button>
            </div>
            {envDraft.variables.map((row, index) => (
              <div key={index} className="flex items-center gap-2">
                <input
                  value={row.key}
                  onChange={(event) =>
                    setEnvDraft({ ...envDraft, variables: envDraft.variables.map((item, at) => (at === index ? { ...item, key: event.target.value } : item)) })
                  }
                  placeholder="nama"
                  className="input mono w-44 py-1"
                />
                <input
                  value={row.value}
                  onChange={(event) =>
                    setEnvDraft({ ...envDraft, variables: envDraft.variables.map((item, at) => (at === index ? { ...item, value: event.target.value } : item)) })
                  }
                  placeholder="nilai"
                  className="input mono flex-1 py-1"
                />
                <button
                  type="button"
                  className="btn btn-ghost px-1.5 py-1"
                  onClick={() => setEnvDraft({ ...envDraft, variables: envDraft.variables.filter((_, at) => at !== index) })}
                >
                  <Icon name="x" size={13} />
                </button>
              </div>
            ))}
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="btn px-1.5 py-0.5"
                onClick={() => setEnvDraft({ ...envDraft, variables: [...envDraft.variables, { key: '', value: '' }] })}
              >
                <Icon name="plus" size={13} /> Variabel
              </button>
              <span className="text-[10.5px] text-muted/70">Dipakai lewat {'{{nama}}'} di URL, header, atau body. Variabel disimpan lokal.</span>
            </div>
          </div>
        ) : null}

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
    </div>
  );
}
