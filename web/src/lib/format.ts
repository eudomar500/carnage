import { TOKEN_DECIMALS, TOKEN_SYMBOL } from "../chain/client";

export { TOKEN_SYMBOL };

/** Formats a wei-denominated bigint into a trimmed decimal string. */
export function formatToken(wei: bigint, maxFractionDigits = 6): string {
  const base = 10n ** BigInt(TOKEN_DECIMALS);
  const whole = wei / base;
  const frac = wei % base;
  if (frac === 0n) return `${whole}.00`;
  let fracStr = frac.toString().padStart(TOKEN_DECIMALS, "0").slice(0, maxFractionDigits);
  fracStr = fracStr.replace(/0+$/, "");
  if (fracStr.length < 2) fracStr = fracStr.padEnd(2, "0");
  return `${whole}.${fracStr}`;
}

/** 0x1234...abcd */
export function shortAddress(addr: string, lead = 4, tail = 4): string {
  if (!addr || addr.length < lead + tail + 2) return addr || "-";
  return `${addr.slice(0, 2 + lead)}...${addr.slice(-tail)}`;
}

/** A price constraint is a plain integer in the contract's units. */
export function formatPrice(v: bigint): string {
  return `${v}.00`;
}
