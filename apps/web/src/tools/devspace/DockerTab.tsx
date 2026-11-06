import { useCallback, useEffect, useMemo, useState } from 'react';
import { Icon, Spinner, cn } from '../../components/ui';
import { api, ApiError, qs } from '../../lib/api';
import { useI18n } from '../../lib/i18n';
import { useConfirm } from '../../components/confirm';
import { useToast } from '../../components/toast';

type Container = {
  id: string;
  fullId: string;
  name: string;
  image: string;
  state: string;
  status: string;
  ports: string;
  running: boolean;
};
type Image = { repo: string; tag: string; size: string; created: string; createdAt?: string };
type DockerAction = 'start' | 'stop' | 'restart' | 'remove';
type SortDir = 'asc' | 'desc';
type ContainerSortKey = 'name' | 'image';
type ImageSortKey = 'repo' | 'size' | 'created';
type SortState<K extends string> = { key: K; dir: SortDir };

function textCompare(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

function sizeBytes(value: string): number {
  const match = /^([\d.]+)\s*([kmgt]?i?b)$/i.exec(value.trim());
  if (!match) return 0;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) return 0;
  const unit = match[2].toLowerCase();
  const power: Record<string, number> = { b: 1, kb: 1024, kib: 1024, mb: 1024 ** 2, mib: 1024 ** 2, gb: 1024 ** 3, gib: 1024 ** 3, tb: 1024 ** 4, tib: 1024 ** 4 };
  return amount * (power[unit] ?? 0);
}

