import { Module } from '@nestjs/common';
import { CompressController } from './compress.controller';
import { CompressService } from './compress.service';

@Module({ controllers: [CompressController], providers: [CompressService], exports: [CompressService] })
export class CompressModule {}
