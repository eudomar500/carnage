import { useCallback, useRef, useState } from "react";

export type ActionPhase =
  | { kind: "idle" }
  | { kind: "working"; note: string }
  | { kind: "done"; note: string }
  | { kind: "error"; message: string };

export type ActionRunner = {
  phase: ActionPhase;
  busy: boolean;
  /** Runs `fn`, surfacing progress notes it reports through `say`. */
  run: (fn: (say: (note: string) => void) => Promise<string>) => Promise<void>;
  reset: () => void;
};

/**
 * Drives one on-chain action through preflight -> wallet -> confirmation.
 *
 * Errors arrive already decoded to the contract's own message by the action
 * layer, so they are shown verbatim rather than as an RPC dump.
 */
export function useAction(onSettled?: () => void): ActionRunner {
  const [phase, setPhase] = useState<ActionPhase>({ kind: "idle" });
  const running = useRef(false);

  const run = useCallback(
    async (fn: (say: (note: string) => void) => Promise<string>) => {
      if (running.current) return;
      running.current = true;
      setPhase({ kind: "working", note: "checking preconditions..." });
      try {
        const done = await fn((note) => setPhase({ kind: "working", note }));
        setPhase({ kind: "done", note: done });
        onSettled?.();
      } catch (e: any) {
        const raw = e?.message ?? String(e);
        // MetaMask's user-rejection code, whatever wrapper it arrives in
        const rejected = e?.code === 4001 || /user rejected|user denied/i.test(raw);
        setPhase({ kind: "error", message: rejected ? "cancelled in wallet" : raw });
      } finally {
        running.current = false;
      }
    },
    [onSettled],
  );

  const reset = useCallback(() => setPhase({ kind: "idle" }), []);

  return { phase, busy: phase.kind === "working", run, reset };
}
