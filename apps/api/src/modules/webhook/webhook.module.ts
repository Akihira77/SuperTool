import { Module } from '@nestjs/common';
import { HookController, WebhookController } from './webhook.controller';
import { WebhookService } from './webhook.service';

@Module({ controllers: [HookController, WebhookController], providers: [WebhookService] })
export class WebhookModule {}
