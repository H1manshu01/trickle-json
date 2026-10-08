/**
 * A resumable, char-at-a-time incremental JSON parser.
 *
 * Unlike `parsePartial` (which re-scans a whole string), this consumes input one
 * character at a time, keeps its parse state across calls, and mutates a live
 * value tree in place. Feeding N characters total costs O(N) — regardless of how
 * they are split into chunks — so streaming does not degrade to O(N²).
 *
 * Invariant (verified by tests): after feeding any prefix P of an input,
 * `snapshot()` deep-equals `parsePartial(P)`.
 *
 * Note on strings: an in-progress string is re-assigned into the tree as it
 * grows. V8 represents `s += ch` as a cons-string (O(1) append), flattened lazily
 * only when the value is actually read, so this stays effectively linear.
 */

// Parser states.
const S_VALUE = 0; // expecting the start of a value (target is set)
const S_KEY = 1; // object: expecting a key string or "}"
const S_COLON = 2; // object: expecting ":"
const S_AFTER = 3; // just finished a value: expecting "," / closer / unwind
const S_STR = 4; // inside a string
const S_STR_ESC = 5; // inside a string, just saw "\"
const S_STR_UNI = 6; // inside a string, collecting \uXXXX
const S_NUM = 7; // inside a number
const S_LIT = 8; // inside true / false / null
const S_DEAD = 9; // unparseable trailing input: ignore everything

// Number sub-phases.
const N_SIGN = 0;
const N_INT = 1;
const N_FRAC = 2;
const N_E = 3;
const N_ESIGN = 4;
const N_EDIG = 5;

// Target container kinds.
const T_ROOT = 0;
const T_ARRAY = 1;
const T_OBJECT = 2;

interface ArrFrame {
  kind: 1;
  ref: unknown[];
}
interface ObjFrame {
  kind: 2;
  ref: Record<string, unknown>;
}
type Frame = ArrFrame | ObjFrame;

function isWs(ch: string): boolean {
  return ch === " " || ch === "\n" || ch === "\t" || ch === "\r";
}
function isDigit(ch: string): boolean {
  return ch >= "0" && ch <= "9";
}
function isHex(ch: string): boolean {
  return (ch >= "0" && ch <= "9") || (ch >= "a" && ch <= "f") || (ch >= "A" && ch <= "F");
}

export class IncrementalParser {
  private state = S_VALUE;
  private stack: Frame[] = [];

  private root: unknown;
  private rootSet = false;

  // Current write target (where a starting value is committed).
  private tKind = T_ROOT;
  private tArr: unknown[] | null = null;
  private tIdx = 0;
  private tObj: Record<string, unknown> | null = null;
  private tKey = "";

  // Scalar accumulators.
  private strBuf = ""; // string value content
  private keyBuf = ""; // object key content
  private strIsKey = false;
  private uniBuf = "";
  private numBuf = "";
  private numPhase = N_INT;
  private litStr = "";
  private litLen = 0;

  /** Feed a chunk of input. */
  writeChunk(chunk: string): void {
    for (let i = 0; i < chunk.length; i++) {
      const ch = chunk[i]!;
      let guard = 0;
      // A handler may choose not to consume (reprocess under a new state after
      // unwinding). Each such step changes state or pops a frame, so the number
      // of reprocesses per char is bounded by the stack depth.
      while (!this.step(ch)) {
        if (++guard > this.stack.length + 4) {
          this.state = S_DEAD;
          break;
        }
      }
    }
  }

  /** The best-effort value parsed so far (live reference for containers). */
  snapshot(): unknown {
    return this.rootSet ? this.root : undefined;
  }

  private put(v: unknown): void {
    if (this.tKind === T_ROOT) {
      this.root = v;
      this.rootSet = true;
    } else if (this.tKind === T_ARRAY) {
      this.tArr![this.tIdx] = v;
    } else {
      this.tObj![this.tKey] = v;
    }
  }

  /** Point the write target at the next slot of the current container. */
  private targetForCurrentContainer(): void {
    const top = this.stack[this.stack.length - 1];
    if (!top) {
      this.tKind = T_ROOT;
    } else if (top.kind === T_ARRAY) {
      this.tKind = T_ARRAY;
      this.tArr = top.ref;
      this.tIdx = top.ref.length;
    } else {
      // object value target is set when the colon is consumed (needs the key)
      this.tKind = T_OBJECT;
      this.tObj = top.ref;
    }
  }

  private closeContainer(): void {
    this.stack.pop();
    this.state = S_AFTER;
  }

