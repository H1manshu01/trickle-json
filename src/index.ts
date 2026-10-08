/**
 * trickle-json — incremental, zero-dependency partial-JSON parser for LLM streams.
 *
 * The core guarantee: `parsePartial` never throws on *truncated* input. It returns
 * the most-complete valid value that can be recovered from whatever has arrived so
 * far. Genuinely malformed input (not just incomplete) yields a best-effort value,
 * never an exception — so it is safe to call on every streamed chunk.
 */

import { IncrementalParser } from "./incremental.js";

export { IncrementalParser } from "./incremental.js";

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

/** The concrete location of a matched value, e.g. `["items", 0, "id"]`. */
export type PathSegments = Array<string | number>;

export type SnapshotListener = (value: unknown, meta: SnapshotMeta) => void;
/** `segments` is the concrete path matched (useful when the path has wildcards). */
export type PathListener = (value: unknown, segments: PathSegments) => void;
/** Fired once per array element as it first appears. */
export type AppendListener = (item: unknown, index: number, segments: PathSegments) => void;

export interface ListenerOptions {
  /** Remove the subscription after it fires once. */
  once?: boolean;
}

/** Remove a subscription. Safe to call more than once. */
export type Unsubscribe = () => void;

interface SnapSub {
  cb: SnapshotListener;
  once: boolean;
  dead: boolean;
}

interface PathSub {
  tokens: string[];
  cb: PathListener;
  once: boolean;
  dead: boolean;
  seen: Map<string, string>; // concrete-path key → last serialized value
}

interface AppendSub {
  tokens: string[];
  cb: AppendListener;
  once: boolean;
  dead: boolean;
  lens: Map<string, number>; // concrete array-path key → last seen length
}

interface Match {
  segments: PathSegments;
  value: unknown;
}

/**
 * Feed streamed chunks and react as the value fills in.
 *
 * ```ts
 * const parser = new StreamingJsonParser();
 * parser.on("snapshot", (value) => render(value));
 * parser.on("path", "choices[0].message.content", (text) => appendToken(text));
 * parser.on("path", "items[*].id", (id, segments) => console.log(segments, id));
 * const stop = parser.on("append", "items", (item, i) => addRow(i, item));
 * for await (const chunk of stream) parser.write(chunk);
 * parser.end();
 * stop(); // unsubscribe
 * ```
 *
 * Paths use dotted/indexed syntax with `*` as a wildcard for any key or index
 * (`items[*].id`, `choices[*].message.content`, `data.*`). Each `on` call
 * returns an {@link Unsubscribe} function.
 *
 * Backed by a true incremental parser: each character is processed exactly once
 * across all `write` calls, so total work is O(input length) regardless of how
 * the input is chunked (no per-chunk re-parsing of the whole buffer).
 */
export class StreamingJsonParser {
  private engine = new IncrementalParser();
  private buf = "";
  private snapSubs: SnapSub[] = [];
  private pathSubs: PathSub[] = [];
  private appendSubs: AppendSub[] = [];

  on(event: "snapshot", cb: SnapshotListener, opts?: ListenerOptions): Unsubscribe;
  on(event: "path", path: string, cb: PathListener, opts?: ListenerOptions): Unsubscribe;
  on(event: "append", path: string, cb: AppendListener, opts?: ListenerOptions): Unsubscribe;
  on(
    event: "snapshot" | "path" | "append",
    a: SnapshotListener | string,
    b?: PathListener | AppendListener | ListenerOptions,
    c?: ListenerOptions,
  ): Unsubscribe {
    if (event === "snapshot") {
      const sub: SnapSub = {
        cb: a as SnapshotListener,
        once: (b as ListenerOptions | undefined)?.once ?? false,
        dead: false,
      };
      this.snapSubs.push(sub);
      return () => {
        sub.dead = true;
      };
    }
    const tokens = tokenizePath(a as string);
    const once = c?.once ?? false;
    if (event === "path") {
      const sub: PathSub = { tokens, cb: b as PathListener, once, dead: false, seen: new Map() };
      this.pathSubs.push(sub);
      return () => {
        sub.dead = true;
      };
    }
    const sub: AppendSub = { tokens, cb: b as AppendListener, once, dead: false, lens: new Map() };
    this.appendSubs.push(sub);
    return () => {
      sub.dead = true;
    };
  }

