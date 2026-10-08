/**
 * trickle-json/zod — typed partial parsing.
 *
 * `zod` is an optional peer dependency; it is only required if you import this
 * entry point. The core (`trickle-json`) stays zero-dependency.
 */
import { parsePartial } from "./index.js";

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
 * value validates. For progressive typing of in-flight data, validate against a
 * `.partial()` / `.deepPartial()` schema.
 *
 * TODO(M4): emit typed partial snapshots directly (schema-aware coercion).
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
