import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  Calendar as BigCalendar,
  dayjsLocalizer,
  type Components,
  type DateHeaderProps,
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
import { useConfirm } from '../components/confirm';
import { useToast } from '../components/toast';

type GoogleDate = { date?: string; dateTime?: string; timeZone?: string };
type CalendarEvent = {
  id: string;
  calendarId?: string;
  calendarName?: string;
  summary: string;
  description: string;
  location: string;
  start: GoogleDate | null;
  end: GoogleDate | null;
  htmlLink: string;
  status: string;
  allDay: boolean;
};
type CalendarResponse = { calendarId: string; account?: string; timeMin: string; writeScope?: boolean; events: CalendarEvent[] };
type Phase = 'loading' | 'disconnected' | 'ready' | 'error';
type RbcEvent = { id: string; title: string; start: Date; end: Date; allDay: boolean; isHoliday: boolean; resource: CalendarEvent };
type EventForm = { summary: string; start: string; end: string; location: string; description: string };

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
    isHoliday: isHolidayEvent(event),
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

function dayKey(date: Date): string {
  return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate());
}

function isHolidayEvent(event: CalendarEvent): boolean {
  return /hari libur|holiday/i.test(event.calendarName ?? '') || /#holiday@group/i.test(event.calendarId ?? '');
}

function localInput(date: Date): string {
  return (
    date.getFullYear() +
    '-' + pad(date.getMonth() + 1) +
    '-' + pad(date.getDate()) +
    'T' + pad(date.getHours()) +
    ':' + pad(date.getMinutes())
  );
}

function defaultEventForm(): EventForm {
  const start = new Date();
  start.setSeconds(0, 0);
  start.setMinutes(0);
  start.setHours(start.getHours() + 1);
  const end = new Date(start.getTime() + 60 * 60_000);
  return { summary: '', start: localInput(start), end: localInput(end), location: '', description: '' };
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
    <span className={event.isHoliday ? 'rbc-event-title rbc-event-holiday-title' : 'rbc-event-title'} title={event.title}>
      {event.title}
    </span>
  );
}

function CalendarDateHeader({ label, drilldownView, onDrillDown, isOffRange, holiday }: DateHeaderProps & { holiday: boolean }) {
  const className = 'rbc-date-number' + (holiday ? ' rbc-holiday-date' : '') + (isOffRange ? ' rbc-off-range-date' : '');
  if (!drilldownView) return <span className={className}>{label}</span>;
  return (
    <button type="button" className={'rbc-button-link ' + className} onClick={onDrillDown}>
      {label}
    </button>
  );
}

