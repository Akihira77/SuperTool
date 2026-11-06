import { Controller, Get, Query } from '@nestjs/common';
import { AuditService } from './audit.service';

@Controller('audit')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  /** Dipakai UI Audit Log; AuthGuard global melindungi route ini. */
  @Get()
  list(
    @Query('source') source?: string,
    @Query('actor') actor?: string,
    @Query('feature') feature?: string,
    @Query('q') q?: string,
    @Query('since') since?: string,
    @Query('until') until?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.audit.list({
      source,
      actor,
      feature,
      q,
      since: Number(since) || undefined,
      until: Number(until) || undefined,
      limit: Number(limit) || undefined,
      offset: Number(offset) || undefined,
    });
  }
}
