import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthGuard } from './modules/auth/auth.guard';
import { AuditModule } from './modules/audit/audit.module';
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
import { DiagnosticsModule } from './modules/diagnostics/diagnostics.module';
import { WorkspacesModule } from './modules/workspaces/workspaces.module';
import { SqliteModule } from './modules/sqlite/sqlite.module';
import { WebhookModule } from './modules/webhook/webhook.module';
import { BackupModule } from './modules/backup/backup.module';
import { CalendarModule } from './modules/calendar/calendar.module';
import { CompareModule } from './modules/compare/compare.module';
import { DownloaderModule } from './modules/downloader/downloader.module';
import { JobsModule } from './modules/jobs/jobs.module';
import { TelegramModule } from './modules/telegram/telegram.module';

@Module({
  imports: [
    AuditModule,
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
    WebhookModule,
    BackupModule,
    CalendarModule,
    CompareModule,
    DownloaderModule,
    DiagnosticsModule,
    JobsModule,
    WorkspacesModule,
    TelegramModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: AuthGuard }],
})
export class AppModule {}
