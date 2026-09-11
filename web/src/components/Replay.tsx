import { useMemo, useState, type ReactNode } from "react";
import { isDishonest, type Label, type MatchState } from "../chain/contract";
import { BRANCHES, isResolved } from "../chain/lifecycle";
import { settlementSplit } from "../chain/rubric";
import { explorerTxUrl, requiredMethods, type LinkedMethod } from "../chain/txlog";
import { useMatchTransactions, type TxLookup } from "../hooks/useMatchTransactions";
import { formatToken, shortAddress, TOKEN_SYMBOL } from "../lib/format";

/**
 * REPLAY: the match record, reconstructed from get_match and nothing else.
 *
 * What this is honest about. get_match returns the anchored claims, the
 * revealed constraints, the price proposals, the labels, the jury's stored
 * reasoning and the claimable balances. That is enough to reconstruct WHAT
 * happened in full, and every number below comes from one of those fields or
 * from arithmetic on them.
 *
 * What it deliberately is not. get_match returns no timestamps, no
 * transaction hashes and no event ordering, so this is not a timestamped
 * playback and does not pretend to be one. The frame order is not invented
 * either: it is the order the contract's preconditions force, so replaying in
 * this sequence is a statement about the contract, not a guess about history.
 *
 * The off-chain negotiation is absent for the same reason it is absent
 * on-chain: it never happened here.
 */

type Frame = {
  key: string;
  title: string;
  caption: string;
  body: ReactNode;
  /**
   * Contract methods whose transaction proves this frame, most important
   * first. Present only on the frames where a hash is the evidence: the
   * verdict, and the transactions that move money.
   */
  proof?: LinkedMethod[];
};

/** Signed difference between two contract-unit prices, as plain text. */
function delta(a: bigint, b: bigint): string {
  const d = a - b;
  if (d === 0n) return "0";
  return d > 0n ? `+${d}` : `${d}`;
}

function Side({
  role,
  address,
  children,
}: {
  role: string;
  address: string;
  children: ReactNode;
}) {
  return (
    <div className={`rep-side rep-side--${role.toLowerCase()}`}>
      <div className="rep-side-head">
        <span className="rep-side-role">{role}</span>
        <span className="rep-side-addr">{shortAddress(address, 4, 4)}</span>
      </div>
      {children}
    </div>
  );
}

function Stat({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="rep-stat">
      <span className="rep-stat-k">{k}</span>
      <span className="rep-stat-v">{v}</span>
    </div>
  );
}

