import { CARNAGE_ADDRESS } from "./client";
import { getMatch, isUnknownMatch, type MatchState } from "./contract";
import { sinkSeatOf } from "./roles";

/**
 * Finding every match a wallet has a stake in, with nothing to ask but
 * get_match.
 *
 * The contract exposes two views, get_match and compute_commitment. There is
 * no match count, no per-address index, and GenVM events are not indexed logs
 * so there is no stream to query at the contract's own address either. What
 * there is: match ids are dense and start at 1, because create_match bumps
 * next_match_id by one and a revert rolls the whole call back. So walking ids
 * upward until the first "unknown match_id" enumerates every match exactly.
 *
 * Reads cost about two seconds each against Bradbury, so this is deliberately
 * not something the app does on a timer. The full walk runs once when a
 * wallet connects, the result is cached, and after that only two cheap things
 * happen: the wallet's own matches are re-read, and a couple of ids past the
 * high-water mark are probed to catch new ones.
 *
 * The walk is capped. A contract with thousands of matches would take minutes
 * to enumerate, and a half-finished scan that claims to be complete is worse
 * than one that admits its bound, so the result carries `capped` and the UI
 * says it scanned the first N.
 */

/** Ceiling on a single walk. Reported honestly rather than hidden. */
export const MAX_SCAN_IDS = 200;

/** Reads in flight at once. The txlog scan settled on the same number. */
const CONCURRENCY = 4;

/** How long a wallet's match list is trusted before a full re-walk. */
const CACHE_TTL_MS = 10 * 60 * 1000;

/** Ids probed past the high-water mark on a warm refresh. */
const LOOKAHEAD = 2;

export type Discovery = {
  /** Match ids this wallet has a stake in, ascending. */
  ids: number[];
  /** Highest id confirmed to exist. 0 when the contract has no matches. */
  scannedTo: number;
  /** True when the walk stopped at MAX_SCAN_IDS rather than at the end. */
  capped: boolean;
  /** Set when a read failed for a transport reason, so the walk is partial. */
  degraded: string | null;
};

const EMPTY: Discovery = { ids: [], scannedTo: 0, capped: false, degraded: null };

type Cached = Discovery & { at: number };

/**
 * Storage may be unavailable (private mode, disabled cookies) and must never
 * take the page down with it, so every access is wrapped. Same rule the
 * attempt journal follows.
 */
const PREFIX = "carnage.matches";

function cacheKey(wallet: string): string {
  return `${PREFIX}.${CARNAGE_ADDRESS.toLowerCase()}.${wallet.toLowerCase()}`;
}