function createdMs(image: Image): number {
  const raw = image.createdAt?.trim();
  if (!raw) return 0;
  // Docker CreatedAt berakhiran zona teks (WIB/UTC); buang agar Date.parse jalan.
  const timestamp = Date.parse(raw.replace(/\s+[A-Za-z]{2,5}$/, ''));
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function toggleSort<K extends string>(sort: SortState<K>, key: K): SortState<K> {
  return sort.key === key ? { key, dir: sort.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' };
}

function SortTh<K extends string>({
  label,
  sortKey,
  sort,
  onSort,
}: {
  label: string;
  sortKey: K;
  sort: SortState<K>;
  onSort: (key: K) => void;
}) {
  const active = sort.key === sortKey;
  return (
    <th
      className="border-b border-line px-3 py-2 font-medium"
      aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={cn('inline-flex items-center gap-1 hover:text-ink', active ? 'text-ink' : 'text-muted')}
      >
        {label}
        <span className="text-[9px] opacity-70">{active ? (sort.dir === 'asc' ? '▲' : '▼') : '↕'}</span>
      </button>
    </th>
  );
}
const DONE_KEYS: Record<DockerAction, 'docker.started' | 'docker.stopped' | 'docker.restarted' | 'docker.removed'> = {
  start: 'docker.started',
  stop: 'docker.stopped',
  restart: 'docker.restarted',
  remove: 'docker.removed',
};

export default function DockerTab() {
  const { t } = useI18n();
  const confirm = useConfirm();
  const toast = useToast();
  const [view, setView] = useState<'containers' | 'images'>('containers');
  const [containers, setContainers] = useState<Container[]>([]);
  const [images, setImages] = useState<Image[]>([]);
  const [logs, setLogs] = useState<{ id: string; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [acting, setActing] = useState<{ id: string; action: DockerAction } | null>(null);
  const [error, setError] = useState('');
  const [containerQuery, setContainerQuery] = useState('');
  const [imageQuery, setImageQuery] = useState('');
  const [containerSort, setContainerSort] = useState<SortState<ContainerSortKey>>({ key: 'name', dir: 'asc' });
  const [imageSort, setImageSort] = useState<SortState<ImageSortKey>>({ key: 'repo', dir: 'asc' });

  const visibleContainers = useMemo(() => {
    const needle = containerQuery.trim().toLowerCase();
    const rows = needle
      ? containers.filter((item) =>
          [item.name, item.image, item.ports].some((value) => value.toLowerCase().includes(needle)),
        )
      : containers;
    return [...rows].sort((a, b) => {
      const compare = containerSort.key === 'name' ? textCompare(a.name, b.name) : textCompare(a.image, b.image);
      return containerSort.dir === 'asc' ? compare : -compare;
    });
  }, [containers, containerQuery, containerSort]);

  const visibleImages = useMemo(() => {
    const needle = imageQuery.trim().toLowerCase();
    const rows = needle ? images.filter((item) => item.repo.toLowerCase().includes(needle)) : images;
    return [...rows].sort((a, b) => {
      let compare = 0;
      if (imageSort.key === 'repo') compare = textCompare(a.repo, b.repo);
      else if (imageSort.key === 'size') compare = sizeBytes(a.size) - sizeBytes(b.size);
      else compare = createdMs(a) - createdMs(b);
      return imageSort.dir === 'asc' ? compare : -compare;
    });
  }, [images, imageQuery, imageSort]);

  const load = useCallback(
    async (target: 'containers' | 'images') => {
      setBusy(true);
      setError('');
      try {
        if (target === 'images') {
          const result = await api.get<{ rows: Image[] }>('/dev/docker' + qs({ view: 'images' }));
          setImages(result.rows);
        } else {
          const result = await api.get<{ rows: Container[] }>('/dev/docker' + qs({ view: 'containers' }));
          setContainers(result.rows);
        }
      } catch (err) {
        setError(err instanceof ApiError ? err.message : t('err.docker'));
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  useEffect(() => {
    void load('containers');
  }, [load]);

  const openLogs = async (container: Container) => {
    setError('');
    try {
      const result = await api.get<{ text: string }>('/dev/docker' + qs({ view: 'logs', id: container.id }));
      setLogs({ id: container.name, text: result.text });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('err.log'));
    }
  };

  const runAction = async (container: Container, action: DockerAction) => {
    if (action === 'remove') {
      const ok = await confirm({
        title: t('docker.confirmRemove'),
        message: container.name + '\n' + t('docker.confirmRemoveBody'),
        danger: true,
        confirmLabel: t('common.delete'),
      });
      if (!ok) return;
    }
    setActing({ id: container.id, action });
    setError('');
    try {
      await api.post('/dev/docker/action', { action, id: container.fullId || container.id });
      if (action === 'remove' && logs?.id === container.name) setLogs(null);
      toast(t(DONE_KEYS[action]), 'ok');
      await load('containers');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('err.dockerAction'));
    } finally {
      setActing(null);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-4 md:p-5">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1">
          {(['containers', 'images'] as const).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => { setView(item); void load(item); }}
              className={cn('chip cursor-pointer', view === item && 'border-accent/60 bg-accent/15 text-accent')}
            >
              {t(item === 'containers' ? 'docker.tabContainers' : 'docker.tabImages')}
            </button>
          ))}
        </div>
        <div className="relative min-w-[180px] flex-1 sm:max-w-xs">
          <Icon name="search" size={14} className="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-muted" />
          <input
            value={view === 'containers' ? containerQuery : imageQuery}
            onChange={(event) =>
              view === 'containers' ? setContainerQuery(event.target.value) : setImageQuery(event.target.value)
            }
            placeholder={t(view === 'containers' ? 'docker.searchContainers' : 'docker.searchImages')}
            aria-label={t(view === 'containers' ? 'docker.searchContainers' : 'docker.searchImages')}
            className="input w-full py-1.5 pl-8 text-[12px]"
          />
        </div>
        <button type="button" className="btn" onClick={() => void load(view)} disabled={busy}>
          {busy ? <Spinner /> : <Icon name="refresh" />} {t('common.reload')}
        </button>
        <span className="hidden text-[11px] text-muted md:inline">{t('docker.controlHint')}</span>
      </div>

      {error ? <div className="text-[12px] text-bad">{error}</div> : null}

      <div className="flex min-h-0 flex-1 gap-3">
        <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-line">
          <table className="w-full border-collapse text-[12px]">
            <thead className="sticky top-0 bg-panel text-left text-[11px] tracking-wide text-muted uppercase">
              {view === 'containers' ? (
                <tr>
                  <SortTh
                    label={t('docker.colName')}
                    sortKey="name"
                    sort={containerSort}
                    onSort={(key) => setContainerSort((current) => toggleSort(current, key))}
                  />
                  <SortTh
                    label={t('docker.colImage')}
                    sortKey="image"
                    sort={containerSort}
                    onSort={(key) => setContainerSort((current) => toggleSort(current, key))}
                  />
                  <th className="border-b border-line px-3 py-2 font-medium">{t('docker.colStatus')}</th>
                  <th className="border-b border-line px-3 py-2 font-medium">{t('docker.colPorts')}</th>
                  <th className="border-b border-line px-3 py-2 text-right font-medium">{t('docker.colActions')}</th>
                </tr>
              ) : (
                <tr>
                  <SortTh
                    label={t('docker.colRepository')}
                    sortKey="repo"
                    sort={imageSort}
                    onSort={(key) => setImageSort((current) => toggleSort(current, key))}
                  />
                  <th className="border-b border-line px-3 py-2 font-medium">{t('docker.colTag')}</th>
                  <SortTh
                    label={t('docker.colSize')}
                    sortKey="size"
                    sort={imageSort}
                    onSort={(key) => setImageSort((current) => toggleSort(current, key))}
                  />
                  <SortTh
                    label={t('docker.colCreated')}
                    sortKey="created"
                    sort={imageSort}
                    onSort={(key) => setImageSort((current) => toggleSort(current, key))}
                  />
                </tr>
              )}
            </thead>
            <tbody>
              {view === 'containers'
                ? visibleContainers.map((item) => (
                    <tr
                      key={item.id}
                      onClick={() => void openLogs(item)}
                      className="cursor-pointer border-b border-line/60 hover:bg-panel2/60"
                    >
                      <td className="px-3 py-1.5">
                        <div className="flex items-center gap-2">
                          <span className={cn('h-1.5 w-1.5 rounded-full', item.running ? 'bg-ok' : 'bg-muted/60')} />
                          <span className="truncate text-ink">{item.name}</span>
                        </div>
                      </td>
                      <td className="mono px-3 py-1.5 text-muted">{item.image}</td>
                      <td className="px-3 py-1.5 text-muted">{item.status}</td>
                      <td className="mono px-3 py-1.5 text-muted">{item.ports}</td>
                      <td className="px-3 py-1.5" onClick={(event) => event.stopPropagation()}>
                        {acting?.id === item.id ? (
                          <div className="flex justify-end"><Spinner /></div>
                        ) : (
                          <div className="flex items-center justify-end gap-1 whitespace-nowrap">
                            {item.running ? (
                              <>
                                <button
                                  type="button"
                                  className="btn btn-ghost px-1.5 py-0.5"
                                  onClick={() => void runAction(item, 'stop')}
                                  disabled={Boolean(acting) || busy}
                                  title={t('docker.stop')}
                                  aria-label={t('docker.stop')}
                                >
                                  <Icon name="stop" size={13} />
                                </button>
                                <button
                                  type="button"
                                  className="btn btn-ghost px-1.5 py-0.5"
                                  onClick={() => void runAction(item, 'restart')}
                                  disabled={Boolean(acting) || busy}
                                  title={t('docker.restart')}
                                  aria-label={t('docker.restart')}
                                >
                                  <Icon name="restart" size={13} />
                                </button>
                              </>
                            ) : (
                              <button
                                type="button"
                                className="btn btn-ghost px-1.5 py-0.5 text-ok"
                                onClick={() => void runAction(item, 'start')}
                                disabled={Boolean(acting) || busy}
                                title={t('docker.start')}
                                aria-label={t('docker.start')}
                              >
                                <Icon name="play" size={13} />
                              </button>
                            )}
                            <button
                              type="button"
                              className="btn btn-ghost px-1.5 py-0.5 hover:text-bad"
                              onClick={() => void runAction(item, 'remove')}
                              disabled={Boolean(acting) || busy}
                              title={t('docker.remove')}
                              aria-label={t('docker.remove')}
                            >
                              <Icon name="trash" size={13} />
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))
                : visibleImages.map((item, index) => (
                    <tr key={item.repo + item.tag + index} className="border-b border-line/60">
                      <td className="px-3 py-1.5 text-ink">{item.repo}</td>
                      <td className="mono px-3 py-1.5 text-muted">{item.tag}</td>
                      <td className="px-3 py-1.5 text-muted">{item.size}</td>
                      <td className="px-3 py-1.5 text-muted">{item.created}</td>
                    </tr>
                  ))}
            </tbody>
          </table>
          {!busy && view === 'containers' && !visibleContainers.length ? (
            <div className="p-4 text-[12px] text-muted">
              {containers.length ? t('docker.noResults') : t('docker.empty')}
            </div>
          ) : null}
          {!busy && view === 'images' && !visibleImages.length ? (
            <div className="p-4 text-[12px] text-muted">
              {images.length ? t('docker.noResults') : t('docker.emptyImages')}
            </div>
          ) : null}
        </div>

        {logs ? (
          <div className="flex w-1/2 min-w-0 flex-col rounded-lg border border-line">
            <div className="flex items-center gap-2 border-b border-line px-3 py-1.5 text-[12px]">
              <Icon name="dev" size={13} className="text-accent" />
              <span className="mono truncate">{logs.id}</span>
              <button
                type="button"
                className="btn btn-ghost ml-auto px-1.5 py-0.5"
                onClick={() => setLogs(null)}
                title={t('common.close')}
                aria-label={t('common.close')}
              >
                <Icon name="x" size={13} />
              </button>
            </div>
            <pre className="mono min-h-0 flex-1 overflow-auto bg-[#070d14] p-3 text-[11.5px] leading-relaxed whitespace-pre-wrap">
              {logs.text || t('docker.logsEmpty')}
            </pre>
          </div>
        ) : null}
      </div>
    </div>
  );
}
