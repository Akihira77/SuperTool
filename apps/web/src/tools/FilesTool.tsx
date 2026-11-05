import { useCallback, useEffect, useRef, useState } from 'react';
import { CodeEditor } from '../components/CodeEditor';
import { CopyButton, Icon, PageHeader, Spinner, cn } from '../components/ui';
import { api, ApiError, qs } from '../lib/api';
import { bytes, timeAgo } from '../lib/format';
import { renderMarkdown } from '../lib/markdown';

type Entry = { name: string; path: string; dir: boolean; size: number; mtime: number; ext: string; hidden: boolean };
type Listing = { path: string; parent: string | null; entries: Entry[]; truncated: boolean };
type FileData = { path: string; binary: boolean; size: number; mtime: number; ext: string; text: string; truncated: boolean };
type Root = { path: string; label: string };

const IMAGE = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'bmp']);
const RAW = '/api/fs/raw?path=';

function TreeNode({ entry, depth, selected, onPick }: { entry: Entry; depth: number; selected: string; onPick: (path: string) => void }) {
  const [open, setOpen] = useState(false);
  const [children, setChildren] = useState<Entry[] | null>(null);
  const [loading, setLoading] = useState(false);

  const toggle = async () => {
    onPick(entry.path);
    if (open) {
      setOpen(false);
      return;
    }
    if (!children) {
      setLoading(true);
      try {
        const result = await api.get<Listing>('/fs/list' + qs({ path: entry.path }));
        setChildren(result.entries.filter((child) => child.dir));
      } catch {
        setChildren([]);
      } finally {
        setLoading(false);
      }
    }
    setOpen(true);
  };

  return (
    <div>
      <button
        type="button"
        onClick={toggle}
        style={{ paddingLeft: 6 + depth * 12 }}
        className={cn(
          'flex w-full items-center gap-1 rounded-md py-1 pr-2 text-left text-[12.5px] transition-colors',
          selected === entry.path ? 'bg-accent/12 text-ink' : 'text-muted hover:bg-panel2 hover:text-ink',
        )}
      >
        {loading ? <Spinner /> : <Icon name={open ? 'chevronDown' : 'chevronRight'} size={13} className="shrink-0 opacity-70" />}
        <Icon name="files" size={13} className="shrink-0 text-accent/70" />
        <span className="truncate">{entry.name}</span>
      </button>
      {open && children ? children.map((child) => <TreeNode key={child.path} entry={child} depth={depth + 1} selected={selected} onPick={onPick} />) : null}
    </div>
  );
}

