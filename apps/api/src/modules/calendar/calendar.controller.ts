import { Body, Controller, Get, HttpCode, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Public } from '../../common/public.decorator';
import { CalendarService, type CreateCalendarEventInput } from './calendar.service';

@Controller('calendar')
export class CalendarController {
  constructor(private readonly calendar: CalendarService) {}

  /** URL otorisasi Google; `switch=1` memaksa pemilih akun. */
  @Get('auth')
  auth(@Query('switch') switchAccount?: string) {
    return this.calendar.authUrl(switchAccount === '1' ? 'switch' : 'connect');
  }

  /**
   * Callback dari Google. Tidak bisa memakai sesi (browser bisa membuka auth di
   * profil lain), jadi publik + state sekali pakai. Selalu redirect ke frontend.
   */
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

  /** Event pada rentang tertentu; default bulan berjalan (AuthGuard global). */
  @Get('events')
  events(@Query('timeMin') timeMin?: string, @Query('timeMax') timeMax?: string) {
    return this.calendar.events(timeMin, timeMax);
  }

  /** Tambah event baru ke kalender utama. */
  @Post('events')
  @HttpCode(201)
  create(@Body() body: CreateCalendarEventInput) {
    return this.calendar.createEvent(body ?? {});
  }

  /** Sign out: cabut grant Google dan hapus token lokal. */
  @Post('disconnect')
  @HttpCode(200)
  disconnect() {
    return this.calendar.disconnect();
  }
}
