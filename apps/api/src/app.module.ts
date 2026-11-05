import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthGuard } from './modules/auth/auth.guard';
import { AuthModule } from './modules/auth/auth.module';
import { FilesModule } from './modules/files/files.module';
import { LlmModule } from './modules/llm/llm.module';
import { NginxModule } from './modules/nginx/nginx.module';
import { NotesModule } from './modules/notes/notes.module';
import { PortsModule } from './modules/ports/ports.module';
import { ProxyModule } from './modules/proxy/proxy.module';
import { StorageModule } from './modules/storage/storage.module';
import { CompressModule } from './modules/tools/compress.module';
import { DevModule } from './modules/dev/dev.module';
import { SqliteModule } from './modules/sqlite/sqlite.module';

@Module({
  imports: [
    AuthModule,
    NotesModule,
    FilesModule,
    PortsModule,
    NginxModule,
    ProxyModule,
    LlmModule,
    StorageModule,
    CompressModule,
    DevModule,
    SqliteModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: AuthGuard }],
})
export class AppModule {}
