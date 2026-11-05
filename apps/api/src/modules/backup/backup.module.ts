import { Module } from '@nestjs/common';
import { BackupController, RestoreController } from './backup.controller';
import { BackupService } from './backup.service';

@Module({
  controllers: [BackupController, RestoreController],
  providers: [BackupService],
})
export class BackupModule {}
