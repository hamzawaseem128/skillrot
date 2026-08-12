import { labelForChunk } from './chunker';
import { embedQuery, isGeminiConfigured, type RetrievedContext } from './gemini';
import type { SourceUnit } from './pdf-extract';
import { getChunks, matchChunksByEmbedding, type StoredChunk } from './store';
import { cosineSimilarity, keywordScore } from './vector';

export interface RetrievalResult {
  contexts: RetrievedContext[];
  strategy: 'pgvector' | 'vector' | 'keyword';
}

/**
 * Retrieves the chunks most relevant to a question (PRD §7.4 step 3).
 *
 * Three tiers, each falling back to the next:
 *
 *  1. `pgvector` — cosine distance computed in Postgres via the
 *     `match_material_chunks` RPC. The intended production path.
 *  2. `vector` — the same cosine similarity computed in-process, used when
 *     Supabase isn't configured or the RPC hasn't been created.
 *  3. `keyword` — term-overlap scoring when no embeddings exist at all (no API
 *     key, a failed embedding pass, or a quota error mid-demo).
 *
 * The last tier is a real retrieval strategy rather than "return the first N
 * chunks", so answers stay grounded and citations still point at relevant text.
 */
export async function retrieveRelevantChunks(
  materialId: string,
  question: string,
  unit: SourceUnit = 'page',
  topK = 4,
): Promise<RetrievalResult> {
  const toContext = (chunk: StoredChunk): RetrievedContext => ({
    chunk_index: chunk.chunk_index,
    chunk_text: chunk.chunk_text,
    label: labelForChunk(chunk, unit),
  });

  const chunks = await getChunks(materialId);
  if (chunks.length === 0) return { contexts: [], strategy: 'keyword' };

  const embedded = chunks.filter((chunk) => Array.isArray(chunk.embedding) && chunk.embedding.length > 0);

  if (embedded.length > 0 && isGeminiConfigured()) {
    try {
      const questionEmbedding = await embedQuery(question);

      const fromDatabase = await matchChunksByEmbedding(materialId, questionEmbedding, topK);
      if (fromDatabase && fromDatabase.length > 0) {
        return { contexts: fromDatabase.map(toContext), strategy: 'pgvector' };
      }

      const ranked = embedded
        .map((chunk) => ({ chunk, score: cosineSimilarity(questionEmbedding, chunk.embedding!) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, topK);

      return { contexts: ranked.map(({ chunk }) => toContext(chunk)), strategy: 'vector' };
    } catch (error) {
      console.error('[retrieval] vector search failed, using keyword fallback:', error);
    }
  }

  const ranked = chunks
    .map((chunk) => ({ chunk, score: keywordScore(question, chunk.chunk_text) }))
    .sort((a, b) => b.score - a.score);

  // If nothing overlaps the question at all, still return the opening chunks so
  // the model has something to ground a "not in your material" response against.
  const selected = ranked[0]?.score > 0 ? ranked.filter((r) => r.score > 0) : ranked;

  return { contexts: selected.slice(0, topK).map(({ chunk }) => toContext(chunk)), strategy: 'keyword' };
}
