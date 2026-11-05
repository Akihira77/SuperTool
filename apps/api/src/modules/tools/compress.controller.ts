import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { CompressService } from './compress.service';

@Controller('compress')
export class CompressController {
  constructor(private readonly compress: CompressService) {}

  @Get('info')
  info() {
    return this.compress.info();
  }

  @Get('job')
  job(@Query('id') id: string) {
    return this.compress.job(id);
  }

  @Post('image')
  image(@Body() body: { path: string; quality?: number; maxWidth?: number; format?: string }) {
    return this.compress.image(body?.path, body ?? {});
  }

  @Post('pdf')
  pdf(@Body() body: { path: string; mode?: string }) {
    return this.compress.pdf(body?.path, body ?? {});
  }

  @Post('convert')
  convert(@Body() body: { path: string; target?: string; quality?: number; dpi?: number }) {
    return this.compress.convert(body?.path, body ?? {});
  }
}