  /** Process one char. Returns true if the char was consumed. */
  private step(ch: string): boolean {
    switch (this.state) {
      case S_VALUE:
        return this.stValue(ch);
      case S_KEY:
        return this.stKey(ch);
      case S_COLON:
        return this.stColon(ch);
      case S_AFTER:
        return this.stAfter(ch);
      case S_STR:
        return this.stStr(ch);
      case S_STR_ESC:
        return this.stStrEsc(ch);
      case S_STR_UNI:
        return this.stStrUni(ch);
      case S_NUM:
        return this.stNum(ch);
      case S_LIT:
        return this.stLit(ch);
      default:
        return true; // S_DEAD: swallow
    }
  }

  private stValue(ch: string): boolean {
    if (isWs(ch)) return true;
    const top = this.stack[this.stack.length - 1];

    switch (ch) {
      case '"':
        this.put("");
        this.strBuf = "";
        this.strIsKey = false;
        this.state = S_STR;
        return true;
      case "{": {
        const obj: Record<string, unknown> = {};
        this.put(obj);
        this.stack.push({ kind: 2, ref: obj });
        this.state = S_KEY;
        return true;
      }
      case "[": {
        const arr: unknown[] = [];
        this.put(arr);
        this.stack.push({ kind: 1, ref: arr });
        this.targetForCurrentContainer(); // target = arr[0]
        this.state = S_VALUE;
        return true;
      }
      case "t":
      case "f":
      case "n":
        this.litStr = ch === "t" ? "true" : ch === "f" ? "false" : "null";
        this.litLen = 1;
        this.state = S_LIT;
        return true;
      default:
        if (ch === "-" || isDigit(ch)) {
          this.numBuf = ch;
          this.numPhase = ch === "-" ? N_SIGN : N_INT;
          this.state = S_NUM;
          this.commitNumber();
          return true;
        }
        // Not a value start. An empty array closes here; otherwise unwind.
        if (top && top.kind === T_ARRAY && ch === "]") {
          this.closeContainer();
          return true;
        }
        if (top && top.kind === T_OBJECT && ch === "}") {
          // "{...:}" — pending key had no value; drop it and close.
          this.closeContainer();
          return true;
        }
        if (top && top.kind === T_ARRAY && ch === ",") {
          return true; // tolerate stray comma before an element
        }
        // Drop the (absent) value and let an ancestor handle this char.
        this.state = S_AFTER;
        return false;
    }
  }

  private stKey(ch: string): boolean {
    if (isWs(ch)) return true;
    if (ch === "}") {
      this.closeContainer();
      return true;
    }
    if (ch === ",") return true; // tolerate stray comma
    if (ch === '"') {
      this.keyBuf = "";
      this.strIsKey = true;
      this.state = S_STR;
      return true;
    }
    // No key available → object is done; unwind and reprocess.
    this.closeContainer();
    return false;
  }

  private stColon(ch: string): boolean {
    if (isWs(ch)) return true;
    if (ch === ":") {
      this.tKind = T_OBJECT;
      this.tObj = (this.stack[this.stack.length - 1] as ObjFrame).ref;
      this.tKey = this.keyBuf;
      this.state = S_VALUE;
      return true;
    }
    // Key with no colon → drop it; object done; unwind and reprocess.
    this.closeContainer();
    return false;
  }

  private stAfter(ch: string): boolean {
    if (isWs(ch)) return true;
    const top = this.stack[this.stack.length - 1];

    if (!top) {
      // Top-level value complete; trailing content is ignored.
      this.state = S_DEAD;
      return true;
    }

    if (top.kind === T_ARRAY) {
      if (ch === "]") {
        this.closeContainer();
        return true;
      }
      if (ch === ",") {
        this.targetForCurrentContainer();
        this.state = S_VALUE;
        return true;
      }
      if (ch === "}") {
        // wrong closer: close this array implicitly, let parent handle it
        this.closeContainer();
        return false;
      }
      // missing comma before another element (arrays are lenient)
      if (
        ch === '"' ||
        ch === "{" ||
        ch === "[" ||
        ch === "t" ||
        ch === "f" ||
        ch === "n" ||
        ch === "-" ||
        isDigit(ch)
      ) {
        this.targetForCurrentContainer();
        this.state = S_VALUE;
        return false;
      }
      // garbage: array is done; unwind and reprocess
      this.closeContainer();
      return false;
    }

    // object
    if (ch === "}") {
      this.closeContainer();
      return true;
    }
    if (ch === ",") {
      this.state = S_KEY;
      return true;
    }
    if (ch === '"') {
      // missing comma before next key
      this.state = S_KEY;
      return false;
    }
    if (ch === "]") {
      // wrong closer: close this object implicitly, let parent handle it
      this.closeContainer();
      return false;
    }
    // garbage: object is done; unwind and reprocess
    this.closeContainer();
    return false;
  }

