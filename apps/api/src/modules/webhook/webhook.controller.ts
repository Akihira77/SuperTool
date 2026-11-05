import { All, Controller, Delete, Get, NotFoundException, Param, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Public } from '../../common/public.decorator';
import { WebhookService } from './webhook.service';

/** Endpoint publik: aplikasi lain memanggil ini tanpa login. */
@Controller('hook')
export class HookController {
  constructor(private readonly hooks: WebhookService) {}

  @Public()
  @All(':token')
  receive(@Param('token') token: string, @Req() req: Request) {
    if (token !== this.hooks.info().token) throw new NotFoundException('Token webhook tidak dikenal');
    return this.hooks.capture(req);
  }
}

@Controller('webhook')
export class WebhookController {
  constructor(private readonly hooks: WebhookService) {}

  @Get()
  info() {
    return this.hooks.info();
  }

  @Delete()
  clear() {
    return this.hooks.clear();
  }

  @Get('stream')
  stream(@Res() res: Response) {
    this.hooks.subscribe(res);
  }
}
