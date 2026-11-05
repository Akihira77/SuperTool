import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Calendar as BigCalendar,
  dayjsLocalizer,
  type Components,
  type EventProps,
  type Messages,
  type View,
} from 'react-big-calendar';
import dayjs from 'dayjs';
import 'dayjs/locale/id';
import 'react-big-calendar/lib/css/react-big-calendar.css';
import './calendar.css';
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
type RbcEvent = { id: string; title: string; start: Date; end: Date; allDay: boolean; resource: CalendarEvent };

const localizer = dayjsLocalizer(dayjs);
const VIEWS: View[] = ['month', 'week', 'agenda'];
const AUTO_REFRESH_MS = 5 * 60_000;
const DATE_FORMAT: Intl.DateTimeFormatOptions = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' };

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

/** Google end.date eksklusif, sama seperti react-big-calendar untuk all-day. */
function toRbcEvent(event: CalendarEvent, noTitle: string): RbcEvent | null {
  const start = parseDate(event.start);
  if (!start) return null;
  const allDay = Boolean(event.start?.date) || event.allDay;
  let end = parseDate(event.end);
  if (!end || end.getTime() <= start.getTime()) {
    end = new Date(start.getTime() + (allDay ? 86_400_000 : 3_600_000));
  }
  return {
    id: event.id,
    title: (typeof event.summary === 'string' ? event.summary.trim() : '') || noTitle,
    start,
    end,
    allDay,
    resource: event,
  };
}

const pad = (value: number) => String(value).padStart(2, '0');

function clock(date: Date): string {
  return pad(date.getHours()) + ':' + pad(date.getMinutes());
}

/** Zona waktu Indonesia mengikuti offset waktu lokal (sama dengan jam header). */
function zoneLabel(date: Date): string {
  const offset = -date.getTimezoneOffset() / 60;
  if (offset === 7) return 'WIB';
  if (offset === 8) return 'WITA';
  if (offset === 9) return 'WIT';
  const sign = offset >= 0 ? '+' : '-';
  const absolute = Math.abs(offset);
  const hours = Math.floor(absolute);
  const minutes = Math.round((absolute - hours) * 60);
  return 'UTC' + sign + hours + (minutes ? ':' + pad(minutes) : '');
}

