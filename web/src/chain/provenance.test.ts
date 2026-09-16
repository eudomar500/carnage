import { describe, expect, it } from "vitest";
import {
  convergenceMethodNote,
  convergenceReadsNote,
  footerSourceNote,
  indexReach,
  linksProofs,
  liveHalfNote,
  liveSourceName,
  missingNote,
  missingVerdictNote,
  sourcesNote,
  type Provenance,
} from "./provenance";

/**
 * What each network is allowed to say about its own evidence.
 *
 * These sentences were wrong for months and nothing caught it, because they
 * were typed into four components as prose. Studio Next was described as a
 * network that "exposes no transaction log, so no verdict here carries a
 * transaction". The first clause was a true statement about eth_getLogs. The
 * second was a claim about the network, and it was false: its node lists every
 * transaction ever sent to a contract.
 *
 * So the rule these pin is narrow and mechanical. A sentence may quote a block
 * number only where the network numbers blocks, and a date only where its index
 * records one, and it may never name a source the network does not have.
 */

const BRADBURY: Provenance = {
  source: "log",
  snapshotBlock: 21_640_248,
  snapshotAt: null,
};

const STUDIO_NEXT: Provenance = {
  source: "rpc-index",
  snapshotBlock: null,
  snapshotAt: "2026-09-16",
};

/** A contract no committed file describes, on a network with a live source. */
const UNINDEXED: Provenance = {
  source: "rpc-index",
  snapshotBlock: null,
  snapshotAt: null,
};

describe("how far the index reaches", () => {
  it("is a block where the network numbers blocks", () => {
    expect(indexReach(BRADBURY)).toBe("block 21,640,248");
  });

  it("is a date where it does not", () => {
    expect(indexReach(STUDIO_NEXT)).toBe("2026-09-16");
  });

  it("is nothing at all when no committed file describes the contract", () => {
    expect(indexReach(UNINDEXED)).toBeNull();
  });
});

describe("every network can attach a hash", () => {
  it("says so for both deployed networks", () => {
    // The gate that used to be hasTxLog. If either of these turns false, proof
    // links disappear from a network that has them.
    expect(linksProofs(BRADBURY)).toBe(true);
    expect(linksProofs(STUDIO_NEXT)).toBe(true);
    expect(linksProofs(UNINDEXED)).toBe(true);
  });

  it("says no only where there is neither a live source nor a file", () => {
    expect(
      linksProofs({ source: "committed", snapshotBlock: null, snapshotAt: null }),
    ).toBe(false);
  });
});

describe("naming the live source", () => {
  it("names each network's own, and never the other's", () => {
    expect(liveSourceName("log")).toBe("the consensus contract's transaction log");
    expect(liveSourceName("rpc-index")).toBe("the node's own transaction index");
    expect(liveSourceName("committed")).toBe("the committed index");
  });
});

describe("the note under the convergence chart", () => {
  it("quotes Bradbury's reach as a block and counts its windows", () => {
    const note = sourcesNote(BRADBURY, 3);
    expect(note).toContain("Every transaction through block 21,640,248 is in an index");
    expect(note).toContain("Blocks after it were scanned live on this visit, 3 windows of them.");
  });

  it("quotes Studio Next's reach as a date and counts no windows", () => {
    // A window count here would be the log walk's unit reported on a source
    // that makes one request, and a block number would be another chain's.
    const note = sourcesNote(STUDIO_NEXT, 0);
    expect(note).toContain("Every transaction through 2026-09-16 is in an index");
    expect(note).toContain("The node's own transaction index was read live on this visit");
    expect(note).not.toContain("window");
    expect(note).not.toContain("block");
  });

  it("says the index is absent rather than quoting a reach it does not have", () => {
    expect(sourcesNote(UNINDEXED, 0)).toContain("No committed index describes this contract");
  });

  it("never reports a window count where the source has no windows", () => {
    // The caller passes whatever the feed had; the wording decides what is
    // meaningful. Passing Bradbury's window count against Studio Next's source
    // must not produce "3 windows".
    expect(liveHalfNote(STUDIO_NEXT, 3)).not.toContain("3");
  });
});

describe("why a transaction has no link", () => {
  it("names both of Bradbury's sources and how far each looked", () => {
    expect(missingNote(BRADBURY, 3)).toBe(
      "not located in the committed index through block 21,640,248, nor in the 3 live windows after it",
    );
  });

  it("names both of Studio Next's, in its own units", () => {
    expect(missingNote(STUDIO_NEXT, 0)).toBe(
      "not located in the committed index through 2026-09-16, nor in the node's own transaction index read on this visit",
    );
  });

  it("reports a transport failure as itself rather than as absence", () => {
    // A node that would not answer is not evidence that a transaction does not
    // exist, and the two must never read the same.
    expect(missingNote(STUDIO_NEXT, 0, "the node is rate limiting this scan")).toBe(
      "not located (the node is rate limiting this scan)",
    );
  });

  it("agrees with itself on the claims table's version", () => {
    expect(missingVerdictNote(BRADBURY)).toContain("block 21,640,248");
    expect(missingVerdictNote(BRADBURY)).not.toContain("2026");
    expect(missingVerdictNote(STUDIO_NEXT)).toContain("2026-09-16");
    expect(missingVerdictNote(STUDIO_NEXT)).not.toContain("block");
  });
});

describe("the record network's own wording is untouched", () => {
  /*
   * Bradbury had these three sentences before a second network existed. They
   * are reproduced verbatim rather than generalised, because a rewrite that
   * says the same thing differently is still a rewrite of a published page.
   * pages/bradbury-render.test.tsx pins them again where they render.
   */
  it("keeps the METHOD bullet", () => {
    expect(convergenceMethodNote("log")).toBe(
      "Attempts are reconstructed from the consensus contract's transaction log, " +
        "read from a committed index through its snapshot block and a live scan of " +
        "the blocks after it.",
    );
  });

  it("keeps the convergence section's own clause", () => {
    expect(convergenceReadsNote("log")).toBe(
      "this section reads the consensus contract's own transaction log instead",
    );
  });

  it("keeps the footer", () => {
    expect(footerSourceNote("log")).toBe(
      "The transaction behind each verdict comes from a committed index plus a live " +
        "scan of the blocks after it, described under",
    );
  });

  it("gives the other source its own three, naming its own index", () => {
    expect(convergenceMethodNote("rpc-index")).toContain("the node's own transaction index");
    expect(convergenceReadsNote("rpc-index")).toContain("the node's own transaction index");
    expect(footerSourceNote("rpc-index")).toContain("the node's own transaction index");
    for (const s of [
      convergenceMethodNote("rpc-index"),
      convergenceReadsNote("rpc-index"),
      footerSourceNote("rpc-index"),
    ]) {
      expect(s).not.toContain("consensus contract");
      expect(s).not.toContain("blocks after it");
    }
  });
});
