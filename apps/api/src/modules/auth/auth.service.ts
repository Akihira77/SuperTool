import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { randomBytes, scrypt } from 'node:crypto';
import { one, run } from '../../common/db';
import { signToken, verifyToken } from '../../common/token';

export const COOKIE_NAME = 'st_session';
const DEFAULT_PASSWORD = 'password';
const SESSION_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_ATTEMPTS = 6;
const WINDOW_MS = 10 * 60 * 1000;
const MAX_TRACKED_IPS = 2048;

type Account = { salt: string; hash: string; pv: number; must_change: number; secret: string };

export type Session = { mustChange: boolean; exp: number };

function hashPassword(password: string, salt: string): Promise<string> {
  return new Promise((res, rej) => {
    scrypt(password, salt, 64, (err, key) => {
      if (err) rej(err);
      else res(key.toString('hex'));
    });
  });
}

@Injectable()
export class AuthService {
  private cache: Account | null = null;
  private attempts = new Map<string, { count: number; until: number }>();

  /** Akun (hash password + secret sesi) tersimpan di tabel account, bukan file. */
  private async state(): Promise<Account> {
    if (this.cache) return this.cache;
    const saved = one<Account>('SELECT salt, hash, pv, must_change, secret FROM account WHERE id = 1');
    if (saved) {
      this.cache = saved;
      return saved;
    }
    const salt = randomBytes(16).toString('hex');
    const created: Account = {
      salt,
      hash: await hashPassword(DEFAULT_PASSWORD, salt),
      pv: 1,
      must_change: 1,
      secret: randomBytes(32).toString('hex'),
    };
    run(
      'INSERT INTO account (id, salt, hash, pv, must_change, secret, created_at) VALUES (1, ?, ?, ?, ?, ?, ?)',
      created.salt,
      created.hash,
      created.pv,
      created.must_change,
      created.secret,
      Date.now(),
    );
    this.cache = created;
    return created;
  }

  private issue(state: Account): string {
    return signToken({ exp: Date.now() + SESSION_MS, pv: state.pv }, state.secret);
  }

  async session(cookieHeader: string | undefined): Promise<Session | null> {
    const token = parseCookie(cookieHeader, COOKIE_NAME);
    if (!token) return null;
    const state = await this.state();
    const payload = verifyToken(token, state.secret);
    if (!payload || payload.pv !== state.pv) return null;
    return { mustChange: state.must_change === 1, exp: payload.exp };
  }

  /** Tiket bearer untuk mode proxy subdomain: terikat origin target, bukan cookie sesi. */
  async issueProxyTicket(origin: string): Promise<string> {
    const state = await this.state();
    return signToken({ exp: Date.now() + 12 * 60 * 60 * 1000, pv: state.pv, origin }, state.secret);
  }

  /** Verifikasi tiket proxy; origin harus sama persis dan sesi belum dirotasi. */
  async verifyProxyTicket(ticket: string | undefined, origin: string): Promise<boolean> {
    if (!ticket) return false;
    const state = await this.state();
    const payload = verifyToken(ticket, state.secret);
    return Boolean(payload && payload.pv === state.pv && payload.origin === origin);
  }

  async login(password: string, ip: string): Promise<{ token: string; mustChange: boolean }> {
    this.assertNotLocked(ip);
    const state = await this.state();
    const candidate = await hashPassword(String(password ?? ''), state.salt);
    if (candidate !== state.hash) {
      this.fail(ip);
      throw new UnauthorizedException('Password salah');
    }
    this.attempts.delete(ip);
    return { token: this.issue(state), mustChange: state.must_change === 1 };
  }

  async changePassword(current: string, next: string): Promise<{ token: string; mustChange: boolean }> {
    const state = await this.state();
    const currentHash = await hashPassword(String(current ?? ''), state.salt);
    if (currentHash !== state.hash) throw new UnauthorizedException('Password lama salah');
    if (typeof next !== 'string' || next.length < 8) {
      throw new BadRequestException('Password baru minimal 8 karakter');
    }
    if (next === DEFAULT_PASSWORD) {
      throw new BadRequestException('Password tidak boleh sama dengan password default');
    }
    const salt = randomBytes(16).toString('hex');
    const updated: Account = {
      ...state,
      salt,
      hash: await hashPassword(next, salt),
      pv: state.pv + 1,
      must_change: 0,
    };
    run(
      'UPDATE account SET salt = ?, hash = ?, pv = ?, must_change = 0 WHERE id = 1',
      updated.salt,
      updated.hash,
      updated.pv,
    );
    this.cache = updated;
    return { token: this.issue(updated), mustChange: false };
  }

  /** Buang entri kedaluwarsa supaya map tidak tumbuh tanpa batas. */
  private sweep(now: number): void {
    if (this.attempts.size < MAX_TRACKED_IPS) return;
    for (const [ip, entry] of this.attempts) {
      if (entry.until < now) this.attempts.delete(ip);
    }
    if (this.attempts.size >= MAX_TRACKED_IPS) this.attempts.clear();
  }

  private assertNotLocked(ip: string): void {
    this.sweep(Date.now());
    const entry = this.attempts.get(ip);
    if (entry && entry.count >= MAX_ATTEMPTS && entry.until > Date.now()) {
      const minutes = Math.ceil((entry.until - Date.now()) / 60000);
      throw new ForbiddenException('Terlalu banyak percobaan. Coba lagi dalam ' + minutes + ' menit');
    }
  }

  private fail(ip: string): void {
    const now = Date.now();
    this.sweep(now);
    const entry = this.attempts.get(ip);
    if (!entry || entry.until < now) {
      this.attempts.set(ip, { count: 1, until: now + WINDOW_MS });
      return;
    }
    entry.count += 1;
  }
}

export function parseCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(eq + 1).trim());
    } catch {
      return undefined;
    }
  }
  return undefined;
}