function buildFrames(m: MatchState): Frame[] {
  const frames: Frame[] = [];
  const stake = m.stake_amount;

  frames.push({
    key: "band",
    title: "THE BAND",
    caption:
      "What create_match fixed before either agent said a word. The band and the stake are immutable for the life of the match.",
    body: (
      <div className="rep-grid">
        <Stat k="price band" v={`${m.price_floor} .. ${m.price_ceil}`} />
        <Stat k="stake each" v={`${formatToken(stake)} ${TOKEN_SYMBOL}`} />
        <Stat k="escrow pool" v={`${formatToken(stake * 2n)} ${TOKEN_SYMBOL}`} />
        <Stat k="holder" v={shortAddress(m.holder, 6, 6)} />
        <Stat k="buyer" v={shortAddress(m.buyer, 6, 6)} />
        <Stat k="reveal deadline" v={m.reveal_deadline} />
        <Stat k="inconclusive deadline" v={m.inconclusive_deadline} />
      </div>
    ),
  });

  if (m.holder_committed || m.buyer_committed) {
    frames.push({
      key: "sealed",
      title: "SEALED",
      caption:
        "Each side committed H(state || salt || match_id || agent) before anything else could run. The order is what matters: the constraint was fixed before either agent chose what to claim. get_match exposes that a commitment was recorded, not the hash itself.",
      body: (
        <div className="rep-sides">
          <Side role="HOLDER" address={m.holder}>
            <p className="rep-quiet">sealed: minimum acceptable price</p>
            <p className={`rep-flag${m.holder_committed ? " rep-flag--on" : ""}`}>
              {m.holder_committed ? "COMMITMENT RECORDED" : "NEVER COMMITTED"}
            </p>
          </Side>
          <Side role="BUYER" address={m.buyer}>
            <p className="rep-quiet">sealed: maximum budget</p>
            <p className={`rep-flag${m.buyer_committed ? " rep-flag--on" : ""}`}>
              {m.buyer_committed ? "COMMITMENT RECORDED" : "NEVER COMMITTED"}
            </p>
          </Side>
        </div>
      ),
    });
  }

  if (m.holder_claimed || m.buyer_claimed) {
    frames.push({
      key: "claims",
      title: "THE CLAIMS",
      caption:
        "The exact text the jury read, anchored on-chain while both constraints were still sealed. Nothing here is paraphrased.",
      body: (
        <div className="rep-sides">
          <Side role="HOLDER" address={m.holder}>
            {m.holder_claimed ? (
              <blockquote className="rep-quote">{m.holder_claim}</blockquote>
            ) : (
              <p className="rep-quiet">no claim anchored</p>
            )}
          </Side>
          <Side role="BUYER" address={m.buyer}>
            {m.buyer_claimed ? (
              <blockquote className="rep-quote">{m.buyer_claim}</blockquote>
            ) : (
              <p className="rep-quiet">no claim anchored</p>
            )}
          </Side>
        </div>
      ),
    });
  }

  if (m.price_locked || m.holder_proposed_price > 0n || m.buyer_proposed_price > 0n) {
    frames.push({
      key: "price",
      title: "THE PRICE",
      caption:
        "The deal locks only when both proposals land on the same number inside the band. Whatever the verdict says later, this number is never rewritten.",
      body: (
        <div className="rep-grid">
          <Stat k="holder proposed" v={m.holder_proposed_price > 0n ? `${m.holder_proposed_price}` : "not proposed"} />
          <Stat k="buyer proposed" v={m.buyer_proposed_price > 0n ? `${m.buyer_proposed_price}` : "not proposed"} />
          <Stat
            k="deal price"
            v={m.price_locked ? <strong className="rep-hot">{`${m.deal_price}`}</strong> : "not locked"}
          />
        </div>
      ),
    });
  }

  if (m.holder_revealed || m.buyer_revealed) {
    frames.push({
      key: "evidence",
      title: "THE EVIDENCE",
      caption:
        "Both commitments opened and rehashed by the contract. The figures beside each constraint are arithmetic against the locked deal price, not an interpretation of anyone's claim.",
      body: (
        <>
        <div className="rep-sides">
          <Side role="HOLDER" address={m.holder}>
            {m.holder_revealed ? (
              <>
                <Stat k="minimum acceptable price" v={<strong className="rep-hot">{`${m.holder_revealed_state}`}</strong>} />
                {m.price_locked ? (
                  <Stat
                    k="deal price vs that minimum"
                    v={`${delta(m.deal_price, m.holder_revealed_state)}`}
                  />
                ) : null}
              </>
            ) : (
              <p className="rep-quiet">never revealed</p>
            )}
          </Side>
          <Side role="BUYER" address={m.buyer}>
            {m.buyer_revealed ? (
              <>
                <Stat k="maximum budget" v={<strong className="rep-hot">{`${m.buyer_revealed_state}`}</strong>} />
                {m.price_locked ? (
                  <Stat
                    k="deal price vs that budget"
                    v={`${delta(m.deal_price, m.buyer_revealed_state)}`}
                  />
                ) : null}
              </>
            ) : (
              <p className="rep-quiet">never revealed</p>
            )}
          </Side>
        </div>
        {m.coherence_known ? (
          <p className="rep-quiet">
            {m.coherent
              ? "The two revealed constraints bracket the deal price: the holder's minimum sits at or below it, and the buyer's budget at or above it."
              : "The two revealed constraints do not bracket the deal price. The contract records that and does nothing about it: what a side commits is its own business, and only the claims are judged."}
          </p>
        ) : null}
        </>
      ),
    });
  }

  const branch = BRANCHES.find((b) => b.taken(m));

  if (m.adjudicated) {
    frames.push({
      key: "verdict",
      title: "THE VERDICT",
      caption:
        "One label per claim, judged against that side's revealed constraint. The reasoning is the jury's own text as stored on-chain; validators compare the label only, never the wording.",
      proof: ["adjudicate"],
      body: (
        <div className="rep-sides">
          <Side role="HOLDER" address={m.holder}>
            <VerdictBlock label={m.holder_label} reasoning={m.holder_reasoning} />
          </Side>
          <Side role="BUYER" address={m.buyer}>
            <VerdictBlock label={m.buyer_label} reasoning={m.buyer_reasoning} />
          </Side>
        </div>
      ),
    });
  } else if (branch) {
    frames.push({
      key: "verdict",
      title: "NO VERDICT",
      caption:
        "This match never reached adjudication. It took a deterministic exit instead, and no AI call was involved in the outcome.",
      proof: [branch.method as LinkedMethod],
      body: (
        <div className="rep-branch">
          <div className="rep-branch-head">
            <span className="rep-branch-title">{branch.title}</span>
            <code>{branch.method}</code>
          </div>
          <p className="rep-branch-when">triggered when {branch.when}</p>
          <p>{branch.outcome}</p>
        </div>
      ),
    });
  }

  if (isResolved(m)) {
    frames.push({
      key: "settlement",
      title: "SETTLEMENT",
      caption:
        "Awards are recomputed from the recorded outcome using the contract's own rule, so they stay correct after each side withdraws. The unclaimed figures are live and fall to zero as claim() is called.",
      // settle is where the verdict becomes money. Claims are the withdrawals
      // that followed, and there may be nought, one or two of them.
      // A settled match got there through the scheduled self-call or through
      // the permissionless fallback, so both are worth linking; whichever was
      // not used simply is not found. A refund has its own transaction.
      proof: m.settled
        ? ["settle", "force_settle", "claim"]
        : m.refunded_before_lock
          ? ["refund_before_lock", "claim"]
          : ["claim"],
      body: <Settlement m={m} />,
    });
  }

  return frames;
}

