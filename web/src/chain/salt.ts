import { keccak256, toHex } from "viem";
import { CARNAGE_ADDRESS } from "./client";
import type { Role } from "./roles";

/**
 * Salt handling for the commit -> reveal gap.
 *
 * The salt is DERIVED from a wallet signature over a canonical, match-bound
 * message rather than stored anywhere. ECDSA signing is deterministic
 * (RFC 6979), so the same wallet signing the same string later reproduces the
 * same signature, and therefore the same salt, on any device, after any
 * amount of cleared browser state.
 *
 * The signature itself is the salt preimage. It never leaves this module, is
 * never logged, and is never rendered.
 */

const SALT_CACHE = new Map<string, `0x${string}`>();

function cacheKey(matchId: bigint | number, role: Role, account: string): string {
  return `${CARNAGE_ADDRESS}:${matchId}:${role}:${account.toLowerCase()}`;
}

/** The exact string the wallet signs. Changing this invalidates every salt. */
export function saltMessage(matchId: bigint | number, role: Role, account: string): string {
  return [
    "Carnage salt derivation",
    `contract: ${CARNAGE_ADDRESS}`,
    `match: ${matchId}`,
    `role: ${role}`,
    `account: ${account.toLowerCase()}`,
    "",
    "Signing this proves you can regenerate your commitment salt.",
    "It does not move funds and is not a transaction.",
  ].join("\n");
}

/**
 * Asks the wallet to sign the canonical message and folds the signature into
 * a 32-byte salt. Cached in memory for the session so a commit and a reveal
 * in one sitting only prompt once.
 */
export async function deriveSalt(
  matchId: bigint | number,
  role: Role,
  account: `0x${string}`,
): Promise<`0x${string}`> {
  const key = cacheKey(matchId, role, account);
  const cached = SALT_CACHE.get(key);
  if (cached) return cached;

  const provider = window.ethereum;
  if (!provider) throw new Error("No injected wallet found.");

  const message = saltMessage(matchId, role, account);
  const signature: string = await provider.request({
    method: "personal_sign",
    params: [toHex(message), account],
  });

  // keccak of the signature, never the signature itself
  const salt = keccak256(signature as `0x${string}`);
  SALT_CACHE.set(key, salt);
  return salt;
}

/** Seeds the cache from a recovery ticket so reveal needs no signature. */
export function primeSalt(
  matchId: bigint | number,
  role: Role,
  account: string,
  salt: `0x${string}`,
): void {
  SALT_CACHE.set(cacheKey(matchId, role, account), salt);
}

export type RecoveryTicket = {
  carnage: "reveal-ticket";
  contract: string;
  match_id: string;
  role: Role;
  account: string;
  state: string;
  salt: `0x${string}`;
};

/**
 * The optional belt-and-braces export. Holds state + salt (never the
 * signature), so it is enough to reveal without the original wallet's
 * signing behaviour cooperating.
 */
export function buildTicket(
  matchId: bigint | number,
  role: Role,
  account: string,
  state: bigint,
  salt: `0x${string}`,
): RecoveryTicket {
  return {
    carnage: "reveal-ticket",
    contract: CARNAGE_ADDRESS,
    match_id: `${matchId}`,
    role,
    account: account.toLowerCase(),
    state: `${state}`,
    salt,
  };
}

export function parseTicket(raw: string): RecoveryTicket {
  const t = JSON.parse(raw);
  if (t?.carnage !== "reveal-ticket") throw new Error("not a Carnage reveal ticket");
  if (!t.salt || !t.state || !t.role) throw new Error("ticket is missing fields");
  return t as RecoveryTicket;
}