export function readCache(wallet: string): Cached | null {
  try {
    const raw = localStorage.getItem(cacheKey(wallet));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Cached;
    if (!Array.isArray(parsed.ids) || typeof parsed.scannedTo !== "number") return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCache(wallet: string, d: Discovery): void {
  try {
    localStorage.setItem(cacheKey(wallet), JSON.stringify({ ...d, at: Date.now() }));
  } catch {
    // A wallet with no cache just re-walks next time. Not worth failing over.
  }
}

export function clearCache(wallet: string): void {
  try {
    localStorage.removeItem(cacheKey(wallet));
  } catch {
    // Nothing to do.
  }
}

/**
 * Whether this wallet has any reason to care about a match.
 *
 * Being the holder or the buyer is the obvious one. The sink matters too, and
 * note that sink_address and pending_sink are contract-level rather than
 * per-match, so a wallet holding the sink is relevant to every match that has
 * credited the sink anything.
 */
export function walletIsInvolved(m: MatchState, wallet: string): boolean {
  const me = wallet.toLowerCase();
  if (m.holder.toLowerCase() === me) return true;
  if (m.buyer.toLowerCase() === me) return true;
  if (sinkSeatOf(m, wallet) !== null) return m.sink_claimable > 0n || sinkSeatOf(m, wallet) === "pending-sink";
  return false;
}

type Probe = { id: number; match: MatchState | null; missing: boolean; error: unknown };

async function probe(id: number): Promise<Probe> {
  try {
    return { id, match: await getMatch(id), missing: false, error: null };
  } catch (err) {
    if (isUnknownMatch(err)) return { id, match: null, missing: true, error: null };
    return { id, match: null, missing: false, error: err };
  }
}

/**
 * Walks ids from `from` upward until the first missing one.
 *
 * Ids are probed in small parallel batches, but the batch is only trusted up
 * to the first miss inside it: ids are dense, so a miss is the end of the
 * list and anything read past it would be reading past the end.
 */
async function walk(
  wallet: string,
  from: number,
  limit: number,
  keep: (m: MatchState, wallet: string) => boolean = walletIsInvolved,
  onFound?: (kept: number) => void,
): Promise<{ found: MatchState[]; scannedTo: number; capped: boolean; degraded: string | null }> {
  const found: MatchState[] = [];
  let scannedTo = from - 1;
  let id = from;

  while (id < from + limit) {
    const batch: number[] = [];
    for (let k = 0; k < CONCURRENCY && id + k < from + limit; k++) batch.push(id + k);
    const results = await Promise.all(batch.map(probe));

    for (const r of results) {
      if (r.error) {
        return {
          found,
          scannedTo,
          capped: false,
          degraded: "a read failed, so the match list may be incomplete",
        };
      }
      if (r.missing) {
        return { found, scannedTo, capped: false, degraded: null };
      }
      scannedTo = r.id;
      if (r.match && keep(r.match, wallet)) found.push(r.match);
    }
    onFound?.(found.length);
    id += batch.length;
  }

  return { found, scannedTo, capped: true, degraded: null };
}

export type DiscoveryResult = Discovery & { matches: MatchState[] };

/**
 * The wallet's matches, cold or warm.
 *
 * Cold (no cache, or a cache older than the TTL): walk from id 1. Warm:
 * re-read the ids already known to involve this wallet, then probe a couple
 * past the high-water mark for anything new. The warm path is what runs on a
 * timer, and it costs a handful of reads rather than a full enumeration.
 */
export async function discoverMatches(wallet: string): Promise<DiscoveryResult> {
  const cached = readCache(wallet);
  const fresh = cached !== null && Date.now() - cached.at < CACHE_TTL_MS;

  if (!fresh) {
    const { found, scannedTo, capped, degraded } = await walk(wallet, 1, MAX_SCAN_IDS);
    const result: Discovery = {
      ids: found.map((m) => Number(m.match_id)),
      scannedTo,
      capped,
      degraded,
    };
    if (!degraded) writeCache(wallet, result);
    return { ...result, matches: found };
  }

  // Warm: the wallet's known matches, re-read for current state.
  const known: MatchState[] = [];
  let degraded: string | null = null;
  for (let i = 0; i < cached.ids.length; i += CONCURRENCY) {
    const slice = cached.ids.slice(i, i + CONCURRENCY);
    const results = await Promise.all(slice.map(probe));
    for (const r of results) {
      if (r.error) degraded = "a read failed, so some matches may be out of date";
      else if (r.match) known.push(r.match);
    }
  }

  // Then look just past the end for matches created since the last walk.
  const ahead = await walk(wallet, cached.scannedTo + 1, LOOKAHEAD);
  const matches = [...known, ...ahead.found].sort((a, b) => Number(a.match_id - b.match_id));

  const result: Discovery = {
    ids: matches.map((m) => Number(m.match_id)),
    scannedTo: Math.max(cached.scannedTo, ahead.scannedTo),
    capped: cached.capped,
    degraded: degraded ?? ahead.degraded,
  };
  // A lookahead that filled its whole budget means there may be more still,
  // so the next refresh should walk properly rather than trust this.
  if (!result.degraded && !ahead.capped) writeCache(wallet, result);
  return { ...result, matches };
}

/**
 * Every match on the contract, whoever played it.
 *
 * The bell asks a different question: which matches involve this wallet. The
 * lab needs the whole record, and it runs on the landing where there may be
 * no wallet at all, so it walks with the filter open and caches under a key
 * of its own rather than a wallet's.
 *
 * The walk, the cap and the honest reporting of both are the same ones the
 * bell uses. Only the filter and the cache key differ.
 *
 * `onFound` reports how many matches have been read so far. The lab shows that
 * count while it waits, because the walk is one slow read per id and a page
 * that sits on zeros for several seconds looks broken rather than busy.
 */
const ALL_KEY = "all";

export async function discoverAllMatches(
  onFound?: (kept: number) => void,
): Promise<DiscoveryResult> {
  const cached = readCache(ALL_KEY);
  const fresh = cached !== null && Date.now() - cached.at < CACHE_TTL_MS;

  if (fresh) {
    const known: MatchState[] = [];
    let degraded: string | null = null;
    for (let i = 0; i < cached.ids.length; i += CONCURRENCY) {
      const slice = cached.ids.slice(i, i + CONCURRENCY);
      for (const r of await Promise.all(slice.map(probe))) {
        if (r.error) degraded = "a read failed, so some matches may be out of date";
        else if (r.match) known.push(r.match);
      }
      onFound?.(known.length);
    }
    const ahead = await walk(ALL_KEY, cached.scannedTo + 1, LOOKAHEAD, () => true);
    const matches = [...known, ...ahead.found].sort((a, b) => Number(a.match_id - b.match_id));
    const result: Discovery = {
      ids: matches.map((m) => Number(m.match_id)),
      scannedTo: Math.max(cached.scannedTo, ahead.scannedTo),
      capped: cached.capped,
      degraded: degraded ?? ahead.degraded,
    };
    if (!result.degraded && !ahead.capped) writeCache(ALL_KEY, result);
    return { ...result, matches };
  }

  const { found, scannedTo, capped, degraded } = await walk(
    ALL_KEY,
    1,
    MAX_SCAN_IDS,
    () => true,
    onFound,
  );
  const result: Discovery = {
    ids: found.map((m) => Number(m.match_id)),
    scannedTo,
    capped,
    degraded,
  };
  if (!degraded) writeCache(ALL_KEY, result);
  return { ...result, matches: found };
}

/** What the bell says about its own coverage. Empty when there is nothing to say. */
export function coverageNote(d: Discovery): string {
  if (d.degraded) return d.degraded;
  if (d.capped) return `scanned the first ${MAX_SCAN_IDS} matches`;
  if (d.scannedTo === 0) return "no matches on this contract yet";
  return `scanned all ${d.scannedTo} matches`;
}

export const DISCOVERY_EMPTY = EMPTY;
