import { afterEach, describe, expect, it } from "vitest";
import { isUnknownMatch } from "./contract";
import { setActiveNetwork } from "./client";

/**
 * Telling "that id does not exist" from "that read failed".
 *
 * Discovery walks ids upward until one comes back unknown, so this predicate
 * is the stop condition for the whole match list. It was written against
 * Bradbury, whose node returns the GenVM return data inside the error, so the
 * contract's own "[EXPECTED] unknown match_id" could be decoded out of it.
 *
 * Studio Next's node returns nothing of the sort. The same read of an unminted
 * id comes back as details "execution failed", and the walk read its own stop
 * condition as a transport failure: Labs on studio-next showed "a read failed,
 * so the match list may be incomplete" on a network with exactly one match.
 *
 * Both fixtures below are the real errors, captured from the two live nodes.
 */

/** Bradbury: viem error carrying the GenVM ReturnData with the UserError text. */
const BRADBURY_UNKNOWN = Object.assign(new Error("Missing or invalid parameters."), {
  name: "InvalidInputRpcError",
  shortMessage: "Missing or invalid parameters.",
  details:
    "execution failed: &genvm.VMResult{Kind:0x1, ReturnData:[]uint8{0x2e, 0x4, 0x64, 0x61, 0x74, 0x61, 0xdc, 0x1, 0x5b, 0x45, 0x58, 0x50, 0x45, 0x43, 0x54, 0x45, 0x44, 0x5d, 0x20, 0x75, 0x6e, 0x6b, 0x6e, 0x6f, 0x77, 0x6e, 0x20, 0x6d, 0x61, 0x74, 0x63, 0x68, 0x5f, 0x69, 0x64}}",
});

/** Studio Next: the same condition, with nothing in it. */
const STUDIO_UNKNOWN = Object.assign(new Error("Missing or invalid parameters."), {
  name: "InvalidInputRpcError",
  shortMessage: "Missing or invalid parameters.",
  details: "execution failed",
});

/** A node that could not be reached. Never a stop condition, on any network. */
const TRANSPORT = Object.assign(new Error("HTTP request failed."), {
  name: "HttpRequestError",
  shortMessage: "HTTP request failed.",
  details: "fetch failed",
});

const RATE_LIMITED = Object.assign(new Error("Too many requests"), {
  name: "HttpRequestError",
  details: "Status: 429",
});

afterEach(() => {
  setActiveNetwork("bradbury");
});

describe("isUnknownMatch on Bradbury", () => {
  it("decodes the contract's own words out of the return data", () => {
    setActiveNetwork("bradbury");
    expect(isUnknownMatch(BRADBURY_UNKNOWN)).toBe(true);
  });

  it("does not treat a bare execution failure as a missing id", () => {
    // Bradbury always returns the revert bytes, so a bare failure there is
    // something else and the walk must keep calling it a failed read.
    setActiveNetwork("bradbury");
    expect(isUnknownMatch(STUDIO_UNKNOWN)).toBe(false);
  });

  it("never treats a transport failure as a missing id", () => {
    setActiveNetwork("bradbury");
    expect(isUnknownMatch(TRANSPORT)).toBe(false);
    expect(isUnknownMatch(RATE_LIMITED)).toBe(false);
  });
});

describe("isUnknownMatch on Studio Next", () => {
  it("reads a bare execution failure as the end of the ids", () => {
    setActiveNetwork("studio-next");
    expect(isUnknownMatch(STUDIO_UNKNOWN)).toBe(true);
  });

  it("still keeps a transport failure a failed read", () => {
    // This is the line between a clean stop and silently truncating the list.
    setActiveNetwork("studio-next");
    expect(isUnknownMatch(TRANSPORT)).toBe(false);
    expect(isUnknownMatch(RATE_LIMITED)).toBe(false);
  });

  it("accepts the decoded form too, if a node ever starts sending it", () => {
    setActiveNetwork("studio-next");
    expect(isUnknownMatch(BRADBURY_UNKNOWN)).toBe(true);
  });

  it("does not choke on shapes that are not errors", () => {
    setActiveNetwork("studio-next");
    expect(isUnknownMatch(null)).toBe(false);
    expect(isUnknownMatch(undefined)).toBe(false);
    expect(isUnknownMatch({})).toBe(false);
    expect(isUnknownMatch("execution failed")).toBe(false);
  });

  it("reads the failure off the cause when details is absent", () => {
    setActiveNetwork("studio-next");
    const viaCause = Object.assign(new Error("Missing or invalid parameters."), {
      cause: new Error("execution failed"),
    });
    expect(isUnknownMatch(viaCause)).toBe(true);
  });
});
