/**
 * Pulls the contract's own UserError text out of a GenVM failure.
 *
 * The RPC returns the whole VMResult struct as a Go debug dump; the readable
 * message lives in ReturnData as raw bytes (so it is NOT greppable as text in
 * the raw error), and Python-level crashes land in Stderr instead.
 */
export function decodeGenvmError(err: unknown): string {
  const detail = String(
    (err as any)?.details ?? (err as any)?.shortMessage ?? (err as any)?.message ?? err,
  );

  const ret = detail.match(/ReturnData:\[\]uint8\{([^}]*)\}/);
  if (ret) {
    const bytes = ret[1]
      .split(",")
      .map((b) => parseInt(b.trim(), 16))
      .filter((n) => Number.isFinite(n));
    const text = String.fromCharCode(...bytes);
    const expected = text.match(/\[EXPECTED\][ -~]{0,140}/);
    if (expected) return expected[0].replace("[EXPECTED] ", "");
    const llm = text.match(/\[LLM_ERROR\][ -~]{0,140}/);
    if (llm) return llm[0];
  }

  const py = detail.match(/(\w+Error): ([ -~]{0,120})/);
  if (py) return `${py[1]}: ${py[2]}`;

  // Not a contract revert, but a wallet or transport failure. Keep it to one
  // readable line instead of dumping the RPC envelope into the UI.
  const short = String(
    (err as any)?.shortMessage ?? (err as any)?.message ?? detail,
  );
  return short.replace(/\s+/g, " ").trim().slice(0, 160);
}
