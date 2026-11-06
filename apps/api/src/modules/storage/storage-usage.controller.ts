import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { StorageUsageService } from './storage-usage.service';

@Controller('storage')
export class StorageUsageController {
  constructor(private readonly storage: StorageUsageService) {}

  @Get('usage')
  usage(@Query('refresh') refresh?: string) {
    return this.storage.usage(refresh === '1' || refresh === 'true');
  }

  @Post('delete')
  remove(@Body() body: { path?: string }) {
    return this.storage.remove(body?.path ?? '');
  }

  @Post('docker-prune')
  dockerPrune() {
    return this.storage.dockerPrune();
  }
}
