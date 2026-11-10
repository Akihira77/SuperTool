import { Controller, Get, Query } from '@nestjs/common';
import { DiagnosticsService } from './diagnostics.service';

@Controller('diagnostics')
export class DiagnosticsController {
  constructor(private readonly diagnostics: DiagnosticsService) {}

  @Get()
  get(@Query('logs') logs?: string) {
    return this.diagnostics.snapshot(logs ? Number(logs) : 40);
  }
}
