import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { randomBytes, scrypt } from 'node:crypto';
import { join } from 'node:path';
import { cfg } from '../../config';
import { readJson, writeJson } from '../../common/json-store';
import { signToken, verifyToken } from '../../common/token';

export const COOKIE_NAME = 'st_session';
const DEFAULT_PASSWORD = 'password';
const SESSION_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_ATTEMPTS = 6;
const WINDOW_MS = 10 * 60 * 1000;

type AuthFile = {
  salt: string;
  hash: string;
  pv: number;
  mustChange: boolean;
  secret: string;
};

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
  private readonly file = join(cfg.dataDir, 'auth.json');
  private cache: AuthFile | null = null;
  private attempts = new Map<string, { count: number; until: number }>();

  private async state(): Promise<AuthFile> {
    if (this.cache) return this.cache;
    const saved = await readJson<AuthFile | null>(this.file, null);
    if (saved) {
      this.cache = saved;
      return saved;
    }
    const salt = randomBytes(16).toString('hex');
    const created: AuthFile = {
      salt,
      hash: await hashPassword(DEFAULT_PASSWORD, salt),
      pv: 1,
      mustChange: true,
      secret: randomBytes(32).toString('hex'),
    };
    await writeJson(this.file, created);
    this.cache = created;
    return created;
  }

  private issue(state: AuthFile): string {
    return signToken({ exp: Date.now() + SESSION_MS, pv: state.pv }, state.secret);
  }

  async session(cookieHeader: string | undefined): Promise<Session | null> {
    const token = parseCookie(cookieHeader, COOKIE_NAME);
    if (!token) return null;
    const state = await this.state();
    const payload = verifyToken(token, state.secret);
    if (!payload || payload.pv !== state.pv) return null;
    return { mustChange: state.mustChange, exp: payload.exp };
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
    return { token: this.issue(state), mustChange: state.mustChange };
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
    const updated: AuthFile = {
      ...state,
      salt,
      hash: await hashPassword(next, salt),
      pv: state.pv + 1,
      mustChange: false,
    };
    await writeJson(this.file, updated);
    this.cache = updated;
    return { token: this.issue(updated), mustChange: false };
  }

  private assertNotLocked(ip: string): void {
    const entry = this.attempts.get(ip);
    if (entry && entry.count >= MAX_ATTEMPTS && entry.until > Date.now()) {
      const minutes = Math.ceil((entry.until - Date.now()) / 60000);
      throw new ForbiddenException('Terlalu banyak percobaan. Coba lagi dalam ' + minutes + ' menit');
    }
  }

  private fail(ip: string): void {
    const now = Date.now();
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
    if (part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return undefined;
}
