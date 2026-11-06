import { useCallback, useEffect, useState } from 'react';
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
type Image = { repo: string; tag: string; size: string; created: string };
type DockerAction = 'start' | 'stop' | 'restart' | 'remove';
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
              {item === 'containers' ? 'Container' : 'Image'}
            </button>
          ))}
        </div>
        <button type="button" className="btn ml-auto" onClick={() => void load(view)} disabled={busy}>
          {busy ? <Spinner /> : <Icon name="refresh" />} {t('common.reload')}
        </button>
        <span className="text-[11px] text-muted">{t('docker.controlHint')}</span>
      </div>

      {error ? <div className="text-[12px] text-bad">{error}</div> : null}

      <div className="flex min-h-0 flex-1 gap-3">
        <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-line">
          <table className="w-full border-collapse text-[12px]">
            <thead className="sticky top-0 bg-panel text-left text-[11px] tracking-wide text-muted uppercase">
              {view === 'containers' ? (
                <tr>
                  <th className="border-b border-line px-3 py-2 font-medium">Nama</th>
                  <th className="border-b border-line px-3 py-2 font-medium">Image</th>
                  <th className="border-b border-line px-3 py-2 font-medium">Status</th>
                  <th className="border-b border-line px-3 py-2 font-medium">Port</th>
                  <th className="border-b border-line px-3 py-2 text-right font-medium">Aksi</th>
                </tr>
              ) : (
                <tr>
                  <th className="border-b border-line px-3 py-2 font-medium">Repository</th>
                  <th className="border-b border-line px-3 py-2 font-medium">Tag</th>
                  <th className="border-b border-line px-3 py-2 font-medium">Ukuran</th>
                  <th className="border-b border-line px-3 py-2 font-medium">Dibuat</th>
                </tr>
              )}
            </thead>
            <tbody>
              {view === 'containers'
                ? containers.map((item) => (
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
                : images.map((item, index) => (
                    <tr key={item.repo + item.tag + index} className="border-b border-line/60">
                      <td className="px-3 py-1.5 text-ink">{item.repo}</td>
                      <td className="mono px-3 py-1.5 text-muted">{item.tag}</td>
                      <td className="px-3 py-1.5 text-muted">{item.size}</td>
                      <td className="px-3 py-1.5 text-muted">{item.created}</td>
                    </tr>
                  ))}
            </tbody>
          </table>
          {view === 'containers' && !containers.length && !busy ? (
            <div className="p-4 text-[12px] text-muted">{t("docker.empty")}</div>
          ) : null}
        </div>

        {logs ? (
          <div className="flex w-1/2 min-w-0 flex-col rounded-lg border border-line">
            <div className="flex items-center gap-2 border-b border-line px-3 py-1.5 text-[12px]">
              <Icon name="dev" size={13} className="text-accent" />
              <span className="mono truncate">{logs.id}</span>
              <button type="button" className="btn btn-ghost ml-auto px-1.5 py-0.5" onClick={() => setLogs(null)}>
                <Icon name="x" size={13} />
              </button>
            </div>
            <pre className="mono min-h-0 flex-1 overflow-auto bg-[#070d14] p-3 text-[11.5px] leading-relaxed whitespace-pre-wrap">
              {logs.text || '(log kosong)'}
            </pre>
          </div>
        ) : null}
      </div>
    </div>
  );
}
