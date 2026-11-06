export const REMIND_KEY = 'st:calendar:remind';
export const NOTIFIED_KEY = 'st:calendar:notified';
export const REMIND_CHOICES: number[] = [60, 30, 15];

export type ReminderEvent = {
  id: string;
  calendarId?: string;
  start: { date?: string; dateTime?: string } | null;
  allDay?: boolean;
  status?: string;
};

export function readRemindBefore(): number {
  try {
    const value = Number(localStorage.getItem(REMIND_KEY));
    if (value === 0 || REMIND_CHOICES.includes(value)) return value;
  } catch {
    // localStorage bisa diblokir; pakai default.
  }
  return 30;
}

export function parseReminderDate(value: ReminderEvent['start']): Date | null {
  if (!value) return null;
  if (value.dateTime) {
    const date = new Date(value.dateTime);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (value.date) {
    const date = new Date(value.date + 'T00:00:00');
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}

export function notifyKey(event: ReminderEvent, start: Date): string {
  return (event.calendarId ?? '') + '|' + event.id + '|' + start.toISOString();
}

export function eventIdentity(event: ReminderEvent): string {
  return (event.calendarId ?? '') + '|' + event.id + '|' + (event.start?.dateTime ?? event.start?.date ?? '');
}

/**
 * Event yang masuk jendela pengingat: mulai sekarang sampai `leadMs`.
 * All-day dan event batal sengaja dilewati karena tidak punya jam mulai.
 */
export function dueReminders<T extends ReminderEvent>(
  events: T[],
  leadMs: number,
  now: number,
): Array<{ event: T; start: Date }> {
  if (leadMs <= 0) return [];
  return events
    .map((event) => ({ event, start: parseReminderDate(event.start) }))
    .filter((item): item is { event: T; start: Date } => {
      if (!item.start || item.event.allDay || item.event.start?.date || item.event.status === 'cancelled') return false;
      const start = item.start.getTime();
      return start >= now && start - now <= leadMs;
    })
    .sort((a, b) => a.start.getTime() - b.start.getTime());
}
