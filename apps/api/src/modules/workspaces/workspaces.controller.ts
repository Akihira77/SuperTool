import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { WorkspacesService } from './workspaces.service';

@Controller('workspaces')
export class WorkspacesController {
  constructor(private readonly workspaces: WorkspacesService) {}

  @Get()
  list() {
    return this.workspaces.list();
  }

  @Post()
  save(@Body() body: { id?: string; name?: string; root?: string; config?: unknown }) {
    return this.workspaces.save(body ?? {});
  }

  @Get('export')
  exportData() {
    return this.workspaces.exportData();
  }

  @Post('import')
  importData(@Body() body: unknown) {
    return this.workspaces.importData(body);
  }

  @Post(':id/duplicate')
  duplicate(@Param('id') id: string) {
    return this.workspaces.duplicate(id);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.workspaces.remove(id);
  }
}
