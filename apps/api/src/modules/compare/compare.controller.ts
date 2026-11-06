import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { CompareService } from './compare.service';

@Controller('compare')
export class CompareController {
  constructor(private readonly compare: CompareService) {}

  @Get()
  list(@Query('limit') limit?: string, @Query('before') before?: string) {
    return this.compare.list(limit, before);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.compare.get(id);
  }

  @Post()
  save(@Body() body: { left?: unknown; right?: unknown }) {
    return this.compare.save(body ?? {});
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.compare.remove(id);
  }
}
