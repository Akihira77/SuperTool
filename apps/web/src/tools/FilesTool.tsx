import { useCallback, useEffect, useRef, useState } from 'react';
import { CodeEditor } from '../components/CodeEditor';
import { CopyButton, Icon, PageHeader, Spinner, cn } from '../components/ui';
import { api, ApiError, qs } from '../lib/api';
import { bytes, timeAgo } from '../lib/format';
import { useI18n } from '../lib/i18n';
import { usePaletteIntent, type FilesSearchPayload } from '../lib/palette';
import { projectName, useProject } from '../lib/project';
import { useConfirm } from '../components/confirm';
import { useToast } from '../components/toast';
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
  const { t } = useI18n();
  const confirm = useConfirm();
  const toast = useToast();
  const { projectPath } = useProject();
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
  const [grepWarning, setGrepWarning] = useState('');
  const [searching, setSearching] = useState(false);
  const [include, setInclude] = useState('');
  const [paletteQuery, setPaletteQuery] = useState<FilesSearchPayload | null>(null);
  const [openTarget, setOpenTarget] = useState('');
  const [exclude, setExclude] = useState<string[]>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('st:files:exclude') ?? '["*.log"]');
      return Array.isArray(saved) ? saved.filter((item) => typeof item === 'string') : ['*.log'];
    } catch {
      return ['*.log'];
    }
  });
  const [excludeOpen, setExcludeOpen] = useState(false);
  const searchAbort = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState(false);
  const [recents, setRecents] = useState<Array<{ path: string; openedAt: number }>>([]);
  const [recentOpen, setRecentOpen] = useState(false);
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
      return result;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('err.readFolder'));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void loadRecents();
  }, []);

  // Folder proyek global berubah (dipilih dari header) → buka langsung.
  useEffect(() => {
    if (!projectPath || !roots.length) return;
    if (!roots.some((root) => projectPath === root.path || projectPath.startsWith(root.path + '/'))) return;
    setRootPath(projectPath);
    void loadListing(projectPath);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectPath, roots]);

  useEffect(() => {
    api
      .get<Root[]>('/fs/roots')
      .then((list) => {
        setRoots(list);
        const start = projectPath && list.some((root) => projectPath === root.path || projectPath.startsWith(root.path + '/')) ? projectPath : list[0]?.path;
        if (start) {
          setRootPath(start);
          void loadListing(start);
        }
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : t('err.loadRoots')));
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
      setError(err instanceof ApiError ? err.message : t('err.save'));
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
      setError(err instanceof ApiError ? err.message : t('err.openFile'));
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!file) return;
    setBusy(true);
    try {
      await api.put('/fs/write', { path: file.path, content: draft });
      toast(t('common.saved'), 'ok');
      setFile({ ...file, text: draft, size: new Blob([draft]).size });
      setEditing(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('err.save'));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (path: string) => {
    const ok = await confirm({ title: t('files.confirmDelete'), message: path, danger: true, confirmLabel: t('common.delete') });
    if (!ok) return;
    try {
      await api.del('/fs' + qs({ path }));
      toast(t('common.deleted'), 'ok');
      if (file?.path === path) setFile(null);
      if (office?.path === path) setOffice(null);
      if (listing) await loadListing(listing.path);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('err.delete'));
    }
  };

  const rename = async (entry: Entry) => {
    const name = window.prompt('Nama baru', entry.name);
    if (!name || name === entry.name) return;
    try {
      await api.post('/fs/rename', { path: entry.path, name });
      toast(t('common.renamed'), 'ok');
      if (file?.path === entry.path) setFile(null);
      if (listing) await loadListing(listing.path);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('err.rename'));
    }
  };

  const makeFolder = async () => {
    if (!listing) return;
    const name = window.prompt('Nama folder baru');
    if (!name) return;
    try {
      await api.post('/fs/mkdir', { path: listing.path + '/' + name });
      toast(t('common.created'), 'ok');
      await loadListing(listing.path);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('err.mkdir'));
    }
  };

  const search = async () => {
    if (!listing || query.trim().length < 2) return;
    searchAbort.current?.abort();
    const controller = new AbortController();
    searchAbort.current = controller;
    setBusy(true);
    setSearching(true);
    setError('');
    try {
      setGrepWarning('');
      const params = {
        path: listing.path,
        q: query,
        exclude: exclude.join(',') || undefined,
        include: include.trim() || undefined,
      };
      if (deep) {
        const result = await api.get<{ results: GrepHit[]; truncated: boolean; warning?: string }>(
          '/fs/grep' + qs(params),
          { signal: controller.signal },
        );
        setHits(result.results);
        setResults(null);
        if (result.warning) setGrepWarning(result.warning);
        else if (result.truncated) setGrepWarning(t('files.truncated'));
      } else {
        const result = await api.get<{ results: Entry[] }>('/fs/search' + qs(params), { signal: controller.signal });
        setResults(result.results);
        setHits(null);
      }
      setFile(null);
      setOffice(null);
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') {
        setHits(null);
        setResults(null);
        setError(t('files.cancelled'));
      } else {
        setError(err instanceof ApiError ? err.message : t('files.searchError'));
      }
    } finally {
      if (searchAbort.current === controller) searchAbort.current = null;
      setBusy(false);
      setSearching(false);
    }
  };

  const searchRef = useRef(search);
  searchRef.current = search;

  // Perintah dari command palette / tool lain: cari, atau buka satu berkas.
  usePaletteIntent('files', (action, payload) => {
    if (action === 'open' && typeof payload === 'string') {
      setOpenTarget(payload);
      return;
    }
    const data = payload as FilesSearchPayload | undefined;
    if (!data) return;
    setQuery(data.query);
    setDeep(data.mode === 'content');
    setInclude(data.include);
    setExclude(data.exclude.split(',').map((item) => item.trim()).filter(Boolean));
    setPaletteQuery(data);
  });

  useEffect(() => {
    if (!openTarget) return;
    const target = openTarget;
    setOpenTarget('');
    const dir = target.slice(0, target.lastIndexOf('/'));
    const run = async () => {
      const result = listing?.path === dir ? listing : await loadListing(dir);
      const entry = result?.entries.find((item) => item.path === target);
      if (entry) await openFile(entry);
      else setError(t('files.notFound'));
    };
    void run();
  }, [openTarget]);

  useEffect(() => {
    if (!paletteQuery || !listing) return;
    setPaletteQuery(null);
    void searchRef.current();
  }, [paletteQuery, listing]);

  const cancelSearch = () => {
    searchAbort.current?.abort();
    searchAbort.current = null;
    setSearching(false);
    setBusy(false);
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
      toast(t('common.uploaded'), 'ok');
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

  const [sort, setSort] = useState<{ key: 'name' | 'size' | 'mtime'; dir: 1 | -1 }>({ key: 'name', dir: 1 });

  const toggleSort = (key: 'name' | 'size' | 'mtime') =>
    setSort((prev) => ({ key, dir: prev.key === key && prev.dir === 1 ? -1 : 1 }));

  const compare = (a: Entry, b: Entry) => {
    if (sort.key === 'name') return a.name.localeCompare(b.name, 'id', { numeric: true, sensitivity: 'base' });
    if (sort.key === 'size') return a.size - b.size;
    return a.mtime - b.mtime;
  };

  const rows = (results ?? (hits ? [] : (listing?.entries ?? [])))
    .slice()
    .sort((a, b) => (a.dir === b.dir ? compare(a, b) * sort.dir : a.dir ? -1 : 1));

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="File Explorer" subtitle={listing ? listing.path + ' · ' + rows.length + ' item' : 'Jelajahi file lokal'}>
        <button type="button" className="btn" onClick={togglePanel} title={panelOpen ? 'Sembunyikan tree' : 'Tampilkan tree'}>
          <Icon name="panel" />
        </button>
        {projectPath ? (
          <button type="button" className="btn border-accent/40 px-2 py-1.5 text-[11.5px] text-accent" onClick={() => void loadListing(projectPath)} title={projectPath}>
            <Icon name="folderPlus" size={13} /> {projectName(projectPath)}
          </button>
        ) : null}
        <select value={rootPath} onChange={(e) => { setRootPath(e.target.value); void loadListing(e.target.value); }} className="input w-40 py-1.5 text-[12px]">
          {roots.map((root) => (
            <option key={root.path} value={root.path}>
              {root.label}
            </option>
          ))}
        </select>
        <div className="flex overflow-hidden rounded-md border border-line">
          {([
            [false, t('files.modeName'), 'Cocokkan nama berkas'],
            [true, t('files.modeContent'), t('files.modeContentHint')],
          ] as const).map(([value, label, hint]) => (
            <button
              key={String(value)}
              type="button"
              onClick={() => {
                setDeep(value);
                setHits(null);
                setResults(null);
                setGrepWarning('');
              }}
              title={hint}
              className={cn(
                'cursor-pointer px-2 py-1 text-[11.5px] transition-colors',
                deep === value ? 'bg-accent/15 text-accent' : 'text-muted hover:bg-panel2 hover:text-ink',
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="relative">
          <Icon name="search" className="absolute top-2 left-2 text-muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void search()}
            placeholder={deep ? t('files.searchContent') : t('files.searchName')}
            className="input w-44 py-1.5 pl-7 text-[12px]"
          />
        </div>
        <div className="relative hidden xl:block">
          <input
            value={include}
            onChange={(e) => setInclude(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void search()}
            placeholder={t('files.includeHint')}
            title={t('files.includeHint')}
            className={cn('input w-40 py-1.5 pl-2 text-[11.5px]', include && 'border-accent/40')}
          />
        </div>
        <button
          type="button"
          className={cn('btn hidden cursor-pointer lg:inline-flex', exclude.length > 0 && 'border-accent/40 text-accent')}
          onClick={() => setExcludeOpen(true)}
          title={t('files.excludeTitle')}
        >
          <Icon name="filter" size={13} />
          {t('files.exclude')}
          {exclude.length ? <span className="rounded bg-accent/20 px-1 text-[10px]">{exclude.length}</span> : null}
        </button>
        {searching ? (
          <button type="button" className="btn cursor-pointer text-bad" onClick={cancelSearch} title={t('files.cancelSearch')}>
            <Icon name="x" size={13} /> {t('common.cancel')}
          </button>
        ) : (
          <button type="button" className="btn cursor-pointer" onClick={() => void search()} title={t("common.search")}>
            <Icon name="search" size={13} />
          </button>
        )}
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

      <ExcludeDialog
        open={excludeOpen}
        value={exclude}
        onClose={() => setExcludeOpen(false)}
        onApply={(next) => {
          setExclude(next);
          localStorage.setItem('st:files:exclude', JSON.stringify(next));
          setExcludeOpen(false);
        }}
      />

      <div className="flex min-h-0 flex-1">
        {panelOpen ? (
        <div className="flex w-64 shrink-0 flex-col overflow-y-auto border-r border-line p-2">
          {recents.length ? (
            <div className="mb-1 border-b border-line pb-1">
              <div className="flex items-center gap-1 px-1 pb-1">
                <span className="text-[10px] tracking-wide text-muted uppercase">{t('files.recent')}</span>
                {recents.length ? (
                  <button type="button" className="ml-auto cursor-pointer text-[10.5px] text-accent/80 hover:text-accent" onClick={() => setRecentOpen(true)}>
                    {t('files.allRecent')}
                  </button>
                ) : null}
              </div>
              {recents.slice(0, 5).map((item) => (
                <button
                  key={item.path}
                  type="button"
                  onClick={() => void openFile({ path: item.path, ext: (item.path.split('.').pop() ?? '').toLowerCase() } as Entry)}
                  title={item.path}
                  className="flex w-full items-center gap-2 rounded px-1 py-0.5 text-left transition-colors hover:bg-panel2"
                >
                  <span className="min-w-0 flex-1 truncate text-[11.5px] text-muted hover:text-ink">{item.path.split('/').pop()}</span>
                  <span className="shrink-0 text-[10px] text-muted/60">{timeAgo(item.openedAt)}</span>
                </button>
              ))}
            </div>
          ) : null}
          {(projectPath && roots.some((root) => projectPath === root.path || projectPath.startsWith(root.path + '/'))
            ? [{ path: projectPath, label: projectName(projectPath) }]
            : roots
          ).map((root) => (
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
          {grepWarning ? (
            <div className="border-b border-line bg-warn/10 px-3 py-1.5 text-[11.5px] text-warn">
              {t('files.warning')}: {grepWarning}
            </div>
          ) : null}

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
                        <Icon name="save" /> {t("common.save")}
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
                        <Icon name="save" /> {t("common.save")}
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
                {hits.length} {t('files.hits')} &quot;{query}&quot; · {t('files.clickOpen')}
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
                    {([
                      ['name', t('files.name'), 'text-left'],
                      ['size', t('files.size'), 'text-right'],
                      ['mtime', t('files.modified'), 'text-left'],
                    ] as const).map(([key, label, align]) => (
                      <th key={key} className={cn('border-b border-line px-3 py-2 font-medium', align)}>
                        <button
                          type="button"
                          onClick={() => toggleSort(key)}
                          className={cn(
                            'inline-flex cursor-pointer items-center gap-1 rounded px-1 uppercase transition-colors hover:text-ink',
                            sort.key === key ? 'text-accent' : 'text-muted',
                          )}
                          title={'Urutkan menurut ' + label.toLowerCase()}
                        >
                          {label}
                          <span className="text-[9px]">{sort.key === key ? (sort.dir === 1 ? '▲' : '▼') : '↕'}</span>
                        </button>
                      </th>
                    ))}
                    <th className="border-b border-line px-3 py-2 text-right font-medium">{t('files.action')}</th>
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
                      <td className="border-b border-line/60 px-3 py-1.5 text-right whitespace-nowrap opacity-40 group-hover:opacity-100">
                        {!entry.dir ? (
                          <a
                            className="btn btn-ghost px-1.5 py-0.5"
                            href={RAW + encodeURIComponent(entry.path) + '&download=1'}
                            download
                            title="Unduh"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <Icon name="download" size={13} />
                          </a>
                        ) : null}
                        <button
                          type="button"
                          className="btn btn-ghost px-1.5 py-0.5"
                          title="Salin path"
                          onClick={(e) => {
                            e.stopPropagation();
                            void navigator.clipboard?.writeText(entry.path).then(() => setError(''));
                          }}
                        >
                          <Icon name="copy" size={13} />
                        </button>
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
                          title={t("common.delete")}
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

      {recentOpen ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/55 p-4" onMouseDown={() => setRecentOpen(false)}>
          <div className="flex max-h-[70vh] w-full max-w-lg flex-col gap-2 rounded-xl border border-line bg-panel p-3 shadow-2xl" onMouseDown={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-label={t('files.recentTitle')}>
            <div className="flex items-center gap-2">
              <Icon name="files" size={14} className="text-accent" />
              <span className="text-[13px] font-medium">{t('files.recentTitle')}</span>
              <button type="button" className="btn btn-ghost ml-auto cursor-pointer px-1 py-0.5" onClick={() => setRecentOpen(false)} title={t('common.close')}>
                <Icon name="x" size={13} />
              </button>
            </div>
            <div className="min-h-24 flex-1 overflow-y-auto rounded border border-line">
              {recents.map((item) => (
                <button
                  key={item.path}
                  type="button"
                  onClick={() => {
                    setRecentOpen(false);
                    void openFile({ path: item.path, ext: (item.path.split('.').pop() ?? '').toLowerCase() } as Entry);
                  }}
                  title={item.path}
                  className="flex w-full items-center gap-2 border-b border-line/50 px-2 py-1.5 text-left last:border-0 hover:bg-panel2"
                >
                  <Icon name="markdown" size={13} className="shrink-0 text-muted" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12px] text-ink/90">{item.path.split('/').pop()}</span>
                    <span className="mono block truncate text-[10px] text-muted/70">{item.path}</span>
                  </span>
                  <span className="shrink-0 text-[10.5px] text-muted/70">{timeAgo(item.openedAt)}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

const EXCLUDE_FILES = ['*.log', '*.map', '*.min.js', '*.min.css', '*.lock', '*.tmp', '*.bak', '*.cache', '*.snap', '*.d.ts'];
const EXCLUDE_DIRS = [
  'node_modules/',
  '.git/',
  'dist/',
  'build/',
  '.cache/',
  '.next/',
  'coverage/',
  'vendor/',
  'tmp/',
  'logs/',
  '.venv/',
  'target/',
  '.pnpm-store/',
];

/** Dialog pilihan exclude: centang tipe berkas & folder, atau tambah pola sendiri. */
function ExcludeDialog({
  open,
  value,
  onClose,
  onApply,
}: {
  open: boolean;
  value: string[];
  onClose: () => void;
  onApply: (next: string[]) => void;
}) {
  const { t } = useI18n();
  const [picked, setPicked] = useState<string[]>(value);
  const [custom, setCustom] = useState('');

  useEffect(() => {
    if (open) {
      setPicked(value);
      setCustom('');
    }
  }, [open, value]);

  if (!open) return null;

  const toggle = (item: string) =>
    setPicked((prev) => (prev.includes(item) ? prev.filter((entry) => entry !== item) : [...prev, item]));

  const addCustom = () => {
    const raw = custom.trim();
    if (!raw) return;
    const item = raw.endsWith('/') ? raw : raw.includes('.') || raw.includes('*') ? raw : raw + '/';
    if (!picked.includes(item)) setPicked((prev) => [...prev, item]);
    setCustom('');
  };

  const extra = picked.filter((item) => !EXCLUDE_FILES.includes(item) && !EXCLUDE_DIRS.includes(item));

  const section = (title: string, options: string[]) => (
    <div className="flex flex-col gap-1">
      <div className="text-[10.5px] tracking-wide text-muted uppercase">{title}</div>
      <div className="flex flex-wrap gap-1">
        {options.map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => toggle(item)}
            className={cn(
              'mono cursor-pointer rounded border px-1.5 py-0.5 text-[11px] transition-colors',
              picked.includes(item) ? 'border-accent/60 bg-accent/15 text-accent' : 'border-line text-muted hover:text-ink',
            )}
          >
            {item}
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onMouseDown={onClose}>
      <div
        className="flex w-full max-w-lg flex-col gap-3 rounded-xl border border-line bg-panel p-4 shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={t('files.excludeTitle')}
      >
        <div className="flex items-center gap-2">
          <Icon name="filter" size={15} className="text-accent" />
          <span className="text-[13px] font-medium">{t('files.excludeTitle')}</span>
          <span className="ml-auto text-[11px] text-muted">
            {picked.length} {t('files.excludeSelected')}
          </span>
          <button type="button" className="btn cursor-pointer px-1" onClick={onClose} aria-label="Tutup">
            <Icon name="x" size={13} />
          </button>
        </div>

        {section(t('files.excludeFiles'), EXCLUDE_FILES)}
        {section(t('files.excludeDirs'), EXCLUDE_DIRS)}

        {extra.length ? (
          <div className="flex flex-col gap-1">
            <div className="text-[10.5px] tracking-wide text-muted uppercase">{t('files.excludeCustom')}</div>
            <div className="flex flex-wrap gap-1">
              {extra.map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => toggle(item)}
                  className="mono cursor-pointer rounded border border-accent/60 bg-accent/15 px-1.5 py-0.5 text-[11px] text-accent"
                  title={t("common.delete")}
                >
                  {item} ×
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <div className="flex items-center gap-2">
          <input
            value={custom}
            onChange={(event) => setCustom(event.target.value)}
            onKeyDown={(event) => event.key === 'Enter' && addCustom()}
            placeholder="*.csv atau vendor/"
            className="input flex-1 py-1 text-[12px]"
          />
          <button type="button" className="btn cursor-pointer" onClick={addCustom} disabled={!custom.trim()}>
            <Icon name="plus" size={13} /> {t('files.excludeAdd')}
          </button>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-line pt-2">
          <button type="button" className="btn cursor-pointer" onClick={() => setPicked([])}>
            {t('files.excludeReset')}
          </button>
          <button type="button" className="btn btn-primary cursor-pointer" onClick={() => onApply(picked)}>
            <Icon name="check" size={13} /> {t('files.excludeApply')}
          </button>
        </div>
      </div>
    </div>
  );
}
