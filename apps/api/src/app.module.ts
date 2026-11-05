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

@Module({
  imports: [AuthModule, NotesModule, FilesModule, PortsModule, NginxModule, ProxyModule, LlmModule],
  providers: [{ provide: APP_GUARD, useClass: AuthGuard }],
})
export class AppModule {}
