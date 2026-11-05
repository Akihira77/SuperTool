import { useEffect, useRef, useState } from 'react';
import { Icon, PageHeader, Spinner, cn } from '../components/ui';
import { api, ApiError } from '../lib/api';
import { bytes, timeAgo } from '../lib/format';
import { useI18n } from '../lib/i18n';
import { useToast } from '../components/toast';
import { useConfirm } from '../components/confirm';

type DbInfo = { path: string; size: number; mtime: number; tables: Array<{ name: string; rows: number }> };

/**
 * Backup & restore data aplikasi: unduh zip (database + uploads), lalu pulihkan
 * dari zip. Restore mengganti database yang sedang dipakai, jadi sesi login lama
 * ikut hilang (secret sesi tersimpan di dalam database).
 */
export default function SettingsTool() {
  const { t } = useI18n();
  const toast = useToast();
  const confirm = useConfirm();
  const [info, setInfo] = useState<DbInfo | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api
      .get<DbInfo>('/sqlite/info')
      .then((data) => setInfo(data))
      .catch(() => undefined);
  }, []);

  const restore = async () => {
    if (!file) return;
    const ok = await confirm({
      title: t('settings.confirmRestore'),
      message: t('settings.confirmRestoreBody'),
      confirmLabel: t('settings.restoreNow'),
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    setError('');
    try {
      const body = new FormData();
      body.append('file', file);
      const res = await fetch('/api/restore', { method: 'POST', body, credentials: 'same-origin', headers: { 'x-st-csrf': '1' } });
      const text = await res.text();
      if (!res.ok) {
        let message = res.statusText;
        try {
          const payload = JSON.parse(text) as { message?: string | string[] };
          message = Array.isArray(payload.message) ? payload.message.join(', ') : payload.message ?? message;
        } catch {
          message = text.slice(0, 160) || message;
        }
        throw new ApiError(message, res.status);
      }
      toast(t('settings.restored'), 'ok');
      setFile(null);
      if (fileRef.current) fileRef.current.value = '';
      // Database baru punya secret sesi lain: muat ulang supaya login ulang.
      setTimeout(() => location.reload(), 1200);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : t('settings.restoreError');
      setError(message);
      toast(message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <PageHeader title={t('settings.title')} subtitle={t('settings.subtitle')} />

      <div className="flex flex-col gap-3 p-4">
        <div className="card flex flex-col gap-3 p-4">
          <div className="flex items-center gap-2">
            <span className="flex size-7 items-center justify-center rounded-lg bg-accent/15 text-accent"><Icon name="download" size={14} /></span>
            <div>
              <div className="text-[13px] font-medium">{t('settings.backup')}</div>
              <div className="text-[11.5px] text-muted">{t('settings.backupHint')}</div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <a className="btn btn-primary cursor-pointer" data-action="settings:backup" href="/api/backup" download>
              <Icon name="download" size={13} /> {t('settings.downloadBackup')}
            </a>
            <span className="text-[11.5px] text-muted">{t('settings.backupContains')}</span>
          </div>
          {info ? (
            <div className="grid gap-2 rounded-lg border border-line bg-panel2/40 p-2.5 text-[11.5px] sm:grid-cols-3">
              <div>
                <div className="label">{t('settings.dbSize')}</div>
                <div className="mono text-ink/85">{bytes(info.size)}</div>
              </div>
              <div>
                <div className="label">{t('settings.dbUpdated')}</div>
                <div className="text-ink/85">{timeAgo(info.mtime)}</div>
              </div>
              <div className="min-w-0">
                <div className="label">{t('settings.dbTables')}</div>
                <div className="truncate text-ink/85" title={info.tables.map((table) => table.name).join(', ')}>
                  {info.tables.length} · {info.tables.slice(0, 3).map((table) => table.name).join(', ')}
                </div>
              </div>
            </div>
          ) : null}
        </div>

        <div className={cn('card flex flex-col gap-3 p-4', file && 'border-warn/40')}>
          <div className="flex items-center gap-2">
            <span className="flex size-7 items-center justify-center rounded-lg bg-warn/15 text-warn"><Icon name="upload" size={14} /></span>
            <div>
              <div className="text-[13px] font-medium">{t('settings.restore')}</div>
              <div className="text-[11.5px] text-muted">{t('settings.restoreHint')}</div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileRef}
              type="file"
              accept=".zip,application/zip"
              onChange={(event) => {
                const next = event.target.files?.[0] ?? null;
                setFile(next);
                setError('');
              }}
              className="input max-w-sm cursor-pointer py-1.5 text-[12px]"
              aria-label={t('settings.chooseZip')}
            />
            <button type="button" className="btn cursor-pointer" data-action="settings:restore" onClick={() => void restore()} disabled={!file || busy}>
              {busy ? <Spinner /> : <Icon name="upload" size={13} />} {t('settings.restoreNow')}
            </button>
          </div>

          <div className="rounded-lg border border-warn/30 bg-warn/5 p-2.5 text-[11.5px] leading-relaxed text-warn/90">
            {t('settings.restoreWarning')}
          </div>
          {error ? <div className="text-[11.5px] text-bad">{error}</div> : null}
        </div>
      </div>
    </div>
  );
}
