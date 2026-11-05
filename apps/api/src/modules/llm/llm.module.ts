import { Module } from '@nestjs/common';
import { LlmController } from './llm.controller';

@Module({
  controllers: [LlmController],
})
export class LlmModule {}
