/**
 * trickle-json/anthropic — adapter for Anthropic (Claude) streaming responses.
 *
 * Zero runtime dependencies: accepts the event shapes the Anthropic SDK yields
 * without importing the SDK.
 *
 * TODO(M4): tool-use (`input_json_delta`) partial-argument streaming.
 */
import { StreamingJsonParser } from "./index.js";

interface AnthropicStreamEvent {
  type?: string;
  delta?: { type?: string; text?: string };
}

/** Extract incremental text from an Anthropic `content_block_delta` event. */
export function textDelta(event: AnthropicStreamEvent): string {
  if (event.type === "content_block_delta" && event.delta?.type === "text_delta") {
    return event.delta.text ?? "";
  }
  return "";
}

/**
 * Consume an Anthropic message stream whose concatenated text deltas form a
 * JSON document, yielding the best-effort value after each event.
 */
export async function* fromAnthropicStream(
  stream: AsyncIterable<AnthropicStreamEvent>,
): AsyncGenerator<unknown> {
  const parser = new StreamingJsonParser();
  for await (const event of stream) {
    const delta = textDelta(event);
    if (delta) yield parser.write(delta);
  }
  yield parser.end();
}
