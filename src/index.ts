/**
 * trickle-json — incremental, zero-dependency partial-JSON parser for LLM streams.
 *
 * The core guarantee: `parsePartial` never throws on *truncated* input. It returns
 * the most-complete valid value that can be recovered from whatever has arrived so
 * far. Genuinely malformed input (not just incomplete) yields a best-effort value,
 * never an exception — so it is safe to call on every streamed chunk.
 */

/** Internal sentinel: "no usable value could be read at this position yet." */
const INCOMPLETE = Symbol("trickle-json/incomplete");

interface Cursor {
  s: string;
  i: number;
}

/**
 * Parse a (possibly truncated) JSON string into the best valid value available.
 *
 * - Empty / whitespace-only input → `undefined`.
 * - A truncated string value → the partial string decoded so far.
 * - A truncated object/array → only the members fully parsed so far; a trailing
 *   member whose value has not arrived is dropped rather than guessed.
 * - Never throws.
 */
export function parsePartial(input: string | null | undefined): unknown {
  if (input == null) return undefined;
  const c: Cursor = { s: input, i: 0 };
  skipWs(c);
  if (c.i >= c.s.length) return undefined;
  const v = parseValue(c);
  return v === INCOMPLETE ? undefined : v;
}

function skipWs(c: Cursor): void {
  while (c.i < c.s.length) {
    const ch = c.s[c.i];
    if (ch === " " || ch === "\n" || ch === "\t" || ch === "\r") c.i++;
    else break;
  }
}

function parseValue(c: Cursor): unknown {
  skipWs(c);
  if (c.i >= c.s.length) return INCOMPLETE;
  const ch = c.s[c.i];
  switch (ch) {
    case '"':
      return parseString(c);
    case "{":
      return parseObject(c);
    case "[":
      return parseArray(c);
    case "t":
    case "f":
      return parseBool(c);
    case "n":
      return parseNull(c);
    default:
      if (ch === "-" || (ch !== undefined && ch >= "0" && ch <= "9")) {
        return parseNumber(c);
      }
      return INCOMPLETE;
  }
}

function parseString(c: Cursor): string {
  // Assumes current char is the opening quote.
  c.i++;
  let out = "";
  while (c.i < c.s.length) {
    const ch = c.s[c.i++];
    if (ch === '"') return out; // closed
    if (ch === "\\") {
      if (c.i >= c.s.length) return out; // lone trailing backslash → drop
      const esc = c.s[c.i++];
      switch (esc) {
        case '"':
          out += '"';
          break;
        case "\\":
          out += "\\";
          break;
        case "/":
          out += "/";
          break;
        case "b":
          out += "\b";
          break;
        case "f":
          out += "\f";
          break;
        case "n":
          out += "\n";
          break;
        case "r":
          out += "\r";
          break;
        case "t":
          out += "\t";
          break;
        case "u": {
          const hex = c.s.slice(c.i, c.i + 4);
          if (hex.length < 4 || !/^[0-9a-fA-F]{4}$/.test(hex)) {
            // incomplete/invalid \u escape (likely truncation) → stop here
            return out;
          }
          out += String.fromCharCode(Number.parseInt(hex, 16));
          c.i += 4;
          break;
        }
        default:
          out += esc; // unknown escape: keep the char, best-effort
      }
    } else {
      out += ch;
    }
  }
  return out; // EOF before closing quote → partial string
}

const DIGIT = /[0-9]/;

function parseNumber(c: Cursor): number | typeof INCOMPLETE {
  const start = c.i;
  if (c.s[c.i] === "-") c.i++;
  while (c.i < c.s.length && DIGIT.test(c.s[c.i]!)) c.i++;
  if (c.s[c.i] === ".") {
    c.i++;
    while (c.i < c.s.length && DIGIT.test(c.s[c.i]!)) c.i++;
  }
  if (c.s[c.i] === "e" || c.s[c.i] === "E") {
    c.i++;
    if (c.s[c.i] === "+" || c.s[c.i] === "-") c.i++;
    while (c.i < c.s.length && DIGIT.test(c.s[c.i]!)) c.i++;
  }
  const raw = c.s.slice(start, c.i);
  const n = Number(raw);
  if (!Number.isNaN(n)) return n;
  // Truncated tokens like "-", "12.", "1e", "1e-": trim trailing non-digits.
  const trimmed = raw.replace(/[.\-+eE]+$/, "");
  if (trimmed === "" || trimmed === "-") return INCOMPLETE;
  const n2 = Number(trimmed);
  return Number.isNaN(n2) ? INCOMPLETE : n2;
}

