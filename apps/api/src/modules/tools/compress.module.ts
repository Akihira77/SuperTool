import { Module } from '@nestjs/common';
import { CompressController } from './compress.controller';
import { JobsModule } from '../jobs/jobs.module';
import { CompressService } from './compress.service';

@Module({ imports: [JobsModule], controllers: [CompressController], providers: [CompressService], exports: [CompressService] })
export class CompressModule {}
