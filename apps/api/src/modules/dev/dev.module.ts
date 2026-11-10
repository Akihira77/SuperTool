import { Module } from '@nestjs/common';
import { DevController } from './dev.controller';
import { DevService } from './dev.service';
import { HttpStoreService } from './http-store.service';

@Module({ controllers: [DevController], providers: [DevService, HttpStoreService] })
export class DevModule {}
