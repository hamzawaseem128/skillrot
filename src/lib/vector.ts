/** Cosine similarity between two equal-length embedding vectors. */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;

  let dot = 0;
  let magA = 0;
  let magB = 0;

  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }

  const denominator = Math.sqrt(magA) * Math.sqrt(magB);
  return denominator === 0 ? 0 : dot / denominator;
}

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'is', 'are', 'was', 'were', 'be', 'been',
  'of', 'to', 'in', 'on', 'for', 'with', 'as', 'by', 'at', 'from', 'that', 'this',
  'it', 'its', 'what', 'how', 'why', 'when', 'where', 'which', 'who', 'does', 'do',
  'can', 'could', 'would', 'should', 'i', 'you', 'me', 'my', 'about', 'explain',
]);

/**
 * Keyword-overlap scoring used as a retrieval fallback when embeddings are
 * unavailable (no API key, quota exhausted, or an embedding call failed).
 *
 * This is deliberately kept as a real retrieval strategy rather than "return
 * the first N chunks" — the answer stays grounded in relevant source text and
 * the citations still point somewhere meaningful, which matters more for a
 * live demo than retrieval quality alone.
 */
export function keywordScore(query: string, text: string): number {
  const queryTerms = tokenize(query);
  if (queryTerms.length === 0) return 0;

  const textTerms = tokenize(text);
  if (textTerms.length === 0) return 0;

  const textCounts = new Map<string, number>();
  for (const term of textTerms) {
    textCounts.set(term, (textCounts.get(term) ?? 0) + 1);
  }

  let score = 0;
  for (const term of queryTerms) {
    const count = textCounts.get(term);
    if (count) {
      // Sub-linear term weighting so one repeated word can't dominate.
      score += 1 + Math.log(count);
    }
  }

  // Normalize by query length so scores stay comparable across questions.
  return score / queryTerms.length;
}

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((term) => term.length > 2 && !STOP_WORDS.has(term));
}
