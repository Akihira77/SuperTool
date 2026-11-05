import { Controller, Get } from '@nestjs/common';
import { PortsService } from './ports.service';

@Controller('ports')
export class PortsController {
  constructor(private readonly ports: PortsService) {}

  @Get()
  list() {
    return this.ports.snapshot();
  }
}
