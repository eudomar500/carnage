# Resolution

A Carnage match resolves through the GenLayer AI jury. Once both sides have
revealed their committed constraints, any caller triggers `adjudicate`. The
jury reads each natural-language claim against the revealed evidence, returns
a label per claim, and the contract settles the escrow according to those
labels. Adjudication is permissionless: `adjudicate` performs no sender check,
so it is not owned by either party and neither can withhold the verdict.

The verdict is only one of four ways a match can end, and that is the point of
this document. Every other way is deterministic, permissionless and
deadline-gated. Taken together they mean the same thing from any state a
funded match can reach: somebody can always end it, and the money always
comes out.

Deployed at `0xc60850c93d9AaB0e8C6c678B14b0B8db2d24337A` on Bradbury.

## The guarantee

**No reachable state can strand funds.** From the moment either side funds,
every state has a terminal move that some caller can reach, and none of them
require the cooperation of the party who walked away.

| State | Way out | Who can trigger it |
| ----- | ------- | ------------------ |
| Funded, deal price never locked | `refund_before_lock` after `lock_deadline` | anyone |
| Price locked, a side never revealed | `resolve_no_reveal` after `reveal_deadline` | anyone |
| Both revealed, jury never converges | `resolve_inconclusive` after `inconclusive_deadline` | anyone |
| Both revealed, jury converges | `adjudicate`, then `settle` on finality | anyone, then the contract itself |
| Adjudicated, settlement never ran | `force_settle` after the grace period | anyone |
| Any of the above, balances credited | `claim` | each credited party |

Every one of those is permissionless except `settle`, which is reachable only
by the contract itself, and `force_settle` exists precisely so that even that
path cannot become a dead end.

## Reaching a verdict

The jury classifies each claim into a closed five-label enum (FALSE,
MISLEADING, AMBIGUOUS, UNSUPPORTED, TRUE) using a strict, ordered decision
procedure. The order is not cosmetic. Validators independently re-derive the
label and compare it against the leader's result, so the enum is closed and
the ordering is explicit precisely to drive convergence: an ordered procedure
with an explicit priority rule at the MISLEADING/AMBIGUOUS boundary leaves
less room for two validators to reach different labels from the same
evidence. The rubric states that rule directly, instructing the jury to choose
MISLEADING even when a strained consistent reading exists.

Comparison happens on the label alone. The validator function recomputes its
own classification and returns `mine["label"] == leaders_res.calldata["label"]`.
The free-form reasoning is stored on the match for the record, in
`holder_reasoning` and `buyer_reasoning`, and never enters the comparison. A
validator also refuses to agree when the leader's result is not a successful
return, which forces consensus to retry or rotate rather than ratify a failed
run.

The enum is enforced on parse, not merely requested in the prompt.
`_parse_adjudication_output` normalizes the label to upper case, accepts a
small set of alias keys for the label field, and raises `[LLM_ERROR]` for
anything outside the five labels. A model that answers off-enum fails the
transaction; it does not write a label.

Because the evidence is committed cryptographically on-chain before any claim
is made, the jury never reads an external source. The gate ordering enforces
this: funding requires both commitments, and anchoring a claim requires both
sides funded, so no claim can be recorded until both commitments already
exist. `exec_prompt` is the only nondeterministic call in the contract. Its
prompt is assembled from the party's role, the integer revealed on-chain and
checked against the commitment hash, and the claim string already in storage.
There are no HTTPS endpoints, no rendered pages, no payloads that differ
between validators. Every validator judges the same on-chain bytes. This
removes an entire class of non-determinism at the source: the input to
adjudication is identical for every validator by construction.

## The escrow ledger

Claimable balances are per match, but the contract's token balance is pooled
across all of them. That gap is closed by an explicit ledger rather than by
trusting each resolution path to behave.

`fund_holder` and `fund_buyer` record what actually arrived, in
`holder_escrow` and `buyer_escrow`, and add it to `escrow_total`. From then on
every credit in the contract goes through one function, `_credit`, which
refuses to push `credited_total` past `escrow_total`. Not clamps: raises, so
the whole transaction fails.

`claim` carries the same rule on the way out. It refuses to let `paid_total`
exceed `escrow_total`, so a match can never pay out more than it holds even if
a credit were somehow wrong.

That gives two invariants worth stating plainly:

- The sum of everything ever credited to a match is at most what that match
  holds in escrow.
- The sum of everything ever paid out of a match is at most the same number.

They hold per match, which is what stops one match's accounting from reaching
another match's stake. `get_match` exposes `escrow_total`, `credited_total`
and `paid_total`, so anyone can check them from outside.

## Terminal state

