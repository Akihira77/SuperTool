import { useCallback, useEffect, useState } from 'react';
import { Icon, Spinner, cn } from '../../components/ui';
import { api, ApiError, qs } from '../../lib/api';

type GitState = {
  path: string;
  branch: string;
  ahead: number;
  behind: number;
  staged: string[];
  changed: string[];
  untracked: string[];
  commits: Array<{ hash: string; subject: string; author: string; when: string }>;
  diffstat: string;
  tags: string[];
};

type Dir = { name: string; path: string };

export default function GitTab() {
  const [roots, setRoots] = useState<Array<{ path: string; label: string }>>([]);
  const [browse, setBrowse] = useState('');
  const [parent, setParent] = useState<string | null>(null);
  const [dirs, setDirs] = useState<Dir[]>([]);
  const [picked, setPicked] = useState('');
  const [state, setState] = useState<GitState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const loadDirs = useCallback(async (path: string) => {
    if (!path) return;
    try {
      const data = await api.get<{ path: string; parent: string | null; entries: Array<{ name: string; path: string; dir: boolean }> }>(
        '/fs/list' + qs({ path }),
      );
      setBrowse(data.path);
      setParent(data.parent);
      setDirs(
        data.entries
          .filter((entry) => entry.dir && !entry.name.startsWith('.git'))
          .map((entry) => ({ name: entry.name, path: entry.path })),
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Gagal membaca folder');
    }
  }, []);

  const load = useCallback(async (target: string) => {
    if (!target.trim()) return;
    setBusy(true);
    setError('');
    try {
      setState(await api.get<GitState>('/dev/git' + qs({ path: target })));
    } catch (err) {
      setState(null);
      setError(err instanceof ApiError ? err.message : 'Gagal membaca git');
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    api
      .get<Array<{ path: string; label: string }>>('/fs/roots')
      .then((list) => {
        setRoots(list);
        if (list.length) {
          void loadDirs(list[0].path);
          setPicked(list[0].path);
        }
      })
      .catch(() => undefined);
  }, [loadDirs]);

  const crumbs = browse
    ? browse
        .slice((roots.find((root) => browse.startsWith(root.path))?.path ?? '').length)
        .split('/')
        .filter(Boolean)
    : [];

  const total = state ? state.staged.length + state.changed.length + state.untracked.length : 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-4">
      <div className="card flex flex-col gap-2 p-3">
        <div className="flex flex-wrap items-center gap-1">
          {roots.map((root) => (
            <button
              key={root.path}
              type="button"
              onClick={() => void loadDirs(root.path)}
              className={cn(
                'cursor-pointer rounded px-2 py-0.5 text-[11.5px] transition-colors',
                browse.startsWith(root.path) ? 'bg-accent/15 text-accent' : 'text-muted hover:bg-panel2 hover:text-ink',
              )}
            >
              {root.label}
            </button>
          ))}
          <span className="mono ml-auto max-w-full truncate text-[11px] text-muted" title={browse}>
            {browse}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-1 text-[11.5px] text-muted">
          <button
            type="button"
            disabled={!parent}
            onClick={() => parent && void loadDirs(parent)}
            className="cursor-pointer rounded px-1 py-0.5 hover:bg-panel2 hover:text-ink disabled:opacity-40"
            title="Naik satu folder"
          >
            <Icon name="back" size={12} />
          </button>
          {crumbs.length ? (
            crumbs.map((part, index) => {
              const base = roots.find((root) => browse.startsWith(root.path))?.path ?? '';
              const path = base + '/' + crumbs.slice(0, index + 1).join('/');
              return (
                <span key={path} className="flex items-center gap-1">
                  <button type="button" className="cursor-pointer rounded px-1 hover:bg-panel2 hover:text-ink" onClick={() => void loadDirs(path)}>
                    {part}
                  </button>
                  <span className="text-muted/40">/</span>
                </span>
              );
            })
          ) : null}
        </div>

        <div className="flex max-h-52 flex-wrap gap-1 overflow-auto">
          {dirs.map((dir) => (
            <span
              key={dir.path}
              className={cn(
                'flex items-center overflow-hidden rounded border transition-colors',
                picked === dir.path ? 'border-accent/50' : 'border-line hover:border-accent/40',
              )}
            >
              <button
                type="button"
                onClick={() => {
                  setPicked(dir.path);
                  void load(dir.path);
                }}
                title={'Pakai folder ini — ' + dir.path}
                className={cn(
                  'flex cursor-pointer items-center gap-1 px-2 py-1 text-[11.5px] transition-colors',
                  picked === dir.path ? 'bg-accent/15 text-accent' : 'text-muted hover:text-ink',
                )}
              >
                <Icon name="files" size={12} /> {dir.name}
              </button>
              <button
                type="button"
                onClick={() => void loadDirs(dir.path)}
                title="Buka folder"
                className="cursor-pointer border-l border-line px-1 py-1 text-[11.5px] text-muted hover:bg-panel2 hover:text-ink"
              >
                ›
              </button>
            </span>
          ))}
          {!dirs.length ? <span className="text-[11.5px] text-muted">Tidak ada subfolder.</span> : null}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="btn btn-primary cursor-pointer"
            onClick={() => {
              setPicked(browse);
              void load(browse);
            }}
            disabled={busy || !browse}
          >
            {busy ? <Spinner /> : <Icon name="check" />} Pakai folder ini
          </button>
          <button type="button" className="btn cursor-pointer" onClick={() => void load(picked || browse)} disabled={busy || !picked}>
            <Icon name="refresh" /> Muat ulang
          </button>
        </div>
      </div>

      {error ? <div className="text-[12px] text-bad">{error}</div> : null}

      {state ? (
        <>
          <div className="card flex flex-wrap items-center gap-2 p-3 text-[12.5px]">
            <span className="flex items-center gap-1.5 rounded-full border border-accent/40 bg-accent/10 px-2 py-0.5 text-accent">
              <Icon name="git" size={12} /> {state.branch}
            </span>
            {state.ahead ? <span className="rounded bg-ok/15 px-1.5 py-0.5 text-[11px] text-ok">↑ {state.ahead} belum di-push</span> : null}
            {state.behind ? <span className="rounded bg-warn/15 px-1.5 py-0.5 text-[11px] text-warn">↓ {state.behind} tertinggal</span> : null}
            <span className={cn('rounded px-1.5 py-0.5 text-[11px]', total ? 'bg-warn/15 text-warn' : 'bg-ok/15 text-ok')}>
              {total ? total + ' perubahan' : 'bersih'}
            </span>
            {state.tags.length ? (
              <span className="flex flex-wrap gap-1">
                {state.tags.slice(0, 6).map((tag) => (
                  <span key={tag} className="mono rounded border border-line px-1.5 py-0.5 text-[10.5px] text-muted">
                    {tag}
                  </span>
                ))}
              </span>
            ) : null}
            <span className="mono ml-auto truncate text-[11px] text-muted" title={state.path}>
              {state.path}
            </span>
          </div>

          <div className="grid gap-3 lg:grid-cols-3">
            {[
              { title: 'Staged', rows: state.staged, tone: 'text-ok', mark: '+' },
              { title: 'Diubah', rows: state.changed, tone: 'text-warn', mark: 'M' },
              { title: 'Belum dilacak', rows: state.untracked, tone: 'text-muted', mark: '?' },
            ].map((group) => (
              <div key={group.title} className="card flex flex-col gap-1 p-3">
                <div className="flex items-center gap-2 text-[11px] tracking-wide text-muted uppercase">
                  {group.title}
                  <span className="rounded bg-panel2 px-1 text-ink">{group.rows.length}</span>
                </div>
                <div className="mono max-h-52 overflow-auto text-[11.5px]">
                  {group.rows.length ? (
                    group.rows.map((row) => (
                      <div key={row} className="flex items-start gap-1.5">
                        <span className={cn('w-4 shrink-0 text-center', group.tone)}>{group.mark}</span>
                        <span className="truncate text-ink/85" title={row}>
                          {row}
                        </span>
                      </div>
                    ))
                  ) : (
                    <div className="text-muted/60">tidak ada</div>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="grid gap-3 lg:grid-cols-[2fr_1fr]">
            <div className="card flex flex-col gap-1 p-3">
              <div className="mb-1 text-[11px] tracking-wide text-muted uppercase">Commit terakhir</div>
              <div className="flex flex-col divide-y divide-line/50">
                {state.commits.map((commit) => (
                  <div key={commit.hash} className="flex items-baseline gap-2 py-1 text-[12px]">
                    <span className="mono shrink-0 rounded bg-panel2 px-1 text-[11px] text-accent">{commit.hash.slice(0, 7)}</span>
                    <span className="min-w-0 flex-1 truncate text-ink/90" title={commit.subject}>
                      {commit.subject}
                    </span>
                    <span className="shrink-0 text-[10.5px] text-muted">
                      {commit.author} · {commit.when}
                    </span>
                  </div>
                ))}
                {!state.commits.length ? <div className="text-[11.5px] text-muted">Belum ada commit.</div> : null}
              </div>
            </div>

            <div className="card flex max-h-72 flex-col gap-1 overflow-auto p-3">
              <div className="text-[11px] tracking-wide text-muted uppercase">Diff stat</div>
              <pre className="mono overflow-auto text-[11px] whitespace-pre-wrap text-ink/80">{state.diffstat || 'tidak ada perubahan'}</pre>
            </div>
          </div>
        </>
      ) : (
        <div className="text-[12px] text-muted">Pilih folder lalu klik “Pakai folder ini”.</div>
      )}
    </div>
  );
}
