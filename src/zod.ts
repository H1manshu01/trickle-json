/**
 * trickle-json/zod — typed partial parsing.
 *
 * `zod` is an optional peer dependency; it is only required if you call
 * `parsePartialZod`. The typed helpers below are schema-agnostic and need no
 * runtime dependency — the core (`trickle-json`) stays zero-dependency.
 */
import { StreamingJsonParser, parsePartial } from "./index.js";

/** A value where every property (recursively) may be absent — a streaming partial. */
export type DeepPartial<T> = T extends Array<infer U>
  ? Array<DeepPartial<U>>
  : T extends object
    ? { [K in keyof T]?: DeepPartial<T[K]> }
    : T;

/**
 * Parse partial JSON, typed as a deep-partial of `T`. Never throws on truncation.
 *
 * ```ts
 * import type { z } from "zod";
 * const value = parsePartialTyped<z.infer<typeof Schema>>(input);
 * //    ^? DeepPartial<...> — safe to read while the stream is still arriving
 * ```
 */
export function parsePartialTyped<T>(input: string | null | undefined): DeepPartial<T> {
  return parsePartial(input) as DeepPartial<T>;
}

/** A `StreamingJsonParser` whose snapshots are typed as `DeepPartial<T>`. */
export class TypedStreamingParser<T> {
  private readonly parser = new StreamingJsonParser();

  write(chunk: string): DeepPartial<T> {
    return this.parser.write(chunk) as DeepPartial<T>;
  }
  end(): DeepPartial<T> {
    return this.parser.end() as DeepPartial<T>;
  }
  snapshot(): DeepPartial<T> {
    return this.parser.snapshot() as DeepPartial<T>;
  }
  get buffered(): string {
    return this.parser.buffered;
  }
}

/** Minimal shape of a Zod schema we rely on — avoids a hard type dependency. */
export interface ZodLike<T> {
  safeParse(data: unknown): { success: true; data: T } | { success: false };
}

export interface PartialZodResult<T> {
  /** The raw best-effort value parsed from the (possibly truncated) input. */
  raw: unknown;
  /** The schema-validated value, if the partial value already satisfies it. */
  data: T | undefined;
  /** Whether `data` is present. */
  valid: boolean;
}

/**
 * Parse partial JSON and validate it against a Zod schema.
 *
 * Partial data will often not satisfy a strict schema until the stream is
 * complete, so `raw` is always returned and `data` is populated only once the
 * value validates. For progressive validation of in-flight data, pass a
 * `.partial()` / `.deepPartial()` schema.
 */
export function parsePartialZod<T>(
  input: string | null | undefined,
  schema: ZodLike<T>,
): PartialZodResult<T> {
  const raw = parsePartial(input);
  const result = schema.safeParse(raw);
  return result.success
    ? { raw, data: result.data, valid: true }
    : { raw, data: undefined, valid: false };
}
