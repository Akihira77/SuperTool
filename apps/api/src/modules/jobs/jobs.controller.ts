import { Controller, Get, Param, Post, Query } from '@nestjs/common';
import { JobsService } from './jobs.service';

@Controller('jobs')
export class JobsController {
  constructor(private readonly jobs: JobsService) {}

  @Get()
  list(@Query('type') type?: string, @Query('status') status?: string, @Query('limit') limit?: string) {
    return this.jobs.list({ type, status, limit: limit ? Number(limit) : undefined });
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.jobs.get(id);
  }

  @Post(':id/cancel')
  cancel(@Param('id') id: string) {
    return this.jobs.cancel(id);
  }
}
