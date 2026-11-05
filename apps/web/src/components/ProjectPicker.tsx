import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Icon, Spinner, cn } from './ui';
import { api, ApiError } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { projectName, useProject } from '../lib/project';

type Listing = { path: string; parent: string | null; entries: Array<{ name: string; path: string; dir: boolean }> };
type Root = { path: string; label: string };

/**
 * Pemilih folder proyek: dropdown di kanan atas + modal penjelajah folder.
 * Path disimpan di ProjectProvider (localStorage), jadi umur pilihan lintas reload.
 */
export function ProjectPicker({ right }: { right?: ReactNode }) {
  const { t } = useI18n();
  const { projectPath, setProject, clearProject, recent, forget } = useProject();
  const [open, setOpen] = useState(false);
  const [picker, setPicker] = useState<Listing | null>(null);
  const [roots, setRoots] = useState<Root[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const requestRef = useRef(0);

  const browse = useCallback(async (path: string) => {
    const request = ++requestRef.current;
    setBusy(true);
    setError('');
    try {
      const result = await api.get<Listing>('/fs/list?path=' + encodeURIComponent(path));
      if (request === requestRef.current) setPicker(result);
    } catch (err) {
      if (request === requestRef.current) {
        setError(err instanceof ApiError ? err.message : t('err.readFolder'));
      }
    } finally {
      if (request === requestRef.current) setBusy(false);
    }
  }, [t]);

  const closePicker = useCallback(() => {
    requestRef.current += 1;
    setPicker(null);
    setBusy(false);
    setError('');
  }, []);

  const openPicker = async () => {
    setOpen(false);
    closePicker();
    if (!roots.length) {
      try {
        setRoots(await api.get<Root[]>('/fs/roots'));
      } catch {
        setRoots([]);
      }
    }
    const start = projectPath || roots[0]?.path;
    if (start) void browse(start);
    else {
      const list = roots.length ? roots : await api.get<Root[]>('/fs/roots').catch(() => []);
      setRoots(list);
      if (list[0]) void browse(list[0].path);
    }
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [open]);

  const pick = (path: string) => {
    setProject(path);
    closePicker();
  };

  return (
    <>
      {/* backdrop-blur membuat stacking context; z-40 agar dropdown tidak tertutup PageHeader. */}
      <div className="relative z-40 flex h-10 shrink-0 items-center gap-2 border-b border-line bg-panel/35 px-4 backdrop-blur-sm">
        <span className="label hidden sm:inline">{t('project.label')}</span>
        {projectPath ? (
          <span className="flex min-w-0 items-center gap-1.5" title={projectPath}>
            <Icon name="files" size={13} className="shrink-0 text-accent/80" />
            <span className="truncate text-[12px] text-ink">{projectName(projectPath)}</span>
            <span className="mono hidden truncate text-[10.5px] text-muted/70 lg:inline">{projectPath}</span>
          </span>
        ) : (
          <span className="text-[11.5px] text-muted">{t('project.none')}</span>
        )}
        {/* Dropdown di pojok kanan atas */}
        <div ref={rootRef} className="relative ml-auto">
          <button
            type="button"
            data-action="project:toggle"
            onClick={() => setOpen((prev) => !prev)}
            className={cn('btn min-h-7 cursor-pointer px-2 py-1 text-[11.5px]', projectPath && 'border-accent/40 text-accent')}
            title={t('project.pick')}
          >
            <Icon name="folderPlus" size={13} />
            <span className="hidden sm:inline">{t('project.choose')}</span>
            <Icon name={open ? 'chevronDown' : 'chevronRight'} size={11} />
          </button>
          {open ? (
            <div className="absolute top-full right-0 z-50 mt-1 flex w-80 flex-col gap-1 rounded-lg border border-line bg-panel p-1.5 shadow-2xl" role="menu">
              <div className="px-1.5 pt-1 pb-0.5 label">{t('project.choose')}</div>
              <button type="button" className="nav-item w-full" onClick={() => void openPicker()}>
                <Icon name="folderPlus" size={14} /> {t('project.pick')}
              </button>
              {projectPath ? (
                <button type="button" className="nav-item w-full text-muted" onClick={() => { clearProject(); setOpen(false); }}>
                  <Icon name="x" size={13} /> {t('project.clear')}
                </button>
              ) : null}
              {recent.length ? <div className="mt-1 border-t border-line px-1.5 pt-1.5 pb-0.5 label">{t('project.recent')}</div> : null}
              {recent.map((path) => (
                <div key={path} className={cn('group flex items-center gap-1 rounded-md px-1.5 py-1 text-[11.5px]', path === projectPath ? 'bg-accent/10 text-ink' : 'text-muted hover:bg-panel2')}>
                  <button type="button" className="min-w-0 flex-1 cursor-pointer text-left" onClick={() => { setProject(path); setOpen(false); }} title={path}>
                    <span className="block truncate text-ink/85">{projectName(path)}</span>
                    <span className="mono block truncate text-[10px] text-muted/70">{path}</span>
                  </button>
                  <button type="button" className="cursor-pointer px-1 text-muted opacity-0 group-hover:opacity-100 hover:text-bad" onClick={() => forget(path)} title={t('project.forget')}>
                    <Icon name="x" size={11} />
                  </button>
                </div>
              ))}
            </div>
          ) : null}
        </div>
        {right}
      </div>

      {picker || busy || error ? (
        <div className="fixed inset-0 z-[65] flex items-center justify-center bg-black/55 p-4" onMouseDown={closePicker}>
          <div className="flex max-h-[80vh] w-full max-w-lg flex-col gap-2 rounded-xl border border-line bg-panel p-3 shadow-2xl" onMouseDown={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-label={t('project.pickTitle')}>
            <div className="flex items-center gap-2">
              <Icon name="files" size={14} className="text-accent" />
              <span className="text-[13px] font-medium">{t('project.pickTitle')}</span>
              <button type="button" className="btn btn-ghost ml-auto cursor-pointer px-1 py-0.5" onClick={closePicker} title={t('common.close')}>
                <Icon name="x" size={13} />
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-1">
              {roots.map((root) => (
                <button key={root.path} type="button" onClick={() => void browse(root.path)} className="cursor-pointer rounded px-1.5 py-0.5 text-[11px] text-muted hover:bg-panel2 hover:text-ink">
                  {root.label}
                </button>
              ))}
              <button type="button" disabled={!picker?.parent} onClick={() => picker?.parent && void browse(picker.parent)} className="ml-auto cursor-pointer rounded px-1 text-muted hover:text-ink disabled:opacity-30" title={t('project.up')}>
                <Icon name="back" size={12} />
              </button>
            </div>
            <div className="mono truncate rounded border border-line bg-panel2/60 px-2 py-1 text-[11px] text-muted" title={picker?.path}>{picker?.path ?? '…'}</div>
            {busy ? (
              <div className="flex items-center gap-2 p-4 text-[12px] text-muted"><Spinner /> {t('project.loading')}</div>
            ) : (
              <div className="min-h-24 flex-1 overflow-y-auto rounded border border-line">
                {(picker?.entries ?? []).filter((entry) => entry.dir).map((entry) => (
                  <button key={entry.path} type="button" onClick={() => void browse(entry.path)} onDoubleClick={() => pick(entry.path)} className="flex w-full cursor-pointer items-center gap-2 px-2 py-1.5 text-left text-[12px] text-muted hover:bg-panel2 hover:text-ink">
                    <Icon name="files" size={13} className="shrink-0 text-accent/70" />
                    <span className="truncate">{entry.name}</span>
                  </button>
                ))}
                {!busy && !(picker?.entries ?? []).some((entry) => entry.dir) ? <div className="px-3 py-4 text-center text-[11.5px] text-muted">{t('project.noDirs')}</div> : null}
              </div>
            )}
            {error ? <div className="text-[11.5px] text-bad">{error}</div> : null}
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] text-muted">{t('project.hint')}</span>
              <button type="button" className="btn btn-primary cursor-pointer" disabled={!picker} onClick={() => picker && pick(picker.path)}>
                <Icon name="check" size={13} /> {t('project.use')}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
