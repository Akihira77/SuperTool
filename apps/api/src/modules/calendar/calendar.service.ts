import { BadRequestException, Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { google, type calendar_v3 } from 'googleapis';
import { cfg } from '../../config';
import { one, run } from '../../common/db';
import { authPrompt, type OAuthMode } from './oauth';

const SCOPE = 'https://www.googleapis.com/auth/calendar';
const STATE_TTL_MS = 10 * 60 * 1000;
type OAuthState = { expiresAt: number; mode: OAuthMode };

export type CreateCalendarEventInput = {
  summary?: unknown;
  description?: unknown;
  location?: unknown;
  start?: unknown;
  end?: unknown;
  timeZone?: unknown;
  allDay?: unknown;
};

type GoogleTokens = {
  access_token?: string | null;
  refresh_token?: string | null;
  expiry_date?: number | null;
  scope?: string | null;
  token_type?: string | null;
};

type TokenRow = {
  accessToken: string;
  refreshToken: string | null;
  expiry: number | null;
  scope: string | null;
};

/**
 * State OAuth disimpan di memori: cukup untuk satu user, kedaluwarsa 10 menit,
 * dan sekali pakai. Tidak perlu tabel tambahan.
 */
const states = new Map<string, OAuthState>();

function isoTime(value: string | undefined, fallback: string, label: string): string {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new BadRequestException(label + ' tidak valid.');
  return date.toISOString();
}

function hasWriteScope(scope: string | null | undefined): boolean {
  return Boolean(scope?.split(/\s+/).includes('https://www.googleapis.com/auth/calendar'));
}

function eventStart(item: calendar_v3.Schema$Event): number {
  const value = item.start?.dateTime ?? item.start?.date;
  if (!value) return 0;
  const date = new Date(item.start?.date ? value + 'T00:00:00' : value);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

function mapEvent(item: calendar_v3.Schema$Event, calendarId = 'primary', calendarName = '') {
  const videoEntry = item.conferenceData?.entryPoints?.find(
    (entry) => entry.entryPointType === 'video' && entry.uri,
  );
  const conferenceUrl = videoEntry?.uri ?? item.hangoutLink ?? '';
  const attendees = (item.attendees ?? [])
    .filter((person) => person.email)
    .slice(0, 50)
    .map((person) => ({
      email: person.email ?? '',
      displayName: person.displayName ?? '',
      responseStatus: person.responseStatus ?? '',
      organizer: person.organizer === true,
      self: person.self === true,
    }));
  const attachments = (item.attachments ?? [])
    .filter((attachment) => attachment.fileUrl)
    .slice(0, 10)
    .map((attachment) => ({
      fileUrl: attachment.fileUrl ?? '',
      title: attachment.title ?? '',
      mimeType: attachment.mimeType ?? '',
    }));

  return {
    id: item.id ?? '',
    calendarId,
    calendarName,
    summary: item.summary ?? '',
    description: item.description ?? '',
    location: item.location ?? '',
    start: item.start ?? null,
    end: item.end ?? null,
    htmlLink: item.htmlLink ?? '',
    status: item.status ?? '',
    allDay: Boolean(item.start?.date),
    organizer: item.organizer?.email
      ? {
          email: item.organizer.email,
          displayName: item.organizer.displayName ?? '',
          self: item.organizer.self === true,
        }
      : null,
    attendees,
    conference: conferenceUrl
      ? {
          url: conferenceUrl,
          label: videoEntry?.label ?? item.conferenceData?.conferenceSolution?.name ?? '',
        }
      : null,
    attachments,
  };
}

@Injectable()
export class CalendarService {
  private configured(): boolean {
    return Boolean(cfg.calendar.clientId && cfg.calendar.clientSecret && cfg.calendar.redirectUri);
  }

  private client() {
    if (!this.configured()) {
      throw new BadRequestException(
        'Google Calendar belum dikonfigurasi. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, dan GOOGLE_REDIRECT_URI di apps/api/.env',
      );
    }
    return new google.auth.OAuth2(cfg.calendar.clientId, cfg.calendar.clientSecret, cfg.calendar.redirectUri);
  }

  /**
   * URL otorisasi Google, sekali pakai lewat parameter state. Mode switch
   * memaksa pemilih akun dan tidak memakai refresh token akun lama.
   */
  authUrl(mode: OAuthMode = 'connect') {
    const client = this.client();
    const now = Date.now();
    for (const [key, entry] of states) {
      if (entry.expiresAt <= now) states.delete(key);
    }
    const state = randomBytes(16).toString('hex');
    states.set(state, { expiresAt: now + STATE_TTL_MS, mode });
    const url = client.generateAuthUrl({
      access_type: 'offline',
      prompt: authPrompt(mode),
      include_granted_scopes: true,
      scope: [SCOPE],
      state,
    });
    return { url };
  }

  /** Tujuan redirect setelah callback Google (halaman Calendar di frontend). */
  redirectUrl(status: string): string {
    let origin = 'http://127.0.0.1:' + cfg.port;
    try {
      origin = new URL(cfg.calendar.redirectUri).origin;
    } catch {
      // redirect URI tidak valid/kosong: tetap arahkan ke aplikasi lokal
    }
    return origin + '/#/calendar?google=' + encodeURIComponent(status);
  }

  private takeState(state: string | undefined): OAuthMode | null {
    if (!state) return null;
    const entry = states.get(state);
    states.delete(state);
    return entry && entry.expiresAt > Date.now() ? entry.mode : null;
  }

  private tokenRow(): TokenRow | null {
    return (
      one<TokenRow>(
        'SELECT access_token AS accessToken, refresh_token AS refreshToken, expiry, scope FROM google_tokens WHERE id = 1',
      ) ?? null
    );
  }

  private saveTokens(tokens: GoogleTokens, fallbackRefresh: string | null): void {
    run(
      'INSERT INTO google_tokens (id, access_token, refresh_token, expiry, scope, token_type, updated_at) ' +
        'VALUES (1, ?, ?, ?, ?, ?, ?) ' +
        'ON CONFLICT(id) DO UPDATE SET access_token = excluded.access_token, ' +
        'refresh_token = COALESCE(excluded.refresh_token, google_tokens.refresh_token), ' +
        'expiry = excluded.expiry, scope = COALESCE(excluded.scope, google_tokens.scope), token_type = excluded.token_type, ' +
        'updated_at = excluded.updated_at',
      tokens.access_token ?? '',
      tokens.refresh_token ?? fallbackRefresh,
      tokens.expiry_date ?? null,
      tokens.scope ?? null,
      tokens.token_type ?? null,
      Date.now(),
    );
  }

  /** Tukar code OAuth dengan token, lalu simpan ke SQLite. */
  async connect(code: string, state: string | undefined): Promise<void> {
    const mode = this.takeState(state);
    if (!mode) {
      throw new BadRequestException('State OAuth tidak valid atau sudah kedaluwarsa');
    }
    const client = this.client();
    let tokens: GoogleTokens;
    try {
      tokens = (await client.getToken(code)).tokens as GoogleTokens;
    } catch (err) {
      const message = (err as Error).message ?? '';
      throw new BadRequestException('Gagal menukar code ke token Google: ' + message.slice(0, 160));
    }
    if (!tokens.access_token) {
      throw new BadRequestException('Google tidak mengembalikan access token');
    }
    const existing = this.tokenRow();
    if (mode === 'switch') {
      // Jangan pernah memakai refresh token akun lama untuk akun baru.
      run('DELETE FROM google_tokens WHERE id = 1');
      this.saveTokens({ ...tokens, scope: tokens.scope ?? SCOPE }, null);
      await this.revoke(existing);
      return;
    }
    // Google biasanya mengembalikan scope; kalau tidak, simpan scope yang diminta
    // supaya UI tidak salah mengira token masih baca-saja.
    this.saveTokens({ ...tokens, scope: tokens.scope ?? SCOPE }, existing?.refreshToken ?? null);
  }

  /** Cabut grant Google bila memungkinkan; kegagalan jaringan tidak menghalangi logout lokal. */
  private async revoke(stored: TokenRow | null): Promise<void> {
    if (!stored || !this.configured()) return;
    const token = stored.refreshToken || stored.accessToken;
    if (!token) return;
    try {
      await this.client().revokeToken(token);
    } catch {
      // Token mungkin sudah dicabut/kedaluwarsa; yang penting baris lokal dihapus.
    }
  }

  /** Sign out: hapus koneksi lokal dulu, lalu cabut grant Google best-effort. */
  async disconnect(): Promise<{ ok: true }> {
    const existing = this.tokenRow();
    run('DELETE FROM google_tokens WHERE id = 1');
    states.clear();
    await this.revoke(existing);
    return { ok: true };
  }

  /** Hasil callback untuk redirect frontend: connected | denied | error. */
  async callbackStatus(code: string | undefined, state: string | undefined, error: string | undefined): Promise<string> {
    if (error || !code) {
      // State tetap sekali pakai walau user menolak consent.
      this.takeState(state);
      return error === 'access_denied' ? 'denied' : 'error';
    }
    try {
      await this.connect(code, state);
      return 'connected';
    } catch {
      return 'error';
    }
  }

  /** Client dengan token tersimpan; refresh otomatis bila hampir kedaluwarsa. */
  private async authorizedClient() {
    const stored = this.tokenRow();
    if (!stored?.accessToken) {
      throw new BadRequestException('Google Calendar belum terhubung. Buka /api/calendar/auth dulu.');
    }

    const client = this.client();
    client.setCredentials({
      access_token: stored.accessToken,
      refresh_token: stored.refreshToken ?? undefined,
      expiry_date: stored.expiry ?? undefined,
    });

    if (!stored.expiry || stored.expiry < Date.now() + 60_000) {
      if (!stored.refreshToken) {
        throw new BadRequestException('Token Google kedaluwarsa dan tidak ada refresh token. Hubungkan ulang kalender.');
      }
      try {
        const { credentials } = await client.refreshAccessToken();
        if (!credentials.access_token) throw new Error('access token kosong');
        this.saveTokens(credentials as GoogleTokens, stored.refreshToken);
        client.setCredentials(credentials);
      } catch {
        throw new BadRequestException('Gagal memperbarui token Google. Hubungkan ulang kalender.');
      }
    }
    return client;
  }

  private calendarError(error: unknown, action: string): never {
    const message = (error as Error).message ?? '';
    if (/insufficient|forbidden|scope|403/i.test(message)) {
      throw new BadRequestException(
        'Izin Google Calendar masih baca-saja. Hubungkan ulang kalender untuk memberi izin tambah event.',
      );
    }
    if (/invalid_grant|unauthorized|401/i.test(message)) {
      throw new BadRequestException('Akses Google Calendar ditolak. Hubungkan ulang kalender.');
    }
    throw new BadRequestException('Gagal ' + action + ' Google Calendar: ' + message.slice(0, 160));
  }

  /** Event pada rentang bulan berjalan (bisa dioverride timeMin/timeMax). */
  async events(timeMin?: string, timeMax?: string) {
    const client = await this.authorizedClient();
    const now = new Date();
    const defaultMin = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const min = isoTime(timeMin, defaultMin, 'timeMin');
    const max = timeMax ? isoTime(timeMax, defaultMin, 'timeMax') : undefined;
    if (max && new Date(max).getTime() <= new Date(min).getTime()) {
      throw new BadRequestException('timeMax harus setelah timeMin.');
    }

    const calendar = google.calendar({ version: 'v3', auth: client });
    let items: Array<{ event: calendar_v3.Schema$Event; calendarId: string; calendarName: string }>;
    let account = '';
    try {
      // showHidden: kalender yang disembunyikan di UI tetap bisa berisi event
      // yang ingin dilihat; jangan diam-diam membuang event pengguna.
      const list = await calendar.calendarList.list({ maxResults: 100, showHidden: true });
      const calendars = (list.data.items ?? []).filter((item) => item.id && item.deleted !== true);
      account = calendars.find((item) => item.primary)?.id ?? '';
      const sources = calendars.length ? calendars : [{ id: 'primary', summary: '' }];
      // Gabungkan semua kalender yang terlihat (termasuk kalender langganan
      // seperti hari libur); kegagalan satu kalender tidak mengosongkan semua.
      const batches = await Promise.all(
        sources.map(async (source) => {
          try {
            const result = await calendar.events.list({
              calendarId: source.id ?? 'primary',
              timeMin: min,
              ...(max ? { timeMax: max } : {}),
              maxResults: 250,
              singleEvents: true,
              orderBy: 'startTime',
            });
            return (result.data.items ?? []).map((event) => ({
              event,
              calendarId: source.id ?? 'primary',
              calendarName: source.summary ?? '',
            }));
          } catch {
            return [];
          }
        }),
      );
      items = batches.flat().sort((a, b) => eventStart(a.event) - eventStart(b.event)).slice(0, 250);
    } catch (err) {
      this.calendarError(err, 'mengambil event');
    }

    return {
      calendarId: 'primary',
      account,
      timeMin: min,
      timeMax: max ?? null,
      writeScope: hasWriteScope(this.tokenRow()?.scope),
      events: items.map(({ event, calendarId, calendarName }) => mapEvent(event, calendarId, calendarName)),
    };
  }

  /** Buat event baru di kalender utama. */
  async createEvent(input: CreateCalendarEventInput) {
    const summary = typeof input.summary === 'string' ? input.summary.trim() : '';
    if (!summary) throw new BadRequestException('Judul event wajib diisi.');
    if (summary.length > 1024) throw new BadRequestException('Judul event terlalu panjang (maksimal 1024 karakter).');

    const description = typeof input.description === 'string' ? input.description.trim() : '';
    const location = typeof input.location === 'string' ? input.location.trim() : '';
    if (description.length > 8192) throw new BadRequestException('Deskripsi terlalu panjang (maksimal 8192 karakter).');
    if (location.length > 1024) throw new BadRequestException('Lokasi terlalu panjang (maksimal 1024 karakter).');

    const allDay = input.allDay === true;
    const startRaw = typeof input.start === 'string' ? input.start.trim() : '';
    const endRaw = typeof input.end === 'string' ? input.end.trim() : '';
    if (!startRaw || !endRaw) throw new BadRequestException('Waktu mulai dan selesai wajib diisi.');

    let start: calendar_v3.Schema$EventDateTime;
    let end: calendar_v3.Schema$EventDateTime;
    if (allDay) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(startRaw) || !/^\d{4}-\d{2}-\d{2}$/.test(endRaw)) {
        throw new BadRequestException('Format tanggal all-day harus YYYY-MM-DD.');
      }
      if (endRaw <= startRaw) throw new BadRequestException('Tanggal selesai harus setelah tanggal mulai.');
      start = { date: startRaw };
      end = { date: endRaw };
    } else {
      const startDate = new Date(startRaw);
      const endDate = new Date(endRaw);
      if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
        throw new BadRequestException('Waktu event tidak valid.');
      }
      if (endDate.getTime() <= startDate.getTime()) {
        throw new BadRequestException('Waktu selesai harus setelah waktu mulai.');
      }
      const timeZone = typeof input.timeZone === 'string' ? input.timeZone.trim() : '';
      start = { dateTime: startDate.toISOString(), ...(timeZone ? { timeZone } : {}) };
      end = { dateTime: endDate.toISOString(), ...(timeZone ? { timeZone } : {}) };
    }

    const client = await this.authorizedClient();
    const calendar = google.calendar({ version: 'v3', auth: client });
    try {
      const result = await calendar.events.insert({
        calendarId: 'primary',
        requestBody: { summary, description: description || undefined, location: location || undefined, start, end },
      });
      return mapEvent(result.data);
    } catch (err) {
      this.calendarError(err, 'menyimpan event');
    }
  }
}
