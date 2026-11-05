import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { PortsService } from './ports.service';

@Controller('ports')
export class PortsController {
  constructor(private readonly ports: PortsService) {}

  @Get()
  list() {
    return this.ports.snapshot();
  }

  @Get('processes')
  processes(@Query('limit') limit: string) {
    const parsed = Number(limit);
    return this.ports.processes(Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 200) : 60);
  }

  @Post('kill')
  kill(@Body() body: { pid: number }) {
    return this.ports.kill(Number(body?.pid));
  }
}
