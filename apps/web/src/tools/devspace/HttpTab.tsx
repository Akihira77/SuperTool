import { useEffect, useState } from 'react';
import { Badge, Button, Card, CopyButton, Field, Icon, IconButton, Input, Select, Textarea, cn } from '../../components/ui';
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
const METHOD_OPTIONS = METHODS.map((item) => ({ value: item, label: item }));
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
          <span className="field-label">Koleksi</span>
          <IconButton
            className="ml-auto"
            icon="plus"
            label="Koleksi baru"
            size="sm"
            onClick={() => setNewCollection((value) => (value ? '' : ' '))}
          />
        </div>
        {newCollection ? (
          <div className="flex items-center gap-1">
            <Input
              autoFocus
              value={newCollection.trimStart()}
              onChange={(event) => setNewCollection(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void addCollection();
                if (event.key === 'Escape') setNewCollection('');
              }}
              placeholder="Nama koleksi"
              aria-label="Nama koleksi"
              className="py-1 text-[12.5px]"
            />
            <IconButton icon="check" label="Simpan koleksi" size="sm" onClick={() => void addCollection()} />
          </div>
        ) : null}
        <div className="flex flex-col gap-0.5">
          {collections.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={collectionId === item.id}
              onClick={() => setCollectionId(collectionId === item.id ? '' : item.id)}
              className={cn(
                'flex items-center gap-1 rounded px-1.5 py-1 text-left text-[12.5px] transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus',
                collectionId === item.id ? 'bg-accent/12 text-accent' : 'text-muted hover:bg-panel2',
              )}
            >
              <Icon name="folder" size={12} />
              <span className="truncate">{item.name}</span>
              <span className="ml-auto tabular-nums text-[12.5px] text-muted/60">{item.count}</span>
            </button>
          ))}
          {!collections.length ? <span className="px-1 text-[12px] text-muted/70">Belum ada koleksi</span> : null}
        </div>

        <div className="mt-1 flex items-center gap-2 border-t border-line pt-2">
          <span className="field-label">Tersimpan</span>
          <span className="ml-auto tabular-nums text-[12.5px] text-muted/60">{saved.length}</span>
        </div>
        <Input value={savedQuery} onChange={(event) => setSavedQuery(event.target.value)} placeholder="Cari request" aria-label="Cari request" className="py-1 text-[12.5px]" />
        <div className="flex flex-col gap-0.5">
          {shownSaved.map((item) => (
            <div key={item.id} className={cn('group flex items-center gap-1 rounded px-1.5 py-1 transition-colors', activeSaved === item.id ? 'bg-accent/12' : 'hover:bg-panel2')}>
              <button type="button" onClick={() => loadSaved(item)} className="min-w-0 flex-1 rounded text-left focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus" title={item.url}>
                <div className="flex items-center gap-1 text-[12.5px]">
                  <span className="text-accent/80">{item.method}</span>
                  <span className="truncate text-ink/85">{item.name}</span>
                </div>
                <div className="mono truncate text-[12.5px] text-muted/65">{item.url}</div>
              </button>
              <IconButton
                icon="x"
                label="Hapus"
                tone="danger"
                size="sm"
                className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                onClick={() => void removeSaved(item)}
              />
            </div>
          ))}
          {!shownSaved.length ? <span className="px-1 text-[12px] text-muted/70">Belum ada request tersimpan</span> : null}
        </div>

        <div className="mt-1 flex items-center gap-2 border-t border-line pt-2">
          <span className="field-label">Environment</span>
          <IconButton
            className="ml-auto"
            icon="plus"
            label="Environment baru"
            size="sm"
            onClick={() => setEnvDraft({ id: '', name: '', variables: [{ key: '', value: '' }] })}
          />
        </div>
        <Select
          value={envId}
          onChange={(next) => {
            setEnvId(next);
            if (next) localStorage.setItem(ENV_KEY, next);
            else localStorage.removeItem(ENV_KEY);
          }}
          options={[{ value: '', label: 'Tanpa environment' }, ...envs.map((item) => ({ value: item.id, label: item.name }))]}
          size="sm"
          label="Environment"
        />
        {activeEnv ? (
          <Button size="sm" className="justify-center text-[12px]" onClick={() => setEnvDraft(activeEnv)}>
            Edit environment aktif
          </Button>
        ) : null}

        <div className="mt-1 flex items-center gap-2 border-t border-line pt-2">
          <span className="field-label">Riwayat</span>
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto text-[12.5px]"
            onClick={() => void api.del('/dev/http/history').then(refresh).catch(() => undefined)}
          >
            Bersihkan
          </Button>
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
              className="flex items-center gap-1 rounded px-1 py-0.5 text-left text-[12.5px] transition-colors hover:bg-panel2 focus-visible:bg-panel2 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus"
              title={item.url}
            >
              <span className={cn('tabular-nums', item.error || (item.status ?? 0) >= 400 ? 'text-bad' : 'text-ok')}>{item.status ?? 'ERR'}</span>
              <span className="text-muted">{item.method}</span>
              <span className="mono truncate text-muted/75">{item.url}</span>
              <span className="ml-auto shrink-0 tabular-nums text-muted/50">{timeAgo(item.ts)}</span>
            </button>
          ))}
          {!history.length ? <span className="px-1 text-[12px] text-muted/70">Belum ada riwayat</span> : null}
        </div>
      </aside>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-auto p-4 md:p-5">
        <div className="flex flex-wrap items-center gap-2">
          <Select value={method} onChange={setMethod} options={METHOD_OPTIONS} size="sm" label="Metode" className="w-28" />
          <Input
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            onKeyDown={(event) => event.key === 'Enter' && void send()}
            placeholder="http://127.0.0.1:3001/api/... atau {{baseUrl}}/api"
            aria-label="URL request"
            className="mono min-w-0 flex-1 py-1.5"
            spellCheck={false}
          />
          <Button variant="primary" icon="play" loading={busy} onClick={() => void send()} disabled={busy || !url.trim()}>
            Kirim
          </Button>
        </div>

        <Card className="flex flex-wrap items-center gap-2 p-2.5">
          <Input value={saveName} onChange={(event) => setSaveName(event.target.value)} placeholder="Nama request" aria-label="Nama request" className="min-w-32 flex-1 py-1 text-[12.5px]" />
          <Select
            value={collectionId}
            onChange={setCollectionId}
            options={[{ value: '', label: 'Tanpa koleksi' }, ...collections.map((item) => ({ value: item.id, label: item.name }))]}
            size="sm"
            label="Koleksi"
            className="w-44"
          />
          <Button icon="save" size="sm" onClick={() => void saveRequest()} disabled={!url.trim()} title="Simpan ke SQLite">
            {activeSaved ? 'Perbarui' : 'Simpan'}
          </Button>
          <span className="text-[12.5px] text-muted/70">Authorization/Cookie tidak disimpan</span>
        </Card>

        {envDraft ? (
          <Card className="flex flex-col gap-2 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <Input
                value={envDraft.name}
                onChange={(event) => setEnvDraft({ ...envDraft, name: event.target.value })}
                placeholder="Nama environment"
                aria-label="Nama environment"
                className="min-w-40 flex-1 py-1 text-[13px]"
              />
              <Button icon="save" size="sm" onClick={() => void saveEnv()}>
                Simpan
              </Button>
              {envDraft.id ? (
                <Button variant="danger" icon="trash" size="sm" onClick={() => void removeEnv(envDraft.id)}>
                  Hapus
                </Button>
              ) : null}
              <Button variant="ghost" size="sm" onClick={() => setEnvDraft(null)}>
                Batal
              </Button>
            </div>
            {envDraft.variables.map((row, index) => (
              <div key={index} className="flex items-center gap-2">
                <Input
                  value={row.key}
                  onChange={(event) =>
                    setEnvDraft({ ...envDraft, variables: envDraft.variables.map((item, at) => (at === index ? { ...item, key: event.target.value } : item)) })
                  }
                  placeholder="nama"
                  aria-label="Nama variabel"
                  className="mono w-44 py-1"
                />
                <Input
                  value={row.value}
                  onChange={(event) =>
                    setEnvDraft({ ...envDraft, variables: envDraft.variables.map((item, at) => (at === index ? { ...item, value: event.target.value } : item)) })
                  }
                  placeholder="nilai"
                  aria-label="Nilai variabel"
                  className="mono min-w-0 flex-1 py-1"
                />
                <IconButton
                  icon="x"
                  label="Hapus variabel"
                  tone="danger"
                  size="sm"
                  onClick={() => setEnvDraft({ ...envDraft, variables: envDraft.variables.filter((_, at) => at !== index) })}
                />
              </div>
            ))}
            <div className="flex items-center gap-2">
              <Button
                icon="plus"
                size="sm"
                onClick={() => setEnvDraft({ ...envDraft, variables: [...envDraft.variables, { key: '', value: '' }] })}
              >
                Variabel
              </Button>
              <span className="text-[12.5px] text-muted/70">Dipakai lewat {'{{nama}}'} di URL, header, atau body. Variabel disimpan lokal.</span>
            </div>
          </Card>
        ) : null}

        <Card className="flex flex-col gap-2 p-3">
          <div className="flex items-center gap-2">
            <span className="field-label">Header</span>
            <IconButton icon="plus" label="Tambah header" size="sm" onClick={() => setHeaders([...headers, { key: '', value: '' }])} />
          </div>
          {headers.map((row, index) => (
            <div key={index} className="flex items-center gap-2">
              <Input
                value={row.key}
                onChange={(event) => setHeaders(headers.map((item, at) => (at === index ? { ...item, key: event.target.value } : item)))}
                placeholder="Nama"
                aria-label="Nama header"
                className="mono w-48 py-1"
                spellCheck={false}
              />
              <Input
                value={row.value}
                onChange={(event) => setHeaders(headers.map((item, at) => (at === index ? { ...item, value: event.target.value } : item)))}
                placeholder="Nilai"
                aria-label="Nilai header"
                className="mono min-w-0 flex-1 py-1"
                spellCheck={false}
              />
              <IconButton
                icon="x"
                label="Hapus header"
                tone="danger"
                size="sm"
                onClick={() => setHeaders(headers.filter((_, at) => at !== index))}
              />
            </div>
          ))}
        </Card>

        {!['GET', 'HEAD'].includes(method) ? (
          <Field id="http-body" label="Body">
            <Textarea
              id="http-body"
              value={body}
              onChange={(event) => setBody(event.target.value)}
              spellCheck={false}
              className="mono min-h-[120px] resize-y"
              placeholder='{"hello": "world"}'
            />
          </Field>
        ) : null}

        {error ? <div className="text-[13px] text-bad">{error}</div> : null}

        {reply ? (
          <div className="flex min-h-0 flex-col gap-2">
            <div className="flex flex-wrap items-center gap-3 text-[13.5px]">
              <Badge tone={reply.status < 400 ? 'ok' : 'bad'} className="tabular-nums px-1.5 py-0.5 text-[13px]">
                {reply.status} {reply.statusText}
              </Badge>
              <span className="tabular-nums text-muted">{reply.ms} ms</span>
              <span className="tabular-nums text-muted">{bytes(reply.size)}</span>
              <span className="mono truncate text-muted">{reply.url}</span>
              <CopyButton text={reply.body} label="Salin body" />
            </div>

            <Card className="px-3 py-2">
              <details>
                <summary className="cursor-pointer rounded text-[13px] text-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">Header respons ({Object.keys(reply.headers).length})</summary>
                <div className="mt-2 flex flex-col gap-0.5">
                  {Object.entries(reply.headers).map(([key, value]) => (
                    <div key={key} className="mono flex gap-2 text-[12.5px]">
                      <span className="shrink-0 text-accent/80">{key}:</span>
                      <span className="break-all text-ink/85">{value}</span>
                    </div>
                  ))}
                </div>
              </details>
            </Card>

            <pre className="input mono min-h-[200px] flex-1 overflow-auto leading-relaxed whitespace-pre-wrap text-[13.5px]">{pretty}</pre>
            {reply.truncated ? <div className="text-[12px] text-warn">Body dipotong 1 MB</div> : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
