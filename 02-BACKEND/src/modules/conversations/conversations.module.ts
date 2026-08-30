import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AiModule } from '../ai/ai.module';
import { ConversationAccessService } from './services/conversation-access.service';
import { ConversationsService } from './services/conversations.service';
import { ConversationMessageService } from './services/conversation-message.service';
import { ConversationHistoryService } from './services/conversation-history.service';
import { ConversationsController } from './controllers/conversations.controller';

@Module({
  imports: [PrismaModule, AiModule],
  controllers: [ConversationsController],
  providers: [
    ConversationAccessService,
    ConversationsService,
    ConversationHistoryService,
    ConversationMessageService,
  ],
  exports: [ConversationsService, ConversationMessageService],
})
export class ConversationsModule {}