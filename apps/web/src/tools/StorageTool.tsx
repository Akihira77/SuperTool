import { Fragment, useCallback, useEffect, useState } from 'react';
import { Icon, PageHeader, Spinner, cn } from '../components/ui';
import { useConfirm } from '../components/confirm';
import { useToast } from '../components/toast';
import { api, ApiError } from '../lib/api';
import { bytes } from '../lib/format';
import { useI18n } from '../lib/i18n';

type UsageNode = {
  name: string;
  path: string;
  size: number;
  depth: number;
  cleanable: boolean;
  children?: UsageNode[];
};

type UsageWarning = {
  code: 'timeout' | 'unreadable' | 'truncated' | 'partial';
  path?: string;
};

type Usage = {
  root: string;
  total: number;
  scannedAt: number;
  truncated: boolean;
  warning?: UsageWarning | string;
  count: number;
  disk?: { total: number; free: number };
  tree: UsageNode[];
};

type Sort = 'size' | 'name';
type Box = { x: number; y: number; w: number; h: number };

const COLORS = ['#0ea5e9', '#22c55e', '#f59e0b', '#a855f7', '#ef4444', '#14b8a6', '#eab308', '#6366f1', '#ec4899', '#84cc16'];

function subtreeCount(node: UsageNode): number {
  return 1 + (node.children?.reduce((sum, child) => sum + subtreeCount(child), 0) ?? 0);
}

function dropPath(nodes: UsageNode[], path: string): UsageNode[] {
  return nodes.flatMap((node) =>
    node.path === path
      ? []
      : [{ ...node, children: node.children ? dropPath(node.children, path) : undefined }],
  );
}

function ordered(nodes: UsageNode[], sort: Sort): UsageNode[] {
  return [...nodes].sort((a, b) =>
    sort === 'size' ? b.size - a.size || a.name.localeCompare(b.name) : a.name.localeCompare(b.name),
  );
}

async function copyText(value: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // Clipboard API bisa diblokir; coba fallback di bawah.
  }
  try {
    const area = document.createElement('textarea');
    area.value = value;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.append(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  } catch {
    return false;
  }
}

/** Treemap binary split tanpa dependency: area mengikuti ukuran folder. */
function layout(nodes: UsageNode[], box: Box): Array<{ node: UsageNode; box: Box }> {
  if (nodes.length === 0 || box.w <= 0 || box.h <= 0) return [];
  if (nodes.length === 1) return [{ node: nodes[0], box }];
  const values = nodes.map((node) => Math.max(1, node.size));
  const total = values.reduce((sum, value) => sum + value, 0);
  let split = 1;
  let first = values[0];
  while (split < nodes.length - 1 && first < total / 2) {
    first += values[split];
    split += 1;
  }
  const firstNodes = nodes.slice(0, split);
  const restNodes = nodes.slice(split);
  const ratio = Math.min(0.86, Math.max(0.14, first / total));
  if (box.w >= box.h) {
    const left = box.w * ratio;
    return [...layout(firstNodes, { ...box, w: left }), ...layout(restNodes, { ...box, x: box.x + left, w: box.w - left })];
  }
  const top = box.h * ratio;
  return [...layout(firstNodes, { ...box, h: top }), ...layout(restNodes, { ...box, y: box.y + top, h: box.h - top })];
}

