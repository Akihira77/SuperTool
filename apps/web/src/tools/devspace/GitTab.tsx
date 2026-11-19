import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Badge, Button, Card, Checkbox, CopyButton, Empty, Icon, IconButton, Input, Panel, Select, Spinner, cn } from '../../components/ui';
import { api, ApiError, qs } from '../../lib/api';
import { useI18n } from '../../lib/i18n';
import { useToast } from '../../components/toast';
import { useConfirm } from '../../components/confirm';
import { useProject } from '../../lib/project';

type Change = { status: string; path: string };
type Commit = {
  hash: string;
  short: string;
  parents: string[];
  author: string;
  email: string;
  when: string;
  subject: string;
  refs: string[];
};
type GitState = {
  path: string;
  branch: string;
  head: string | null;
  ahead: number;
  behind: number;
  staged: Change[];
  changed: Change[];
  untracked: Change[];
  log: Commit[];
  branches: string[];
  stashes: Array<{ ref: string; message: string }>;
  graph: string;
  diffstat: string;
  tags: string[];
  ref: string | null;
};
type Dir = { name: string; path: string };
type Selection = { kind: 'file'; file: string; staged: boolean } | { kind: 'commit'; hash: string };

const LANE_W = 14;
const ROW_H = 30;
const COLORS = ['#60a5fa', '#34d399', '#f472b6', '#fbbf24', '#a78bfa', '#22d3ee', '#f87171'];

/**
 * Hitung posisi lane tiap commit (mirip git log --graph, tanpa lib).
 * lanes[] = hash yang ditunggu di kolom itu pada baris berikutnya.
 */
function layout(commits: Commit[]) {
  const lanes: Array<string | null> = [];
  const rows = commits.map((commit) => {
    let lane = lanes.indexOf(commit.hash);
    if (lane < 0) {
      lane = lanes.indexOf(null);
      if (lane < 0) {
        lane = lanes.length;
        lanes.push(commit.hash);
      } else {
        lanes[lane] = commit.hash;
      }
    }
    const before = lanes.slice();
    const after = lanes.slice();
    after[lane] = commit.parents[0] ?? null;
    for (const parent of commit.parents.slice(1)) {
      if (after.includes(parent)) continue;
      const slot = after.indexOf(null);
      if (slot >= 0) after[slot] = parent;
      else after.push(parent);
    }
    for (let index = 0; index < after.length; index += 1) lanes[index] = after[index] ?? null;
    return { commit, lane, before, after };
  });
  const width = Math.max(1, ...rows.map((row) => Math.max(row.before.length, row.after.length, row.lane + 1)));
  return { rows, width };
}

/** Grafik satu baris dalam SVG: garis lane + titik commit + kurva ke parent. */
function GraphCell({ row, width }: { row: ReturnType<typeof layout>['rows'][number]; width: number }) {
  const x = (lane: number) => lane * LANE_W + LANE_W / 2;
  const color = (lane: number) => COLORS[lane % COLORS.length];
  const mid = ROW_H / 2;
  return (
    <svg width={width * LANE_W} height={ROW_H} className="shrink-0" aria-hidden="true">
      {row.before.map((hash, lane) =>
        hash && lane !== row.lane ? (
          <line key={'b' + lane} x1={x(lane)} y1={0} x2={x(lane)} y2={ROW_H} stroke={color(lane)} strokeWidth={1.6} opacity={0.75} />
        ) : null,
      )}
      {row.before[row.lane] ? (
        <line x1={x(row.lane)} y1={0} x2={x(row.lane)} y2={mid} stroke={color(row.lane)} strokeWidth={1.8} />
      ) : null}
      {row.after.map((hash, lane) =>
        hash && lane !== row.lane ? (
          <line key={'a' + lane} x1={x(lane)} y1={0} x2={x(lane)} y2={ROW_H} stroke={color(lane)} strokeWidth={1.6} opacity={0.75} />
        ) : null,
      )}
      {row.after[row.lane] ? (
        <line x1={x(row.lane)} y1={mid} x2={x(row.lane)} y2={ROW_H} stroke={color(row.lane)} strokeWidth={1.8} />
      ) : null}
      {row.commit.parents.map((parent, index) => {
        const target = row.after.indexOf(parent);
        if (target < 0 || target === row.lane) return null;
        return (
          <path
            key={'p' + index}
            d={'M' + x(row.lane) + ' ' + mid + ' C' + x(row.lane) + ' ' + (mid + 8) + ' ' + x(target) + ' ' + (mid - 2) + ' ' + x(target) + ' ' + ROW_H}
            fill="none"
            stroke={color(target)}
            strokeWidth={1.7}
          />
        );
      })}
      <circle cx={x(row.lane)} cy={mid} r={4} fill={color(row.lane)} stroke="#0b1118" strokeWidth={1.5} />
    </svg>
  );
}

