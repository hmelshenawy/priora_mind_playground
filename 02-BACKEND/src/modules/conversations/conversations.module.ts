import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AiModule } from '../ai/ai.module';
import { RagModule } from '../rag/rag.module';
import { ConversationAccessService } from './services/conversation-access.service';
import { ConversationLifecycleService } from './services/conversation-lifecycle.service';
import { ConversationMessageService } from './services/conversation-message.service';
import { ConversationContextService } from './services/conversation-context.service';
import { ConversationFollowUpRewriteService } from './services/conversation-follow-up-rewrite.service';
import { ConversationsController } from './controllers/conversations.controller';

@Module({
  imports: [PrismaModule, AiModule, RagModule],
  controllers: [ConversationsController],
  providers: [
    ConversationAccessService,
    ConversationLifecycleService,
    ConversationContextService,
    ConversationFollowUpRewriteService,
    ConversationMessageService,
  ],
  exports: [ConversationLifecycleService, ConversationMessageService],
})
export class ConversationsModule {}