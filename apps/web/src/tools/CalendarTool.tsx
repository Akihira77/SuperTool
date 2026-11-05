import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Icon, PageHeader, Spinner } from '../components/ui';
import { ApiError, api } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { useToast } from '../components/toast';

type GoogleDate = { date?: string; dateTime?: string; timeZone?: string };
type CalendarEvent = {
  id: string;
  summary: string;
  description: string;
  location: string;
  start: GoogleDate | null;
  end: GoogleDate | null;
  htmlLink: string;
  status: string;
  allDay: boolean;
};
type CalendarResponse = { calendarId: string; timeMin: string; events: CalendarEvent[] };
type Phase = 'loading' | 'disconnected' | 'ready' | 'error';

function parseDate(value: GoogleDate | null | undefined): Date | null {
  if (!value) return null;
  if (value.dateTime) {
    const date = new Date(value.dateTime);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (value.date) {
    // Tanggal all-day: parse sebagai waktu lokal, bukan UTC.
    const date = new Date(value.date + 'T00:00:00');
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}

const startOf = (event: CalendarEvent) => parseDate(event.start);
const endOf = (event: CalendarEvent) => parseDate(event.end);

function dayKey(date: Date): string {
  return date.getFullYear() + '-' + (date.getMonth() + 1) + '-' + date.getDate();
}

function dayLabel(date: Date, locale: string, today: string, tomorrow: string): string {
  const base = new Date();
  base.setHours(0, 0, 0, 0);
  const target = new Date(date);
  target.setHours(0, 0, 0, 0);
  const diff = Math.round((target.getTime() - base.getTime()) / 86_400_000);
  if (diff === 0) return today;
  if (diff === 1) return tomorrow;
  const sameYear = target.getFullYear() === base.getFullYear();
  return target.toLocaleDateString(locale, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}

function timeRange(event: CalendarEvent, locale: string, allDayLabel: string): string {
  if (event.allDay || !event.start?.dateTime) return allDayLabel;
  const start = startOf(event);
  if (!start) return allDayLabel;
  const clock = (date: Date) => date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  const end = endOf(event);
  return end ? clock(start) + ' – ' + clock(end) : clock(start);
}

export default function CalendarTool() {
  const { t, lang } = useI18n();
  const toast = useToast();
  const locale = lang === 'id' ? 'id-ID' : 'en-US';
  const [phase, setPhase] = useState<Phase>('loading');
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [message, setMessage] = useState('');
  const [configMissing, setConfigMissing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [opening, setOpening] = useState(false);
  const [hint, setHint] = useState(false);
  const booted = useRef(false);

  const fetchEvents = useCallback(
    async (initial: boolean) => {
      if (initial) setPhase('loading');
      setBusy(true);
      try {
        const data = await api.get<CalendarResponse>('/calendar/events');
        setEvents(data.events ?? []);
        setMessage('');
        setConfigMissing(false);
        setPhase('ready');
      } catch (err) {
        const text = err instanceof ApiError ? err.message : t('calendar.error');
        setMessage(text);
        const disconnected =
          err instanceof ApiError && err.status === 400 && /belum terhubung|belum dikonfigurasi/i.test(text);
        if (disconnected) {
          setPhase('disconnected');
          setConfigMissing(/dikonfigurasi/i.test(text));
        } else {
          setPhase('error');
        }
      } finally {
        setBusy(false);
      }
    },
    [t],
  );

  // Status OAuth (?google=connected|denied|error) hanya dibaca sekali, lalu
  // hash dibersihkan supaya toast tidak muncul lagi saat remount.
  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    const query = location.hash.includes('?') ? location.hash.slice(location.hash.indexOf('?') + 1) : '';
    const status = new URLSearchParams(query).get('google');
    if (status) {
      if (status === 'connected') toast(t('calendar.connected'), 'ok');
      else if (status === 'denied') toast(t('calendar.denied'), 'error');
      else toast(t('calendar.failed'), 'error');
      history.replaceState(null, '', location.pathname + location.search + '#/calendar');
    }
    void fetchEvents(true);
  }, [fetchEvents, t, toast]);

  const connect = async () => {
    setOpening(true);
    try {
      const data = await api.get<{ url: string }>('/calendar/auth');
      const popup = window.open(data.url, '_blank');
      if (!popup) {
        window.location.href = data.url;
        return;
      }
      setHint(true);
    } catch (err) {
      const text = err instanceof ApiError ? err.message : t('calendar.failed');
      setMessage(text);
      toast(text, 'error');
    } finally {
      setOpening(false);
    }
  };

  const groups = useMemo(() => {
    const map = new Map<string, { date: Date; items: Array<{ event: CalendarEvent; start: Date }> }>();
    for (const event of events) {
      const start = startOf(event);
      if (!start) continue;
      const key = dayKey(start);
      const group = map.get(key);
      if (group) group.items.push({ event, start });
      else map.set(key, { date: start, items: [{ event, start }] });
    }
    return Array.from(map.values()).sort((a, b) => a.date.getTime() - b.date.getTime());
  }, [events]);

  const subtitle =
    phase === 'loading'
      ? t('calendar.syncing')
      : phase === 'disconnected'
        ? t('calendar.notConnected')
        : phase === 'error'
          ? t('calendar.error')
          : events.length + ' ' + t('calendar.count');

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title={t('calendar.title')} subtitle={subtitle}>
        <button
          type="button"
          className="btn"
          onClick={() => void fetchEvents(false)}
          disabled={busy || phase === 'loading'}
          title={t('calendar.sync')}
        >
          <Icon name="refresh" className={busy ? 'animate-spin' : ''} />
          {busy ? t('calendar.syncing') : t('calendar.sync')}
        </button>
      </PageHeader>

      <div className="min-h-0 flex-1 overflow-y-auto p-4 md:p-5">
        {phase === 'loading' ? (
          <div className="flex h-full items-center justify-center">
            <Spinner />
          </div>
        ) : phase === 'disconnected' ? (
          <div className="mx-auto max-w-xl rounded-xl border border-line bg-panel/40 p-6 text-center">
            <Icon name="calendar" size={30} className="mx-auto text-accent" />
            <h2 className="mt-3 text-base font-semibold">{t('calendar.notConnected')}</h2>
            <p className="mx-auto mt-1 max-w-md text-[12.5px] text-muted">
              {configMissing ? t('calendar.configMissing') : t('calendar.notConnectedHint')}
            </p>
            {configMissing ? (
              <p className="mono mx-auto mt-3 max-w-lg text-[11px] break-words text-muted/80">{message}</p>
            ) : (
              <button type="button" className="btn btn-primary mt-4" onClick={() => void connect()} disabled={opening}>
                <Icon name="external" />
                {opening ? t('calendar.connecting') : t('calendar.connect')}
              </button>
            )}
            {hint ? <p className="mt-3 text-[11.5px] text-muted">{t('calendar.hint')}</p> : null}
          </div>
        ) : phase === 'error' ? (
          <div className="mx-auto max-w-xl rounded-xl border border-bad/40 bg-bad/5 p-6 text-center">
            <Icon name="calendar" size={28} className="mx-auto text-bad" />
            <h2 className="mt-3 text-base font-semibold">{t('calendar.error')}</h2>
            <p className="mono mx-auto mt-2 max-w-lg text-[11.5px] break-words text-muted">{message}</p>
            <button type="button" className="btn mt-4" onClick={() => void fetchEvents(true)}>
              <Icon name="refresh" />
              {t('calendar.retry')}
            </button>
          </div>
        ) : events.length === 0 ? (
          <div className="mx-auto max-w-xl rounded-xl border border-dashed border-line p-8 text-center">
            <Icon name="calendar" size={28} className="mx-auto text-muted" />
            <h2 className="mt-3 text-base font-semibold">{t('calendar.empty')}</h2>
            <p className="mt-1 text-[12.5px] text-muted">{t('calendar.emptyHint')}</p>
          </div>
        ) : (
          <div className="mx-auto max-w-3xl space-y-6">
            {groups.map((group) => (
              <section key={dayKey(group.date)}>
                <div className="mb-2 flex items-center gap-2 text-[11px] font-medium tracking-wide text-muted uppercase">
                  <span>{dayLabel(group.date, locale, t('calendar.today'), t('calendar.tomorrow'))}</span>
                  <span className="h-px flex-1 bg-line/70" />
                  <span>
                    {group.items.length} {t('calendar.count')}
                  </span>
                </div>
                <div className="space-y-2">
                  {group.items.map(({ event, start }) => (
                    <article
                      key={event.id}
                      className="flex items-start gap-3 rounded-lg border border-line bg-panel/40 p-3 transition-colors hover:border-accent/40"
                    >
                      <div className="mono w-12 shrink-0 rounded-md border border-line/70 bg-panel2/40 py-1 text-center">
                        <div className="text-[15px] leading-tight font-semibold">{start.getDate()}</div>
                        <div className="text-[10px] tracking-wide text-muted uppercase">
                          {start.toLocaleDateString(locale, { month: 'short' })}
                        </div>
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start gap-2">
                          <h3 className="min-w-0 flex-1 text-[13px] leading-snug font-medium">{event.summary}</h3>
                          {event.htmlLink ? (
                            <a
                              className="btn btn-ghost shrink-0 px-1 py-0.5"
                              href={event.htmlLink}
                              target="_blank"
                              rel="noreferrer"
                              title={t('calendar.open')}
                              aria-label={t('calendar.open')}
                            >
                              <Icon name="external" size={12} />
                            </a>
                          ) : null}
                        </div>
                        <p className="mt-0.5 text-[11.5px] text-muted">
                          {timeRange(event, locale, t('calendar.allDay'))}
                        </p>
                        {event.location ? (
                          <p className="mt-0.5 truncate text-[11.5px] text-muted">{event.location}</p>
                        ) : null}
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