function Treemap({
  nodes,
  total,
  label,
  onSelect,
}: {
  nodes: UsageNode[];
  total: number;
  label: string;
  onSelect: (path: string) => void;
}) {
  const [hover, setHover] = useState<string | null>(null);
  const boxes = layout(ordered(nodes, 'size'), { x: 0, y: 0, w: 1000, h: 360 });
  if (!boxes.length || total <= 0) return null;
  return (
    <svg viewBox="0 0 1000 360" className="aspect-[1000/360] w-full" role="group" aria-label={label}>
      {boxes.map(({ node, box }, index) => {
        const showName = box.w > 46 && box.h > 20;
        const showSize = box.w > 88 && box.h > 38;
        return (
          <g
            key={node.path}
            role="button"
            tabIndex={0}
            aria-label={node.name + ' · ' + bytes(node.size)}
            className="cursor-pointer outline-none focus-visible:opacity-100"
            onMouseEnter={() => setHover(node.path)}
            onMouseLeave={() => setHover(null)}
            onClick={() => onSelect(node.path)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' && event.key !== ' ') return;
              event.preventDefault();
              onSelect(node.path);
            }}
          >
            <title>{node.name + ' · ' + bytes(node.size)}</title>
            <rect
              x={box.x + 1}
              y={box.y + 1}
              width={Math.max(0, box.w - 2)}
              height={Math.max(0, box.h - 2)}
              rx={3}
              fill={COLORS[index % COLORS.length]}
              opacity={hover && hover !== node.path ? 0.55 : 0.9}
              className="cursor-pointer transition-opacity"
            />
            {showName ? (
              <text
                x={box.x + 7}
                y={box.y + (showSize ? 19 : box.h / 2)}
                fill="#fff"
                fontSize={Math.min(14, Math.max(11.5, box.w / 12))}
                fontWeight={600}
                dominantBaseline="middle"
                pointerEvents="none"
              >
                {node.name}
              </text>
            ) : null}
            {showSize ? (
              <text x={box.x + 7} y={box.y + 36} fill="#fff" opacity={0.82} fontSize={11.5} dominantBaseline="middle" pointerEvents="none">
                {bytes(node.size)}
              </text>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}

export default function StorageTool() {
  const { t, lang } = useI18n();
  const toast = useToast();
  const confirm = useConfirm();
  const [data, setData] = useState<Usage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [sort, setSort] = useState<Sort>('size');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState<string | null>(null);
  const [dockerBusy, setDockerBusy] = useState(false);
  const [dockerOutput, setDockerOutput] = useState('');
  const [activePath, setActivePath] = useState<string | null>(null);

  const load = useCallback(async (force = false) => {
    setLoading(true);
    setError('');
    try {
      const result = await api.get<Usage>('/storage/usage' + (force ? '?refresh=1' : ''));
      setData(result);
      setExpanded(new Set(result.tree.filter((node) => node.children?.length).slice(0, 3).map((node) => node.path)));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('storage.scanError'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const remove = async (node: UsageNode) => {
    const ok = await confirm({
      title: t('storage.confirmDelete'),
      message: node.path + '\n\n' + t('storage.confirmDeleteBody'),
      confirmLabel: t('common.delete'),
      danger: true,
    });
    if (!ok) return;
    setDeleting(node.path);
    try {
      await api.post('/storage/delete', { path: node.path });
      setData((current) =>
        current
          ? {
              ...current,
              total: Math.max(0, current.total - node.size),
              count: Math.max(0, current.count - subtreeCount(node)),
              tree: dropPath(current.tree, node.path),
            }
          : current,
      );
      toast(t('storage.deleted'), 'ok');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('storage.deleteError'));
    } finally {
      setDeleting(null);
    }
  };

  const cleanDocker = async () => {
    const ok = await confirm({
      title: t('storage.confirmDocker'),
      message: t('storage.confirmDockerBody'),
      confirmLabel: t('storage.docker'),
      danger: true,
    });
    if (!ok) return;
    setDockerBusy(true);
    setDockerOutput('');
    try {
      const result = await api.post<{ ok: true; output: string }>('/storage/docker-prune');
      setDockerOutput(result.output || t('storage.noOutput'));
      toast(t('storage.dockerDone'), 'ok');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('storage.dockerError'));
    } finally {
      setDockerBusy(false);
    }
  };

  const copyPath = async (path: string) => {
    const ok = await copyText(path);
    if (ok) toast(t('storage.copied'), 'ok');
    else toast(t('storage.copyFailed'), 'error');
  };

  const toggle = (path: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const focusPath = (path: string) => {
    const row = Array.from(document.querySelectorAll<HTMLElement>('[data-storage-path]')).find(
      (element) => element.dataset.storagePath === path,
    );
    if (!row) return;
    setActivePath(path);
    row.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const renderNode = (node: UsageNode, depth: number) => {
    const children = node.children ? ordered(node.children, sort) : [];
    const open = expanded.has(node.path);
    const childCount = node.children?.length ?? 0;
    const pct = data?.total ? (node.size / data.total) * 100 : 0;
    return (
      <Fragment key={node.path}>
        <div
          data-storage-path={node.path}
          className={cn(
            'group flex items-center gap-2 border-b border-line/50 px-2 py-1.5 text-[13.5px] transition-colors hover:bg-panel2/60',
            activePath === node.path ? 'bg-accent/10 ring-1 ring-inset ring-accent/40' : depth === 0 ? 'bg-panel/30' : '',
          )}
          style={{ paddingLeft: 8 + depth * 18 }}
        >
          <button
            type="button"
            className={cn('btn btn-ghost size-6 shrink-0 px-0', !childCount ? 'invisible' : '')}
            onClick={() => toggle(node.path)}
            aria-label={open ? t('storage.collapse') : t('storage.expand')}
          >
            <Icon name={open ? 'chevronDown' : 'chevronRight'} size={12} />
          </button>
          <Icon name="folder" size={14} className="shrink-0 text-accent/80" />
          <button
            type="button"
            className="min-h-8 min-w-0 flex-1 truncate text-left hover:text-accent"
            title={node.path}
            onClick={() => (childCount ? toggle(node.path) : undefined)}
          >
            <span className={depth === 0 ? 'font-medium' : ''}>{node.name}</span>
            {childCount && !open ? <span className="ml-2 text-[12.5px] text-muted">{childCount}</span> : null}
          </button>
          <span className="mono w-20 shrink-0 text-right text-muted">{bytes(node.size)}</span>
          <span className="hidden w-12 shrink-0 text-right text-[12px] text-muted/70 sm:block">{pct.toFixed(1)}%</span>
          <div className="flex shrink-0 items-center gap-0.5">
            <button
              type="button"
              className="btn btn-ghost shrink-0 px-1.5 py-0.5 opacity-70 hover:text-accent hover:opacity-100"
              onClick={() => void copyPath(node.path)}
              title={t('storage.copyPath')}
              aria-label={t('storage.copyPath') + ' ' + node.name}
            >
              <Icon name="copy" size={13} />
            </button>
            {node.cleanable ? (
              <button
                type="button"
                className="btn btn-ghost shrink-0 px-1.5 py-0.5 text-bad opacity-70 hover:border-bad/30 hover:opacity-100"
                onClick={() => void remove(node)}
                disabled={deleting !== null || loading}
                title={t('storage.clean')}
                aria-label={t('storage.clean') + ' ' + node.name}
              >
                {deleting === node.path ? <Spinner /> : <Icon name="trash" size={13} />}
              </button>
            ) : null}
          </div>
        </div>
        {open ? children.map((child) => renderNode(child, depth + 1)) : null}
      </Fragment>
    );
  };

  const tree = data ? ordered(data.tree, sort) : [];
  const diskPct = data?.disk && data.disk.total > 0 ? ((data.disk.total - data.disk.free) / data.disk.total) * 100 : 0;
  const warningText = (() => {
    if (!data?.warning) return '';
    if (typeof data.warning === 'string') return t('storage.warningGeneric');
    const warning = data.warning;
    const key =
      warning.code === 'timeout'
        ? 'storage.warningTimeout'
        : warning.code === 'unreadable'
          ? 'storage.warningUnreadable'
          : warning.code === 'partial'
            ? 'storage.warningPartial'
            : 'storage.truncated';
    const base = t(key);
    return warning.path ? base + ' ' + t('storage.warningPath') + ' ' + warning.path : base;
  })();

  return (
    <div className="flex h-full flex-col">
      <PageHeader title={t('storage.title')} subtitle={t('storage.subtitle')} icon="storage">
        {data ? <span className="text-[12px] text-muted">{new Date(data.scannedAt).toLocaleTimeString(lang === 'id' ? 'id-ID' : 'en-US')}</span> : null}
        <button type="button" className="btn" onClick={() => void load(true)} disabled={loading}>
          {loading ? <Spinner /> : <Icon name="refresh" size={13} />}
          {loading ? t('storage.scanning') : t('storage.scan')}
        </button>
      </PageHeader>

      <div className="min-h-0 flex-1 overflow-auto p-3 md:p-5">
        {loading && !data ? (
          <div className="flex h-64 items-center justify-center gap-3 text-muted">
            <Spinner />
            <span>{t('storage.scanning')}</span>
          </div>
        ) : error && !data ? (
          <div className="card border-bad/30 p-5">
            <div className="text-bad">{error}</div>
            <button type="button" className="btn mt-3" onClick={() => void load(true)}>
              <Icon name="refresh" size={13} /> {t('storage.scan')}
            </button>
          </div>
        ) : data ? (
          <div className="space-y-4">
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <div className="card p-3">
                <div className="text-[12.5px] uppercase tracking-wide text-muted">{t('storage.total')}</div>
                <div className="mono mt-1 text-[18px] font-semibold">{bytes(data.total)}</div>
                <div className="mt-0.5 truncate text-[12.5px] text-muted" title={data.root}>{data.root}</div>
              </div>
              <div className="card p-3">
                <div className="text-[12.5px] uppercase tracking-wide text-muted">{t('storage.folders')}</div>
                <div className="mono mt-1 text-[18px] font-semibold">{data.count.toLocaleString(lang === 'id' ? 'id-ID' : 'en-US')}</div>
                <div className="mt-0.5 text-[12.5px] text-muted">{data.truncated ? t('storage.truncated') : '—'}</div>
              </div>
              {data.disk ? (
                <div className="card p-3">
                  <div className="text-[12.5px] uppercase tracking-wide text-muted">{t('storage.free')}</div>
                  <div className="mono mt-1 text-[18px] font-semibold">{bytes(data.disk.free)}</div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-panel2">
                    <div className="h-full rounded-full bg-accent" style={{ width: Math.min(100, diskPct) + '%' }} />
                  </div>
                  <div className="mt-0.5 text-right text-[12.5px] text-muted">{diskPct.toFixed(1)}% {t('storage.used')}</div>
                </div>
              ) : null}
              {data.warning ? (
                <div className="card border-warn/30 p-3">
                  <div className="text-[12.5px] uppercase tracking-wide text-warn">{t('storage.warning')}</div>
                  <div className="mt-1 text-[12.5px] text-warn/90 break-words">{warningText}</div>
                </div>
              ) : null}
            </div>

            <section className="card overflow-hidden">
              <div className="flex items-center justify-between gap-3 border-b border-line px-3 py-2">
                <h2 className="text-[13px] font-semibold">{t('storage.treemap')}</h2>
                <span className="text-[12.5px] text-muted">{tree.length} {t('storage.topLevel')}</span>
              </div>
              <div className="p-2">
                <Treemap nodes={tree} total={data.total} label={t('storage.treemapAria')} onSelect={focusPath} />
              </div>
            </section>

            <section className="card overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3 py-2">
                <h2 className="text-[13px] font-semibold">{t('storage.foldersList')}</h2>
                <div className="flex items-center gap-1">
                  <span className="mr-1 text-[12.5px] text-muted">{t('storage.sortSize')}/{t('storage.sortName')}</span>
                  <button
                    type="button"
                    className={cn('btn px-2 py-1 text-[12px]', sort === 'size' ? 'border-accent/40 text-accent' : '')}
                    onClick={() => setSort('size')}
                  >
                    {t('storage.sortSize')}
                  </button>
                  <button
                    type="button"
                    className={cn('btn px-2 py-1 text-[12px]', sort === 'name' ? 'border-accent/40 text-accent' : '')}
                    onClick={() => setSort('name')}
                  >
                    {t('storage.sortName')}
                  </button>
                </div>
              </div>
              {tree.length ? (
                <div className="divide-y divide-line/30">{tree.map((node) => renderNode(node, 0))}</div>
              ) : (
                <div className="p-5 text-[13px] text-muted">{t('storage.empty')}</div>
              )}
            </section>

            <section className="card border-bad/20 p-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="flex items-center gap-2 text-[13px] font-semibold text-bad">
                    <Icon name="trash" size={14} /> {t('storage.danger')}
                  </h2>
                  <p className="mt-1 max-w-2xl text-[12.5px] text-muted">{t('storage.dockerHint')}</p>
                </div>
                <button
                  type="button"
                  className="btn border-bad/30 text-bad hover:bg-bad/10"
                  onClick={() => void cleanDocker()}
                  disabled={dockerBusy}
                >
                  {dockerBusy ? <Spinner /> : <Icon name="trash" size={13} />}
                  {t('storage.docker')}
                </button>
              </div>
              {dockerOutput ? (
                <div className="mt-3">
                  <div className="mb-1 text-[12.5px] uppercase tracking-wide text-muted">{t('storage.dockerOutput')}</div>
                  <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-md border border-line bg-panel2 p-2 text-[12.5px] text-muted">
                    {dockerOutput.slice(0, 4000)}
                  </pre>
                </div>
              ) : null}
            </section>

            {error ? <div className="text-[13px] text-bad">{error}</div> : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
