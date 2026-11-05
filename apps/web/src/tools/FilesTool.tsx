import { useCallback, useEffect, useRef, useState } from 'react';
import { CodeEditor } from '../components/CodeEditor';
import { CopyButton, Icon, PageHeader, Spinner, cn } from '../components/ui';
import { api, ApiError, qs } from '../lib/api';
import { bytes, timeAgo } from '../lib/format';
import { renderMarkdown } from '../lib/markdown';
import { useSidebar } from '../lib/useSidebar';

type Entry = { name: string; path: string; dir: boolean; size: number; mtime: number; ext: string; hidden: boolean };
type Listing = { path: string; parent: string | null; entries: Entry[]; truncated: boolean };
type FileData = { path: string; binary: boolean; size: number; mtime: number; ext: string; text: string; truncated: boolean };
type OfficeBlock =
  | { type: 'text'; lines: string[] }
  | { type: 'table'; name?: string; rows: string[][]; refs?: string[][] };
type Office = { path: string; kind: string; blocks: OfficeBlock[]; editable: 'text' | 'sheet' | 'none'; size: number; mtime: number; truncated: boolean };
type Root = { path: string; label: string };
type GrepHit = { path: string; line: number; text: string };

const OFFICE = new Set(['docx', 'xlsx', 'pptx', 'odt', 'ods', 'odp']);

function officeText(blocks: OfficeBlock[]): string {
  return blocks
    .filter((block): block is { type: 'text'; lines: string[] } => block.type === 'text')
    .flatMap((block) => block.lines)
    .join('\n');
}

