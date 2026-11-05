import { useEffect, useState } from 'react';
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

export default function GitTab() {
  const [path, setPath] = useState('');
  const [state, setState] = useState<GitState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .get<Array<{ path: string }>>('/fs/roots')
      .then((roots) => {
        if (roots.length) {
          setPath(roots[0].path);
          void load(roots[0].path);
        }
      })
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const load = async (target: string) => {
    if (!target.trim()) return;
    setBusy(true);
    setError('');
    try {
      const result = await api.get<GitState>('/dev/git' + qs({ path: target }));
      setState(result);
    } catch (err) {
      setState(null);
      setError(err instanceof ApiError ? err.message : 'Gagal membaca git');
    } finally {
      setBusy(false);
    }
  };

  const total = state ? state.staged.length + state.changed.length + state.untracked.length : 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-4">
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={path}
          onChange={(event) => setPath(event.target.value)}
          onKeyDown={(event) => event.key === 'Enter' && void load(path)}
          placeholder="/home/user/proyek"
          className="input mono flex-1 py-1.5"
          spellCheck={false}
        />
        <button type="button" className="btn" onClick={() => void load(path)} disabled={busy}>
          {busy ? <Spinner /> : <Icon name="refresh" />} Muat
        </button>
      </div>

      {error ? <div className="text-[12px] text-bad">{error}</div> : null}

      {state ? (
        <>
          <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
            <span className="chip border-accent/40 bg-accent/10 text-accent">{state.branch}</span>
            {state.ahead ? <span className="chip text-ok">↑{state.ahead}</span> : null}
            {state.behind ? <span className="chip text-warn">↓{state.behind}</span> : null}
            <span className="text-muted">{total} perubahan</span>
            <span className="mono truncate text-muted">{state.path}</span>
          </div>

          <div className="grid gap-3 lg:grid-cols-3">
            {[
              { title: 'Staged', rows: state.staged, tone: 'text-ok' },
              { title: 'Diubah', rows: state.changed, tone: 'text-warn' },
              { title: 'Belum dilacak', rows: state.untracked, tone: 'text-muted' },
            ].map((group) => (
              <div key={group.title} className="card flex flex-col gap-1 p-3">
                <div className="flex items-center gap-2 text-[11px] tracking-wide text-muted uppercase">
                  {group.title}
                  <span className="text-ink">{group.rows.length}</span>
                </div>
                <div className="mono max-h-52 overflow-auto text-[11.5px]">
                  {group.rows.length ? (
                    group.rows.map((row) => (
                      <div key={row} className={cn('truncate', group.tone)} title={row}>
                        {row}
                      </div>
                    ))
                  ) : (
                    <div className="text-muted/70">-</div>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="card p-3">
            <div className="mb-1 text-[11px] tracking-wide text-muted uppercase">Commit terakhir</div>
            <div className="flex flex-col gap-1">
              {state.commits.map((commit) => (
                <div key={commit.hash} className="flex items-baseline gap-2 text-[12px]">
                  <span className="mono text-accent">{commit.hash}</span>
                  <span className="truncate text-ink">{commit.subject}</span>
                  <span className="ml-auto shrink-0 text-[11px] text-muted">{commit.author} · {commit.when}</span>
                </div>
              ))}
            </div>
          </div>

          {state.diffstat ? (
            <div className="card p-3">
              <div className="mb-1 text-[11px] tracking-wide text-muted uppercase">Diff</div>
              <pre className="mono overflow-auto text-[11.5px] leading-relaxed text-ink/85">{state.diffstat}</pre>
            </div>
          ) : null}

          {state.tags.length ? (
            <div className="flex flex-wrap items-center gap-1">
              <span className="text-[11px] tracking-wide text-muted uppercase">Tag</span>
              {state.tags.map((tag) => (
                <span key={tag} className="chip">{tag}</span>
              ))}
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
