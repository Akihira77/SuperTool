import { useCallback, useEffect, useState } from 'react';
import { Icon, Spinner, cn } from '../../components/ui';
import { api, ApiError, qs } from '../../lib/api';
import { useI18n } from '../../lib/i18n';
import { useConfirm } from '../../components/confirm';
import { useToast } from '../../components/toast';

type Entry = { index: number; line: string };

const PRESETS: Array<{ label: string; value: string }> = [
  { label: 'Backup tiap hari 03:00', value: '0 3 * * * /home/user/backup.sh' },
  { label: 'Tiap 15 menit', value: '*/15 * * * * /home/user/tugas.sh' },
  { label: 'Tiap jam', value: '0 * * * * /home/user/tugas.sh' },
  { label: 'Setiap Senin 08:00', value: '0 8 * * 1 /home/user/tugas.sh' },
];

export default function CronTab() {
  const { t } = useI18n();
  const confirm = useConfirm();
  const toast = useToast();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [line, setLine] = useState('0 3 * * * /home/user/backup.sh');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setBusy(true);
    setError('');
    try {
      const result = await api.get<{ entries: Entry[] }>('/dev/cron');
      setEntries(result.entries);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('err.cronRead'));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const add = async () => {
    setBusy(true);
    setError('');
    try {
      const result = await api.post<{ entries: Entry[] }>('/dev/cron', { line });
      setEntries(result.entries);
      toast(t('common.created'), 'ok');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('err.cronAdd'));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (entry: Entry) => {
    const ok = await confirm({ title: t('cron.confirmDelete'), message: entry.line, danger: true, confirmLabel: t('common.delete') });
    if (!ok) return;
    setBusy(true);
    setError('');
    try {
      const result = await api.del<{ entries: Entry[] }>('/dev/cron' + qs({ index: entry.index }));
      setEntries(result.entries);
      toast(t('common.deleted'), 'ok');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('err.cronDelete'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-4">
      <div className="card flex flex-col gap-2 p-3">
        <div className="flex items-center gap-2">
          <span className="text-[11px] tracking-wide text-muted uppercase">Tambah jadwal</span>
          {busy ? <Spinner /> : null}
          <button type="button" className="btn btn-ghost ml-auto px-1.5 py-0.5" onClick={() => void load()} title={t('common.reload')}>
            <Icon name="refresh" size={13} />
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={line}
            onChange={(event) => setLine(event.target.value)}
            onKeyDown={(event) => event.key === 'Enter' && void add()}
            className="input mono flex-1 py-1.5"
            spellCheck={false}
            placeholder="0 3 * * * /path/script.sh"
          />
          <button type="button" className="btn btn-primary" onClick={() => void add()} disabled={busy || !line.trim()}>
            <Icon name="plus" /> Tambah
          </button>
        </div>
        <div className="flex flex-wrap gap-1">
          {PRESETS.map((preset) => (
            <button
              key={preset.label}
              type="button"
              onClick={() => setLine(preset.value)}
              className="rounded border border-line px-2 py-0.5 text-[11px] text-muted hover:border-accent/50 hover:text-ink"
            >
              {preset.label}
            </button>
          ))}
        </div>
        {error ? <div className="text-[11.5px] text-bad">{error}</div> : null}
      </div>

      <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-line">
        <table className="w-full border-collapse text-[12px]">
          <thead className="sticky top-0 bg-panel text-left text-[11px] tracking-wide text-muted uppercase">
            <tr>
              <th className="border-b border-line px-3 py-2 font-medium">Jadwal</th>
              <th className="border-b border-line px-3 py-2 text-right font-medium">Aksi</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.index} className="border-b border-line/60 hover:bg-panel2/50">
                <td className="mono px-3 py-1.5 break-all text-ink/90">{entry.line}</td>
                <td className="px-3 py-1.5 text-right">
                  <button type="button" className="btn btn-danger px-1.5 py-0.5" onClick={() => void remove(entry)}>
                    <Icon name="trash" size={13} />
                  </button>
                </td>
              </tr>
            ))}
            {!entries.length && !busy ? (
              <tr>
                <td colSpan={2} className="px-3 py-4 text-center text-[12px] text-muted">
                  Belum ada jadwal.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div className={cn('text-[11px]', 'text-muted')}>
        Mengubah crontab user yang menjalankan server. Perubahan langsung aktif pada cron daemon.
      </div>
    </div>
  );
}
