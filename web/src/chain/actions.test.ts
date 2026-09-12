import { describe, expect, it } from "vitest";
import { computeCommitment } from "./actions";

/**
 * The commitment preimage, pinned against the contract.
 *
 * computeCommitment is a second implementation of compute_commitment in
 * contracts/carnage.py, written in another language, and until this file
 * existed nothing forced the two to agree. They are only equivalent as long as
 * four things stay identical: the field order, the two 32-byte big-endian
 * widths, the raw salt bytes, and the 20 address bytes.
 *
 * The cost of drift is why this is pinned rather than reviewed. A preimage
 * that differs by one byte still produces a well-formed 32-byte hash, so the
 * commit succeeds, the fund succeeds, and the failure only surfaces at reveal,
 * when the contract recomputes the hash and refuses it. By then the stake is in
 * escrow and comes back only through resolve_no_reveal after the deadline.
 *
 * The vector and the literal below are the same ones asserted against the
 * contract by test_compute_commitment_matches_the_published_vector in
 * tests/direct/test_carnage_commit_reveal.py. Change one side and that side
 * fails on its own.
 */
const VECTOR = {
  state: 650n,
  // 16 bytes, MIN_SALT_BYTES, so the vector sits on the lower bound.
  salt: `0x${"ab".repeat(16)}` as `0x${string}`,
  matchId: 7n,
  agent: `0x${"a1".repeat(20)}`,
};

const DIGEST = "0xad3bc4e9ebfb770c122e60f19a685812cbdfb9d8bd90279519adf997c9440a1a";

describe("computeCommitment", () => {
  it("matches the digest the contract produces for the published vector", () => {
    // Note the argument order differs from the contract's: this function takes
    // (matchId, state, salt, agent) while compute_commitment takes
    // (state, salt, match_id, agent). Only the preimage order has to match,
    // and it does: state, salt, match_id, agent.
    expect(
      computeCommitment(VECTOR.matchId, VECTOR.state, VECTOR.salt, VECTOR.agent),
    ).toBe(DIGEST);
  });
});
