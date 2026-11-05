import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { IS_PUBLIC } from '../../common/public.decorator';
import { AuthService } from './auth.service';

/** Route yang tetap boleh dipakai saat user wajib ganti password. */
const ALLOWED_WHILE_MUST_CHANGE = ['/api/auth/me', '/api/auth/change-password', '/api/auth/logout'];

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<Request>();
    const mutating = req.method !== 'GET' && req.method !== 'HEAD';
    // Proteksi CSRF ringan: semua request pengubah wajib bawa header khusus.
    if (mutating && req.headers['x-st-csrf'] !== '1') {
      throw new ForbiddenException('Header X-ST-CSRF wajib ada');
    }

    const session = await this.auth.session(req.headers.cookie);
    if (!session) throw new UnauthorizedException('Belum login');

    const path = (req.originalUrl || req.url).split('?')[0];
    if (session.mustChange && !ALLOWED_WHILE_MUST_CHANGE.includes(path)) {
      throw new ForbiddenException({ code: 'PASSWORD_CHANGE_REQUIRED', message: 'Ganti password dulu' });
    }
    return true;
  }
}