function VerdictBlock({ label, reasoning }: { label: Label; reasoning: string }) {
  if (!label) return <p className="rep-quiet">no label recorded</p>;
  return (
    <>
      <p className={`rep-label rep-label--${label.toLowerCase()}`}>{label}</p>
      {reasoning ? (
        <blockquote className="rep-quote rep-quote--jury">{reasoning}</blockquote>
      ) : (
        <p className="rep-quiet">no reasoning stored</p>
      )}
    </>
  );
}

function Settlement({ m }: { m: MatchState }) {
  const stake = m.stake_amount;

  if (m.settled) {
    const h = settlementSplit(m.holder_label, stake);
    const b = settlementSplit(m.buyer_label, stake);
    if (h && b) {
      // When both labels are adverse the slashed portions go to the sink
      // instead of crossing, exactly as _apply_settlement does it. Crossing
      // them would pay two liars what two honest players get.
      const bothLied = isDishonest(m.holder_label) && isDishonest(m.buyer_label);
      const holderAward = bothLied ? h.agent : h.agent + b.counterparty;
      const buyerAward = bothLied ? b.agent : b.agent + h.counterparty;
      const sinkAward = bothLied ? h.counterparty + b.counterparty : 0n;
      return (
        <>
        <div className="rep-sides">
          <Side role="HOLDER" address={m.holder}>
            <Stat k="awarded" v={`${formatToken(holderAward)} ${TOKEN_SYMBOL}`} />
            <Stat k="against a stake of" v={`${formatToken(stake)} ${TOKEN_SYMBOL}`} />
            <Stat k="net" v={`${holderAward >= stake ? "+" : "-"}${formatToken(holderAward >= stake ? holderAward - stake : stake - holderAward)} ${TOKEN_SYMBOL}`} />
            <Stat k="still unclaimed" v={`${formatToken(m.holder_claimable)} ${TOKEN_SYMBOL}`} />
          </Side>
          <Side role="BUYER" address={m.buyer}>
            <Stat k="awarded" v={`${formatToken(buyerAward)} ${TOKEN_SYMBOL}`} />
            <Stat k="against a stake of" v={`${formatToken(stake)} ${TOKEN_SYMBOL}`} />
            <Stat k="net" v={`${buyerAward >= stake ? "+" : "-"}${formatToken(buyerAward >= stake ? buyerAward - stake : stake - buyerAward)} ${TOKEN_SYMBOL}`} />
            <Stat k="still unclaimed" v={`${formatToken(m.buyer_claimable)} ${TOKEN_SYMBOL}`} />
          </Side>
        </div>
        {sinkAward > 0n ? (
          <div className="rep-grid">
            <Stat k="forfeited to the sink" v={`${formatToken(sinkAward)} ${TOKEN_SYMBOL}`} />
            <Stat k="sink unclaimed" v={`${formatToken(m.sink_claimable)} ${TOKEN_SYMBOL}`} />
          </div>
        ) : null}
        </>
      );
    }
  }

  // Both deterministic exits credit balances directly rather than through a
  // label, so the recorded credits are the outcome and there is nothing to
  // recompute. Report what the contract wrote.
  const NO_REVEAL_TEXT: Record<string, string> = {
    HOLDER_REVEALED_BUYER_SLASHED: "The buyer never revealed. The whole pool went to the holder.",
    BUYER_REVEALED_HOLDER_SLASHED: "The holder never revealed. The whole pool went to the buyer.",
    BOTH_UNREVEALED_REFUNDED:
      "Neither side revealed. Nobody beat anybody, so both stakes went back to their owners and the sink took nothing.",
  };

  const what = m.no_reveal_resolved
    ? (NO_REVEAL_TEXT[m.no_reveal_outcome] ??
       "The reveal deadline passed with a side still unrevealed.")
    : m.refunded_before_lock
      ? "The two sides never agreed a deal price. Once the lock deadline passed, the stakes went back: each side was credited exactly what it funded, with nothing slashed and nothing to the sink."
      : "The jury never reached consensus before the deadline. Each side was refunded its own stake, with no slash and no transfer.";

  return (
    <>
      <p className="rep-branch-when">{what}</p>
      <div className="rep-grid">
        {m.no_reveal_outcome ? <Stat k="recorded outcome" v={m.no_reveal_outcome} /> : null}
        <Stat k="holder unclaimed" v={`${formatToken(m.holder_claimable)} ${TOKEN_SYMBOL}`} />
        <Stat k="buyer unclaimed" v={`${formatToken(m.buyer_claimable)} ${TOKEN_SYMBOL}`} />
        <Stat k="sink unclaimed" v={`${formatToken(m.sink_claimable)} ${TOKEN_SYMBOL}`} />
      </div>
    </>
  );
}