const IMAGE = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'bmp', 'avif']);
const AUDIO = new Set(['mp3', 'wav', 'ogg', 'oga', 'm4a', 'aac', 'flac', 'opus']);
const VIDEO = new Set(['mp4', 'm4v', 'webm', 'mkv', 'mov', 'ogv']);
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
  const [panelOpen, togglePanel] = useSidebar('files', true);
  const [roots, setRoots] = useState<Root[]>([]);
  const [rootPath, setRootPath] = useState('');
  const [listing, setListing] = useState<Listing | null>(null);
  const [file, setFile] = useState<FileData | null>(null);
  const [office, setOffice] = useState<Office | null>(null);
  const [officeBody, setOfficeBody] = useState('');
  const [sheetDraft, setSheetDraft] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Entry[] | null>(null);
  const [deep, setDeep] = useState(false);
  const [hits, setHits] = useState<GrepHit[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState(false);
  const [recents, setRecents] = useState<Array<{ path: string; openedAt: number }>>([]);
  const uploadRef = useRef<HTMLInputElement>(null);

  const loadListing = useCallback(async (path: string) => {
    setBusy(true);
    setError('');
    try {
      const result = await api.get<Listing>('/fs/list' + qs({ path }));
      setListing(result);
      setFile(null);
      setOffice(null);
      setEditing(false);
      setResults(null);
      setHits(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Gagal membaca folder');
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void loadRecents();
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

  const loadRecents = async () => {
    try {
      const result = await api.get<{ paths: Array<{ path: string; openedAt: number }> }>('/recent?kind=file');
      setRecents(result.paths);
    } catch {
      // opsional
    }
  };

  const loadOffice = useCallback(async (path: string) => {
    const data = await api.get<Office>('/fs/office' + qs({ path }));
    setOffice(data);
    setOfficeBody(officeText(data.blocks));
    setSheetDraft({});
    setFile(null);
    return data;
  }, []);

  const saveOffice = async () => {
    if (!office) return;
    setBusy(true);
    setError('');
    try {
      if (office.editable === 'text') {
        await api.post('/fs/office', { path: office.path, texts: officeBody.split('\n') });
      } else if (office.editable === 'sheet') {
        const cells: Array<{ sheet: number; ref: string; value: string }> = [];
        office.blocks.forEach((block, blockIndex) => {
          if (block.type !== 'table') return;
          block.rows.forEach((row, rowIndex) => {
            row.forEach((value, colIndex) => {
              const ref = block.refs?.[rowIndex]?.[colIndex];
              if (!ref) return;
              const next = sheetDraft[blockIndex + ':' + ref];
              if (next !== undefined && next !== value) cells.push({ sheet: blockIndex, ref, value: next });
            });
          });
        });
        if (!cells.length) {
          setEditing(false);
          return;
        }
        await api.post('/fs/office', { path: office.path, cells });
      }
      await loadOffice(office.path);
      setEditing(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Gagal menyimpan');
    } finally {
      setBusy(false);
    }
  };

  const openFile = async (entry: Entry) => {
    setBusy(true);
    setError('');
    try {
      setOffice(null);
      const ext = entry.ext || (entry.path.split('.').pop() ?? '').toLowerCase();
      if (OFFICE.has(ext)) {
        await loadOffice(entry.path);
        setEditing(false);
        void loadRecents();
        return;
      }
      const data = await api.get<FileData>('/fs/read' + qs({ path: entry.path }));
      setFile(data);
      setDraft(data.text);
      setEditing(false);
      setPreview(false);
      void loadRecents();
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
      if (office?.path === path) setOffice(null);
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
    setError('');
    try {
      if (deep) {
        const result = await api.get<{ results: GrepHit[]; truncated: boolean }>(
          '/fs/grep' + qs({ path: listing.path, q: query }),
        );
        setHits(result.results);
        setResults(null);
      } else {
        const result = await api.get<{ results: Entry[] }>('/fs/search' + qs({ path: listing.path, q: query }));
        setResults(result.results);
        setHits(null);
      }
      setFile(null);
      setOffice(null);
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

  const rows = results ?? (hits ? [] : (listing?.entries ?? []));

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="File Explorer" subtitle={listing ? listing.path + ' · ' + rows.length + ' item' : 'Jelajahi file lokal'}>
        <button type="button" className="btn" onClick={togglePanel} title={panelOpen ? 'Sembunyikan tree' : 'Tampilkan tree'}>
          <Icon name="panel" />
        </button>
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
            placeholder={deep ? 'Cari isi file' : 'Cari nama file'}
            className="input w-44 py-1.5 pl-7 text-[12px]"
          />
        </div>
        <button
          type="button"
          onClick={() => setDeep(!deep)}
          className={cn('btn px-1.5', deep && 'border-accent/50 text-accent')}
          title={deep ? 'Mencari di dalam isi file' : 'Mencari nama file saja'}
        >
          <Icon name="search" size={13} /> isi
        </button>
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
        {panelOpen ? (
        <div className="flex w-64 shrink-0 flex-col overflow-y-auto border-r border-line p-2">
          {recents.length ? (
            <div className="mb-1 border-b border-line pb-1">
              <div className="px-1 pb-1 text-[10px] tracking-wide text-muted uppercase">Terakhir dibuka</div>
              {recents.slice(0, 5).map((item) => (
                <button
                  key={item.path}
                  type="button"
                  onClick={() => void openFile({ path: item.path, ext: (item.path.split('.').pop() ?? '').toLowerCase() } as Entry)}
                  title={item.path}
                  className="block w-full truncate rounded px-1 py-0.5 text-left text-[11.5px] text-muted transition-colors hover:bg-panel2 hover:text-ink"
                >
                  {item.path.split('/').pop()}
                </button>
              ))}
            </div>
          ) : null}
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
        ) : null}

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

          {office ? (
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line px-3 py-2">
                <button type="button" className="btn px-1.5 py-1" onClick={() => { setOffice(null); setEditing(false); }} title="Kembali ke daftar">
                  <Icon name="back" />
                </button>
                <Icon name="files" size={14} className="text-accent" />
                <span className="mono truncate text-[12.5px] font-medium">{office.path.split('/').pop()}</span>
                <span className="text-[11px] text-muted">
                  {office.kind.toUpperCase()} · {bytes(office.size)} · {timeAgo(office.mtime)}
                </span>
                <div className="ml-auto flex items-center gap-1.5">
                  {office.editable !== 'none' && !editing ? (
                    <button type="button" className="btn" onClick={() => setEditing(true)}>
                      <Icon name="edit" /> Edit
                    </button>
                  ) : null}
                  {editing ? (
                    <>
                      <button type="button" className="btn btn-primary" onClick={() => void saveOffice()}>
                        <Icon name="save" /> Simpan
                      </button>
                      <button type="button" className="btn" onClick={() => { setEditing(false); void loadOffice(office.path); }}>
                        Batal
                      </button>
                    </>
                  ) : null}
                  <a className="btn" href={RAW + encodeURIComponent(office.path) + '&download=1'} download>
                    <Icon name="download" />
                  </a>
                </div>
              </div>

              {office.editable === 'none' ? (
                <div className="border-b border-line px-3 py-1.5 text-[11px] text-muted">
                  Format ini hanya bisa dibaca. Edit langsung tersedia untuk docx dan xlsx.
                </div>
              ) : null}

              <div className="min-h-0 flex-1 space-y-4 overflow-auto p-3">
                {office.editable === 'text' ? (
                  editing ? (
                    <textarea
                      value={officeBody}
                      onChange={(event) => setOfficeBody(event.target.value)}
                      spellCheck={false}
                      className="mono h-full min-h-[60vh] w-full resize-none rounded-lg border border-line bg-[#0b1118] p-4 text-[12.5px] leading-relaxed text-ink outline-none focus:border-accent/50"
                    />
                  ) : (
                    <pre className="mono whitespace-pre-wrap rounded-lg border border-line bg-[#0b1118] p-4 text-[12.5px] leading-relaxed text-ink/90">
                      {officeBody || '(dokumen kosong)'}
                    </pre>
                  )
                ) : (
                  office.blocks.map((block, blockIndex) => {
                    if (block.type === 'text') {
                      return (
                        <pre key={blockIndex} className="mono whitespace-pre-wrap rounded-lg border border-line bg-[#0b1118] p-4 text-[12.5px] leading-relaxed text-ink/90">
                          {block.lines.join(String.fromCharCode(10))}
                        </pre>
                      );
                    }
                    return (
                      <div key={blockIndex}>
                        <div className="mb-1 text-[11px] uppercase tracking-wide text-muted">{block.name ?? 'Sheet'}</div>
                        <div className="overflow-auto rounded-lg border border-line">
                          <table className="w-full border-collapse text-[12px]">
                            <tbody>
                              {block.rows.map((row, rowIndex) => (
                                <tr key={rowIndex}>
                                  {row.map((value, colIndex) => {
                                    const ref = block.refs?.[rowIndex]?.[colIndex] ?? '';
                                    const key = blockIndex + ':' + ref;
                                    return (
                                      <td key={colIndex} className="border-b border-r border-line/60 p-0 align-top">
                                        {editing && ref ? (
                                          <input
                                            value={sheetDraft[key] ?? value}
                                            onChange={(event) => setSheetDraft({ ...sheetDraft, [key]: event.target.value })}
                                            className="w-full min-w-24 bg-transparent px-2 py-1 text-[12px] text-ink outline-none focus:bg-panel2"
                                          />
                                        ) : (
                                          <span className="block min-w-24 px-2 py-1 text-ink/90">{value}</span>
                                        )}
                                      </td>
                                    );
                                  })}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          ) : file ? (
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line px-3 py-2">
                <button type="button" className="btn px-1.5 py-1" onClick={() => setFile(null)} title="Kembali ke daftar">
                  <Icon name="back" />
                </button>
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
                {AUDIO.has(file.ext) || VIDEO.has(file.ext) ? (
                  <div className="flex h-full flex-col items-center justify-center gap-4 rounded-lg border border-line bg-[#0b1118] p-6">
                    {VIDEO.has(file.ext) ? (
                      <video
                        key={file.path}
                        controls
                        autoPlay={false}
                        preload="metadata"
                        src={RAW + encodeURIComponent(file.path)}
                        className="max-h-full w-full max-w-3xl rounded-lg border border-line bg-black"
                      />
                    ) : (
                      <audio key={file.path} controls preload="metadata" src={RAW + encodeURIComponent(file.path)} className="w-full max-w-xl" />
                    )}
                    <div className="text-[11.5px] text-muted">
                      {file.ext.toUpperCase()} · {bytes(file.size)} ·{' '}
                      <a className="text-accent underline" href={RAW + encodeURIComponent(file.path) + '&download=1'} download>
                        unduh
                      </a>
                    </div>
                  </div>
                ) : file.binary ? (
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
          ) : hits ? (
            <div className="min-h-0 flex-1 overflow-auto">
              <div className="border-b border-line px-3 py-1.5 text-[11.5px] text-muted">
                {hits.length} baris cocok untuk &quot;{query}&quot; · klik untuk membuka berkas
              </div>
              <table className="w-full border-collapse text-[12px]">
                <tbody>
                  {hits.map((hit, index) => (
                    <tr
                      key={hit.path + ':' + hit.line + ':' + index}
                      onClick={() =>
                        void openFile({ path: hit.path, ext: (hit.path.split('.').pop() ?? '').toLowerCase() } as Entry)
                      }
                      className="cursor-pointer border-b border-line/50 hover:bg-panel2/60"
                    >
                      <td className="mono px-3 py-1 whitespace-nowrap text-muted">
                        {hit.path.split('/').pop()}:{hit.line}
                      </td>
                      <td className="mono truncate px-2 py-1 text-ink/90">{hit.text}</td>
                      <td className="px-3 py-1 text-right text-[11px] text-muted">{hit.path.replace(listing?.path ?? '', '')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
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
