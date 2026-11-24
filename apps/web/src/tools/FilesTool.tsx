import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { activeWorkspaceRoot, onWorkspace } from '../lib/workspace';
import { CodeEditor } from '../components/CodeEditor';
import { VirtualCode } from '../components/VirtualCode';
import { Badge, Button, CopyButton, Dialog, DropdownMenu, Empty, Icon, IconButton, Input, PageHeader, Select, Spinner, cn } from '../components/ui';
import { api, ApiError, qs } from '../lib/api';
import { bytes, timeAgo } from '../lib/format';
import { useI18n } from '../lib/i18n';
import { usePaletteIntent, type FilesSearchPayload } from '../lib/palette';
import { runWorkflow } from '../lib/workflow';
import { cleanPath, isInside, projectName, useProject } from '../lib/project';
import { usePlayer } from '../lib/player';
import { useConfirm } from '../components/confirm';
import { useToast } from '../components/toast';
import { renderMarkdown } from '../lib/markdown';
import { useSidebar } from '../lib/useSidebar';

type Entry = { name: string; path: string; dir: boolean; size: number; mtime: number; ext: string; hidden: boolean };
type Listing = { path: string; parent: string | null; entries: Entry[]; truncated: boolean };
type FileData = { path: string; binary: boolean; size: number; mtime: number; ext: string; text: string; truncated: boolean; offset: number; returned: number; more: boolean };
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
const THUMB = new Set([...IMAGE, ...VIDEO]);
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
        aria-expanded={open}
        style={{ paddingLeft: 6 + depth * 12 }}
        className={cn(
          'flex w-full items-center gap-1 rounded-control py-1 pr-2 text-left text-[12.5px] transition-colors duration-[var(--duration-fast)]',
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

function Thumb({ entry }: { entry: Entry }) {
  const thumbable = !entry.dir && THUMB.has(entry.ext.toLowerCase());
  const [failed, setFailed] = useState(!thumbable);
  if (failed) {
    return (
      <Icon
        name={entry.dir ? 'files' : 'markdown'}
        size={14}
        className={cn('shrink-0', entry.dir ? 'text-accent/80' : 'text-muted')}
      />
    );
  }
  return (
    <img
      src={'/api/fs/thumb' + qs({ path: entry.path, v: Math.round(entry.mtime) })}
      alt=""
      loading="lazy"
      onError={() => setFailed(true)}
      className="h-6 w-8 shrink-0 rounded-[3px] border border-line/60 bg-panel2 object-cover"
    />
  );
}

export default function FilesTool() {
  const { t } = useI18n();
  const confirm = useConfirm();
  const toast = useToast();
  const { projectPath } = useProject();
  const { play: playMedia } = usePlayer();
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
  const [chunkBusy, setChunkBusy] = useState(false);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState(false);
  const [recents, setRecents] = useState<Array<{ path: string; openedAt: number }>>([]);
  const [recentOpen, setRecentOpen] = useState(false);
  const [nameDialog, setNameDialog] = useState<{ mode: 'rename' | 'mkdir'; entry?: Entry } | null>(null);
  const [nameValue, setNameValue] = useState('');
  const [nameError, setNameError] = useState('');
  const uploadRef = useRef<HTMLInputElement>(null);
  const recentCloseRef = useRef<HTMLButtonElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const lastProject = useRef<string | null>(null);

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

  // Proyek global berubah (dipilih dari header) → buka langsung. Mount pertama
  // tidak ikut, supaya pilihan root terakhir (termasuk keluar dari proyek) tetap dipakai.
  useEffect(() => {
    const previous = lastProject.current;
    lastProject.current = projectPath;
    if (previous === null || !projectPath || previous === projectPath || !roots.length) return;
    if (!roots.some((root) => isInside(projectPath, root.path))) return;
    setRootPath(projectPath);
    localStorage.setItem('st:files:root', projectPath);
    localStorage.setItem('st:files:rootFor', projectPath);
    void loadListing(projectPath);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectPath, roots]);

  useEffect(() => {
    api
      .get<Root[]>('/fs/roots')
      .then((list) => {
        setRoots(list);
        const valid = (value: string | null) => Boolean(value) && list.some((root) => isInside(value!, root.path));
        const saved = localStorage.getItem('st:files:root');
        // Root terakhir hanya dipakai untuk proyek yang sama; proyek baru tetap dibuka.
        const savedFor = localStorage.getItem('st:files:rootFor');
        const remembered = valid(saved) && savedFor === (projectPath ?? '') ? saved : null;
        const workspace = valid(activeWorkspaceRoot()) ? activeWorkspaceRoot() : null;
        const start = workspace ?? remembered ?? (valid(projectPath) ? projectPath : list[0]?.path);
        if (start) {
          setRootPath(start);
          void loadListing(start);
        }
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : t('err.loadRoots')));
  }, [loadListing]);

  useEffect(
    () =>
      onWorkspace((workspace) => {
        if (!roots.some((root) => isInside(workspace.root, root.path))) return;
        setRootPath(workspace.root);
        void loadListing(workspace.root);
      }),
    [roots, loadListing],
  );

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
    const ext = (entry.ext || entry.path.split('.').pop() || '').toLowerCase();
    // Audio/video tidak membuka halaman: diputar di pemutar global pojok kanan bawah.
    if (AUDIO.has(ext) || VIDEO.has(ext)) {
      playMedia({
        path: entry.path,
        name: entry.path.split('/').pop() ?? entry.path,
        ext,
        kind: VIDEO.has(ext) ? 'video' : 'audio',
      });
      void loadRecents();
      return;
    }
    setBusy(true);
    setError('');
    try {
      setOffice(null);
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

  const loadChunk = async () => {
    if (!file || !file.more || chunkBusy || file.binary) return;
    setChunkBusy(true);
    setError('');
    try {
      const data = await api.get<FileData>('/fs/read' + qs({ path: file.path, offset: file.offset + file.returned }));
      setFile({ ...data, text: file.text + data.text });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('err.openFile'));
    } finally {
      setChunkBusy(false);
    }
  };

  const save = async () => {
    // Ctrl+S pada mode baca tidak boleh menulis apa pun ke disk.
    if (!file || !editing) return;
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

  const rename = (entry: Entry) => {
    setNameError('');
    setNameValue(entry.name);
    setNameDialog({ mode: 'rename', entry });
  };

  const makeFolder = () => {
    if (!listing) return;
    setNameError('');
    setNameValue('');
    setNameDialog({ mode: 'mkdir' });
  };

  const submitName = async (event: FormEvent) => {
    event.preventDefault();
    if (!nameDialog || !listing) return;
    const name = nameValue.trim();
    if (!name) return;
    if (name === '.' || name === '..' || /[\\/]/.test(name)) {
      setNameError(t('files.nameInvalid'));
      nameInputRef.current?.focus();
      return;
    }
    if (nameDialog.mode === 'rename' && name === nameDialog.entry?.name) {
      setNameDialog(null);
      return;
    }
    try {
      if (nameDialog.mode === 'rename' && nameDialog.entry) {
        await api.post('/fs/rename', { path: nameDialog.entry.path, name });
        toast(t('common.renamed'), 'ok');
        if (file?.path === nameDialog.entry.path) setFile(null);
      } else {
        await api.post('/fs/mkdir', { path: listing.path + '/' + name });
        toast(t('common.created'), 'ok');
      }
      setNameDialog(null);
      await loadListing(listing.path);
    } catch (err) {
      setNameError(err instanceof ApiError ? err.message : t(nameDialog.mode === 'rename' ? 'err.rename' : 'err.mkdir'));
      nameInputRef.current?.focus();
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
    const path = cleanPath(listing.path);
    const base = roots.find((root) => isInside(path, root.path))?.path;
    if (!base) return [{ name: '/', path: '/' }];
    const out = [{ name: base === '/' ? '/' : base.split('/').filter(Boolean).pop() ?? '/', path: base }];
    let acc = base === '/' ? '' : base;
    for (const part of path.slice(base === '/' ? 0 : base.length).split('/').filter(Boolean)) {
      acc += '/' + part;
      out.push({ name: part, path: acc || '/' });
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

  const openRoot = (path: string) => {
    setRootPath(path);
    const base = roots.find((root) => isInside(path, root.path))?.path;
    if (base) {
      localStorage.setItem('st:files:root', base);
      localStorage.setItem('st:files:rootFor', projectPath ?? '');
    }
    void loadListing(path);
  };

  const fileExt = (file?.ext ?? '').toLowerCase();
  const lineCount = file && !file.binary ? file.text.split('\n').length : 0;
  // Di atas ambang ini textarea + gutter penuh membuat UI hang; pakai penampil virtual.
  const largeFile = Boolean(file) && !file!.binary && (file!.truncated || lineCount > 2000);
  const inProject = Boolean(projectPath) && (rootPath === projectPath || rootPath.startsWith(projectPath + '/'));
  const treeRoots = inProject && projectPath ? [{ path: projectPath, label: projectName(projectPath) }] : roots;
  const rootValue = roots.find((root) => isInside(rootPath, root.path))?.path ?? rootPath;
  const parent = listing?.parent ? cleanPath(listing.parent) : null;
  const parentPath =
    parent && roots.some((root) => isInside(parent, root.path)) ? parent : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="File Explorer" subtitle={listing ? cleanPath(listing.path) + ' · ' + rows.length + ' ' + t('files.items') : t('files.subtitle')} icon="files">
        <IconButton
          icon="panel"
          size="md"
          className="hidden sm:inline-flex"
          onClick={togglePanel}
          label={panelOpen ? t('files.hideTree') : t('files.showTree')}
        />
        <IconButton
          icon="panel"
          size="md"
          className="sm:hidden"
          onClick={togglePanel}
          label={panelOpen ? t('files.hideTree') : t('files.showTree')}
        />
        {projectPath ? (
          <Button
            size="sm"
            icon="folderPlus"
            variant="subtle"
            className="hidden border-accent/40 text-accent lg:inline-flex"
            onClick={() => {
              setRootPath(projectPath);
              localStorage.setItem('st:files:root', projectPath);
              localStorage.setItem('st:files:rootFor', projectPath);
              void loadListing(projectPath);
            }}
            title={projectPath}
          >
            {projectName(projectPath)}
          </Button>
        ) : null}
        <Select
          size="sm"
          value={rootValue}
          onChange={(next) => openRoot(next)}
          label={t('files.root')}
          className="w-32 sm:w-40"
          options={roots.map((root) => ({ value: root.path, label: root.label }))}
        />
        <div role="group" aria-label={t('files.modeName')} className="seg">
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
              aria-pressed={deep === value}
              className="seg-item"
            >
              {label}
            </button>
          ))}
        </div>
        <div className="relative">
          <Icon name="search" size={13} className="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-muted" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void search()}
            placeholder={deep ? t('files.searchContent') : t('files.searchName')}
            aria-label={deep ? t('files.searchContent') : t('files.searchName')}
            data-action="files:search"
            className="w-36 min-h-8 py-1 pl-7 text-[12px] sm:w-44"
          />
        </div>
        <div className="relative hidden xl:block">
          <Input
            value={include}
            onChange={(e) => setInclude(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void search()}
            placeholder={t('files.includeHint')}
            aria-label={t('files.includeHint')}
            title={t('files.includeHint')}
            className={cn('w-40 min-h-8 py-1 text-[11.5px]', include && 'border-accent/40')}
          />
        </div>
        <Button
          size="sm"
          icon="filter"
          variant="subtle"
          className={cn('hidden lg:inline-flex', exclude.length > 0 && 'border-accent/40 text-accent')}
          onClick={() => setExcludeOpen(true)}
          title={t('files.excludeTitle')}
        >
          {t('files.exclude')}
          {exclude.length ? <Badge tone="accent">{exclude.length}</Badge> : null}
        </Button>
        {searching ? (
          <Button size="sm" icon="x" variant="danger" onClick={cancelSearch} title={t('files.cancelSearch')}>
            {t('common.cancel')}
          </Button>
        ) : (
          <IconButton icon="search" size="md" onClick={() => void search()} label={t('common.search')} />
        )}
        <div className="hidden items-center gap-1 lg:flex">
          <IconButton icon="folderPlus" size="md" onClick={makeFolder} disabled={!listing} label={t('files.newFolder')} />
          <IconButton icon="upload" size="md" onClick={() => uploadRef.current?.click()} disabled={!listing} label={t('files.upload')} />
          <IconButton icon="refresh" size="md" onClick={() => listing && void loadListing(listing.path)} disabled={!listing} label={t('files.reload')} />
        </div>
        <DropdownMenu
          className="lg:hidden"
          label={t('common.more')}
          triggerIcon="chevronDown"
          triggerAriaLabel={t('common.more')}
          triggerTitle={t('common.more')}
          align="end"
          entries={[
            { id: 'files-menu-new', type: 'item', label: t('files.newFolder'), icon: 'folderPlus', disabled: !listing, onSelect: makeFolder },
            { id: 'files-menu-upload', type: 'item', label: t('files.upload'), icon: 'upload', disabled: !listing, onSelect: () => uploadRef.current?.click() },
            { id: 'files-menu-reload', type: 'item', label: t('files.reload'), icon: 'refresh', disabled: !listing, onSelect: () => { if (listing) void loadListing(listing.path); } },
          ]}
        />
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
        <div id="files-tree" className="hidden w-64 shrink-0 flex-col overflow-y-auto border-r border-line p-2 sm:flex">
          {recents.length ? (
            <div className="mb-1 border-b border-line pb-1">
              <div className="flex items-center gap-1 px-1 pb-1">
                <span className="field-label">{t('files.recent')}</span>
                {recents.length ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="ml-auto min-h-6 px-1 text-[12px] text-accent/80 hover:text-accent"
                    onClick={() => setRecentOpen(true)}
                  >
                    {t('files.allRecent')}
                  </Button>
                ) : null}
              </div>
              {recents.slice(0, 5).map((item) => (
                <button
                  key={item.path}
                  type="button"
                  onClick={() => void openFile({ path: item.path, ext: (item.path.split('.').pop() ?? '').toLowerCase() } as Entry)}
                  title={item.path}
                  className="flex w-full items-center gap-2 rounded-control px-1 py-0.5 text-left transition-colors duration-[var(--duration-fast)] hover:bg-panel2 focus-visible:bg-panel2"
                >
                  <span className="min-w-0 flex-1 truncate text-[11.5px] text-muted hover:text-ink">{item.path.split('/').pop()}</span>
                  <span className="shrink-0 text-[11.5px] text-muted/60 tabular-nums">{timeAgo(item.openedAt)}</span>
                </button>
              ))}
            </div>
          ) : null}
          {treeRoots.map((root) => (
            <TreeNode
              key={root.path}
              entry={{ name: root.label, path: root.path, dir: true, size: 0, mtime: 0, ext: '', hidden: false }}
              depth={0}
              selected={listing?.path ?? ''}
              onPick={(path) => void loadListing(path)}
            />
          ))}
          {projectPath || parentPath ? (
            <Button
              variant="subtle"
              size="sm"
              icon="back"
              onClick={() => parentPath && void loadListing(parentPath)}
              disabled={!parentPath}
              title={parentPath ?? undefined}
              className="mt-1 w-full justify-start gap-1.5 px-1.5 text-[11.5px]"
            >
              <span className="truncate">{t('files.up')}</span>
            </Button>
          ) : null}
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
                  aria-current={index === crumbs.length - 1 ? 'page' : undefined}
                  className={cn(
                    'rounded-control px-1 py-0.5 transition-colors duration-[var(--duration-fast)] hover:bg-panel2 focus-visible:bg-panel2',
                    index === crumbs.length - 1 ? 'text-ink' : 'text-muted',
                  )}
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

          {error ? (
            <div role="alert" className="border-b border-line bg-bad/5 px-3 py-2 text-xs text-bad">
              {error}
            </div>
          ) : null}
          {grepWarning ? (
            <div role="status" className="flex items-center gap-2 border-b border-line bg-warn/10 px-3 py-1.5 text-[11.5px] text-warn">
              <Badge tone="warn">{t('files.warning')}</Badge>
              <span className="min-w-0 flex-1 truncate">{grepWarning}</span>
            </div>
          ) : null}

          {office ? (
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line px-3 py-2">
                <IconButton icon="back" size="md" onClick={() => { setOffice(null); setEditing(false); }} label={t('files.back')} />
                <Icon name="files" size={14} className="shrink-0 text-accent" />
                <span className="mono truncate text-[12.5px] font-medium">{office.path.split('/').pop()}</span>
                <span className="text-[11.5px] text-muted tabular-nums">
                  {office.kind.toUpperCase()} · {bytes(office.size)} · {timeAgo(office.mtime)}
                </span>
                <div className="ml-auto flex items-center gap-1.5">
                  {office.editable !== 'none' && !editing ? (
                    <Button size="sm" icon="edit" onClick={() => setEditing(true)}>
                      {t('common.edit')}
                    </Button>
                  ) : null}
                  {editing ? (
                    <>
                      <Button size="sm" variant="primary" icon="save" onClick={() => void saveOffice()}>
                        {t("common.save")}
                      </Button>
                      <Button size="sm" variant="subtle" onClick={() => { setEditing(false); void loadOffice(office.path); }}>
                        Batal
                      </Button>
                    </>
                  ) : null}
                  <a className="btn btn-sm" href={RAW + encodeURIComponent(office.path) + '&download=1'} download aria-label={t('common.download')}>
                    <Icon name="download" size={13} />
                  </a>
                </div>
              </div>

              {office.editable === 'none' ? (
                <div role="status" className="border-b border-line bg-panel2/30 px-3 py-1.5 text-[11.5px] text-muted">
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
                      aria-label={office.path}
                      className="mono h-full min-h-[60vh] w-full resize-none rounded-panel border border-line bg-[#070d14] p-4 text-[12.5px] leading-relaxed text-ink outline-none transition-colors duration-[var(--duration-fast)] hover:border-line/80 focus:border-accent/60 focus:ring-2 focus:ring-accent/15"
                    />
                  ) : (
                    <pre className="mono whitespace-pre-wrap rounded-panel border border-line bg-[#070d14] p-4 text-[12.5px] leading-relaxed text-ink/90">
                      {officeBody || '(dokumen kosong)'}
                    </pre>
                  )
                ) : (
                  office.blocks.map((block, blockIndex) => {
                    if (block.type === 'text') {
                      return (
                        <pre key={blockIndex} className="mono whitespace-pre-wrap rounded-panel border border-line bg-[#070d14] p-4 text-[12.5px] leading-relaxed text-ink/90">
                          {block.lines.join(String.fromCharCode(10))}
                        </pre>
                      );
                    }
                    return (
                      <div key={blockIndex}>
                        <div className="field-label mb-1.5">{block.name ?? 'Sheet'}</div>
                        <div className="overflow-auto rounded-panel border border-line">
                          <table className="w-full border-collapse text-[12px]">
                            <tbody>
                              {block.rows.map((row, rowIndex) => (
                                <tr key={rowIndex}>
                                  {row.map((value, colIndex) => {
                                    const ref = block.refs?.[rowIndex]?.[colIndex] ?? '';
                                    const key = blockIndex + ':' + ref;
                                    return (
                                      <td key={colIndex} className="border-b border-r border-line/60 p-0 align-top last:border-r-0">
                                        {editing && ref ? (
                                          <input
                                            value={sheetDraft[key] ?? value}
                                            onChange={(event) => setSheetDraft({ ...sheetDraft, [key]: event.target.value })}
                                            className="w-full min-w-24 bg-transparent px-2 py-1 text-[12px] text-ink outline-none transition-colors duration-[var(--duration-fast)] hover:bg-panel2/40 focus:bg-panel2 focus:ring-1 focus:ring-accent/40 focus:ring-inset"
                                          />
                                        ) : (
                                          <span className="block min-w-24 px-2 py-1 text-ink/90 tabular-nums">{value}</span>
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
                <IconButton icon="back" size="md" onClick={() => setFile(null)} label={t('files.back')} />
                <Icon name="markdown" size={14} className="shrink-0 text-accent" />
                <span className="mono truncate text-[12.5px] font-medium">{file.path.split('/').pop()}</span>
                <span className="text-[11.5px] text-muted tabular-nums">
                  {bytes(file.size)} · {timeAgo(file.mtime)}
                  {file.binary ? '' : ' · ' + lineCount + ' baris'}
                  {largeFile ? ' · mode baca (berkas besar)' : ''}
                </span>
                {largeFile ? (
                  <span className="mono text-[12px] text-muted tabular-nums">
                    {bytes(file.offset + file.returned)} / {bytes(file.size)}
                  </span>
                ) : null}
                <div className="ml-auto flex items-center gap-1.5">
                  {largeFile && file.more ? (
                    <Button size="sm" icon="download" loading={chunkBusy} onClick={() => void loadChunk()}>
                      {chunkBusy ? '…' : t('files.loadMore')}
                    </Button>
                  ) : null}
                  {!file.binary && fileExt === 'md' ? (
                    <Button
                      size="sm"
                      icon="eye"
                      variant={preview ? 'primary' : 'default'}
                      aria-pressed={preview}
                      onClick={() => setPreview(!preview)}
                    >
                      {t('files.preview')}
                    </Button>
                  ) : null}
                  {['html', 'htm'].includes(fileExt) && !largeFile ? (
                    <Button
                      size="sm"
                      icon="html"
                      data-action="files:htmlStudio"
                      onClick={() =>
                        runWorkflow({
                          tool: 'html-studio',
                          action: 'open',
                          payload: {
                            path: file.path,
                            name: file.path.split('/').pop() ?? file.path,
                            content: file.text,
                            truncated: false,
                          },
                        })
                      }
                    >
                      {t('files.openHtmlStudio')}
                    </Button>
                  ) : null}
                  {!file.binary && !editing && !largeFile ? (
                    <Button size="sm" icon="edit" onClick={() => setEditing(true)}>
                      {t('common.edit')}
                    </Button>
                  ) : null}
                  {editing ? (
                    <>
                      <Button size="sm" variant="primary" icon="save" onClick={save}>
                        {t("common.save")}
                      </Button>
                      <Button size="sm" variant="subtle" onClick={() => { setEditing(false); setDraft(file.text); }}>
                        Batal
                      </Button>
                    </>
                  ) : null}
                  <CopyButton text={file.path} label="Path" />
                  {['png', 'jpg', 'jpeg', 'webp', 'pdf'].includes(fileExt) ? (
                    <Button
                      size="sm"
                      icon="compress"
                      title={t('files.compressAction')}
                      data-action="files:compress"
                      onClick={() => runWorkflow({ tool: 'compress', action: 'pick', payload: file.path })}
                    >
                      {t('files.compressAction')}
                    </Button>
                  ) : null}
                  <a className="btn btn-sm" href={RAW + encodeURIComponent(file.path) + '&download=1'} download aria-label={t('common.download')}>
                    <Icon name="download" size={13} />
                  </a>
                  <IconButton icon="trash" size="md" tone="danger" onClick={() => void remove(file.path)} label={t('common.delete')} />
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-hidden p-3">
                {file.binary ? (
                  IMAGE.has(fileExt) ? (
                    <div className="flex h-full items-center justify-center overflow-auto rounded-lg border border-line bg-[#070d14] p-4">
                      <img src={RAW + encodeURIComponent(file.path)} alt={file.path} className="max-h-full max-w-full object-contain" />
                    </div>
                  ) : fileExt === 'pdf' ? (
                    <iframe title={file.path} src={RAW + encodeURIComponent(file.path)} className="h-full w-full rounded-lg border border-line bg-white" />
                  ) : (
                    <div className="flex h-full flex-col items-center justify-center gap-3 rounded-lg border border-warn/30 bg-warn/5 p-6 text-center">
                      <span className="grid size-11 place-items-center rounded-xl border border-warn/30 bg-warn/10 text-warn">
                        <Icon name="eyeOff" size={20} />
                      </span>
                      <div className="text-[13px] font-medium text-ink">
                        {t('files.previewUnsupported')} .{fileExt || 'berkas'}
                      </div>
                      <p className="max-w-md text-[11.5px] text-muted">{t('files.previewHint')}</p>
                      <a className="btn" href={RAW + encodeURIComponent(file.path) + '&download=1'} download>
                        <Icon name="download" /> Unduh untuk membuka
                      </a>
                    </div>
                  )
                ) : largeFile ? (
                  <VirtualCode value={file.text} ext={fileExt} resetKey={file.path} label={t('files.contentPane')} />
                ) : preview ? (
                  <div
                    tabIndex={0}
                    role="region"
                    aria-label={t('files.contentPane')}
                    className="md h-full overflow-y-auto rounded-lg border border-line bg-[#070d14] p-5"
                    dangerouslySetInnerHTML={{
                      __html: renderMarkdown(
                        file.text,
                        { done: t('markdown.taskDone'), open: t('markdown.taskOpen'), code: t('markdown.codeBlock') },
                        { headingOffset: 1 },
                      ),
                    }}
                  />
                ) : (
                  <CodeEditor value={draft} onChange={setDraft} readOnly={!editing} onSave={save} wrap />
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
                      className="cursor-pointer border-b border-line/50 transition-colors duration-[var(--duration-fast)] hover:bg-panel2/60"
                    >
                      <td className="mono px-3 py-1 whitespace-nowrap text-muted tabular-nums">
                        {hit.path.split('/').pop()}:{hit.line}
                      </td>
                      <td className="mono truncate px-2 py-1 text-ink/90">{hit.text}</td>
                      <td className="px-3 py-1 text-right text-[11.5px] text-muted">{hit.path.replace(listing?.path ?? '', '')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="min-h-0 flex-1 overflow-auto">
              <table className="w-full table-fixed border-collapse text-[12.5px]">
                <thead className="sticky top-0 z-10 bg-panel text-left text-[11.5px] tracking-wide text-muted uppercase">
                  <tr>
                    {([
                      ['name', t('files.name'), 'text-left'],
                      ['size', t('files.size'), 'text-right'],
                      ['mtime', t('files.modified'), 'text-left'],
                    ] as const).map(([key, label, align]) => (
                      <th
                        key={key}
                        aria-sort={sort.key === key ? (sort.dir === 1 ? 'ascending' : 'descending') : undefined}
                        className={cn('border-b border-line px-3 py-2 font-medium', align, key === 'mtime' && 'hidden md:table-cell', key === 'size' && 'hidden sm:table-cell')}
                      >
                        <button
                          type="button"
                          onClick={() => toggleSort(key)}
                          className={cn(
                            'inline-flex min-h-6 cursor-pointer items-center gap-1 rounded-control px-1 uppercase transition-colors duration-[var(--duration-fast)] hover:text-ink focus-visible:text-ink',
                            sort.key === key ? 'text-accent' : 'text-muted',
                          )}
                          title={t('files.sortBy') + ' ' + label.toLowerCase()}
                        >
                          {label}
                          <span aria-hidden="true" className="text-[11.5px]">{sort.key === key ? (sort.dir === 1 ? '▲' : '▼') : '↕'}</span>
                        </button>
                      </th>
                    ))}
                    <th className="w-[7.25rem] border-b border-line px-3 py-2 text-right font-medium">{t('files.action')}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((entry) => (
                    <tr
                      key={entry.path}
                      className="group cursor-pointer transition-colors duration-[var(--duration-fast)] hover:bg-panel2/60 focus-within:bg-panel2/60"
                      onClick={() => (entry.dir ? void loadListing(entry.path) : void openFile(entry))}
                    >
                      <td className="border-b border-line/60 px-3 py-2">
                        <div className="flex min-w-0 items-center gap-2">
                          <Thumb entry={entry} />
                          <span className={cn('truncate', entry.hidden && 'text-muted')}>{entry.name}</span>
                          {entry.dir ? <span className="text-[11.5px] text-muted/60">{t('files.dir')}</span> : null}
                        </div>
                      </td>
                      <td className="mono hidden border-b border-line/60 px-3 py-2 text-right text-[11.5px] text-muted tabular-nums sm:table-cell">{entry.dir ? '-' : bytes(entry.size)}</td>
                      <td className="hidden border-b border-line/60 px-3 py-2 text-[11.5px] text-muted tabular-nums md:table-cell">{timeAgo(entry.mtime)}</td>
                      <td className="border-b border-line/60 px-3 py-2 text-right whitespace-nowrap opacity-70 focus-within:opacity-100 group-hover:opacity-100">
                        {!entry.dir ? (
                          <a
                            className="btn btn-ghost btn-sm min-w-6 px-1"
                            href={RAW + encodeURIComponent(entry.path) + '&download=1'}
                            download
                            title={t('common.download')}
                            aria-label={t('common.download') + ': ' + entry.name}
                            onClick={(e) => e.stopPropagation()}
                          >
                            <Icon name="download" size={13} />
                          </a>
                        ) : null}
                        <IconButton
                          icon="copy"
                          size="sm"
                          className="min-w-6 px-1"
                          tooltip={t('files.copyPath')}
                          label={t('files.copyPath') + ': ' + entry.path}
                          onClick={(e) => {
                            e.stopPropagation();
                            void navigator.clipboard?.writeText(entry.path).then(() => setError(''));
                          }}
                        />
                        <IconButton
                          icon="edit"
                          size="sm"
                          className="min-w-6 px-1"
                          tooltip={t('files.rename')}
                          label={t('files.rename') + ': ' + entry.name}
                          onClick={(e) => {
                            e.stopPropagation();
                            void rename(entry);
                          }}
                        />
                        <IconButton
                          icon="trash"
                          size="sm"
                          tone="danger"
                          className="min-w-6 px-1"
                          tooltip={t('common.delete')}
                          label={t('common.delete') + ': ' + entry.name}
                          onClick={(e) => {
                            e.stopPropagation();
                            void remove(entry.path);
                          }}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {rows.length === 0 ? <Empty icon="files" text={t('files.empty')} /> : null}
            </div>
          )}
        </div>
      </div>

      <Dialog
        open={recentOpen}
        onClose={() => setRecentOpen(false)}
        size="lg"
        labelledBy="files-recent-title"
        initialFocusRef={recentCloseRef}
        className="max-h-[70vh] gap-2 p-3"
      >
        <div className="flex items-center gap-2">
          <Icon name="files" size={14} className="shrink-0 text-accent" />
          <h2 id="files-recent-title" className="text-[13px] font-medium">{t('files.recentTitle')}</h2>
          <IconButton
            ref={recentCloseRef}
            icon="x"
            size="sm"
            className="ml-auto"
            onClick={() => setRecentOpen(false)}
            label={t('common.close')}
          />
        </div>
        <div className="min-h-24 flex-1 overflow-y-auto rounded-control border border-line">
          {recents.map((item) => (
            <button
              key={item.path}
              type="button"
              onClick={() => {
                setRecentOpen(false);
                void openFile({ path: item.path, ext: (item.path.split('.').pop() ?? '').toLowerCase() } as Entry);
              }}
              title={item.path}
              className="flex min-h-8 w-full items-center gap-2 border-b border-line/50 px-2 py-1.5 text-left transition-colors duration-[var(--duration-fast)] last:border-0 hover:bg-panel2 focus-visible:bg-panel2"
            >
              <Icon name="markdown" size={13} className="shrink-0 text-muted" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12px] text-ink/90">{item.path.split('/').pop()}</span>
                <span className="mono block truncate text-[11.5px] text-muted/70">{item.path}</span>
              </span>
              <span className="shrink-0 text-[12px] text-muted/70 tabular-nums">{timeAgo(item.openedAt)}</span>
            </button>
          ))}
        </div>
      </Dialog>
      <Dialog
        open={Boolean(nameDialog)}
        onClose={() => setNameDialog(null)}
        size="sm"
        labelledBy="files-name-title"
        initialFocusRef={nameInputRef}
        className="gap-3 p-4"
      >
        <h2 id="files-name-title" className="text-[15px] font-semibold">
          {nameDialog ? t(nameDialog.mode === 'rename' ? 'files.rename' : 'files.newFolder') : ''}
        </h2>
        <form className="flex flex-col gap-3" onSubmit={(event) => void submitName(event)}>
          <label className="flex flex-col gap-1.5">
            <span className="label">{t('files.name')}</span>
            <Input
              ref={nameInputRef}
              value={nameValue}
              onChange={(event) => {
                setNameValue(event.target.value);
                setNameError('');
              }}
              invalid={Boolean(nameError)}
              aria-describedby={nameError ? 'files-name-error' : undefined}
              autoComplete="off"
            />
          </label>
          {nameError ? (
            <p id="files-name-error" role="alert" className="text-[12.5px] text-bad">
              {nameError}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button variant="subtle" onClick={() => setNameDialog(null)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" variant="primary" disabled={!nameValue.trim()}>
              {t('common.save')}
            </Button>
          </div>
        </form>
      </Dialog>
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
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) {
      setPicked(value);
      setCustom('');
    }
  }, [open, value]);

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
    <div className="flex flex-col gap-1.5">
      <div className="field-label">{title}</div>
      <div className="flex flex-wrap gap-1">
        {options.map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => toggle(item)}
            aria-pressed={picked.includes(item)}
            className={cn(
              'mono cursor-pointer rounded-control border px-1.5 py-0.5 text-[11.5px] transition-colors duration-[var(--duration-fast)] focus-visible:border-accent',
              picked.includes(item) ? 'border-accent/60 bg-accent/15 text-accent' : 'border-line text-muted hover:border-line/80 hover:text-ink',
            )}
          >
            {item}
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      labelledBy="files-exclude-title"
      initialFocusRef={closeRef}
      className="gap-3 p-4"
    >
      <div className="flex items-center gap-2">
        <Icon name="filter" size={15} className="shrink-0 text-accent" />
        <h2 id="files-exclude-title" className="text-[13px] font-medium">{t('files.excludeTitle')}</h2>
        <span className="ml-auto text-[11.5px] text-muted tabular-nums">
          {picked.length} {t('files.excludeSelected')}
        </span>
        <IconButton ref={closeRef} icon="x" size="sm" onClick={onClose} label={t('common.close')} />
      </div>

      {section(t('files.excludeFiles'), EXCLUDE_FILES)}
      {section(t('files.excludeDirs'), EXCLUDE_DIRS)}

      {extra.length ? (
        <div className="flex flex-col gap-1.5">
          <div className="field-label">{t('files.excludeCustom')}</div>
          <div className="flex flex-wrap gap-1">
            {extra.map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => toggle(item)}
                aria-pressed="true"
                className="mono cursor-pointer rounded-control border border-accent/60 bg-accent/15 px-1.5 py-0.5 text-[11.5px] text-accent transition-colors duration-[var(--duration-fast)] hover:bg-accent/20"
                title={t("common.delete")}
              >
                {item} ×
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="flex items-center gap-2">
        <Input
          value={custom}
          onChange={(event) => setCustom(event.target.value)}
          onKeyDown={(event) => event.key === 'Enter' && addCustom()}
          placeholder={t('files.excludePlaceholder')}
          aria-label={t('files.excludePlaceholder')}
          className="min-h-8 flex-1 py-1 text-[12px]"
        />
        <Button size="sm" icon="plus" onClick={addCustom} disabled={!custom.trim()}>
          {t('files.excludeAdd')}
        </Button>
      </div>

      <div className="flex items-center justify-end gap-2 border-t border-line pt-2">
        <Button variant="subtle" onClick={() => setPicked([])}>
          {t('files.excludeReset')}
        </Button>
        <Button variant="primary" icon="check" onClick={() => onApply(picked)}>
          {t('files.excludeApply')}
        </Button>
      </div>
    </Dialog>
  );
}