/** 0x1234abcd...ef567890, enough to eyeball against the explorer. */
function shortTx(txId: string): string {
  return txId.length > 22 ? `${txId.slice(0, 10)}...${txId.slice(-8)}` : txId;
}

/**
 * Why a method has no link, in the reader's terms.
 *
 * Two sources answer this section and a reader cannot be expected to know
 * that, so the note names both rather than quoting a block count that means
 * nothing on its own. See chain/txlog.ts for why the split exists.
 */
function missingNote(lookup: Extract<TxLookup, { state: "ready" }>): string {
  if (lookup.degraded) return `not located (${lookup.degraded})`;
  const through = lookup.snapshotBlock.toLocaleString("en-US");
  return `not located in the committed index through block ${through}, nor in the ${lookup.windowsScanned} live windows after it`;
}

/**
 * The verification strip under a frame.
 *
 * Every link here is a hash read from the chain for this specific match. When
 * a hash cannot be found the strip says so and says how far it looked. It
 * never renders a link it did not read, and it never implies a transaction
 * exists that it has not seen.
 */
function ProofLinks({ methods, lookup }: { methods: LinkedMethod[]; lookup: TxLookup }) {
  if (lookup.state === "idle") return null;

  if (lookup.state === "scanning") {
    return (
      <div className="proof">
        <span className="proof-key">ON-CHAIN PROOF</span>
        <span className="proof-wait">
          locating transactions{lookup.done ? ` (${lookup.done} of ${lookup.total} ranges)` : ""}...
        </span>
      </div>
    );
  }

  const hits = methods.flatMap((method) => lookup.txs.filter((t) => t.method === method));
  const missing = methods.filter(
    (method) => method !== "claim" && !lookup.txs.some((t) => t.method === method),
  );

  return (
    <div className="proof">
      <span className="proof-key">ON-CHAIN PROOF</span>

      {hits.map((tx) => {
        const href = explorerTxUrl(tx.txId);
        const final = tx.status === "FINALIZED";
        return (
          <span key={tx.txId} className="proof-item">
            <code className="proof-method">{tx.method}</code>
            {href ? (
              <a className="proof-link" href={href} target="_blank" rel="noreferrer noopener">
                {shortTx(tx.txId)}
              </a>
            ) : (
              <code className="proof-link">{shortTx(tx.txId)}</code>
            )}
            <span className={`proof-status${final ? " proof-status--final" : ""}`}>
              {tx.status || "UNKNOWN"}
            </span>
          </span>
        );
      })}

      {missing.map((method) => (
        <span key={method} className="proof-item proof-item--missing">
          <code className="proof-method">{method}</code>
          <span className="proof-miss">{missingNote(lookup)}</span>
        </span>
      ))}

      {!hits.length && !missing.length ? (
        <span className="proof-miss">no matching transaction found</span>
      ) : null}
    </div>
  );
}

