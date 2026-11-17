import { Module } from '@nestjs/common';
import { AiService } from './ai.service';
import { AiModelRouter } from './model-router';

@Module({
  providers: [AiService, AiModelRouter],
  exports: [AiService],
})
export class AiModule {}
