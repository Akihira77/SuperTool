import { Module } from '@nestjs/common';
import { CalendarController } from './calendar.controller';
import { GoogleCallbackController } from './google-callback.controller';
import { CalendarService } from './calendar.service';

@Module({
  controllers: [CalendarController, GoogleCallbackController],
  providers: [CalendarService],
  exports: [CalendarService],
})
export class CalendarModule {}
