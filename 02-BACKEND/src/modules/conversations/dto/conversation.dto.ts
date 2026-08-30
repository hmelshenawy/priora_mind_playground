import { IsBoolean, IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { trim, toBool } from '../../../common/validation/transforms';
import { CONVERSATION_LIMITS } from '../constants/conversation.constants';

export class CreateConversationDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty({ message: 'title must not be empty' })
  @MaxLength(CONVERSATION_LIMITS.titleMaxLength)
  @Transform(trim)
  title?: string;
}

export class ListConversationsQueryDto {
  @IsOptional()
  @IsUUID()
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(CONVERSATION_LIMITS.maxPageSize)
  limit: number = CONVERSATION_LIMITS.defaultPageSize;

  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  includeArchived: boolean = false;
}

export class GetConversationQueryDto {
  @IsOptional()
  @IsUUID()
  messagesCursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(CONVERSATION_LIMITS.maxPageSize)
  messagesLimit: number = CONVERSATION_LIMITS.defaultPageSize;
}

export class PatchConversationDto {
  @IsBoolean()
  archived!: boolean;
}

export class SendMessageDto {
  @IsString()
  @IsNotEmpty({ message: 'content must not be empty' })
  @MaxLength(CONVERSATION_LIMITS.messageMaxLength)
  @Transform(trim)
  content!: string;
}

export type ConversationStatusDto = 'ACTIVE' | 'ARCHIVED';
export type ConversationMessageRoleDto = 'user' | 'assistant' | 'system';
/** Legacy persisted values remain readable; the fixed pipeline writes null. */
export type ConversationMessageRouteDto = 'SYSTEM_COMMAND' | 'RAG' | 'STATIC_RESPONSE';
export type ConversationMessageStatusDto = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';

export interface ConversationSummaryDto {
  id: string;
  title: string | null;
  status: ConversationStatusDto;
  createdAt: string;
  updatedAt: string;
  lastMessageAt: string | null;
}

export interface AssistantSourceDto {
  chunkId: string;
  sourceId: string;
  sourceTitle: string;
  sourceFile?: string | null;
  sourceType: string;
  chunkIndex: number;
  score: number;
  citationPage?: number | null;
  pageStart?: number | null;
  pageEnd?: number | null;
  citationHeading?: string | null;
  citationSection?: string | null;
  textHash: string;
  displayOrder: number;
}

export interface ConversationMessageDto {
  id: string;
  conversationId: string;
  role: ConversationMessageRoleDto;
  content: string;
  status: ConversationMessageStatusDto;
  route: ConversationMessageRouteDto | null;
  sources: AssistantSourceDto[];
  createdAt: string;
  completedAt: string | null;
}
