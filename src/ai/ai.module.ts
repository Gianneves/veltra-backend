import { Module } from '@nestjs/common';
import { AiService } from './ai.service';
import { AiProvider } from './ai-provider';
import { OpenAiProvider } from './openai-provider';
import { AiModelRouter } from './model-router';

@Module({
  providers: [
    AiService,
    AiModelRouter,
    OpenAiProvider,
    { provide: AiProvider, useExisting: OpenAiProvider },
  ],
  exports: [AiService],
})
export class AiModule {}
