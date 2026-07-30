import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CoachService } from './coach.service';
import { CoachController } from './coach.controller';
import { CoachConversation } from './entities/coach-conversation.entity';
import { CoachMessage } from './entities/coach-message.entity';
import { AiModule } from 'src/ai/ai.module';
import { RedisModule } from 'src/redis/redis.module';

@Module({
    imports: [TypeOrmModule.forFeature([CoachConversation, CoachMessage]), AiModule, RedisModule],
    controllers: [CoachController],
    providers: [CoachService],
    exports: [CoachService],
})
export class CoachModule {}
