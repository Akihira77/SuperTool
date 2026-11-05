import { Controller, Get, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Public } from '../../common/public.decorator';
import { CalendarService } from './calendar.service';

/**
 * Alias callback untuk GOOGLE_REDIRECT_URI yang sudah terlanjur memakai
 * /api/google/callback (mis. di Google Cloud Console). Perilaku sama:
 * state sekali pakai, lalu redirect ke halaman Calendar di frontend.
 */
@Controller('google')
export class GoogleCallbackController {
  constructor(private readonly calendar: CalendarService) {}

  @Public()
  @Get('callback')
  async callback(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Query('error') error: string | undefined,
    @Res() res: Response,
  ) {
    const status = await this.calendar.callbackStatus(code, state, error);
    res.redirect(302, this.calendar.redirectUrl(status));
  }
}