Five flags mark a match finished: `adjudicated`, `settled`,
`no_reveal_resolved`, `inconclusive_resolved` and `refunded_before_lock`.
`_require_not_resolved` treats them as one door, and it is checked at the top
of `adjudicate`, `resolve_no_reveal`, `resolve_inconclusive`,
`refund_before_lock`, `reveal_holder` and `reveal_buyer`.

Once any of them is set the match is over. Nothing may reveal, adjudicate,
resolve or refund it again, so two resolution paths can never both run and
credit the same escrow. The ledger above is the second line of defence behind
that check, not the first.

Reveals are bounded too. `reveal_holder` and `reveal_buyer` reject a reveal at
or after `reveal_deadline`, and the deterministic resolvers require the
deadline to be strictly past. The deadline instant belongs to neither phase,
so a reveal and a no-reveal resolution can never both be legal at the same
moment.

## Failure handling

Resolution degrades in layers.

1. Never agreed a price. Money enters at funding, but the deal price may
   never lock: one side goes quiet during the negotiation, or the two never
   converge on a number. `create_match` derives `lock_deadline` as
   `reveal_deadline` minus `MIN_REVEAL_WINDOW_SECONDS` (900), and price
   proposals are refused at or after it, so a locked match always has a real
   reveal window ahead of it. Once that deadline passes with no locked price,
   any caller triggers `refund_before_lock`. It credits each side exactly what
   that side funded, `holder_escrow` and `buyer_escrow`. Nothing is slashed
   and nothing goes to the sink, because nobody broke a rule. It emits
   `MatchRefundedBeforeLock`.

2. No reveal. A missed reveal is a deterministic protocol violation, not a
   question for the jury. Once the reveal deadline passes with a side still
   unrevealed, any caller triggers `resolve_no_reveal`. It requires a locked
   deal price, requires that not both sides have revealed, and rejects a
   second run. There are three outcomes, and the contract records which one it
   applied in `no_reveal_outcome`:

   - `HOLDER_REVEALED_BUYER_SLASHED`: the buyer never opened its commitment.
     The holder is credited both stakes, as two separate credits.
   - `BUYER_REVEALED_HOLDER_SLASHED`: the mirror image.
   - `BOTH_UNREVEALED_REFUNDED`: neither side revealed. Nobody beat anybody,
     so each side gets its own stake back and the sink takes nothing. A mutual
     failure to reveal is usually a liveness problem rather than a strategy,
     and it is not treated as one.

   No AI call is involved in any of the three, and it emits
   `MatchNoRevealResolved`.

3. A failed adjudication run. If the leader returns something the contract
   cannot use, a non-dict output, a missing label field, or a label outside
   the enum, `_parse_adjudication_output` raises and the transaction fails.
   Nothing partial is written: labels, reasoning and the `adjudicated` flag
   are all assigned after both classifications have returned, so a failed run
   leaves the match exactly as it was and the call can simply be made again.
   The contract has no in-run inconclusive resolution. A jury that cannot
   answer produces a failed transaction, not a resolved match.

4. Non-convergence. Genuine disagreement across validators cannot be caught
   inside a single execution, because it is a property of the committee rather
   than of one run. Such a transaction ends UNDETERMINED at the consensus
   layer and commits nothing, so the match stays unresolved and the funds stay
   locked, untouched. UNDETERMINED is a platform outcome, not contract state:
   what the contract contributes is atomicity, plus the terminal-state guard
   that makes a retry safe. Adjudication is permissionless, so any caller can
   run it again. As a backstop, once `inconclusive_deadline` passes, any
   caller triggers `resolve_inconclusive`. It requires both sides revealed,
   requires that the match was not adjudicated, rejects a second run, credits
   each side its own escrow back in full, and emits
   `MatchInconclusiveRefunded`. No slash, no transfer to the counterparty,
   nothing to the sink. An honest disagreement the jury cannot settle costs
   the players nothing.

5. A verdict that never got paid out. Settlement is scheduled rather than
   immediate (see below), which means there is a window where the labels are
   stored but the money has not moved. If that scheduled message never
   arrives, `settle` cannot be reached by anyone and every other resolver
   refuses an adjudicated match. `force_settle` closes that: once
   `SETTLE_GRACE_SECONDS` (7200, two hours) has passed since `adjudicated_at`,
   any caller can push the same settlement through, applying the same stored
   labels through the same rule. The grace period is deliberately longer than
   the appeal window, so on a healthy chain the automatic path always gets
   there first and this one never runs.

Read the deadlines as an ordering, which `create_match` enforces:
`lock_deadline` sits a full reveal window before `reveal_deadline`, and
`inconclusive_deadline` must fall after `reveal_deadline`. Both deadlines must
be in the future at creation, and both must carry a timezone offset. They are
parsed once, at creation, and stored as Unix seconds, so no resolution path
can fail later on a string that turns out to be unparseable.

