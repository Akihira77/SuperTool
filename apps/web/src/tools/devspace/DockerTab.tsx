import { useCallback, useEffect, useState } from 'react';
import { Icon, Spinner, cn } from '../../components/ui';
import { api, ApiError, qs } from '../../lib/api';
import { useI18n } from '../../lib/i18n';

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

export default function DockerTab() {
  const { t } = useI18n();
  const [view, setView] = useState<'containers' | 'images'>('containers');
  const [containers, setContainers] = useState<Container[]>([]);
  const [images, setImages] = useState<Image[]>([]);
  const [logs, setLogs] = useState<{ id: string; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
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

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
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
        <span className="text-[11px] text-muted">read-only</span>
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
            <pre className="mono min-h-0 flex-1 overflow-auto bg-[#0b1118] p-3 text-[11.5px] leading-relaxed whitespace-pre-wrap">
              {logs.text || '(log kosong)'}
            </pre>
          </div>
        ) : null}
      </div>
    </div>
  );
}