  private stStr(ch: string): boolean {
    if (ch === '"') {
      if (this.strIsKey) {
        this.state = S_COLON;
      } else {
        this.state = S_AFTER;
      }
      return true;
    }
    if (ch === "\\") {
      this.state = S_STR_ESC;
      return true;
    }
    this.appendStr(ch);
    return true;
  }

  private stStrEsc(ch: string): boolean {
    switch (ch) {
      case '"':
        this.appendStr('"');
        break;
      case "\\":
        this.appendStr("\\");
        break;
      case "/":
        this.appendStr("/");
        break;
      case "b":
        this.appendStr("\b");
        break;
      case "f":
        this.appendStr("\f");
        break;
      case "n":
        this.appendStr("\n");
        break;
      case "r":
        this.appendStr("\r");
        break;
      case "t":
        this.appendStr("\t");
        break;
      case "u":
        this.uniBuf = "";
        this.state = S_STR_UNI;
        return true;
      default:
        this.appendStr(ch); // unknown escape: keep the char
    }
    this.state = S_STR;
    return true;
  }

  private stStrUni(ch: string): boolean {
    if (isHex(ch)) {
      this.uniBuf += ch;
      if (this.uniBuf.length === 4) {
        this.appendStr(String.fromCharCode(Number.parseInt(this.uniBuf, 16)));
        this.state = S_STR;
      }
      return true;
    }
    // Invalid \u escape (pathological, not simple truncation): end the string,
    // dropping the partial escape, and let an ancestor handle this char.
    this.state = S_AFTER;
    return false;
  }

  private appendStr(decoded: string): void {
    if (this.strIsKey) {
      this.keyBuf += decoded;
    } else {
      this.strBuf += decoded;
      this.put(this.strBuf);
    }
  }

  private stNum(ch: string): boolean {
    switch (this.numPhase) {
      case N_SIGN:
        if (isDigit(ch)) {
          this.numBuf += ch;
          this.numPhase = N_INT;
          this.commitNumber();
          return true;
        }
        return this.endNumber();
      case N_INT:
        if (isDigit(ch)) {
          this.numBuf += ch;
          this.commitNumber();
          return true;
        }
        if (ch === ".") {
          this.numBuf += ch;
          this.numPhase = N_FRAC;
          this.commitNumber();
          return true;
        }
        if (ch === "e" || ch === "E") {
          this.numBuf += ch;
          this.numPhase = N_E;
          this.commitNumber();
          return true;
        }
        return this.endNumber();
      case N_FRAC:
        if (isDigit(ch)) {
          this.numBuf += ch;
          this.commitNumber();
          return true;
        }
        if (ch === "e" || ch === "E") {
          this.numBuf += ch;
          this.numPhase = N_E;
          this.commitNumber();
          return true;
        }
        return this.endNumber();
      case N_E:
        if (ch === "+" || ch === "-") {
          this.numBuf += ch;
          this.numPhase = N_ESIGN;
          this.commitNumber();
          return true;
        }
        if (isDigit(ch)) {
          this.numBuf += ch;
          this.numPhase = N_EDIG;
          this.commitNumber();
          return true;
        }
        return this.endNumber();
      case N_ESIGN:
        if (isDigit(ch)) {
          this.numBuf += ch;
          this.numPhase = N_EDIG;
          this.commitNumber();
          return true;
        }
        return this.endNumber();
      default: // N_EDIG
        if (isDigit(ch)) {
          this.numBuf += ch;
          this.commitNumber();
          return true;
        }
        return this.endNumber();
    }
  }

  private endNumber(): boolean {
    // Value already provisionally committed; the terminator is for an ancestor.
    this.state = S_AFTER;
    return false;
  }

  /** Commit the best-effort value of `numBuf` — identical policy to parsePartial. */
  private commitNumber(): void {
    const n = Number(this.numBuf);
    if (Number.isFinite(n)) {
      this.put(n);
      return;
    }
    const trimmed = this.numBuf.replace(/[.\-+eE]+$/, "");
    if (trimmed === "" || trimmed === "-") return;
    const n2 = Number(trimmed);
    if (Number.isFinite(n2)) this.put(n2);
  }

  private stLit(ch: string): boolean {
    const expected = this.litStr[this.litLen];
    if (ch === expected) {
      this.litLen++;
      if (this.litLen === this.litStr.length) {
        this.put(this.litStr === "true" ? true : this.litStr === "false" ? false : null);
        this.state = S_AFTER;
      }
      return true;
    }
    // Divergent literal → drop the value; let an ancestor handle this char.
    this.state = S_AFTER;
    return false;
  }
}
