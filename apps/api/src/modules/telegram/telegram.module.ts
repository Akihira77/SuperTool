import { Module } from '@nestjs/common';
import { CompressModule } from '../tools/compress.module';
import { DownloaderModule } from '../downloader/downloader.module';
import { TelegramService } from './telegram.service';

@Module({
  imports: [DownloaderModule, CompressModule],
  providers: [TelegramService],
})
export class TelegramModule {}
