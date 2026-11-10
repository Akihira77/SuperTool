import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ProxyController } from './proxy.controller';

@Module({
  imports: [AuthModule],
  controllers: [ProxyController],
})
export class ProxyModule {}
