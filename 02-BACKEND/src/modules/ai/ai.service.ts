import { Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import type { LlmProvider, LlmRequest, LlmResponse } from './llm.types';

/** Public AI API for the rest of the backend. Business services build the
 *  request and validate the response; this service only delegates to the
 *  configured provider, whose errors are thrown as standard NestJS exceptions. */
@Injectable()
export class AiService {
  constructor(
    @Inject('LLM_PROVIDER')
    private readonly provider: LlmProvider | null,
  ) {}

  generate(request: LlmRequest): Promise<LlmResponse> {
    if (!this.provider) {
      throw new ServiceUnavailableException('LLM provider is disabled');
    }
    return this.provider.generate(request);
  }
}