export default function Replay({ match }: { match: MatchState | null }) {
  const frames = match ? buildFrames(match) : [];
  const [cursor, setCursor] = useState(0);

  // A match that advances while the page is open grows frames, and switching
  // match can shrink them. Clamp on the way out rather than storing a index
  // that a later poll could invalidate.
  const last = Math.max(frames.length - 1, 0);
  const at = Math.min(cursor, last);

  // Hooks run on every render, so these sit above the empty-state return.
  // The scan costs RPC, so it only starts once the reader is actually on a
  // frame whose evidence is a transaction hash.
  const settled = match?.settled ?? false;
  const noReveal = match?.no_reveal_resolved ?? false;
  const inconclusive = match?.inconclusive_resolved ?? false;
  const refunded = match?.refunded_before_lock ?? false;
  const required = useMemo(
    () => (match ? requiredMethods({
      settled,
      no_reveal_resolved: noReveal,
      inconclusive_resolved: inconclusive,
      refunded_before_lock: refunded,
    }) : []),
    [match, settled, noReveal, inconclusive, refunded],
  );
  const lookup = useMatchTransactions(
    match ? match.match_id : null,
    required,
    Boolean(frames[at]?.proof),
  );

  if (!match) {
    return (
      <section className="doc" id="replay">
        <div className="doc-head">
          <h2 className="doc-title">REPLAY</h2>
          <p className="doc-lede">
            Every match leaves a complete record on-chain: both sealed
            commitments, the claims each agent anchored before revealing
            anything, the constraints they then opened, the jury's label and
            reasoning for each claim, and the settlement that followed. Open a
            match by id at the top of this page, or create one, and its record
            is replayed here frame by frame.
          </p>
          <p className="doc-lede doc-lede--fine">
            The record has no timestamps: get_match stores state, not an event
            log, so the replay walks the contract's enforced order rather than
            a clock.
          </p>
          <p>
            <a className="linkish" href="#top">back to the top</a>
          </p>
        </div>
      </section>
    );
  }

  const live = !isResolved(match);
  const frame = frames[at];

  return (
    <section className="doc" id="replay">
      <div className="doc-head">
        <h2 className="doc-title">REPLAY</h2>
        <p className="doc-lede">
          Match #{`${match.match_id}`}, reconstructed from contract state.
          Frames appear as the record fills in, in the order the contract's
          preconditions force. There are no timestamps to show: get_match
          stores state, not an event log.
        </p>
        {live ? (
          <p className="rep-live">
            MATCH IN PROGRESS: this is the record as far as it goes.
          </p>
        ) : null}
      </div>

      <div className="rep">
        <ol className="rep-rail">
          {frames.map((f, i) => (
            <li key={f.key}>
              <button
                type="button"
                className={`rep-tab${i === at ? " rep-tab--on" : ""}`}
                onClick={() => setCursor(i)}
              >
                <span className="rep-tab-no">{String(i + 1).padStart(2, "0")}</span>
                <span className="rep-tab-title">{f.title}</span>
              </button>
            </li>
          ))}
        </ol>

        <div className="rep-frame">
          <div className="rep-frame-head">
            <span className="rep-frame-no">
              FRAME {at + 1} / {frames.length}
            </span>
            <h3 className="rep-frame-title">{frame.title}</h3>
          </div>
          <p className="rep-caption">{frame.caption}</p>
          <div className="rep-body">{frame.body}</div>
          {frame.proof ? <ProofLinks methods={frame.proof} lookup={lookup} /> : null}
          <div className="rep-nav">
            <button
              type="button"
              className="act"
              disabled={at === 0}
              onClick={() => setCursor(at - 1)}
            >
              &lt;&lt; BACK
            </button>
            <button
              type="button"
              className="act"
              disabled={at >= last}
              onClick={() => setCursor(at + 1)}
            >
              NEXT &gt;&gt;
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
