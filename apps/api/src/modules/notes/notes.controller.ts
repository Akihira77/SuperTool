import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';
import { NotesService } from './notes.service';

@Controller('notes')
export class NotesController {
  constructor(private readonly notes: NotesService) {}

  @Get()
  list(@Query('q') q?: string, @Query('scope') scope?: string) {
    return this.notes.list(q, scope);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.notes.get(id);
  }

  @Post()
  create(@Body() body: { title?: string; body?: string }) {
    return this.notes.create(body ?? {});
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() body: { title?: string; body?: string }) {
    return this.notes.update(id, body ?? {});
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.notes.remove(id);
  }
}
