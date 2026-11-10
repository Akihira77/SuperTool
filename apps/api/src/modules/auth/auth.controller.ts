import { Body, Controller, Get, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Public } from '../../common/public.decorator';
import { AuthService, COOKIE_NAME } from './auth.service';

function cookieOptions(req: Request) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    path: '/',
    // Loopback HTTP tidak boleh memaksa Secure; di belakang HTTPS proxy aktif.
    secure: req.secure,
    maxAge: 30 * 24 * 60 * 60 * 1000,
  };
}

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  async login(@Body() body: { password?: string }, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const { token, mustChange } = await this.auth.login(String(body?.password ?? ''), clientIp(req));
    res.cookie(COOKIE_NAME, token, cookieOptions(req));
    return { ok: true, mustChange };
  }

  @Post('logout')
  logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    res.clearCookie(COOKIE_NAME, { path: '/', secure: req.secure, sameSite: 'lax', httpOnly: true });
    return { ok: true };
  }

  @Get('me')
  async me(@Req() req: Request) {
    const session = await this.auth.session(req.headers.cookie);
    return { authenticated: true, mustChange: session?.mustChange ?? false };
  }

  @Post('change-password')
  async changePassword(
    @Body() body: { current?: string; next?: string },
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { token, mustChange } = await this.auth.changePassword(
      String(body?.current ?? ''),
      String(body?.next ?? ''),
    );
    res.cookie(COOKIE_NAME, token, cookieOptions(req));
    return { ok: true, mustChange };
  }
}

function clientIp(req: Request): string {
  return req.ip ?? req.socket.remoteAddress ?? 'unknown';
}
