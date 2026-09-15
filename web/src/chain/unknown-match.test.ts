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
 * Studio Next's node puts nothing in `details` but "execution failed", and the
 * walk read its own stop condition as a transport failure: Labs on studio-next
 * showed "a read failed, so the match list may be incomplete" on a network
 * with exactly one match.
 *
 * It does carry the contract's words, though, one level down. Probed against
 * the deployed contract on 2026-09-15, ids 4 and 5 both answer with the
 * UserError base64 in the JSON-RPC error's own data, so the stop condition can
 * be the contract speaking rather than an inference from a capability flag.
 *
 * The same probe turned up the fault that put the note back on a network with
 * three matches: the node answers thirty requests a minute and refuses the
 * rest, and a refusal is not an answer. It is the last fixture below.
 *
 * Every fixture here is a real error, captured from the two live nodes.
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

/**
 * Studio Next again, read down to the receipt.
 *
 * `result` is base64 for "\x01[EXPECTED] unknown match_id": a one-byte kind
 * marker and then the contract's own UserError, the same text Bradbury spells
 * out in its ReturnData dump.
 */
const STUDIO_UNKNOWN_RECEIPT = Object.assign(
  new Error("Missing or invalid parameters.\nDouble check you have provided the correct parameters."),
  {
    name: "InvalidInputRpcError",
    code: -32000,
    shortMessage:
      "Missing or invalid parameters.\nDouble check you have provided the correct parameters.",
    details: "execution failed",
    cause: {
      code: -32000,
      message: "execution failed",
      data: {
        receipt: {
          execution_result: "ERROR",
          result: "AVtFWFBFQ1RFRF0gdW5rbm93biBtYXRjaF9pZA==",
        },
      },
    },
  },
);

/**
 * Studio Next refusing to answer at all.
 *
 * This is what the probe of id 4 returns once the visit has spent its thirty
 * requests for the minute, and it is the error that put the incomplete-list
 * note back on a network with three matches. Note the shape: a different name,
 * a different code, and the node's own -32029 one level down. Nothing in it
 * says the contract ran.
 */
const STUDIO_THROTTLED = Object.assign(new Error("Rate limit exceeded: 30 requests per minute"), {
  name: "UnknownRpcError",
  code: -1,
  details: "Rate limit exceeded: 30 requests per minute",
  cause: { code: -32029, message: "Rate limit exceeded: 30 requests per minute" },
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
    expect(isUnknownMatch(STUDIO_THROTTLED)).toBe(false);
  });

  it("reads the other node's receipt too, wherever it arrives from", () => {
    // The receipt carries the contract's own words, and those mean the same
    // thing on any chain running this contract.
    setActiveNetwork("bradbury");
    expect(isUnknownMatch(STUDIO_UNKNOWN_RECEIPT)).toBe(true);
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

  it("reads the contract's own words out of the receipt", () => {
    // The shape ids 4 and 5 actually return. This is the stop condition the
    // walk should be using: the contract saying the id does not exist, rather
    // than a bare execution failure read through a capability flag.
    setActiveNetwork("studio-next");
    expect(isUnknownMatch(STUDIO_UNKNOWN_RECEIPT)).toBe(true);
  });

  it("never reads a throttled read as the end of the ids", () => {
    // The line between ending discovery and truncating the record. This error
    // says the node refused to run the call, not that the id is unminted.
    setActiveNetwork("studio-next");
    expect(isUnknownMatch(STUDIO_THROTTLED)).toBe(false);
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
