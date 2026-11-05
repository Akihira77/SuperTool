import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { SqliteService } from './sqlite.service';

/**
 * Semua route di sini otomatis dilindungi AuthGuard global (APP_GUARD di AppModule):
 * tanpa cookie sesi valid -> 401, dan POST wajib header x-st-csrf: 1.
 */
@Controller('sqlite')
export class SqliteController {
  constructor(private readonly sqlite: SqliteService) {}

  @Get('info')
  info() {
    return this.sqlite.info();
  }

  @Get('table')
  table(@Query('name') name: string, @Query('limit') limit?: string, @Query('offset') offset?: string) {
    return this.sqlite.table(name, Number(limit) || 100, Number(offset) || 0);
  }

  @Post('query')
  query(@Body() body: { sql?: string }) {
    return this.sqlite.query(body?.sql ?? '');
  }
}