function initials(author: string) {
  return author
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

type DiffRow = { kind: 'ctx' | 'add' | 'del' | 'hunk' | 'meta'; old?: number; next?: number; text: string };

/** Pisahkan unified diff jadi baris ber-nomor untuk tampilan dua kolom (sebelum | sesudah). */
function parseDiff(text: string) {
  const rows: DiffRow[] = [];
  let oldNo = 0;
  let nextNo = 0;
  for (const line of text.split('\n')) {
    if (line.startsWith('@@')) {
      const match = /@@ -(\d+)(?:,\d+)? \+(\d+)/.exec(line);
      oldNo = Number(match?.[1] ?? 0);
      nextNo = Number(match?.[2] ?? 0);
      rows.push({ kind: 'hunk', text: line });
    } else if (line.startsWith('+++') || line.startsWith('---') || /^(diff |index |new file|deleted file|similarity|rename |old mode|new mode|Binary)/.test(line)) {
      rows.push({ kind: 'meta', text: line });
    } else if (line.startsWith('+')) {
      rows.push({ kind: 'add', next: nextNo++, text: line.slice(1) });
    } else if (line.startsWith('-')) {
      rows.push({ kind: 'del', old: oldNo++, text: line.slice(1) });
    } else {
      rows.push({ kind: 'ctx', old: oldNo++, next: nextNo++, text: line.startsWith(' ') ? line.slice(1) : line });
    }
  }
  return rows;
}

function DiffView({ text, loading }: { text: string; loading: boolean }) {
  const { t } = useI18n();
  const rows = useMemo(() => parseDiff(text), [text]);
  if (loading) return <div className="flex items-center gap-2 p-4 text-[13px] text-muted"><Spinner /> {t('git.loadingDiff')}</div>;
  if (!text.trim()) return <Empty text={t('git.noDiff')} />;
  const cell = (no: number | undefined, line: string, tone: 'old' | 'new') => (
    <div className={cn('flex min-w-0 gap-2 px-1', tone === 'old' && no ? 'bg-bad/10 text-bad' : tone === 'new' && no ? 'bg-ok/10 text-ok' : 'text-ink/70')}>
      <span className="w-9 shrink-0 select-none text-right tabular-nums text-muted/50">{no ?? ''}</span>
      <span className="min-w-0 flex-1 break-all whitespace-pre-wrap">{line || ' '}</span>
    </div>
  );
  return (
    <div className="mono flex min-h-0 flex-1 flex-col overflow-auto text-[12.5px] leading-[1.5]">
      <div className="sticky top-0 z-10 flex shrink-0 border-b border-line bg-panel text-[12.5px] tracking-wide text-muted uppercase">
        <div className="w-1/2 px-2 py-1">{t('git.previous')}</div>
        <div className="w-1/2 border-l border-line px-2 py-1">{t('git.updated')}</div>
      </div>
      {rows.map((row, index) =>
        row.kind === 'hunk' ? (
          <div key={index} className="border-y border-line/60 bg-panel2/60 px-2 py-0.5 text-[12.5px] text-accent">{row.text}</div>
        ) : row.kind === 'meta' ? (
          <div key={index} className="truncate px-2 py-0.5 text-[12.5px] text-muted/70">{row.text}</div>
        ) : (
          <div key={index} className="flex">
            <div className="w-1/2 border-r border-line/60">{cell(row.kind === 'add' ? undefined : row.old, row.kind === 'add' ? '' : row.text, 'old')}</div>
            <div className="w-1/2">{cell(row.kind === 'del' ? undefined : row.next, row.kind === 'del' ? '' : row.text, 'new')}</div>
          </div>
        ),
      )}
    </div>
  );
}

export default function GitTab() {
  const { t } = useI18n();
  const toast = useToast();
  const confirm = useConfirm();
  const { projectPath } = useProject();
  const [roots, setRoots] = useState<Array<{ path: string; label: string }>>([]);
  const [browse, setBrowse] = useState('');
  const [parent, setParent] = useState<string | null>(null);
  const [dirs, setDirs] = useState<Dir[]>([]);
  const [state, setState] = useState<GitState | null>(null);
  const [ref, setRef] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [selection, setSelection] = useState<Selection | null>(null);
  const [branchName, setBranchName] = useState('');
  const [branchTarget, setBranchTarget] = useState('');
  const [commitMessage, setCommitMessage] = useState('');
  const [stashIndex, setStashIndex] = useState(0);
  const [stashMessage, setStashMessage] = useState('');
  const [gitBusy, setGitBusy] = useState(false);
  const [diff, setDiff] = useState('');
  const [diffLoading, setDiffLoading] = useState(false);
  const [split, setSplit] = useState(() => {
    const saved = Number(localStorage.getItem('st:git:split'));
    return saved >= 24 && saved <= 72 ? saved : 40;
  });
  const dragging = useRef(false);
  const splitRef = useRef<HTMLDivElement>(null);

  const stopDrag = () => {
    if (!dragging.current) return;
    dragging.current = false;
    localStorage.setItem('st:git:split', String(Math.round(split)));
  };

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
      setError(err instanceof ApiError ? err.message : t('git.readFolderError'));
    }
  }, [t]);

  const load = useCallback(async (target: string, branch?: string | null) => {
    if (!target.trim()) return;
    setBusy(true);
    setError('');
    try {
      setState(await api.get<GitState>('/dev/git' + qs({ path: target, ref: branch ?? undefined })));
    } catch (err) {
      setState(null);
      setError(err instanceof ApiError ? err.message : t('git.readError'));
    } finally {
      setBusy(false);
    }
  }, [t]);

  const gitAction = async (label: string, run: () => Promise<unknown>) => {
    setGitBusy(true);
    try {
      await run();
      toast(label, 'ok');
      if (state) await load(state.path, ref);
      setCommitMessage('');
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t('git.actionError'), 'error');
    } finally {
      setGitBusy(false);
    }
  };

  useEffect(() => {
    api
      .get<Array<{ path: string; label: string }>>('/fs/roots')
      .then((list) => {
        setRoots(list);
        if (!projectPath && list.length) void loadDirs(list[0].path);
      })
      .catch(() => undefined);
  }, [loadDirs, projectPath]);

  // Proyek global berubah → langsung buka repo-nya.
  useEffect(() => {
    if (!projectPath) return;
    setSelection(null);
    setDiff('');
    setRef(null);
    void loadDirs(projectPath);
    void load(projectPath, null);
  }, [projectPath, loadDirs, load]);

  const openDiff = useCallback(async (next: Selection) => {
    if (!state) return;
    setSelection(next);
    setDiffLoading(true);
    setDiff('');
    try {
      const result =
        next.kind === 'file'
          ? await api.get<{ diff: string }>('/dev/git/diff' + qs({ path: state.path, file: next.file, staged: next.staged ? '1' : '0' }))
          : await api.get<{ diff: string }>('/dev/git/show' + qs({ path: state.path, hash: next.hash }));
      setDiff(result.diff);
    } catch (err) {
      setDiff('');
      toast(err instanceof ApiError ? err.message : t('git.diffError'), 'error');
    } finally {
      setDiffLoading(false);
    }
  }, [state, t, toast]);

  const stage = async (file: string, action: 'stage' | 'unstage') => {
    if (!state) return;
    try {
      await api.post('/dev/git/stage', { path: state.path, files: [file], action });
      await load(state.path, ref);
      toast((action === 'stage' ? t('git.stageDone') : t('git.unstageDone')) + ' ' + file, 'ok');
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t('git.stageError'), 'error');
    }
  };

  const rows = useMemo(() => (state ? layout(state.log) : { rows: [], width: 1 }), [state]);
  const maxCols = rows.width;

  const total = state ? state.staged.length + state.changed.length + state.untracked.length : 0;

  const fileGroup = (title: string, items: Change[], staged: boolean, tone: string) => (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2 text-[12.5px] tracking-wide text-muted uppercase">
        {title}
        <Badge className="tabular-nums">{items.length}</Badge>
      </div>
      <div className="flex flex-col">
        {items.map((item) => (
          <div
            key={item.path}
            className={cn(
              'group flex items-center gap-2 rounded px-1 py-0.5 text-[12.5px] transition-colors',
              selection?.kind === 'file' && selection.file === item.path ? 'bg-accent/10' : 'hover:bg-panel2',
            )}
          >
            <Checkbox
              checked={staged}
              onChange={() => void stage(item.path, staged ? 'unstage' : 'stage')}
              className="shrink-0"
              aria-label={staged ? t('git.unstage') : t('git.stage')}
              title={staged ? t('git.unstage') : t('git.stage')}
            />
            <span className={cn('mono w-4 shrink-0 text-center text-[12.5px]', tone)}>{item.status}</span>
            <button type="button" onClick={() => void openDiff({ kind: 'file', file: item.path, staged })} className="min-w-0 flex-1 cursor-pointer truncate rounded text-left text-ink/85 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus" title={item.path}>
              {item.path}
            </button>
          </div>
        ))}
        {!items.length ? <div className="px-1 text-[12px] text-muted/60">{t('git.none')}</div> : null}
      </div>
    </div>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-4 md:p-5">
      <Card className="flex flex-col gap-2 p-3">
        <div className="flex flex-wrap items-center gap-1">
          {roots.map((root) => (
            <button key={root.path} type="button" aria-pressed={browse.startsWith(root.path)} onClick={() => void loadDirs(root.path)} className={cn('cursor-pointer rounded px-2 py-0.5 text-[12.5px] transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus', browse.startsWith(root.path) ? 'bg-accent/15 text-accent' : 'text-muted hover:bg-panel2 hover:text-ink')}>
              {root.label}
            </button>
          ))}
          <span className="mono ml-auto max-w-full truncate text-[12px] text-muted" title={browse}>{browse}</span>
        </div>
        <div className="flex flex-wrap items-center gap-1 text-[12.5px] text-muted">
          <IconButton icon="back" label={t('common.previous')} size="sm" disabled={!parent} onClick={() => parent && void loadDirs(parent)} />
          {dirs.map((dir) => (
            <span key={dir.path} className="flex items-center overflow-hidden rounded border border-line">
              <button type="button" onClick={() => { void loadDirs(dir.path); void load(dir.path, null); setRef(null); setSelection(null); }} className="cursor-pointer px-2 py-0.5 text-[12.5px] text-muted transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus">{dir.name}</button>
              <button type="button" aria-label={'Buka ' + dir.name} onClick={() => void loadDirs(dir.path)} className="cursor-pointer border-l border-line px-1 py-0.5 text-muted transition-colors hover:bg-panel2 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus">›</button>
            </span>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="primary" icon="check" loading={busy} onClick={() => { setSelection(null); void load(browse, null); setRef(null); }} disabled={busy || !browse}>
            {t('git.open')}
          </Button>
          <Button icon="refresh" onClick={() => void load(browse, ref)} disabled={busy || !state}>
            {t('git.reload')}
          </Button>
        </div>
      </Card>

      {error ? <div className="text-[13px] text-bad">{error}</div> : null}

      {state ? (
        <>
          <Panel className="flex flex-wrap items-center gap-2 px-3 py-2 text-[13px]">
            <Badge tone="accent" className="gap-1.5"><Icon name="git" size={12} /> {state.branch}</Badge>
            {state.ahead ? <Badge tone="ok" className="tabular-nums">↑ {state.ahead}</Badge> : null}
            {state.behind ? <Badge tone="warn" className="tabular-nums">↓ {state.behind}</Badge> : null}
            <Badge tone={total ? 'warn' : 'ok'} className="tabular-nums">{total ? total + ' ' + t('git.changes') : t('git.clean')}</Badge>
            <div className="flex flex-wrap gap-1">
              <button type="button" aria-pressed={!ref} onClick={() => { setRef(null); void load(browse, null); }} className={cn('cursor-pointer rounded px-2 py-0.5 text-[12px] transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus', !ref ? 'bg-accent/15 text-accent' : 'text-muted hover:bg-panel2 hover:text-ink')}>{t('git.allBranches')}</button>
              {state.branches.map((name) => (
                <button key={name} type="button" aria-pressed={ref === name} onClick={() => { setRef(name); void load(browse, name); }} className={cn('mono cursor-pointer rounded px-2 py-0.5 text-[12px] transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus', ref === name ? 'bg-accent/15 text-accent' : name === state.branch ? 'text-ink hover:bg-panel2' : 'text-muted hover:bg-panel2 hover:text-ink')}>
                  {name === state.branch ? '● ' : ''}{name}
                </button>
              ))}
            </div>
            <span className="mono ml-auto truncate text-[12px] text-muted" title={state.path}>{state.path}</span>
          </Panel>

          <Card className="flex flex-col gap-2 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[12px] font-semibold tracking-wide text-muted uppercase">{t('git.branchOps')}</span>
              <Input className="h-7 max-w-48 text-[13px]" aria-label={t('git.branchName')} value={branchName} onChange={(event) => setBranchName(event.target.value)} placeholder={t('git.branchName')} maxLength={80} />
              <Button size="sm" disabled={gitBusy || !branchName.trim()} onClick={() => void gitAction(t('git.branchCreated'), () => api.post('/dev/git/branch', { path: state.path, action: 'create', name: branchName.trim() }))}>
                {t('git.createBranch')}
              </Button>
              <Select
                value={branchTarget}
                onChange={setBranchTarget}
                options={[{ value: '', label: t('git.chooseBranch') }, ...state.branches.map((name) => ({ value: name, label: name }))]}
                size="sm"
                label={t('git.chooseBranch')}
                className="max-w-44"
                triggerClassName="h-7 min-h-7 text-[13px]"
              />
              <Button size="sm" disabled={gitBusy || !branchTarget} onClick={() => void gitAction(t('git.branchSwitched'), () => api.post('/dev/git/branch', { path: state.path, action: 'switch', name: branchTarget }))}>
                {t('git.switchBranch')}
              </Button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[12px] font-semibold tracking-wide text-muted uppercase">{t('git.commit')}</span>
              <Input className="h-7 min-w-56 flex-1 text-[13px]" aria-label={t('git.commitHint')} value={commitMessage} onChange={(event) => setCommitMessage(event.target.value)} placeholder={t('git.commitHint')} maxLength={2000} />
              <Button variant="primary" size="sm" disabled={gitBusy || !commitMessage.trim() || !state.staged.length} onClick={() => void gitAction(t('git.committed'), () => api.post('/dev/git/commit', { path: state.path, message: commitMessage.trim() }))}>
                {t('git.commitStaged')} ({state.staged.length})
              </Button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[12px] font-semibold tracking-wide text-muted uppercase">{t('git.stash')}</span>
              <Input className="h-7 min-w-40 flex-1 text-[13px]" aria-label={t('git.stashHint')} value={stashMessage} onChange={(event) => setStashMessage(event.target.value)} placeholder={t('git.stashHint')} maxLength={200} />
              <Button size="sm" disabled={gitBusy} onClick={() => void gitAction(t('git.stashSaved'), () => api.post('/dev/git/stash', { path: state.path, action: 'save', message: stashMessage.trim() }))}>
                {t('git.stashSave')}
              </Button>
              <Select
                value={String(stashIndex)}
                onChange={(next) => setStashIndex(Number(next))}
                options={state.stashes.length ? state.stashes.map((stash, index) => ({ value: String(index), label: index + ': ' + (stash.message || stash.ref) })) : [{ value: '0', label: t('git.noStash') }]}
                size="sm"
                label={t('git.stash')}
                className="max-w-56"
                triggerClassName="h-7 min-h-7 text-[13px]"
              />
              <Button size="sm" disabled={gitBusy || !state.stashes.length} onClick={() => void gitAction(t('git.stashPopped'), () => api.post('/dev/git/stash', { path: state.path, action: 'pop', index: stashIndex }))}>
                {t('git.stashPop')}
              </Button>
              <Button variant="ghost" size="sm" className="text-bad" disabled={gitBusy || !state.stashes.length} onClick={async () => {
                const target = state.stashes[stashIndex];
                if (!target) return;
                const ok = await confirm({ title: t('git.stashDrop'), message: target.message || target.ref, danger: true, confirmLabel: t('git.stashDrop') });
                if (ok) await gitAction(t('git.stashDropped'), () => api.post('/dev/git/stash', { path: state.path, action: 'drop', index: stashIndex }));
              }}>
                {t('git.stashDrop')}
              </Button>
            </div>
          </Card>

          <div
            ref={splitRef}
            className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden lg:flex-row"
            style={{ ['--split' as string]: split + '%' }}
            onPointerMove={(event) => {
              if (!dragging.current || !splitRef.current) return;
              const rect = splitRef.current.getBoundingClientRect();
              const percent = ((event.clientX - rect.left) / rect.width) * 100;
              setSplit(Math.min(72, Math.max(24, percent)));
            }}
            onPointerUp={stopDrag}
            onPointerLeave={stopDrag}
          >
            <div className="flex min-h-0 w-full flex-col gap-2 lg:w-[var(--split)] lg:shrink-0">
              <Card className="flex max-h-[60vh] flex-col gap-0 overflow-hidden p-0">
                <div className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-1.5 text-[12.5px] tracking-wide text-muted uppercase">
                  {t('git.history')}
                  <Badge className="tabular-nums">{state.log.length}</Badge>
                  <span className="ml-auto truncate normal-case">{ref ?? t('git.allBranches')}</span>
                </div>
                <div className="min-h-0 flex-1 overflow-auto">
                  {rows.rows.map((row) => {
                    const active = selection?.kind === 'commit' && selection.hash === row.commit.hash;
                    return (
                      <div
                        key={row.commit.hash}
                        className={cn('flex items-start gap-2 border-b border-line/40 px-1 py-1', active ? 'bg-accent/10' : 'hover:bg-panel2/60')}
                      >
                        <div className="flex items-center self-stretch pt-0">
                          <GraphCell row={row} width={maxCols} />
                        </div>
                        <button type="button" onClick={() => void openDiff({ kind: 'commit', hash: row.commit.hash })} className="flex min-w-0 flex-1 cursor-pointer items-start gap-2 rounded text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">
                          <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-panel2 text-[12.5px] font-semibold text-accent">{initials(row.commit.author)}</span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[13px] text-ink/92" title={row.commit.subject}>{row.commit.subject}</span>
                            <span className="flex flex-wrap items-center gap-1.5 text-[12.5px] text-muted">
                              <span>{row.commit.author}</span>
                              <span>·</span>
                              <span>{row.commit.when}</span>
                              <span className="mono tabular-nums text-[#60a5fa]">{row.commit.short}</span>
                              {row.commit.refs.map((item) => (
                                <Badge key={item} tone={item === state.head ? 'accent' : 'ok'} className="px-1.5 text-[11.5px]">
                                  {item === state.head ? 'HEAD' : item}
                                </Badge>
                              ))}
                            </span>
                          </span>
                        </button>
                      </div>
                    );
                  })}
                  {!rows.rows.length ? <div className="px-3 py-4 text-[12.5px] text-muted">{t('git.noCommits')}</div> : null}
                </div>
              </Card>

              <Card className="flex max-h-40 flex-col gap-1 overflow-auto p-2">
                <div className="text-[12.5px] tracking-wide text-muted uppercase">{t('git.diffstat')}</div>
                <pre className="mono text-[12.5px] leading-[1.4] whitespace-pre-wrap tabular-nums text-ink/75">{state.diffstat || t('git.noChanges')}</pre>
              </Card>
            </div>

            <div
              role="separator"
              aria-orientation="vertical"
              title={t('git.resizeHint')}
              onPointerDown={(event) => {
                dragging.current = true;
                (event.target as HTMLElement).setPointerCapture(event.pointerId);
              }}
              className="hidden w-1.5 shrink-0 cursor-col-resize rounded bg-line transition-colors hover:bg-accent/60 lg:block"
            />

            <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2">
              <Card className="flex flex-col gap-2 p-2">
                <div className="flex items-center gap-2 text-[12.5px] tracking-wide text-muted uppercase">
                  {t('git.workingTree')}
                  <span className="ml-auto flex gap-2 normal-case">
                    <Button variant="ghost" size="sm" className="text-[12.5px]" onClick={() => void load(state.path, ref)}>{t('git.refresh')}</Button>
                  </span>
                </div>
                <div className="grid gap-2 sm:grid-cols-3">
                  {fileGroup(t('git.staged'), state.staged, true, 'text-ok')}
                  {fileGroup(t('git.changed'), state.changed, false, 'text-warn')}
                  {fileGroup(t('git.untracked'), state.untracked, false, 'text-muted')}
                </div>
              </Card>

              <Card className="flex min-h-[16rem] flex-1 flex-col overflow-hidden p-0">
                <div className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-1.5 text-[12.5px] tracking-wide text-muted uppercase">
                  {t('git.diff')}
                  {selection ? (
                    <span className="mono min-w-0 truncate normal-case text-ink/80" title={selection.kind === 'file' ? selection.file : selection.hash}>
                      {selection.kind === 'file' ? selection.file : selection.hash.slice(0, 7)}
                    </span>
                  ) : null}
                  <div className="ml-auto flex shrink-0 items-center gap-2 normal-case">
                    {selection?.kind === 'file' ? (
                      <span>{selection.staged ? t('git.stagedFile') : t('git.workingFile')}</span>
                    ) : null}
                    {selection && diff && !diffLoading ? <CopyButton text={diff} size="sm" /> : null}
                  </div>
                </div>
                {selection ? <DiffView text={diff} loading={diffLoading} /> : <Empty text={t('git.pickFile')} />}
              </Card>
            </div>
          </div>
        </>
      ) : (
        <div className="text-[13px] text-muted">{t('git.pickFolder')}</div>
      )}
    </div>
  );
}