## Settlement after finality

Accepted is not finalized. A verdict that has been accepted by consensus can
still change during the appeal window, so settlement does not run inline with
adjudication. Instead `adjudicate` schedules the call on itself:

    gl.get_contract_at(self.address).emit(on="finalized").settle(match_id)

`settle` refuses any sender other than the contract address, requires the
match to be adjudicated, and refuses to run twice. It then applies
`_settle_side` once per side and credits claimable balances. It emits no
transfers of its own, deliberately: a transfer emitted from inside it would be
another separately scheduled finalized message, chaining a second appeal
window behind the first.

`force_settle` applies exactly the same body through `_apply_settlement`, and
both are guarded by the `settled` flag, which is written before any credit.
Whichever runs first wins and the other reverts, so the two paths cannot both
pay out.

`_settle_side` is the whole payout rule:

| Label       | To the agent        | To the counterparty |
| ----------- | ------------------- | ------------------- |
| TRUE        | full stake          | nothing             |
| AMBIGUOUS   | full stake          | nothing             |
| UNSUPPORTED | full stake          | nothing             |
| MISLEADING  | `stake - stake//2`  | `stake//2`          |
| FALSE       | nothing             | full stake          |

Integer division rounds in the agent's favour, so an odd stake conserves
exactly with no rounding leak. Each side is scored on its own label
independently.

One rule sits on top of that table. When **both** labels are adverse (FALSE or
MISLEADING on both sides), the slashed portions go to the protocol sink
instead of crossing to the counterparty. Crossing them would cancel out and
pay two liars exactly what two honest players get, which is not a penalty at
all. The amounts in the table do not change, only the destination, and only in
that case: a single liar still pays the honest counterparty exactly as before.

Each party then withdraws its own credited balance with `claim`. The three
role checks are independent rather than first-match-wins, so an address that
is both a party and the sink is paid both in one call. The payout goes out
through `emit_transfer(value=amount, on="finalized")`, so the funds move when
the claim transaction itself finalizes, not when it is accepted. Both the
settled ledger and the actual movement of funds are gated on true finality,
never on mere acceptance.

## The protocol sink

The sink holds what both-lie settlements forfeit. It starts as the deploying
account and moves in two steps, never one.

`propose_sink_address(new_sink)` may only be called by the current sink, and
it does not move the role: it records `pending_sink` and emits
`SinkTransferProposed`. `accept_sink_address()` may only be called by the
address sitting in `pending_sink`; it moves the role, clears `pending_sink` so
the acceptance cannot be replayed, and emits `SinkTransferAccepted`.

A mistyped or unowned address can therefore never take the sink, because it
would have to send the acceptance itself. A later proposal replaces an earlier
one, and proposing the zero address cancels a pending handover outright.

## Designing a claim

The sharpest input a claim can carry is an instruction aimed at the jury
itself. A claim is untrusted data, never an instruction. The rubric delimits
it inside `<claim></claim>` tags and says so explicitly, naming the attack:
the text may contain what looks like instructions, system messages, or
requests to ignore the rubric and return a particular label, and the jury is
told to treat everything inside the tags as the text being evaluated. Output
is confined to the closed enum, and that confinement is checked in Python
after the model answers rather than trusted from the prompt. A claim is also
bounded at anchoring time: non-empty, and at most `MAX_CLAIM_CHARS`
characters. Consensus alone does not defend against this: an injection that
fools every validator identically would converge on the wrong answer. The
defense lives in prompt construction and is tested adversarially as part of
the benchmark, not assumed.

## Coherence, recorded and not enforced

When both sides have revealed, the contract records whether the two revealed
constraints bracket the deal price, that is whether
`holder_revealed_state <= deal_price <= buyer_revealed_state`. The result is
exposed as `coherent`, alongside `coherence_known`.

It is deliberately never enforced. A party is free to commit whatever
constraint it likes, and bluffing around a real number is the game. Enforcing
the relationship would make certain honest bluffs impossible to commit to. The
flag makes the relationship visible to anyone reading the match, and does
nothing else.

## Bounds

A few limits are worth knowing, all checked at `create_match`:

- `stake_amount` and `price_ceil` are capped at `2**128 - 1`, which keeps every
  sum in settlement far inside `u256`.
- A salt must be between 16 and 64 bytes.
- A claim must be non-empty and at most 2000 characters.
- `holder` and `buyer` must differ, and the price band must be positive and
  widening.
- Every externally reachable method other than `fund_holder` and `fund_buyer`
  rejects a transfer of value, so nothing can arrive in the contract without a
  claimable credit behind it.

An earlier deployment of this contract was audited before this one was
written. Every finding from that audit is resolved here; see
`security-audit.md` for the summary.