export default function CalendarTool() {
  const { t, lang } = useI18n();
  const toast = useToast();
  const confirm = useConfirm();
  const [phase, setPhase] = useState<Phase>('loading');
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [account, setAccount] = useState('');
  const [writeScope, setWriteScope] = useState(true);
  const [message, setMessage] = useState('');
  const [configMissing, setConfigMissing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [opening, setOpening] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [hint, setHint] = useState(false);
  const [selected, setSelected] = useState<RbcEvent | null>(null);
  const [composer, setComposer] = useState(false);
  const [form, setForm] = useState<EventForm>(() => defaultEventForm());
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const booted = useRef(false);
  const fetching = useRef(false);
  const locale = lang === 'id' ? 'id-ID' : 'en-US';

  const errorText = (message: string): string => {
    if (lang === 'id' || !message) return message || t('calendar.error');
    if (/Judul event wajib/i.test(message)) return t('calendar.titleRequired');
    if (/Waktu event tidak valid|Waktu mulai/i.test(message)) return t('calendar.invalidTime');
    if (/Waktu selesai/i.test(message)) return t('calendar.endBeforeStart');
    if (/baca-saja|read-only|insufficient.*scope|scope/i.test(message)) return t('calendar.writeScopeError');
    if (/belum terhubung/i.test(message)) return t('calendar.notConnectedHint');
    if (/dikonfigurasi/i.test(message)) return t('calendar.configMissingHint');
    if (/kedaluwarsa|ditolak|invalid_grant|reconnect/i.test(message)) return t('calendar.reconnectHint');
    if (/Gagal menyimpan event/i.test(message)) return t('calendar.createFailed');
    if (/Gagal mengambil event/i.test(message)) return t('calendar.error');
    return message;
  };

  const fetchEvents = useCallback(
    async (initial: boolean) => {
      if (fetching.current) return;
      fetching.current = true;
      if (initial) setPhase('loading');
      setBusy(true);
      try {
        const now = new Date();
        const from = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString();
        const to = new Date(now.getFullYear(), now.getMonth() + 3, 1).toISOString();
        const query = new URLSearchParams({ timeMin: from, timeMax: to }).toString();
        const data = await api.get<CalendarResponse>('/calendar/events?' + query);
        setEvents(data.events ?? []);
        setAccount(data.account ?? '');
        setWriteScope(data.writeScope !== false);
        setMessage('');
        setConfigMissing(false);
        setPhase('ready');
      } catch (err) {
        const raw = err instanceof ApiError ? err.message : '';
        setMessage(errorText(raw));
        const disconnected =
          err instanceof ApiError && err.status === 400 && /belum terhubung|belum dikonfigurasi/i.test(raw);
        if (disconnected) {
          setPhase('disconnected');
          setConfigMissing(/dikonfigurasi/i.test(raw));
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

  useEffect(() => {
    if (!composer) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !saving) setComposer(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [composer, saving]);

  const openComposer = () => {
    setForm(defaultEventForm());
    setFormError('');
    setComposer(true);
  };

  const setField = (key: keyof EventForm, value: string) => setForm((current) => ({ ...current, [key]: value }));

  const createEvent = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving) return;
    const summary = form.summary.trim();
    if (!summary) {
      setFormError(t('calendar.titleRequired'));
      return;
    }
    const start = new Date(form.start);
    const end = new Date(form.end);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      setFormError(t('calendar.invalidTime'));
      return;
    }
    if (end.getTime() <= start.getTime()) {
      setFormError(t('calendar.endBeforeStart'));
      return;
    }

    setSaving(true);
    setFormError('');
    try {
      await api.postSilent<CalendarEvent>('/calendar/events', {
        summary,
        start: start.toISOString(),
        end: end.toISOString(),
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        location: form.location.trim(),
        description: form.description.trim(),
      });
      setComposer(false);
      toast(t('calendar.created'), 'ok');
      await fetchEvents(false);
    } catch (err) {
      setFormError(errorText(err instanceof ApiError ? err.message : t('calendar.createFailed')));
    } finally {
      setSaving(false);
    }
  };

  const connect = async (switchAccount = false) => {
    setOpening(true);
    try {
      const data = await api.get<{ url: string }>('/calendar/auth' + (switchAccount ? '?switch=1' : ''));
      const popup = window.open(data.url, '_blank');
      if (!popup) {
        window.location.href = data.url;
        return;
      }
      setHint(true);
      if (phase === 'ready') toast(t('calendar.hint'), 'ok');
    } catch (err) {
      const text = errorText(err instanceof ApiError ? err.message : t('calendar.failed'));
      setMessage(text);
      toast(text, 'error');
    } finally {
      setOpening(false);
    }
  };

  const signOut = async () => {
    const ok = await confirm({
      title: t('calendar.signOutTitle'),
      message: t('calendar.signOutBody'),
      confirmLabel: t('calendar.signOut'),
      danger: true,
    });
    if (!ok) return;
    setDisconnecting(true);
    try {
      await api.postSilent<{ ok: boolean }>('/calendar/disconnect');
      setEvents([]);
      setAccount('');
      setWriteScope(true);
      setMessage('');
      setConfigMissing(false);
      setHint(false);
      setSelected(null);
      setComposer(false);
      setPhase('disconnected');
      toast(t('calendar.signedOut'), 'ok');
    } catch (err) {
      toast(errorText(err instanceof ApiError ? err.message : t('calendar.signOutFailed')), 'error');
    } finally {
      setDisconnecting(false);
    }
  };

  const rbcEvents = useMemo(
    () => events.map((event) => toRbcEvent(event, t('calendar.noTitle'))).filter((event): event is RbcEvent => event !== null),
    [events, t],
  );

  const holidayDates = useMemo(() => {
    const dates = new Set<string>();
    for (const event of events) {
      if (!isHolidayEvent(event)) continue;
      const start = parseDate(event.start);
      if (!start) continue;
      const end = parseDate(event.end) ?? new Date(start.getTime() + 86_400_000);
      const cursor = new Date(start.getFullYear(), start.getMonth(), start.getDate());
      const stop = Boolean(event.start?.date) || event.allDay ? end : new Date(start.getTime() + 86_400_000);
      let guard = 0;
      while (cursor < stop && guard++ < 40) {
        dates.add(dayKey(cursor));
        cursor.setDate(cursor.getDate() + 1);
      }
    }
    return dates;
  }, [events]);

  const calendarComponents = useMemo<Components<RbcEvent>>(
    () => ({
      event: EventBlock,
      dateHeader: (props: DateHeaderProps) => (
        <CalendarDateHeader {...props} holiday={holidayDates.has(dayKey(props.date))} />
      ),
    }),
    [holidayDates],
  );

  const dayPropGetter = useCallback(
    (date: Date) => (holidayDates.has(dayKey(date)) ? { className: 'rbc-holiday-day' } : {}),
    [holidayDates],
  );

  const eventPropGetter = useCallback(
    (event: RbcEvent) => (event.isHoliday ? { className: 'rbc-holiday-event' } : {}),
    [],
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
          : events.length + ' ' + t('calendar.count') + (account ? ' · ' + account : '');

  const whenText = selected ? eventWhen(selected, locale, t('calendar.allDay')) : '';

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title={t('calendar.title')} subtitle={subtitle} icon="calendar">
        <button type="button" className="btn btn-primary" onClick={openComposer} disabled={phase !== 'ready' || busy || !writeScope}>
          <Icon name="plus" />
          {t('calendar.addEvent')}
        </button>
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
        {phase === 'ready' || phase === 'error' ? (
          <>
            <button
              type="button"
              className="btn"
              onClick={() => void connect(true)}
              disabled={opening || disconnecting}
              title={t('calendar.switchHint')}
            >
              {opening ? <Spinner /> : <Icon name="refresh" />}
              {opening ? t('calendar.connecting') : t('calendar.changeAccount')}
            </button>
            <button
              type="button"
              className="btn btn-danger"
              onClick={() => void signOut()}
              disabled={opening || disconnecting}
              title={t('calendar.signOut')}
            >
              {disconnecting ? <Spinner /> : <Icon name="logout" />}
              {disconnecting ? t('calendar.signingOut') : t('calendar.signOut')}
            </button>
          </>
        ) : null}
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
              <p className="mx-auto mt-3 max-w-md text-[11.5px] text-muted">{t('calendar.configMissingHint')}</p>
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
          <div className="flex h-full min-h-[520px] flex-col gap-2">
            {!writeScope ? (
              <div className="flex flex-wrap items-center gap-2 rounded-lg border border-warn/40 bg-warn/5 px-3 py-2 text-[11.5px] text-warn">
                <Icon name="bell" size={13} className="shrink-0" />
                <span className="min-w-0 flex-1">{t('calendar.writeScopeHint')}</span>
                <button type="button" className="btn px-2 py-1 text-[11px]" onClick={() => void connect()} disabled={opening}>
                  {opening ? t('calendar.connecting') : t('calendar.reconnect')}
                </button>
              </div>
            ) : null}
            <div className="calendar-shell flex min-h-0 flex-1 flex-col rounded-xl border border-line bg-panel/40 p-2">
              <BigCalendar<RbcEvent>
              localizer={localizer}
              culture={lang}
              events={rbcEvents}
              views={VIEWS}
              defaultView="month"
              popup
              selectable={false}
              messages={messages}
              components={calendarComponents}
              dayPropGetter={dayPropGetter}
              eventPropGetter={eventPropGetter}
              startAccessor="start"
              endAccessor="end"
              titleAccessor="title"
              allDayAccessor="allDay"
              onSelectEvent={(event) => setSelected(event)}
              tooltipAccessor={(event) => event.resource.location || event.title}
                style={{ height: '100%' }}
              />
            </div>
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

      {composer ? (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !saving) setComposer(false);
          }}
        >
          <form
            role="dialog"
            aria-modal="true"
            aria-labelledby="calendar-create-title"
            className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-xl border border-line bg-panel shadow-2xl"
            onSubmit={createEvent}
          >
            <div className="sticky top-0 flex items-center gap-2.5 border-b border-line bg-panel p-4">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-accent">
                <Icon name="plus" size={15} />
              </span>
              <h2 id="calendar-create-title" className="min-w-0 flex-1 text-[15px] font-semibold">
                {t('calendar.addEvent')}
              </h2>
              <button
                type="button"
                className="btn btn-ghost shrink-0 cursor-pointer px-1.5 py-0.5"
                onClick={() => setComposer(false)}
                disabled={saving}
                title={t('common.close')}
                aria-label={t('common.close')}
              >
                <Icon name="x" size={14} />
              </button>
            </div>

            <div className="flex flex-col gap-3 p-4">
              <label className="flex flex-col">
                <span className="label">{t('calendar.eventTitle')}</span>
                <input
                  className="input mt-1"
                  value={form.summary}
                  onChange={(event) => setField('summary', event.target.value)}
                  autoFocus
                  required
                  maxLength={1024}
                  placeholder={t('calendar.eventTitlePlaceholder')}
                  disabled={saving}
                />
              </label>

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="flex flex-col">
                  <span className="label">{t('calendar.start')}</span>
                  <input
                    type="datetime-local"
                    className="input mt-1"
                    value={form.start}
                    onChange={(event) => setField('start', event.target.value)}
                    required
                    disabled={saving}
                  />
                </label>
                <label className="flex flex-col">
                  <span className="label">{t('calendar.end')}</span>
                  <input
                    type="datetime-local"
                    className="input mt-1"
                    value={form.end}
                    onChange={(event) => setField('end', event.target.value)}
                    required
                    disabled={saving}
                  />
                </label>
              </div>

              <label className="flex flex-col">
                <span className="label">{t('calendar.location')}</span>
                <input
                  className="input mt-1"
                  value={form.location}
                  onChange={(event) => setField('location', event.target.value)}
                  maxLength={1024}
                  disabled={saving}
                />
              </label>

              <label className="flex flex-col">
                <span className="label">{t('calendar.description')}</span>
                <textarea
                  className="input mt-1 min-h-24 resize-y"
                  value={form.description}
                  onChange={(event) => setField('description', event.target.value)}
                  maxLength={8192}
                  disabled={saving}
                />
              </label>

              {formError ? (
                <div role="alert" className="rounded-lg border border-bad/40 bg-bad/5 px-3 py-2 text-[12px] break-words text-bad">
                  {formError}
                  {/izin|hubungkan ulang|scope|reconnect/i.test(formError) ? (
                    <button
                      type="button"
                      className="btn mt-2 w-full justify-center"
                      onClick={() => {
                        setComposer(false);
                        void connect();
                      }}
                    >
                      <Icon name="external" size={13} /> {t('calendar.reconnect')}
                    </button>
                  ) : null}
                </div>
              ) : null}

              <div className="mt-1 flex flex-wrap justify-end gap-2 border-t border-line pt-3">
                <button type="button" className="btn" onClick={() => setComposer(false)} disabled={saving}>
                  {t('common.cancel')}
                </button>
                <button type="submit" className="btn btn-primary" disabled={saving}>
                  {saving ? <Spinner /> : <Icon name="check" size={14} />}
                  {saving ? t('calendar.saving') : t('calendar.save')}
                </button>
              </div>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}