export default function FilesTool() {
  const [roots, setRoots] = useState<Root[]>([]);
  const [rootPath, setRootPath] = useState('');
  const [listing, setListing] = useState<Listing | null>(null);
  const [file, setFile] = useState<FileData | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Entry[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState(false);
  const uploadRef = useRef<HTMLInputElement>(null);

  const loadListing = useCallback(async (path: string) => {
    setBusy(true);
    setError('');
    try {
      const result = await api.get<Listing>('/fs/list' + qs({ path }));
      setListing(result);
      setFile(null);
      setEditing(false);
      setResults(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Gagal membaca folder');
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    api
      .get<Root[]>('/fs/roots')
      .then((list) => {
        setRoots(list);
        if (list.length) {
          setRootPath(list[0].path);
          void loadListing(list[0].path);
        }
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Gagal memuat root'));
  }, [loadListing]);

  const openFile = async (entry: Entry) => {
    setBusy(true);
    setError('');
    try {
      const data = await api.get<FileData>('/fs/read' + qs({ path: entry.path }));
      setFile(data);
      setDraft(data.text);
      setEditing(false);
      setPreview(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Gagal membuka file');
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!file) return;
    setBusy(true);
    try {
      await api.put('/fs/write', { path: file.path, content: draft });
      setFile({ ...file, text: draft, size: new Blob([draft]).size });
      setEditing(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Gagal menyimpan');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (path: string) => {
    if (!window.confirm('Hapus ' + path + '?')) return;
    try {
      await api.del('/fs' + qs({ path }));
      if (file?.path === path) setFile(null);
      if (listing) await loadListing(listing.path);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Gagal menghapus');
    }
  };

  const rename = async (entry: Entry) => {
    const name = window.prompt('Nama baru', entry.name);
    if (!name || name === entry.name) return;
    try {
      await api.post('/fs/rename', { path: entry.path, name });
      if (file?.path === entry.path) setFile(null);
      if (listing) await loadListing(listing.path);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Gagal mengganti nama');
    }
  };

  const makeFolder = async () => {
    if (!listing) return;
    const name = window.prompt('Nama folder baru');
    if (!name) return;
    try {
      await api.post('/fs/mkdir', { path: listing.path + '/' + name });
      await loadListing(listing.path);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Gagal membuat folder');
    }
  };

  const search = async () => {
    if (!listing || query.trim().length < 2) return;
    setBusy(true);
    try {
      const result = await api.get<{ results: Entry[] }>('/fs/search' + qs({ path: listing.path, q: query }));
      setResults(result.results);
      setFile(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Pencarian gagal');
    } finally {
      setBusy(false);
    }
  };

  const upload = async (files: FileList | null) => {
    if (!files || !listing) return;
    setBusy(true);
    try {
      for (const item of Array.from(files)) {
        const form = new FormData();
        form.append('file', item);
        const res = await fetch('/api/fs/upload' + qs({ path: listing.path }), {
          method: 'POST',
          headers: { 'x-st-csrf': '1' },
          body: form,
        });
        if (!res.ok) throw new Error(await res.text());
      }
      await loadListing(listing.path);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Upload gagal');
    } finally {
      setBusy(false);
      if (uploadRef.current) uploadRef.current.value = '';
    }
  };

  const crumbs = (() => {
    if (!listing) return [] as Array<{ name: string; path: string }>;
    const base = rootPath && listing.path.startsWith(rootPath) ? rootPath : '';
    const relative = base ? listing.path.slice(base.length).replace(/^\//, '') : listing.path;
    const parts = relative.split('/').filter(Boolean);
    const out = [{ name: base ? base.split('/').filter(Boolean).pop() ?? '/' : '/', path: base || listing.path }];
    let acc = base;
    for (const part of parts) {
      acc = acc + '/' + part;
      out.push({ name: part, path: acc });
    }
    return out;
  })();

  const rows = results ?? listing?.entries ?? [];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="File Explorer" subtitle={listing ? listing.path + ' · ' + rows.length + ' item' : 'Jelajahi file lokal'}>
        <select value={rootPath} onChange={(e) => { setRootPath(e.target.value); void loadListing(e.target.value); }} className="input w-40 py-1.5 text-[12px]">
          {roots.map((root) => (
            <option key={root.path} value={root.path}>
              {root.label}
            </option>
          ))}
        </select>
        <div className="relative">
          <Icon name="search" className="absolute top-2 left-2 text-muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void search()}
            placeholder="Cari nama file"
            className="input w-44 py-1.5 pl-7 text-[12px]"
          />
        </div>
        <button type="button" className="btn" onClick={makeFolder} disabled={!listing} title="Folder baru">
          <Icon name="folderPlus" />
        </button>
        <button type="button" className="btn" onClick={() => uploadRef.current?.click()} disabled={!listing} title="Upload file">
          <Icon name="upload" />
        </button>
        <button type="button" className="btn" onClick={() => listing && void loadListing(listing.path)} disabled={!listing} title="Muat ulang">
          <Icon name="refresh" />
        </button>
        <input ref={uploadRef} type="file" multiple hidden onChange={(e) => void upload(e.target.files)} />
      </PageHeader>

      <div className="flex min-h-0 flex-1">
        <div className="flex w-64 shrink-0 flex-col overflow-y-auto border-r border-line p-2">
          {roots.map((root) => (
            <TreeNode
              key={root.path}
              entry={{ name: root.label, path: root.path, dir: true, size: 0, mtime: 0, ext: '', hidden: false }}
              depth={0}
              selected={listing?.path ?? ''}
              onPick={(path) => void loadListing(path)}
            />
          ))}
        </div>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-line px-3 py-1.5 text-[12px]">
            {crumbs.map((crumb, index) => (
              <span key={crumb.path} className="flex shrink-0 items-center gap-1">
                {index > 0 ? <Icon name="chevronRight" size={12} className="text-muted/50" /> : null}
                <button
                  type="button"
                  onClick={() => void loadListing(crumb.path)}
                  className={cn('rounded px-1 py-0.5 hover:bg-panel2', index === crumbs.length - 1 ? 'text-ink' : 'text-muted')}
                >
                  {crumb.name}
                </button>
              </span>
            ))}
            {results ? (
              <span className="ml-2 text-muted">hasil pencarian &quot;{query}&quot;</span>
            ) : null}
            <div className="ml-auto flex items-center gap-1">
              {busy ? <Spinner /> : null}
            </div>
          </div>

          {error ? <div className="border-b border-line px-3 py-2 text-xs text-bad">{error}</div> : null}

          {file ? (
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line px-3 py-2">
                <Icon name="markdown" size={14} className="text-accent" />
                <span className="mono truncate text-[12.5px] font-medium">{file.path.split('/').pop()}</span>
                <span className="text-[11px] text-muted">
                  {bytes(file.size)} · {timeAgo(file.mtime)}
                  {file.binary ? '' : ' · ' + file.text.split('\n').length + ' baris'}
                </span>
                <div className="ml-auto flex items-center gap-1.5">
                  {!file.binary && file.ext === 'md' ? (
                    <button type="button" className={cn('btn', preview && 'btn-primary')} onClick={() => setPreview(!preview)}>
                      <Icon name="eye" /> Preview
                    </button>
                  ) : null}
                  {!file.binary && !editing ? (
                    <button type="button" className="btn" onClick={() => setEditing(true)}>
                      <Icon name="edit" /> Edit
                    </button>
                  ) : null}
                  {editing ? (
                    <>
                      <button type="button" className="btn btn-primary" onClick={save}>
                        <Icon name="save" /> Simpan
                      </button>
                      <button type="button" className="btn" onClick={() => { setEditing(false); setDraft(file.text); }}>
                        Batal
                      </button>
                    </>
                  ) : null}
                  <CopyButton text={file.path} label="Path" />
                  <a className="btn" href={RAW + encodeURIComponent(file.path) + '&download=1'} download>
                    <Icon name="download" />
                  </a>
                  <button type="button" className="btn btn-danger" onClick={() => void remove(file.path)}>
                    <Icon name="trash" />
                  </button>
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-hidden p-3">
                {file.binary ? (
                  IMAGE.has(file.ext) ? (
                    <div className="flex h-full items-center justify-center overflow-auto rounded-lg border border-line bg-[#0b1118] p-4">
                      <img src={RAW + encodeURIComponent(file.path)} alt={file.path} className="max-h-full max-w-full object-contain" />
                    </div>
                  ) : file.ext === 'pdf' ? (
                    <iframe title={file.path} src={RAW + encodeURIComponent(file.path)} className="h-full w-full rounded-lg border border-line bg-white" />
                  ) : (
                    <div className="flex h-full flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-line text-sm text-muted">
                      <Icon name="files" size={26} />
                      File biner tidak bisa ditampilkan
                      <a className="btn" href={RAW + encodeURIComponent(file.path) + '&download=1'} download>
                        <Icon name="download" /> Unduh
                      </a>
                    </div>
                  )
                ) : preview ? (
                  <div className="md h-full overflow-y-auto rounded-lg border border-line bg-[#0b1118] p-5" dangerouslySetInnerHTML={{ __html: renderMarkdown(file.text) }} />
                ) : (
                  <CodeEditor value={editing ? draft : file.text} onChange={setDraft} readOnly={!editing} onSave={save} wrap />
                )}
              </div>
            </div>
          ) : (
            <div className="min-h-0 flex-1 overflow-auto">
              <table className="w-full border-collapse text-[12.5px]">
                <thead className="sticky top-0 z-10 bg-panel text-left text-[11px] tracking-wide text-muted uppercase">
                  <tr>
                    <th className="border-b border-line px-3 py-2 font-medium">Nama</th>
                    <th className="border-b border-line px-3 py-2 text-right font-medium">Ukuran</th>
                    <th className="border-b border-line px-3 py-2 font-medium">Diubah</th>
                    <th className="border-b border-line px-3 py-2 text-right font-medium">Aksi</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((entry) => (
                    <tr
                      key={entry.path}
                      className="group cursor-pointer hover:bg-panel2/60"
                      onClick={() => (entry.dir ? void loadListing(entry.path) : void openFile(entry))}
                    >
                      <td className="border-b border-line/60 px-3 py-1.5">
                        <div className="flex items-center gap-2">
                          <Icon name={entry.dir ? 'files' : 'markdown'} size={14} className={entry.dir ? 'text-accent/80' : 'text-muted'} />
                          <span className={cn('truncate', entry.hidden && 'text-muted')}>{entry.name}</span>
                          {entry.dir ? <span className="text-[10px] text-muted/60">dir</span> : null}
                        </div>
                      </td>
                      <td className="mono border-b border-line/60 px-3 py-1.5 text-right text-[11.5px] text-muted">{entry.dir ? '-' : bytes(entry.size)}</td>
                      <td className="border-b border-line/60 px-3 py-1.5 text-[11.5px] text-muted">{timeAgo(entry.mtime)}</td>
                      <td className="border-b border-line/60 px-3 py-1.5 text-right whitespace-nowrap opacity-0 group-hover:opacity-100">
                        <button
                          type="button"
                          className="btn btn-ghost px-1.5 py-0.5"
                          title="Ganti nama"
                          onClick={(e) => {
                            e.stopPropagation();
                            void rename(entry);
                          }}
                        >
                          <Icon name="edit" size={13} />
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost px-1.5 py-0.5"
                          title="Hapus"
                          onClick={(e) => {
                            e.stopPropagation();
                            void remove(entry.path);
                          }}
                        >
                          <Icon name="trash" size={13} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {rows.length === 0 ? <p className="p-6 text-center text-sm text-muted">Folder kosong</p> : null}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
