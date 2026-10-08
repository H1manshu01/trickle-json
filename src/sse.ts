/**
 * A tiny, zero-dependency Server-Sent Events (`text/event-stream`) parser.
 *
 * Both OpenAI and Anthropic deliver streaming responses as SSE over the HTTP
 * body. This turns a stream of text/byte chunks (e.g. `response.body`) into
 * discrete events, buffering across chunk boundaries so a split mid-line — or
 * mid-UTF-8-sequence — is handled correctly.
 */

export interface SSEEvent {
  /** The `event:` field, if present. */
  event?: string;
  /** The joined `data:` payload (multiple data lines joined with "\n"). */
  data: string;
  /** The `id:` field, if present. */
  id?: string;
}

/** Parse a stream of chunks into SSE events. */
export async function* parseSSE(
  source: AsyncIterable<string | Uint8Array>,
): AsyncGenerator<SSEEvent> {
  const decoder = new TextDecoder();
  let buf = "";
  let dataLines: string[] = [];
  let eventName: string | undefined;
  let id: string | undefined;

  const take = (): SSEEvent | null => {
    if (dataLines.length === 0) {
      eventName = undefined;
      id = undefined;
      return null;
    }
    const ev: SSEEvent = { data: dataLines.join("\n") };
    if (eventName !== undefined) ev.event = eventName;
    if (id !== undefined) ev.id = id;
    dataLines = [];
    eventName = undefined;
    id = undefined;
    return ev;
  };

  const handleLine = (raw: string): SSEEvent | null => {
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    if (line === "") return take(); // blank line dispatches the event
    if (line.startsWith(":")) return null; // comment
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "data") dataLines.push(value);
    else if (field === "event") eventName = value;
    else if (field === "id") id = value;
    return null;
  };

  for await (const chunk of source) {
    buf += typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true });
    let nl: number;
    // biome-ignore lint/suspicious/noAssignInExpressions: scanning complete lines
    while ((nl = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      const ev = handleLine(line);
      if (ev) yield ev;
    }
  }

  // Flush any trailing bytes and a final event that lacked a terminating blank line.
  buf += decoder.decode();
  for (const line of buf.split("\n")) {
    const ev = handleLine(line);
    if (ev) yield ev;
  }
  const last = take();
  if (last) yield last;
}