function parseBool(c: Cursor): boolean | typeof INCOMPLETE {
  if (c.s.startsWith("true", c.i)) {
    c.i += 4;
    return true;
  }
  if (c.s.startsWith("false", c.i)) {
    c.i += 5;
    return false;
  }
  return INCOMPLETE; // partial literal (e.g. "tr") → not yet usable
}

function parseNull(c: Cursor): null | typeof INCOMPLETE {
  if (c.s.startsWith("null", c.i)) {
    c.i += 4;
    return null;
  }
  return INCOMPLETE;
}

function parseObject(c: Cursor): Record<string, unknown> {
  c.i++; // consume "{"
  const obj: Record<string, unknown> = {};
  for (;;) {
    skipWs(c);
    if (c.i >= c.s.length) return obj; // truncated
    const ch = c.s[c.i];
    if (ch === "}") {
      c.i++;
      return obj;
    }
    if (ch === ",") {
      c.i++;
      continue;
    }
    if (ch !== '"') return obj; // cannot read a key → stop, best-effort
    const key = parseString(c);
    skipWs(c);
    if (c.s[c.i] !== ":") return obj; // key with no colon yet → drop it
    c.i++; // consume ":"
    const val = parseValue(c);
    if (val === INCOMPLETE) return obj; // value not available yet → drop key
    obj[key] = val;
  }
}

function parseArray(c: Cursor): unknown[] {
  c.i++; // consume "["
  const arr: unknown[] = [];
  for (;;) {
    skipWs(c);
    if (c.i >= c.s.length) return arr;
    const ch = c.s[c.i];
    if (ch === "]") {
      c.i++;
      return arr;
    }
    if (ch === ",") {
      c.i++;
      continue;
    }
    const val = parseValue(c);
    if (val === INCOMPLETE) return arr;
    arr.push(val);
  }
}

// ---------------------------------------------------------------------------
// Streaming API
// ---------------------------------------------------------------------------

/** Metadata passed to a snapshot listener. */
export interface SnapshotMeta {
  /** True on the snapshot emitted by `end()`. */
  done: boolean;
}

export type SnapshotListener = (value: unknown, meta: SnapshotMeta) => void;
export type PathListener = (value: unknown) => void;

interface PathSub {
  path: string;
  cb: PathListener;
  last: string | undefined;
  seen: boolean;
}

/**
 * Feed streamed chunks and react as the value fills in.
 *
 * ```ts
 * const parser = new StreamingJsonParser();
 * parser.on("snapshot", (value) => render(value));
 * parser.on("path", "choices[0].message.content", (text) => appendToken(text));
 * for await (const chunk of stream) parser.write(chunk);
 * const final = parser.end();
 * ```
 *
 * v0.1 re-parses the accumulated buffer on every `write`, which is correct and
 * simple. A true incremental parser (reusing work across chunks) is tracked for
 * a later release — see ROADMAP.
 */
export class StreamingJsonParser {
  private buf = "";
  private snapshotListeners: SnapshotListener[] = [];
  private pathSubs: PathSub[] = [];

  on(event: "snapshot", cb: SnapshotListener): this;
  on(event: "path", path: string, cb: PathListener): this;
  on(event: "snapshot" | "path", a: SnapshotListener | string, b?: PathListener): this {
    if (event === "snapshot") {
      this.snapshotListeners.push(a as SnapshotListener);
    } else {
      this.pathSubs.push({ path: a as string, cb: b as PathListener, last: undefined, seen: false });
    }
    return this;
  }

  /** Append a chunk and emit updates. Returns the current best-effort value. */
  write(chunk: string): unknown {
    this.buf += chunk;
    return this.flush(false);
  }

  /** Finish the stream, emit a final snapshot, and return the final value. */
  end(): unknown {
    return this.flush(true);
  }

  /** The raw text accumulated so far. */
  get buffered(): string {
    return this.buf;
  }

  private flush(done: boolean): unknown {
    const value = parsePartial(this.buf);
    for (const l of this.snapshotListeners) l(value, { done });
    for (const sub of this.pathSubs) {
      const v = getPath(value, sub.path);
      if (v === undefined) continue;
      const ser = safeSerialize(v);
      if (!sub.seen || ser !== sub.last) {
        sub.seen = true;
        sub.last = ser;
        sub.cb(v);
      }
    }
    return value;
  }
}

/** Read a value at a dotted/indexed path, e.g. `"choices[0].message.content"`. */
export function getPath(obj: unknown, path: string): unknown {
  const tokens = path.match(/[^.[\]]+/g);
  if (!tokens) return obj;
  let cur: unknown = obj;
  for (const t of tokens) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[t];
  }
  return cur;
}

function safeSerialize(v: unknown): string {
  try {
    return JSON.stringify(v) ?? String(v);
  } catch {
    return String(v);
  }
}
