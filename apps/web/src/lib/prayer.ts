export type PrayerKey = 'fajr' | 'dhuhr' | 'asr' | 'maghrib' | 'isha';

export type PrayerTime = { key: PrayerKey; at: Date };

export type PrayerSettings = {
  lat: number | null;
  lon: number | null;
  label: string;
  sound: boolean;
  popup: boolean;
};

export const PRAYER_KEYS: PrayerKey[] = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'];

export const PRAYER_LABEL_KEYS: Record<PrayerKey, string> = {
  fajr: 'prayer.subuh',
  dhuhr: 'prayer.dzuhur',
  asr: 'prayer.ashar',
  maghrib: 'prayer.maghrib',
  isha: 'prayer.isya',
};

const STORAGE_KEY = 'st:prayer';
const CHANGE_EVENT = 'st:prayer-changed';
const ALERT_LEAD_MS = 5 * 60_000;
const ALERT_GRACE_MS = 60_000;

export const DEFAULT_PRAYER_SETTINGS: PrayerSettings = {
  lat: null,
  lon: null,
  label: '',
  sound: true,
  popup: true,
};

/** Kota umum di Indonesia; koordinat pusat kota (cukup untuk jadwal sholat). */
export const PRAYER_CITIES: Array<{ name: string; lat: number; lon: number }> = [
  { name: 'Banda Aceh', lat: 5.5483, lon: 95.3238 },
  { name: 'Medan', lat: 3.5952, lon: 98.6722 },
  { name: 'Padang', lat: -0.9471, lon: 100.4172 },
  { name: 'Pekanbaru', lat: 0.5071, lon: 101.4478 },
  { name: 'Batam', lat: 1.0456, lon: 104.0305 },
  { name: 'Palembang', lat: -2.9761, lon: 104.7754 },
  { name: 'Bandar Lampung', lat: -5.3971, lon: 105.2668 },
  { name: 'Jakarta', lat: -6.2088, lon: 106.8456 },
  { name: 'Bogor', lat: -6.5971, lon: 106.806 },
  { name: 'Depok', lat: -6.4025, lon: 106.7942 },
  { name: 'Tangerang', lat: -6.1783, lon: 106.6319 },
  { name: 'Bekasi', lat: -6.2383, lon: 106.9756 },
  { name: 'Bandung', lat: -6.9175, lon: 107.6191 },
  { name: 'Semarang', lat: -6.9932, lon: 110.4203 },
  { name: 'Yogyakarta', lat: -7.7956, lon: 110.3695 },
  { name: 'Surakarta', lat: -7.5755, lon: 110.8243 },
  { name: 'Surabaya', lat: -7.2575, lon: 112.7521 },
  { name: 'Malang', lat: -7.9666, lon: 112.6326 },
  { name: 'Denpasar', lat: -8.6705, lon: 115.2126 },
  { name: 'Mataram', lat: -8.5833, lon: 116.1167 },
  { name: 'Pontianak', lat: -0.0263, lon: 109.3425 },
  { name: 'Banjarmasin', lat: -3.3186, lon: 114.5944 },
  { name: 'Balikpapan', lat: -1.2379, lon: 116.8529 },
  { name: 'Makassar', lat: -5.1477, lon: 119.4327 },
  { name: 'Manado', lat: 1.4748, lon: 124.8421 },
  { name: 'Ambon', lat: -3.6954, lon: 128.1814 },
  { name: 'Jayapura', lat: -2.5916, lon: 140.669 },
];

function validLat(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= -90 && value <= 90;
}

function validLon(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= -180 && value <= 180;
}

export function loadPrayerSettings(): PrayerSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_PRAYER_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<PrayerSettings>;
    return {
      lat: validLat(parsed.lat) ? parsed.lat : null,
      lon: validLon(parsed.lon) ? parsed.lon : null,
      label: typeof parsed.label === 'string' ? parsed.label : '',
      sound: typeof parsed.sound === 'boolean' ? parsed.sound : true,
      popup: typeof parsed.popup === 'boolean' ? parsed.popup : true,
    };
  } catch {
    return { ...DEFAULT_PRAYER_SETTINGS };
  }
}

export function savePrayerSettings(patch: Partial<PrayerSettings>): PrayerSettings {
  const next = { ...loadPrayerSettings(), ...patch };
  // Koordinat harus sepasang; kalau salah satu tidak valid, kosongkan keduanya.
  if (!validLat(next.lat) || !validLon(next.lon)) {
    next.lat = null;
    next.lon = null;
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  window.dispatchEvent(new Event(CHANGE_EVENT));
  return next;
}

export function subscribePrayerSettings(listener: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) listener();
  };
  window.addEventListener(CHANGE_EVENT, listener);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, listener);
    window.removeEventListener('storage', onStorage);
  };
}

let adhan: Promise<typeof import('adhan')> | null = null;

export async function computePrayerTimes(lat: number, lon: number, date: Date = new Date()): Promise<PrayerTime[]> {
  adhan ??= import('adhan');
  const { CalculationMethod, Coordinates, Madhab, PrayerTimes } = await adhan;
  // Metode Singapore (Fajr 20°, Isya 18°) paling umum dipakai untuk Indonesia.
  const params = CalculationMethod.Singapore();
  params.madhab = Madhab.Shafi;
  const times = new PrayerTimes(new Coordinates(lat, lon), date, params);
  return [
    { key: 'fajr', at: times.fajr },
    { key: 'dhuhr', at: times.dhuhr },
    { key: 'asr', at: times.asr },
    { key: 'maghrib', at: times.maghrib },
    { key: 'isha', at: times.isha },
  ];
}

/** Jam 24 jam dengan titik dua, tidak bergantung locale. */
export function formatClock(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return pad(date.getHours()) + ':' + pad(date.getMinutes());
}

/** Sholat yang masuk jendela pengingat: 5 menit sebelum sampai 1 menit sesudah. */
export function duePrayer(times: PrayerTime[], now = Date.now()): PrayerTime | null {
  return times.find((item) => now >= item.at.getTime() - ALERT_LEAD_MS && now < item.at.getTime() + ALERT_GRACE_MS) ?? null;
}

/** Jadwal berikutnya untuk penanda di daftar. */
export function nextPrayer(times: PrayerTime[], now = Date.now()): PrayerTime | null {
  return times.find((item) => item.at.getTime() > now) ?? null;
}

export { playChime } from './chime';