  /** Append a chunk and emit updates. Returns the current best-effort value. */
  write(chunk: string): unknown {
    this.buf += chunk;
    this.engine.writeChunk(chunk);
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
    const value = this.engine.snapshot();

    for (const sub of this.snapSubs) {
      if (sub.dead) continue;
      sub.cb(value, { done });
      if (sub.once) sub.dead = true;
    }

    for (const sub of this.pathSubs) {
      if (sub.dead) continue;
      for (const m of collect(value, sub.tokens)) {
        if (m.value === undefined) continue;
        const key = segKey(m.segments);
        const ser = safeSerialize(m.value);
        if (sub.seen.get(key) !== ser) {
          sub.seen.set(key, ser);
          sub.cb(m.value, m.segments);
          if (sub.once) {
            sub.dead = true;
            break;
          }
        }
      }
    }

    for (const sub of this.appendSubs) {
      if (sub.dead) continue;
      let fired = false;
      for (const m of collect(value, sub.tokens)) {
        if (!Array.isArray(m.value)) continue;
        const key = segKey(m.segments);
        const prev = sub.lens.get(key) ?? 0;
        if (m.value.length > prev) {
          for (let i = prev; i < m.value.length; i++) {
            sub.cb(m.value[i], i, [...m.segments, i]);
            fired = true;
            if (sub.once) break;
          }
          sub.lens.set(key, m.value.length);
        }
        if (sub.once && fired) break;
      }
      if (sub.once && fired) sub.dead = true;
    }

    this.sweep();
    return value;
  }

  private sweep(): void {
    if (this.snapSubs.some((s) => s.dead)) this.snapSubs = this.snapSubs.filter((s) => !s.dead);
    if (this.pathSubs.some((s) => s.dead)) this.pathSubs = this.pathSubs.filter((s) => !s.dead);
    if (this.appendSubs.some((s) => s.dead))
      this.appendSubs = this.appendSubs.filter((s) => !s.dead);
  }
}

/** Split a path into segment tokens; `*` is a wildcard. e.g. `a.b[0].c` → [a,b,0,c]. */
function tokenizePath(path: string): string[] {
  return path.match(/[^.[\]]+/g) ?? [];
}

function segKey(segments: PathSegments): string {
  return segments.join("\u0000");
}

/** Read the single value at a concrete (wildcard-free) path, e.g. `"a.b[0].c"`. */
export function getPath(obj: unknown, path: string): unknown {
  const tokens = tokenizePath(path);
  let cur: unknown = obj;
  for (const t of tokens) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[t];
  }
  return cur;
}

/** Resolve a (possibly wildcard) path against a value into all concrete matches. */
function collect(root: unknown, tokens: string[]): Match[] {
  const out: Match[] = [];
  walk(root, tokens, 0, [], out);
  return out;
}

function walk(node: unknown, tokens: string[], i: number, segs: PathSegments, out: Match[]): void {
  if (i === tokens.length) {
    out.push({ segments: segs.slice(), value: node });
    return;
  }
  if (node == null || typeof node !== "object") return;
  const tok = tokens[i]!;

  if (tok === "*") {
    if (Array.isArray(node)) {
      for (let k = 0; k < node.length; k++) {
        segs.push(k);
        walk(node[k], tokens, i + 1, segs, out);
        segs.pop();
      }
    } else {
      for (const key of Object.keys(node)) {
        segs.push(key);
        walk((node as Record<string, unknown>)[key], tokens, i + 1, segs, out);
        segs.pop();
      }
    }
    return;
  }

  if (Array.isArray(node)) {
    const idx = Number(tok);
    if (!Number.isInteger(idx) || idx < 0 || idx >= node.length) return;
    segs.push(idx);
    walk(node[idx], tokens, i + 1, segs, out);
    segs.pop();
  } else {
    if (!(tok in (node as Record<string, unknown>))) return;
    segs.push(tok);
    walk((node as Record<string, unknown>)[tok], tokens, i + 1, segs, out);
    segs.pop();
  }
}

function safeSerialize(v: unknown): string {
  try {
    return JSON.stringify(v) ?? String(v);
  } catch {
    return String(v);
  }
}
