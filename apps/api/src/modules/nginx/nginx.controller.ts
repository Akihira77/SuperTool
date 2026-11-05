import { Body, Controller, Get, Post, Put, Query } from '@nestjs/common';
import { NginxService } from './nginx.service';

@Controller('nginx')
export class NginxController {
  constructor(private readonly nginx: NginxService) {}

  @Get('files')
  files() {
    return this.nginx.list();
  }

  @Get('file')
  file(@Query('path') path: string) {
    return this.nginx.read(path);
  }

  @Put('file')
  save(@Body() body: { path: string; content: string }) {
    return this.nginx.write(body?.path, body?.content ?? '');
  }

  @Post('test')
  test() {
    return this.nginx.test();
  }
}
