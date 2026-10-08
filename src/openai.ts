/**
 * trickle-json/openai — adapter for OpenAI-style streaming responses.
 *
 * Zero runtime dependencies: this accepts the shapes the OpenAI SDK yields
 * (an async iterable of chat-completion chunks) without importing the SDK.
 *
 * TODO(M4): raw SSE (`text/event-stream`) parsing + tool-call argument streams.
 */
import { StreamingJsonParser } from "./index.js";

interface OpenAIStreamChunk {
  choices?: Array<{ delta?: { content?: string | null } }>;
}

/** Extract the incremental `delta.content` text from an OpenAI chunk. */
export function contentDelta(chunk: OpenAIStreamChunk): string {
  return chunk.choices?.[0]?.delta?.content ?? "";
}

/**
 * Consume an OpenAI chat-completion stream whose concatenated `delta.content`
 * forms a JSON document, yielding the best-effort value after each chunk.
 *
 * ```ts
 * const stream = await openai.chat.completions.create({ stream: true, ... });
 * for await (const value of fromOpenAIStream(stream)) {
 *   render(value); // progressively more complete
 * }
 * ```
 */
export async function* fromOpenAIStream(
  stream: AsyncIterable<OpenAIStreamChunk>,
): AsyncGenerator<unknown> {
  const parser = new StreamingJsonParser();
  for await (const chunk of stream) {
    const delta = contentDelta(chunk);
    if (delta) yield parser.write(delta);
  }
  yield parser.end();
}
