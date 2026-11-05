export type Tone = 'ok' | 'error' | 'info';

let sink: ((message: string, tone?: Tone) => void) | null = null;

/** Hubungkan toast React ke modul non-React (mis. wrapper api). */
export function bindNotifier(fn: ((message: string, tone?: Tone) => void) | null) {
  sink = fn;
}

export function notify(message: string, tone: Tone = 'info') {
  sink?.(message, tone);
}
