import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { IsUUID } from 'class-validator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { EmailVerifiedGuard } from '../../auth/guards/email-verified.guard';
import type { JwtPayload } from '../../auth/tokens/jwt-token.service';
import {
  CreateConversationDto,
  GetConversationQueryDto,
  ListConversationsQueryDto,
  PatchConversationDto,
  SendMessageDto,
} from '../dto/conversation.dto';
import { ConversationLifecycleService } from '../services/conversation-lifecycle.service';
import { ConversationMessageService } from '../services/conversation-message.service';

export class ConversationIdParamDto {
  @IsUUID()
  conversationId!: string;
}

@Controller('conversations')
@UseGuards(JwtAuthGuard, EmailVerifiedGuard)
export class ConversationsController {
  constructor(
    private readonly lifecycle: ConversationLifecycleService,
    private readonly messages: ConversationMessageService,
  ) {}

  @Post()
  create(@Req() req: Request, @Body() body: CreateConversationDto) {
    return this.lifecycle.create(this.userId(req), body);
  }

  @Get()
  list(@Req() req: Request, @Query() query: ListConversationsQueryDto) {
    return this.lifecycle.list(this.userId(req), query);
  }

  @Get(':conversationId')
  get(
    @Req() req: Request,
    @Param() params: ConversationIdParamDto,
    @Query() query: GetConversationQueryDto,
  ) {
    return this.lifecycle.get(this.userId(req), params.conversationId, query.messagesCursor, query.messagesLimit);
  }

  @Patch(':conversationId')
  patch(
    @Req() req: Request,
    @Param() params: ConversationIdParamDto,
    @Body() body: PatchConversationDto,
  ) {
    return this.lifecycle.patch(this.userId(req), params.conversationId, body);
  }

  @Delete(':conversationId')
  @HttpCode(204)
  async delete(@Req() req: Request, @Param() params: ConversationIdParamDto): Promise<void> {
    await this.lifecycle.delete(this.userId(req), params.conversationId);
  }

  @Post(':conversationId/messages')
  send(
    @Req() req: Request,
    @Param() params: ConversationIdParamDto,
    @Body() body: SendMessageDto,
  ) {
    return this.messages.send(this.userId(req), params.conversationId, body);
  }

  private userId(req: Request): string {
    return (req.user as JwtPayload).sub;
  }
}