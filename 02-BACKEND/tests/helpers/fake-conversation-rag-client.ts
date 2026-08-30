import type {
  RetrievalSearchRequest,
  RetrievalSearchResult,
} from '../../src/modules/rag/rag.types';

export class FakeConversationRagClient {
  searchCalls: Array<{ request: RetrievalSearchRequest; correlationId: string }> = [];
  nextSearchResult: RetrievalSearchResult = {
    status: 'not_enough_evidence',
    correlationId: 'corr-1',
    chunks: [],
  };
  async search(
    request: RetrievalSearchRequest,
    correlationId: string,
  ): Promise<RetrievalSearchResult> {
    this.searchCalls.push({ request, correlationId });
    return { ...this.nextSearchResult, correlationId };
  }

}
