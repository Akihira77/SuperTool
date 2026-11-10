import { useEffect, useRef, useState } from 'react';
import { Icon, PageHeader, Spinner, cn } from '../components/ui';
import { api, ApiError } from '../lib/api';
import { bytes, timeAgo } from '../lib/format';
import { useI18n } from '../lib/i18n';
import { useToast } from '../components/toast';
import { useConfirm } from '../components/confirm';
import { PrayerSettings } from '../components/PrayerSettings';
import { WorkspacePanel } from '../components/WorkspacePanel';

type DbInfo = { path: string; size: number; mtime: number; tables: Array<{ name: string; rows: number }> };
type CookieInfo = { configured: boolean; size: number; mtime: number | null };
type Diagnostics = {
  version: string;
  node: string;
  pid: number;
  uptimeSec: number;
  memory: { rss: number; heapUsed: number; heapTotal: number };
  db: { path: string; size: number; walSize: number; pageCount: number; pageSize: number; freePages: number; userVersion: number; journalMode: string; ok: boolean; error: string | null };
  disk: { path: string; total: number; free: number; available: number } | null;
  lastError: { ts: number; level: string; context: string; message: string } | null;
  logs: Array<{ ts: number; level: string; context: string; message: string }>;
};

function uptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d) return d + 'd ' + h + 'h';
  if (h) return h + 'h ' + m + 'm';
  return m + 'm ' + (seconds % 60) + 's';
}

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
  const [cookieInfo, setCookieInfo] = useState<CookieInfo | null>(null);
  const [cookieBusy, setCookieBusy] = useState(false);
  const [cookieError, setCookieError] = useState('');
  const cookieRef = useRef<HTMLInputElement>(null);
  const [diag, setDiag] = useState<Diagnostics | null>(null);
  const [diagError, setDiagError] = useState('');

  const refreshDiagnostics = () => {
    setDiagError('');
    api
      .get<Diagnostics>('/diagnostics')
      .then((data) => setDiag(data))
      .catch((err) => setDiagError(err instanceof ApiError ? err.message : t('settings.diagUnavailable')));
  };

  useEffect(() => {
    api
      .get<DbInfo>('/sqlite/info')
      .then((data) => setInfo(data))
      .catch(() => undefined);
    api
      .get<CookieInfo>('/downloader/cookies')
      .then((data) => setCookieInfo(data))
      .catch(() => undefined);
    refreshDiagnostics();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const uploadCookies = async (picked: File) => {
    if (!picked.name.toLowerCase().endsWith('.txt')) {
      setCookieError(t('settings.cookiesFileError'));
      return;
    }
    if (picked.size > 1_000_000) {
      setCookieError(t('settings.cookiesTooLarge'));
      return;
    }
    setCookieBusy(true);
    setCookieError('');
    try {
      const body = new FormData();
      body.append('file', picked);
      const res = await fetch('/api/downloader/cookies', {
        method: 'POST',
        body,
        credentials: 'same-origin',
        headers: { 'x-st-csrf': '1' },
      });
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
      setCookieInfo(JSON.parse(text) as CookieInfo);
      toast(t('settings.cookiesUploaded'), 'ok');
    } catch (err) {
      const message = err instanceof ApiError ? err.message : t('settings.cookiesError');
      setCookieError(message);
      toast(message, 'error');
    } finally {
      setCookieBusy(false);
      if (cookieRef.current) cookieRef.current.value = '';
    }
  };

  const removeCookies = async () => {
    const ok = await confirm({
      title: t('settings.cookiesRemove'),
      message: t('settings.cookiesRemoveBody'),
      confirmLabel: t('settings.cookiesRemove'),
      danger: true,
    });
    if (!ok) return;
    setCookieBusy(true);
    setCookieError('');
    try {
      const res = await fetch('/api/downloader/cookies', {
        method: 'DELETE',
        credentials: 'same-origin',
        headers: { 'x-st-csrf': '1' },
      });
      if (!res.ok) throw new ApiError(res.statusText || 'HTTP ' + res.status, res.status);
      setCookieInfo((await res.json()) as CookieInfo);
      toast(t('settings.cookiesRemoved'), 'ok');
    } catch (err) {
      const message = err instanceof ApiError ? err.message : t('settings.cookiesError');
      setCookieError(message);
      toast(message, 'error');
    } finally {
      setCookieBusy(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <PageHeader title={t('settings.title')} subtitle={t('settings.subtitle')} icon="save" />

      <div className="page-body">
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

        <div className="card flex flex-col gap-3 p-4">
          <div className="flex items-center gap-2">
            <span className="flex size-7 items-center justify-center rounded-lg bg-accent/15 text-accent"><Icon name="ports" size={14} /></span>
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-medium">{t('settings.diagnostics')}</div>
              <div className="text-[11.5px] text-muted">{t('settings.diagnosticsHint')}</div>
            </div>
            <button type="button" className="btn cursor-pointer px-2 py-1 text-[11px]" onClick={refreshDiagnostics}>
              <Icon name="refresh" size={12} /> {t('settings.diagRefresh')}
            </button>
          </div>
          {diag ? (
            <div className="flex flex-col gap-2">
              <div className="grid gap-2 rounded-lg border border-line bg-panel2/40 p-2.5 text-[11.5px] sm:grid-cols-3 lg:grid-cols-4">
                <div><div className="label">{t('settings.diagVersion')}</div><div className="mono text-ink/85">{diag.version}</div></div>
                <div><div className="label">{t('settings.diagNode')}</div><div className="mono text-ink/85">{diag.node}</div></div>
                <div><div className="label">{t('settings.diagUptime')}</div><div className="mono text-ink/85">{uptime(diag.uptimeSec)}</div></div>
                <div><div className="label">{t('settings.diagMemory')}</div><div className="mono text-ink/85">{bytes(diag.memory.rss)}</div></div>
                <div><div className="label">{t('settings.diagDb')}</div><div className={cn('mono', diag.db.ok ? 'text-ink/85' : 'text-danger')}>{bytes(diag.db.size)} · v{diag.db.userVersion}</div></div>
                <div><div className="label">WAL</div><div className="mono text-ink/85">{bytes(diag.db.walSize)}</div></div>
                <div><div className="label">{t('settings.diagDisk')}</div><div className="mono text-ink/85">{diag.disk ? bytes(diag.disk.available) : '—'}</div></div>
                <div><div className="label">Pages</div><div className="mono text-ink/85">{diag.db.pageCount} × {bytes(diag.db.pageSize)}</div></div>
              </div>
              {diag.db.error ? <div className="rounded-lg border border-danger/30 bg-danger/10 p-2 text-[11.5px] text-danger">{diag.db.error}</div> : null}
              <div className="rounded-lg border border-line bg-panel2/40 p-2.5">
                <div className="label mb-1">{t('settings.diagLogs')}</div>
                {diag.lastError ? (
                  <div className="mb-1.5 rounded border border-danger/30 bg-danger/10 p-1.5 font-mono text-[10.5px] text-danger">
                    {new Date(diag.lastError.ts).toLocaleTimeString()} [{diag.lastError.context}] {diag.lastError.message}
                  </div>
                ) : <div className="mb-1.5 text-[11px] text-muted">{t('settings.diagNoError')}</div>}
                <div className="max-h-40 space-y-0.5 overflow-y-auto font-mono text-[10.5px] leading-relaxed text-muted">
                  {diag.logs.slice(-30).map((entry, index) => (
                    <div key={entry.ts + ':' + index} className={cn('truncate', entry.level === 'error' && 'text-danger', entry.level === 'warn' && 'text-warn')} title={entry.message}>
                      {new Date(entry.ts).toLocaleTimeString()} [{entry.context}] {entry.message}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-[11.5px] text-muted">
              {diagError ? <span className="text-danger">{diagError}</span> : <><Spinner /> {t('settings.diagnostics')}</>}
            </div>
          )}
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

        <div className="card flex flex-col gap-3 p-4">
          <div className="flex items-center gap-2">
            <span className="flex size-7 items-center justify-center rounded-lg bg-accent/15 text-accent"><Icon name="upload" size={14} /></span>
            <div className="min-w-0">
              <div className="text-[13px] font-medium">{t('settings.cookies')}</div>
              <div className="text-[11.5px] text-muted">{t('settings.cookiesHint')}</div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className={cn('badge', cookieInfo?.configured ? 'text-ok' : 'text-muted')}>
              {cookieInfo?.configured ? t('settings.cookiesActive') : t('settings.cookiesEmpty')}
            </span>
            {cookieInfo?.configured ? (
              <span className="text-[11.5px] text-muted">
                {bytes(cookieInfo.size)}{cookieInfo.mtime ? ' · ' + timeAgo(cookieInfo.mtime) : ''}
              </span>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={cookieRef}
              type="file"
              accept=".txt,text/plain"
              className="hidden"
              onChange={(event) => {
                const picked = event.target.files?.[0];
                if (picked) void uploadCookies(picked);
              }}
              aria-label={t('settings.cookiesFile')}
            />
            <button
              type="button"
              className="btn cursor-pointer"
              onClick={() => cookieRef.current?.click()}
              disabled={cookieBusy}
            >
              {cookieBusy ? <Spinner /> : <Icon name="upload" size={13} />}
              {cookieInfo?.configured ? t('settings.cookiesReplace') : t('settings.cookiesUpload')}
            </button>
            {cookieInfo?.configured ? (
              <button type="button" className="btn cursor-pointer" onClick={() => void removeCookies()} disabled={cookieBusy}>
                {t('settings.cookiesRemove')}
              </button>
            ) : null}
          </div>

          <div className="rounded-lg border border-line bg-panel2/40 p-2.5 text-[11.5px] leading-relaxed text-muted">
            {t('settings.cookiesWarning')}
          </div>
          {cookieError ? <div className="text-[11.5px] text-bad">{cookieError}</div> : null}
        </div>

        <WorkspacePanel />

        <PrayerSettings />
      </div>
    </div>
  );
}
