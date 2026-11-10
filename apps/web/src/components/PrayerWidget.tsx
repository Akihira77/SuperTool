import { useEffect, useRef, useState } from 'react';
import { Icon, cn } from './ui';
import { useI18n } from '../lib/i18n';
import {
  PRAYER_LABEL_KEYS,
  type PrayerKey,
  type PrayerSettings,
  type PrayerTime,
  computePrayerTimes,
  duePrayer,
  formatClock,
  loadPrayerSettings,
  nextPrayer,
  playChime,
  subscribePrayerSettings,
} from '../lib/prayer';

const ALERT_VISIBLE_MS = 20_000;
const SOON_MS = 30 * 60_000;
const THROB_BEFORE_MS = 15 * 60_000;
const THROB_AFTER_MS = 10 * 60_000;

/**
 * Widget jam + jadwal sholat di header. Lokasi hanya dari input manual di
 * Setelan (tanpa izin geolocation browser); pengingat dicek tiap menit.
 */
export function PrayerWidget() {
  const { t, lang } = useI18n();
  const locale = lang === 'id' ? 'id-ID' : 'en-US';
  const [now, setNow] = useState(() => new Date());
  const [settings, setSettings] = useState<PrayerSettings>(() => loadPrayerSettings());
  const [times, setTimes] = useState<PrayerTime[]>([]);
  const [nextDayTimes, setNextDayTimes] = useState<PrayerTime[]>([]);
  const [open, setOpen] = useState(false);
  const [alert, setAlert] = useState<PrayerTime | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const fired = useRef<Set<string>>(new Set());

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => subscribePrayerSettings(() => setSettings(loadPrayerSettings())), []);

  const day = now.toDateString();
  useEffect(() => {
    if (settings.lat === null || settings.lon === null) {
      setTimes([]);
      setNextDayTimes([]);
      return;
    }
    let alive = true;
    const tomorrow = new Date(now.getTime() + 86_400_000);
    Promise.all([
      computePrayerTimes(settings.lat, settings.lon, now),
      computePrayerTimes(settings.lat, settings.lon, tomorrow),
    ])
      .then(([today, nextDay]) => {
        if (!alive) return;
        setTimes(today);
        setNextDayTimes(nextDay);
      })
      .catch(() => {
        if (!alive) return;
        setTimes([]);
        setNextDayTimes([]);
      });
    return () => {
      alive = false;
    };
    // now sengaja tidak jadi dependency: cukup berganti hari, bukan tiap detik.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.lat, settings.lon, day]);

  useEffect(() => {
    if (!times.length) return;
    const check = () => {
      const due = duePrayer(times, Date.now());
      if (!due) return;
      const id = due.at.toDateString() + ':' + due.key;
      if (fired.current.has(id)) return;
      fired.current.add(id);
      if (settings.popup) setAlert(due);
      if (settings.sound) playChime();
    };
    check();
    const id = window.setInterval(check, 60_000);
    return () => window.clearInterval(id);
  }, [times, settings.popup, settings.sound]);

  useEffect(() => {
    if (!alert) return;
    const id = window.setTimeout(() => setAlert(null), ALERT_VISIBLE_MS);
    return () => window.clearTimeout(id);
  }, [alert]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointer);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const dateText = now.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const clockText = formatClock(now);
  const nowMs = now.getTime();
  const upcoming = nextPrayer(times, nowMs);
  const beforePrayer = times.find(
    (item) => nowMs >= item.at.getTime() - THROB_BEFORE_MS && nowMs < item.at.getTime(),
  ) ?? null;
  const afterPrayer = times.find(
    (item) => nowMs >= item.at.getTime() && nowMs < item.at.getTime() + THROB_AFTER_MS,
  ) ?? null;
  const throbTone = afterPrayer ? 'after' : beforePrayer ? 'before' : null;
  // Jangan lompat ke sholat berikutnya sampai jendela 10 menit sesudahnya lewat.
  const focusPrayer = afterPrayer ?? upcoming;
  const headerNext = focusPrayer ?? nextDayTimes[0] ?? null;
  const headerTone = throbTone ?? (headerNext && headerNext.at.getTime() - nowMs <= SOON_MS ? 'soon' : null);
  const coords = settings.lat !== null && settings.lon !== null
    ? settings.lat.toFixed(4) + ', ' + settings.lon.toFixed(4)
    : '';
  const prayerLabel = (key: PrayerKey) => t(PRAYER_LABEL_KEYS[key] as 'prayer.subuh');
  const openSettings = () => {
    setOpen(false);
    location.hash = '/settings';
  };

  const alertLabel = alert ? prayerLabel(alert.key) : '';

  return (
    <div ref={rootRef} className="relative">
      <div
        className={cn(
          'relative rounded-[10px]',
          throbTone === 'after' && 'prayer-throbber prayer-throbber-after',
          throbTone === 'before' && 'prayer-throbber prayer-throbber-before',
        )}
      >
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="btn min-h-7 cursor-pointer gap-1.5 px-2 py-1"
        title={dateText + ' · ' + clockText}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <Icon name="clock" size={13} className="shrink-0 text-accent/80" />
        <span className="hidden text-[12.5px] text-muted lg:inline">{dateText}</span>
        <span className="mono text-[13px] font-medium tabular-nums">{clockText}</span>
        {headerNext ? (
          <span className="flex items-center gap-1.5 border-l border-line pl-1.5">
            {headerTone ? (
              <span className="relative flex size-1.5" aria-hidden="true">
                <span className={cn('absolute inline-flex size-full animate-ping rounded-full opacity-70', headerTone === 'after' ? 'bg-ok' : 'bg-warn')} />
                <span className={cn('relative inline-flex size-1.5 rounded-full', headerTone === 'after' ? 'bg-ok' : 'bg-warn')} />
              </span>
            ) : null}
            <span className="hidden text-[12px] text-muted sm:inline">{prayerLabel(headerNext.key)}</span>
            <span className="mono text-[12.5px] tabular-nums text-muted">{formatClock(headerNext.at)}</span>
          </span>
        ) : null}
        <Icon name={open ? 'chevronDown' : 'chevronRight'} size={10} className="shrink-0 text-muted" />
      </button>
      </div>

      {open ? (
        <div className="absolute top-full right-0 z-50 mt-1.5 w-72 rounded-xl border border-line bg-panel p-2 shadow-[0_24px_70px_-24px_rgb(0_0_0/0.9)]" role="dialog" aria-label={t('prayer.title')}>
          <div className="flex items-start gap-2 rounded-lg bg-panel2/45 px-2 py-2">
            <Icon name="bell" size={14} className="mt-0.5 shrink-0 text-accent" />
            <div className="min-w-0 flex-1">
              <div className="text-[13.5px] font-medium">{t('prayer.today')}</div>
              <div className="truncate text-[12.5px] text-muted" title={settings.label || coords}>
                {settings.label || coords || t('prayer.locationUnknown')}
              </div>
            </div>
          </div>

          {times.length ? (
            <div className="flex flex-col">
              {times.map((item) => {
                const next = focusPrayer?.key === item.key;
                const passed = item.at.getTime() < now.getTime() && !next;
                return (
                  <div
                    key={item.key}
                    className={cn(
                      'flex items-center justify-between rounded-md px-1.5 py-1 text-[13px]',
                      next ? 'bg-accent/10 text-accent' : passed ? 'text-muted/70' : 'text-ink/85',
                    )}
                  >
                    <span className="flex items-center gap-1.5">
                      {next ? <span className="size-1.5 rounded-full bg-accent" /> : <span className="size-1.5" />}
                      {prayerLabel(item.key)}
                    </span>
                    <span className="mono text-[12.5px] tabular-nums">{formatClock(item.at)}</span>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="px-1.5 py-2">
              <button
                type="button"
                className="btn btn-primary mt-2 w-full cursor-pointer justify-center"
                onClick={openSettings}
              >
                <Icon name="pin" size={13} /> {t('prayer.setLocation')}
              </button>
            </div>
          )}

          <div className="mt-2 border-t border-line pt-1.5">
            <button
              type="button"
              className="nav-item w-full text-[12.5px]"
              onClick={openSettings}
            >
              <Icon name="pin" size={13} /> {t('prayer.settingsLink')}
            </button>
            <div className="mt-1 px-1.5 text-[12.5px] leading-snug text-muted/70">
              {t('prayer.methodNote')}
            </div>
          </div>
        </div>
      ) : null}

      {alert ? (
        <div className="fixed bottom-4 left-4 z-[70] w-80 rounded-xl border border-accent/50 bg-panel/95 p-3 shadow-[0_24px_70px_-20px_rgb(0_0_0/0.9)] backdrop-blur" role="alert">
          <div className="flex items-start gap-2.5">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-accent">
              <Icon name="bell" size={16} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[13.5px] font-semibold">{t('prayer.reminder')} {alertLabel}</div>
              <div className="mono mt-0.5 text-[12px] text-muted">{formatClock(alert.at)}</div>
              <div className="mt-1 text-[12px] leading-snug text-muted">{t('prayer.reminderBody')}</div>
            </div>
            <button
              type="button"
              className="btn btn-ghost shrink-0 cursor-pointer px-1 py-0.5"
              onClick={() => setAlert(null)}
              title={t('common.close')}
            >
              <Icon name="x" size={12} />
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}