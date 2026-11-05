import { BadRequestException, Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { google } from 'googleapis';
import { cfg } from '../../config';
import { one, run } from '../../common/db';

const SCOPE = 'https://www.googleapis.com/auth/calendar.readonly';
const STATE_TTL_MS = 10 * 60 * 1000;

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
};

/**
 * State OAuth disimpan di memori: cukup untuk satu user, kedaluwarsa 10 menit,
 * dan sekali pakai. Tidak perlu tabel tambahan.
 */
const states = new Map<string, number>();

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

  /** URL otorisasi Google, sekali pakai lewat parameter state. */
  authUrl() {
    const client = this.client();
    const now = Date.now();
    for (const [key, expiresAt] of states) {
      if (expiresAt <= now) states.delete(key);
    }
    const state = randomBytes(16).toString('hex');
    states.set(state, now + STATE_TTL_MS);
    const url = client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
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

  private takeState(state: string | undefined): boolean {
    if (!state) return false;
    const expiresAt = states.get(state);
    states.delete(state);
    return Boolean(expiresAt && expiresAt > Date.now());
  }

  private tokenRow(): TokenRow | null {
    return (
      one<TokenRow>(
        'SELECT access_token AS accessToken, refresh_token AS refreshToken, expiry FROM google_tokens WHERE id = 1',
      ) ?? null
    );
  }

  private saveTokens(tokens: GoogleTokens, fallbackRefresh: string | null): void {
    run(
      'INSERT INTO google_tokens (id, access_token, refresh_token, expiry, scope, token_type, updated_at) ' +
        'VALUES (1, ?, ?, ?, ?, ?, ?) ' +
        'ON CONFLICT(id) DO UPDATE SET access_token = excluded.access_token, ' +
        'refresh_token = COALESCE(excluded.refresh_token, google_tokens.refresh_token), ' +
        'expiry = excluded.expiry, scope = excluded.scope, token_type = excluded.token_type, ' +
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
    if (!this.takeState(state)) {
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
    this.saveTokens(tokens, existing?.refreshToken ?? null);
  }

  /** Hasil callback untuk redirect frontend: connected | denied | error. */
  async callbackStatus(code: string | undefined, state: string | undefined, error: string | undefined): Promise<string> {
    if (error || !code) return error === 'access_denied' ? 'denied' : 'error';
    try {
      await this.connect(code, state);
      return 'connected';
    } catch {
      return 'error';
    }
  }

  /** Event terdekat dari kalender utama; token di-refresh otomatis bila hampir kedaluwarsa. */
  async events() {
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

    const timeMin = new Date().toISOString();
    const calendar = google.calendar({ version: 'v3', auth: client });
    let items;
    try {
      const result = await calendar.events.list({
        calendarId: 'primary',
        timeMin,
        maxResults: 20,
        singleEvents: true,
        orderBy: 'startTime',
      });
      items = result.data.items ?? [];
    } catch (err) {
      const message = (err as Error).message ?? '';
      if (/invalid_grant|unauthorized|401/i.test(message)) {
        throw new BadRequestException('Akses Google Calendar ditolak. Hubungkan ulang kalender.');
      }
      throw new BadRequestException('Gagal mengambil event Google Calendar: ' + message.slice(0, 160));
    }

    return {
      calendarId: 'primary',
      timeMin,
      events: items.map((item) => ({
        id: item.id ?? '',
        summary: item.summary ?? '(tanpa judul)',
        description: item.description ?? '',
        location: item.location ?? '',
        start: item.start ?? null,
        end: item.end ?? null,
        htmlLink: item.htmlLink ?? '',
        status: item.status ?? '',
        allDay: Boolean(item.start?.date),
      })),
    };
  }
}