function dateLabel(date: Date, locale: string): string {
  return new Intl.DateTimeFormat(locale, DATE_FORMAT).format(date);
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function eventWhen(event: RbcEvent, locale: string, allDayLabel: string): string {
  if (event.allDay) {
    const last = new Date(event.end.getTime() - 86_400_000);
    const start = dateLabel(event.start, locale);
    return sameDay(event.start, last)
      ? start + ' · ' + allDayLabel
      : start + ' – ' + dateLabel(last, locale) + ' · ' + allDayLabel;
  }
  const zone = zoneLabel(event.start);
  if (sameDay(event.start, event.end)) {
    return dateLabel(event.start, locale) + ' · ' + clock(event.start) + '–' + clock(event.end) + ' ' + zone;
  }
  return (
    dateLabel(event.start, locale) + ' ' + clock(event.start) +
    ' – ' + dateLabel(event.end, locale) + ' ' + clock(event.end) + ' ' + zone
  );
}

/** Isi kotak event di grid: judul harus selalu terlihat, bukan cuma blok warna. */
function EventBlock({ event }: EventProps<RbcEvent>) {
  return (
    <span className="rbc-event-title" title={event.title}>
      {event.title}
    </span>
  );
}

const CALENDAR_COMPONENTS: Components<RbcEvent> = { event: EventBlock };

export default function CalendarTool() {
  const { t, lang } = useI18n();
  const toast = useToast();
  const [phase, setPhase] = useState<Phase>('loading');
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [message, setMessage] = useState('');
  const [configMissing, setConfigMissing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [opening, setOpening] = useState(false);
  const [hint, setHint] = useState(false);
  const [selected, setSelected] = useState<RbcEvent | null>(null);
  const booted = useRef(false);
  const fetching = useRef(false);
  const locale = lang === 'id' ? 'id-ID' : 'en-US';

  const fetchEvents = useCallback(
    async (initial: boolean) => {
      if (fetching.current) return;
      fetching.current = true;
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
        fetching.current = false;
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

  // Sinkron otomatis tiap 5 menit; fetchEvents punya guard agar request
  // manual dan otomatis tidak tumpang tindih.
  useEffect(() => {
    const id = window.setInterval(() => void fetchEvents(false), AUTO_REFRESH_MS);
    return () => window.clearInterval(id);
  }, [fetchEvents]);

  useEffect(() => {
    dayjs.locale(lang);
  }, [lang]);

  useEffect(() => {
    if (!selected) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSelected(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected]);

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

  const rbcEvents = useMemo(
    () => events.map((event) => toRbcEvent(event, t('calendar.noTitle'))).filter((event): event is RbcEvent => event !== null),
    [events, t],
  );

  const messages = useMemo<Messages<RbcEvent>>(
    () => ({
      today: t('calendar.today'),
      previous: t('calendar.previous'),
      next: t('calendar.next'),
      month: t('calendar.month'),
      week: t('calendar.week'),
      day: t('calendar.day'),
      agenda: t('calendar.agenda'),
      date: t('calendar.date'),
      time: t('calendar.time'),
      event: t('calendar.event'),
      noEventsInRange: t('calendar.emptyHint'),
      showMore: (count) => t('calendar.showMore').replace('{n}', String(count)),
    }),
    [t],
  );

  const subtitle =
    phase === 'loading'
      ? t('calendar.syncing')
      : phase === 'disconnected'
        ? t('calendar.notConnected')
        : phase === 'error'
          ? t('calendar.error')
          : events.length + ' ' + t('calendar.count');

  const whenText = selected ? eventWhen(selected, locale, t('calendar.allDay')) : '';

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
        ) : (
          <div className="calendar-shell flex h-full min-h-[520px] flex-col rounded-xl border border-line bg-panel/40 p-2">
            <BigCalendar<RbcEvent>
              localizer={localizer}
              culture={lang}
              events={rbcEvents}
              views={VIEWS}
              defaultView="month"
              popup
              selectable={false}
              messages={messages}
              components={CALENDAR_COMPONENTS}
              startAccessor="start"
              endAccessor="end"
              titleAccessor="title"
              allDayAccessor="allDay"
              onSelectEvent={(event) => setSelected(event)}
              tooltipAccessor={(event) => event.resource.location || event.title}
              style={{ height: '100%' }}
            />
          </div>
        )}
      </div>

      {selected ? (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setSelected(null);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="calendar-detail-title"
            className="max-h-[85vh] w-full max-w-xl overflow-y-auto rounded-xl border border-line bg-panel shadow-2xl"
          >
            <div className="sticky top-0 flex items-start gap-2.5 border-b border-line bg-panel p-4">
              <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-accent">
                <Icon name="calendar" size={15} />
              </span>
              <div className="min-w-0 flex-1">
                <h2 id="calendar-detail-title" className="text-[15px] leading-snug font-semibold break-words">
                  {selected.title}
                </h2>
                <div className="mt-0.5 text-[11px] text-muted">
                  {selected.allDay ? t('calendar.allDay') : zoneLabel(selected.start)}
                </div>
              </div>
              <button
                type="button"
                className="btn btn-ghost shrink-0 cursor-pointer px-1.5 py-0.5"
                onClick={() => setSelected(null)}
                title={t('common.close')}
                aria-label={t('common.close')}
                autoFocus
              >
                <Icon name="x" size={14} />
              </button>
            </div>

            <div className="flex flex-col gap-3 p-4 text-[12.5px]">
              <div className="flex items-start gap-2.5">
                <Icon name="clock" size={14} className="mt-0.5 shrink-0 text-accent/80" />
                <div className="min-w-0">
                  <div className="label">{t('calendar.time')}</div>
                  <div className="text-ink/90">{whenText}</div>
                </div>
              </div>

              {selected.resource.location ? (
                <div className="flex items-start gap-2.5">
                  <Icon name="pin" size={14} className="mt-0.5 shrink-0 text-accent/80" />
                  <div className="min-w-0">
                    <div className="label">{t('calendar.location')}</div>
                    <div className="break-words text-ink/90">{selected.resource.location}</div>
                  </div>
                </div>
              ) : null}

              {selected.resource.description ? (
                <div>
                  <div className="label">{t('calendar.description')}</div>
                  <div className="mt-1 whitespace-pre-wrap break-words text-ink/85">{selected.resource.description}</div>
                </div>
              ) : null}
            </div>

            {selected.resource.htmlLink ? (
              <div className="border-t border-line p-3">
                <a
                  className="btn w-full justify-center"
                  href={selected.resource.htmlLink}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  <Icon name="external" size={13} /> {t('calendar.open')}
                </a>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
