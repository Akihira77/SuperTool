import { All, Body, Controller, Delete, Get, NotFoundException, Param, Post, Query, Req, Res } from '@nestjs/common';
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
    const endpoint = this.hooks.find(token);
    if (!endpoint) throw new NotFoundException('Token webhook tidak dikenal');
    return this.hooks.capture(req, endpoint.id);
  }
}

@Controller('webhook')
export class WebhookController {
  constructor(private readonly hooks: WebhookService) {}

  @Get()
  info() {
    return this.hooks.info();
  }

  @Post()
  create(@Body() body: { name?: string }) {
    return this.hooks.create(body?.name);
  }

  @Delete('e/:id')
  remove(@Param('id') id: string) {
    return this.hooks.remove(id);
  }

  @Delete('items')
  clearItems(@Query('endpoint') endpoint: string) {
    return this.hooks.clear(endpoint || undefined);
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
