/**
 * Failure classification for every RPC and wallet call.
 *
 * Two questions decide what the UI is allowed to do next:
 *
 *   1. What went wrong, in words a person can act on?
 *   2. Was a transaction broadcast before it went wrong?
 *
 * Question 2 is the important one. If nothing was broadcast, the step can be
 * re-enabled straight away. If something was broadcast, the outcome is simply
 * unknown, and re-enabling the button is how a match gets a duplicate
 * transaction fired at it. Callers get that answer from `stageOf`.
 */

/** How far a call got before it threw. */
export type Stage = "preflight" | "submit" | "confirm";

export type FailureKind =
  | "cancelled"
  | "rate-limited"
  | "reverted"
  | "network"
  | "unknown";

export type Failure = {
  kind: FailureKind;
  /** One line, already fit for display. */
  message: string;
  /**
   * True when we know no transaction reached the network, so the step is safe
   * to re-enable immediately. False means the outcome is unknown and the
   * caller must confirm against contract state before offering a retry.
   */
  nothingSent: boolean;
};

const STAGE_KEY = "__carnageStage";

/** Marks how far a call got, so the caller can tell "not sent" from "unknown". */
export function tagStage<E>(err: E, stage: Stage): E {
  try {
    (err as any)[STAGE_KEY] = stage;
  } catch {
    // Frozen error objects are rare but not worth throwing over.
  }
  return err;
}

export function stageOf(err: unknown): Stage | null {
  const s = (err as any)?.[STAGE_KEY];
  return s === "preflight" || s === "submit" || s === "confirm" ? s : null;
}

function rawDetail(err: unknown): string {
  return String(
    (err as any)?.details ?? (err as any)?.shortMessage ?? (err as any)?.message ?? err,
  );
}

/**
 * Walks the usual nesting spots for a JSON-RPC error code. Providers wrap the
 * original error differently depending on which layer rejected, so a single
 * `err.code` read misses most of them.
 */
function codeOf(err: unknown): number | null {
  const seen = new Set<unknown>();
  let node: any = err;
  for (let depth = 0; node && typeof node === "object" && depth < 6; depth++) {
    if (seen.has(node)) break;
    seen.add(node);
    if (typeof node.code === "number") return node.code;
    node = node.cause ?? node.error ?? node.data ?? node.info;
  }
  return null;
}

/** Bytes come back as a Go debug dump; decode in chunks to keep the stack flat. */
function decodeBytes(list: string): string {
  const bytes = list
    .split(",")
    .map((b) => parseInt(b.trim(), 16))
    .filter((n) => Number.isFinite(n));
  let out = "";
  for (let i = 0; i < bytes.length; i += 4096) {
    out += String.fromCharCode(...bytes.slice(i, i + 4096));
  }
  return out;
}

/**
 * The contract's own UserError text, or null when this was not a revert.
 *
 * The RPC returns the whole VMResult struct as a Go debug dump; the readable
 * message lives in ReturnData as raw bytes (so it is NOT greppable as text in
 * the raw error), and Python-level crashes land in Stderr instead.
 */
export function contractRevert(err: unknown): string | null {
  const detail = rawDetail(err);
  const ret = detail.match(/ReturnData:\[\]uint8\{([^}]*)\}/);
  if (ret) {
    const text = decodeBytes(ret[1]);
    const expected = text.match(/\[EXPECTED\][ -~]{0,140}/);
    if (expected) return expected[0].replace("[EXPECTED] ", "");
    const llm = text.match(/\[LLM_ERROR\][ -~]{0,140}/);
    if (llm) return llm[0];
  }
  const py = detail.match(/(\w+Error): ([ -~]{0,120})/);
  if (py) return `${py[1]}: ${py[2]}`;
  return null;
}

/** Pulls the contract's own UserError text out of a GenVM failure. */
export function decodeGenvmError(err: unknown): string {
  const revert = contractRevert(err);
  if (revert) return revert;

  // Not a contract revert, but a wallet or transport failure. Keep it to one
  // readable line instead of dumping the RPC envelope into the UI.
  const short = String(
    (err as any)?.shortMessage ?? (err as any)?.message ?? rawDetail(err),
  );
  return short.replace(/\s+/g, " ").trim().slice(0, 160);
}

const CANCEL_CODES = new Set([4001, 4100]);
const RATE_LIMIT_CODES = new Set([-32005, 429]);

const CANCEL_TEXT = /user rejected|user denied|request rejected|rejected the request/i;
const RATE_LIMIT_TEXT = /node at capacity|rate ?limit|too many requests|\b429\b/i;
/*
 * The last three alternatives are a node that answered with something other
 * than JSON-RPC. A gateway or a proxy in front of the RPC returns an HTML
 * error page, the client fails to parse it, and the result used to classify as
 * "unknown" and reach the reader as "An unknown RPC error occurred". It is a
 * transport failure like any other, and the caller can retry it.
 */
const NETWORK_TEXT =
  /timeout|timed out|exceeded|network|fetch failed|failed to fetch|socket|econn|aborted|502|503|504|not valid json|unexpected token|<!doctype/i;

export function isRateLimited(err: unknown): boolean {
  const code = codeOf(err);
  if (code !== null && RATE_LIMIT_CODES.has(code)) return true;
  return RATE_LIMIT_TEXT.test(rawDetail(err));
}

/**
 * Turns any thrown value into something the recovery layer can route on.
 *
 * `nothingSent` is deliberately conservative: it is only true when the call
 * failed before or during submission, or the wallet refused outright. A
 * failure while waiting for a receipt leaves it false, because the
 * transaction is on the network and may still land.
 */
export function classifyFailure(err: unknown): Failure {
  // Only `send` can broadcast, and it tags both of its failure points. So an
  // error carrying no stage never reached the network, and a "confirm" stage
  // is the single case where a transaction is out there with an unknown fate.
  const mayHaveLanded = stageOf(err) === "confirm";
  const code = codeOf(err);
  const detail = rawDetail(err);

  if ((code !== null && CANCEL_CODES.has(code)) || CANCEL_TEXT.test(detail)) {
    return { kind: "cancelled", message: "cancelled in wallet, try again", nothingSent: true };
  }

  if (isRateLimited(err)) {
    return {
      kind: "rate-limited",
      message: mayHaveLanded
        ? "network busy while confirming, checking what landed"
        : "network busy, nothing was sent. Retry in a moment.",
      nothingSent: !mayHaveLanded,
    };
  }

  const revert = contractRevert(err);
  if (revert) {
    // A revert means the node executed the call and refused it, so no state
    // moved even if this happened at submit time.
    return { kind: "reverted", message: revert, nothingSent: true };
  }

  const message = decodeGenvmError(err);
  if (NETWORK_TEXT.test(detail)) {
    return { kind: "network", message, nothingSent: !mayHaveLanded };
  }
  return { kind: "unknown", message, nothingSent: !mayHaveLanded };
}
