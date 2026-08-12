import { askWithContextStream, type RetrievedContext } from '@/lib/gemini';
import { askWithContextStreamGrok, isGrokConfigured } from '@/lib/grok';
import { retrieveRelevantChunks } from '@/lib/retrieval';
import { handleRouteError, jsonError, requireOwnedMaterial } from '@/lib/api-utils';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/materials/[id]/chat — streaming RAG answer.
 *
 * Emits newline-delimited JSON events so the client can render tokens as they
 * arrive and still receive structured citations:
 *
 *   {"type":"citations","citations":[...],"strategy":"pgvector"}
 *   {"type":"delta","text":"Containers are "}
 *   {"type":"done"}
 *
 * Citations are sent FIRST, before any token: retrieval has already finished by
 * then, and the UI can show the source badges while the answer is still
 * arriving. An `error` event is emitted in-band because once streaming has
 * begun the HTTP status is already committed to 200.
 */
export async function POST(request: Request, context: RouteContext<'/api/materials/[id]/chat'>) {
  try {
    const { id } = await context.params;
    const { question, user_id } = await request.json();

    if (typeof question !== 'string' || !question.trim()) {
      return jsonError('question is required.');
    }

    const owned = await requireOwnedMaterial(id, user_id);
    if (!owned.ok) return owned.response;

    const { contexts, strategy } = await retrieveRelevantChunks(
      id,
      question.trim(),
      owned.material.source_unit,
    );

    const encoder = new TextEncoder();
    const send = (payload: unknown) => encoder.encode(`${JSON.stringify(payload)}\n`);

    const stream = new ReadableStream({
      async start(controller) {
        try {
          if (contexts.length === 0) {
            controller.enqueue(send({ type: 'citations', citations: [], strategy }));
            controller.enqueue(
              send({ type: 'delta', text: "I couldn't find that in your uploaded material." }),
            );
            controller.enqueue(send({ type: 'done' }));
            return;
          }

          controller.enqueue(
            send({
              type: 'citations',
              strategy,
              citations: contexts.map((c) => ({
                chunk_index: c.chunk_index,
                label: c.label,
                // Long enough for the student to actually verify the claim when
                // they open the source panel, not just a tooltip teaser.
                text_preview: truncate(c.chunk_text, 700),
              })),
            }),
          );

          for await (const event of streamAnswer(question.trim(), contexts)) {
            controller.enqueue(send(event));
          }

          controller.enqueue(send({ type: 'done' }));
        } catch (error) {
          console.error('[chat stream]', error);
          controller.enqueue(
            send({
              type: 'error',
              error: error instanceof Error ? error.message : 'The answer stream failed.',
            }),
          );
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'application/x-ndjson; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        // Stops proxies (and Vercel's edge) from buffering the stream.
        'X-Accel-Buffering': 'no',
      },
    });
  } catch (error) {
    return handleRouteError('Chat', error);
  }
}

/**
 * Generates the answer on Grok when configured, falling back to Gemini.
 *
 * The fallback matters because a configured key is not the same as a usable
 * one — an xAI team without credits returns 403 on every request. Without this,
 * merely setting GROK_API_KEY would break chat entirely rather than moving it.
 *
 * The switch is only safe before the first token is emitted: once the client
 * has rendered part of an answer, restarting on another model would corrupt it.
 * Pulling `next()` explicitly forces the connection to happen here, where a
 * failure is still recoverable.
 */
async function* streamAnswer(
  question: string,
  contexts: RetrievedContext[],
): AsyncGenerator<{ type: string; text?: string; generator?: string }> {
  if (isGrokConfigured()) {
    try {
      const grok = askWithContextStreamGrok(question, contexts);
      const first = await grok.next();

      yield { type: 'generator', generator: 'grok' };
      if (!first.done && first.value) yield { type: 'delta', text: first.value };
      for await (const delta of grok) yield { type: 'delta', text: delta };
      return;
    } catch (error) {
      console.error('[chat] Grok unavailable, falling back to Gemini:', error);
    }
  }

  yield { type: 'generator', generator: 'gemini' };
  for await (const delta of askWithContextStream(question, contexts)) {
    yield { type: 'delta', text: delta };
  }
}

function truncate(text: string, maxChars: number): string {
  const trimmed = text.trim();
  return trimmed.length <= maxChars ? trimmed : `${trimmed.slice(0, maxChars).trimEnd()}…`;
}
