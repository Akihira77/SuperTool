import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Calendar as BigCalendar, dayjsLocalizer, type Messages, type View } from 'react-big-calendar';
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
  const allDay = event.allDay || !event.start?.dateTime;
  let end = parseDate(event.end);
  if (!end || end.getTime() <= start.getTime()) {
    end = new Date(start.getTime() + (allDay ? 86_400_000 : 3_600_000));
  }
  return {
    id: event.id,
    title: event.summary || noTitle,
    start,
    end,
    allDay,
    resource: event,
  };
}

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

  useEffect(() => {
    dayjs.locale(lang);
  }, [lang]);

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
              startAccessor="start"
              endAccessor="end"
              titleAccessor="title"
              allDayAccessor="allDay"
              tooltipAccessor={(event) => event.resource.location || event.title}
              style={{ height: '100%' }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
