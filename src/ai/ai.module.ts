import { Module } from '@nestjs/common';
import { RedisModule } from 'src/redis/redis.module';
import { AiFailoverService } from './ai-failover.service';
import { AiProvider } from './ai-provider';
import { AiProviderStateService } from './ai-provider-state.service';
import { AiService } from './ai.service';
import { DeepSeekProvider } from './deepseek-provider';
import { AiModelRouter } from './model-router';
import { OpenAiProvider } from './openai-provider';

@Module({
  imports: [RedisModule],
  providers: [
    AiService,
    AiModelRouter,
    OpenAiProvider,
    DeepSeekProvider,
    AiProviderStateService,
    AiFailoverService,
    { provide: AiProvider, useExisting: AiFailoverService },
  ],
  exports: [AiService, AiProviderStateService],
})
export class AiModule {}
