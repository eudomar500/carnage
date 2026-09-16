import type { TxIndexSource } from "./networks";

/**
 * How the app describes where a transaction hash came from.
 *
 * Every network Carnage runs on now answers with two sources: a committed
 * index for the past and a live read for whatever has happened since. What
 * differs is the live half, and the difference is visible in the copy, because
 * the two halves reach back differently and a reader checking the page is
 * entitled to know which one answered.
 *
 * The sentences live here rather than in the components for one reason: the
 * pages used to carry a network's limits as prose, and prose does not get
 * recompiled when the limit turns out to be wrong. Studio Next was described
 * across four files as a network that "exposes no transaction log, so no
 * verdict here carries a transaction". The first half was true of eth_getLogs.
 * The second half was never true at all, and it survived because it was typed
 * out in four places instead of derived in one.
 *
 * Everything below is a pure function of the capability and the index, so the
 * tests can pin what each network says without rendering anything.
 */

/** What this page knows about its own sources. */
export type Provenance = {
  source: TxIndexSource;
  /** The block the committed index answers through, or null where none does. */
  snapshotBlock: number | null;
  /** The day the committed index was taken, or null where none did. */
  snapshotAt: string | null;
};

/**
 * Whether a verdict on this network can carry a transaction hash.
 *
 * True for all three sources, and kept as a function rather than dropped,
 * because it is the question the components actually ask and the answer is a
 * property of the source rather than a constant. A network added with no live
 * source and no committed index would be the first to answer false, and the
 * gates that read this are what would notice.
 */
export function linksProofs(p: Provenance): boolean {
  return p.source !== "committed" || p.snapshotAt !== null || p.snapshotBlock !== null;
}

/**
 * How far the committed index reaches, in the terms this network has.
 *
 * Blocks where the network numbers blocks, a date where it does not. Never a
 * block number on a network without blocks: quoting one chain's block height
 * against another chain's record was the specific mistake that made the old
 * copy say nothing at all rather than say something wrong.
 */
export function indexReach(p: Provenance): string | null {
  if (p.snapshotBlock !== null) return `block ${p.snapshotBlock.toLocaleString("en-US")}`;
  if (p.snapshotAt !== null) return p.snapshotAt;
  return null;
}

/** The live half, named the way a reader could go and check it. */
export function liveSourceName(source: TxIndexSource): string {
  switch (source) {
    case "log":
      return "the consensus contract's transaction log";
    case "rpc-index":
      return "the node's own transaction index";
    case "committed":
      return "the committed index";
  }
}

/**
 * The three sentences that name the source in running prose.
 *
 * Each returns Bradbury's original wording verbatim for the log source. That is
 * deliberate and it is pinned by a test: the record network's page had these
 * sentences before any of this existed, and making a second network work is not
 * a reason to reword the first one. Only the branch that did not exist is new.
 */
export function convergenceMethodNote(source: TxIndexSource): string {
  if (source === "log") {
    return (
      "Attempts are reconstructed from the consensus contract's transaction log, " +
      "read from a committed index through its snapshot block and a live scan of " +
      "the blocks after it."
    );
  }
  if (source === "rpc-index") {
    return (
      "Attempts are reconstructed from the node's own transaction index, read from " +
      "a committed index and a live listing of every transaction ever sent to the " +
      "contract, merged over it."
    );
  }
  return "Attempts are reconstructed from a committed index in this repository.";
}

/** How the convergence section names the source it is about to read. */
export function convergenceReadsNote(source: TxIndexSource): string {
  if (source === "log") return "this section reads the consensus contract's own transaction log instead";
  if (source === "rpc-index") return "this section reads the node's own transaction index instead";
  return "this section reads the committed index instead";
}

/** How the footer names the source, in its own shorter form. */
export function footerSourceNote(source: TxIndexSource): string {
  if (source === "log") {
    return "The transaction behind each verdict comes from a committed index plus a live scan of the blocks after it, described under";
  }
  if (source === "rpc-index") {
    return "The transaction behind each verdict comes from a committed index plus the node's own transaction index read over it, described under";
  }
  return "The transaction behind each verdict comes from a committed index, described under";
}

/**
 * What the live half actually did on this visit, as a clause.
 *
 * `windows` is the window count the log walk read, and is meaningless on any
 * other source, so it is only consulted where it means something.
 */
export function liveHalfNote(p: Provenance, windows: number): string {
  if (p.source === "committed") {
    return "There is nothing live to read on this network, so the index is the whole answer.";
  }
  if (p.source === "rpc-index") {
    return (
      "The node's own transaction index was read live on this visit and merged over it: " +
      "one request that returns every transaction ever sent to the contract."
    );
  }
  return (
    "Blocks after it were scanned live on this visit" +
    (windows > 0 ? `, ${windows} ${windows === 1 ? "window" : "windows"} of them` : "") +
    "."
  );
}

/**
 * The paragraph under the convergence chart, and the footer's shorter form.
 *
 * Both name the two sources and how far each reaches, because that is the
 * claim the page is making about its own evidence.
 */
export function sourcesNote(p: Provenance, windows: number): string {
  const reach = indexReach(p);
  const head = reach
    ? `Two sources, both on-chain. Every transaction through ${reach} is in an index ` +
      "committed to this repository, which any reader can regenerate from the contract " +
      "with the snapshot script. "
    : `No committed index describes this contract, so everything here was read live from ` +
      `${liveSourceName(p.source)}. `;
  return head + liveHalfNote(p, windows);
}

/**
 * Why a particular transaction has no link, in the reader's terms.
 *
 * Two sources answer this and a reader cannot be expected to know that, so the
 * note names both and says how far each looked. It never quotes a figure the
 * network does not have.
 */
export function missingNote(p: Provenance, windows: number, degraded?: string | null): string {
  if (degraded) return `not located (${degraded})`;
  const reach = indexReach(p);
  const inIndex = reach ? `in the committed index through ${reach}` : "in any committed index";
  if (p.source === "log") {
    return `not located ${inIndex}, nor in the ${windows} live ${
      windows === 1 ? "window" : "windows"
    } after it`;
  }
  if (p.source === "rpc-index") {
    return `not located ${inIndex}, nor in the node's own transaction index read on this visit`;
  }
  return `not located ${inIndex}, which is the whole record this network offers`;
}

/** The same question for a claims-table row, which is about one verdict. */
export function missingVerdictNote(p: Provenance): string {
  const reach = indexReach(p);
  const inIndex = reach ? `the committed index through ${reach}` : "any committed index";
  if (p.source === "log") {
    return `no adjudicate transaction found for this match, in ${inIndex} or in the live blocks after it`;
  }
  if (p.source === "rpc-index") {
    return `no adjudicate transaction found for this match, in ${inIndex} or in ${liveSourceName(
      p.source,
    )} read on this visit`;
  }
  return `no adjudicate transaction found for this match in ${inIndex}`;
}
