import { Body, Controller, Delete, Get, Post, Put, Query } from '@nestjs/common';
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

  @Post('file')
  create(@Body() body: { name: string }) {
    return this.nginx.create(body?.name);
  }

  @Delete('file')
  remove(@Query('path') path: string) {
    return this.nginx.remove(path);
  }

  @Post('revert')
  revert(@Body() body: { path: string }) {
    return this.nginx.revert(body?.path);
  }

  @Post('test')
  test() {
    return this.nginx.test();
  }
}
