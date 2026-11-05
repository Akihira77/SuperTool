import { Module } from '@nestjs/common';
import { SqliteController } from './sqlite.controller';
import { SqliteService } from './sqlite.service';

@Module({ controllers: [SqliteController], providers: [SqliteService] })
export class SqliteModule {}
