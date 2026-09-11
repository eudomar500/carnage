# Carnage security audit

An internal security review of the Carnage contract, run by the author, zkVan,
on 2026-09-08 against the contract at commit `c8e9a8d`. It covered escrow
safety, the state machine, every resolution path, access control and input
validation, and produced **22 findings across four severity levels. All 22 are
resolved**: the fixes landed in commit `c38c9af`, and the hardened contract is
deployed at `0xc60850c93d9AaB0e8C6c678B14b0B8db2d24337A` on Bradbury, from
block 21112681.

The contract that was reviewed ran at
`0x77B486Def4Fc7B18D0a7Ace31Ec3A75A0E5878Fd`. That deployment is deprecated
and must not be used.

This document summarises what was found and how each class of issue was
closed. It deliberately describes the fixes rather than the failures: there
are no triggering sequences, code paths or reproduction steps here, and none
are needed to judge whether the current contract is sound. What matters is the
invariant it now holds, and that is stated and checked below.

Method: line by line reading of the contract, plus direct mode tests against
the real thing. The hardened contract ships with 127 passing tests, 50 of
which exist specifically to prove that the issues below stay closed.

## Scope

- **In scope.** `contracts/carnage.py` and the direct mode suite under
  `tests/direct/`.
- **Partially in scope.** The web client, where a finding's fix lives there.
  L1 is the only such finding: the contract change is documentation, and the
  fix itself is in `web/src/chain/actions.ts`.
- **Out of scope.** The GenLayer consensus layer, the deployment keys, and the
  externally owned accounts that hold the deployer and sink roles.

Severity is read as impact on funds. Critical and High are findings that could
strand, misdirect or over-credit stake, Critical where no special timing or
cooperation is needed and High where a particular sequence or deadline has to
line up. Medium covers policy and correctness issues that do not by themselves
move money wrongly; Low covers hygiene, visibility and defence in depth.

## The invariant

Everything in the audit was measured against one rule:

> Funds are never permanently stranded, every failure state has a
> permissionless deadline-gated recovery, and no path can ever credit more
> than a match actually holds.

Each recovery credits by its own rule rather than handing every stake back to
whoever funded it: `refund_before_lock` and `resolve_inconclusive` credit each
side its own escrow, and `resolve_no_reveal` credits both stakes to the side
that did reveal.

The original contract failed that rule in both directions: there were states
where funded stakes could not come out, and paths where the accounting could
go past what a match held. The hardened contract holds it in both directions,
by construction and by test.

Two mechanisms do most of that work:

- **One terminal state.** Five flags mark a match finished, and a single guard
  checks all of them from every path that could add to a resolution. Once a
  match is resolved, nothing may resolve it again.
- **A per-match escrow ledger.** Every credit goes through one function that
  refuses to let the credited total exceed what the match holds, and the
  withdrawal path carries the same cap. An accounting mistake fails the
  transaction rather than reaching another match's stake.

## Findings by severity

Every finding carries an id, and the regression tests carry the same ids, so a
row and the test that keeps it closed can be read together.

### Critical (5), all resolved

| Id | Issue class | Resolved by | Pinned by |
| -- | ----------- | ----------- | --------- |
| C1 | Escrow accounting: a resolution path could credit more than the match held | Per-match escrow ledger (`escrow_total`, `credited_total`, `paid_total`) that caps every credit and every payout, plus a single terminal-state guard checked from every resolution path | `test_c1_weaponized_drain_is_closed` and five more c1 tests |
| C2 | Payout isolation: balances are pooled across matches, so an over-credit in one match could draw on another's stake | The withdrawal path now refuses to let a match pay out more than that match funded | `test_c2_claim_never_exceeds_the_match_escrow` |
| C3 | Stranded funds: several states between funding and the price lock had no exit at all | New permissionless `refund_before_lock`, deadline-gated, returning each side exactly what it funded | `test_c3_refund_before_lock_prices_never_matched` and seven more c3 tests |
| C4 | Deadline handling: a deadline accepted at creation could make the deterministic exits unusable later | Deadlines are validated and converted at creation, and every later check compares integers, so no resolution path can fail on a stored value | `test_c4_naive_deadlines_rejected`, `test_c4_mixed_naive_and_aware_deadlines_rejected` |
| C5 | Settlement liveness: an adjudicated match whose scheduled settlement never ran had no way to be settled by anyone | New permissionless `force_settle`, available `SETTLE_GRACE_SECONDS` (7200) after `adjudicated_at`, applying the same stored labels through the same rule. The grace period is sized to outlast the appeal window by design; on the record all eight settlements came through the scheduled call and `force_settle` has never run | `test_c5_force_settle_recovers_an_unsettled_verdict` and three more c5 tests |

### High (4), all resolved

| Id | Issue class | Resolved by | Pinned by |
| -- | ----------- | ----------- | --------- |
| H1 | Deadline validation: a match could be created with deadlines that left no usable window | Both deadlines must now be in the future at creation, with a minimum reveal window reserved | `test_h1_past_deadlines_rejected`, `test_h1_reveal_window_shorter_than_the_minimum_rejected` |
| H2 | Phase overlap: the negotiation phase was not bounded relative to the reveal phase | A derived lock deadline sits a full reveal window before the reveal deadline, and price proposals are refused after it | `test_h2_price_lock_after_the_lock_deadline_rejected`, `test_h2_normal_timing_is_unaffected` |
| H3 | Reveal timing: reveals were not bounded by the reveal deadline | Reveals are rejected at or after the deadline, and the deterministic resolvers require it to be strictly past, so the two can never both be legal | `test_h3_reveal_after_the_deadline_rejected` |
| H4 | Sink accessibility: a protocol sink balance could be unreachable in some configurations, and the sink could not be changed | The withdrawal path now pays every role the caller holds in one call, and the sink is transferable through a two-step propose and accept | `test_h4_party_who_is_also_the_sink_claims_both_roles` and eight more h4 tests |

### Medium (7), all resolved

| Id | Issue class | Resolved by | Pinned by |
| -- | ----------- | ----------- | --------- |
| M1 | Mutual no-reveal policy: a liveness failure by both sides was treated as a forfeiture | Both sides are now refunded their own stake, and the sink takes nothing | No new test was needed: this is a policy change inside an existing path, and the original no-reveal tests assert it, `test_resolve_no_reveal_case_b_refunds_both_sides` and `test_claim_after_case_b_pays_each_side_its_own_stake` |
| M2 | Arithmetic bounds: an extreme stake could take a resolution path outside its numeric range | Stake and price ceilings capped at `2**128 - 1`, and stakes credited separately rather than as a doubled value | `test_m2_stake_above_the_protocol_maximum_rejected`, `test_m2_price_ceiling_above_the_protocol_maximum_rejected` |
| M3 | Match creation is unrestricted, and abandoned matches accumulate | Accepted by design for now: creation holds no funds. Abandoned matches now reach a terminal state through the new refund path | No test was needed: nothing about creation changed, and the exit it relies on is covered by the c3 tests |
| M4 | Error typing: some invalid input surfaced as a raw runtime error rather than the contract's own rejection class | Input parsing wrapped so every rejection is a `UserError` carrying the `[EXPECTED]` marker | `test_m4_malformed_deadline_raises_expected_user_error` |
| M5 | Incentive symmetry: two adverse labels cancelled out, paying two liars what two honest players get | When both labels are adverse the slashed portions go to the protocol sink instead of crossing | `test_m5_both_adverse_sends_the_crossed_portion_to_the_sink`, `test_m5_single_liar_outcomes_are_unchanged` |
| M6 | Evidence coherence was neither checked nor visible | Recorded and exposed as a flag, deliberately not enforced, so bluffing remains possible and the relationship remains visible | `test_m6_coherence_is_recorded_but_not_enforced`, `test_m6_coherent_match_records_true` |
| M7 | Observability: most resolution paths emitted nothing | Every path that credits or pays now emits an event carrying the outcome and the amounts. Two limits are worth knowing: `MatchInconclusiveRefunded` carries `stake_amount` rather than the credited amounts, and `adjudicate` emits no event at all, which is why a discarded jury round is visible only in the consensus log | `test_m7_every_resolution_path_emits_an_event` |

### Low (6), all resolved

| Id | Issue class | Resolved by | Pinned by |
| -- | ----------- | ----------- | --------- |
| L1 | A view could be used in a way that exposed a secret before it was committed | The contract change is documentation only: the view is marked verification-only and is still callable by anyone with any arguments. The fix is in the client, which builds the commitment hash locally in `web/src/chain/actions.ts`, so the secret never leaves the browser | No contract test, because the contract behaviour is unchanged |
| L2 | Deadline boundary semantics were not consistent | Deadlines are exclusive on both sides, so the deadline instant belongs to neither phase | `test_l2_deadline_instant_belongs_to_neither_phase` |
| L3 | Unbounded inputs on a hashing helper | Upper bound added alongside the existing lower bound | `test_l3_oversized_salt_rejected` |
| L4 | State visibility: the sink and the escrow ledger were not readable from outside | Both exposed through the match view | `test_l4_get_match_exposes_the_sink_and_the_escrow_ledger` |
| L5 | Value could reach methods that had no use for it | Value is rejected on every externally reachable method except `fund_holder` and `fund_buyer`. `settle` is the deliberate exception and does not carry the guard: its sender check already limits it to the contract's own scheduled self-call, which never carries value, and a revert on that path would hold the payout until the `force_settle` grace period opened | `test_l5_non_payable_method_rejects_value`, which exercises one method |
| L6 | No pause or upgrade path | Accepted by design and deliberately not added. The recovery paths above make an emergency stop unnecessary for fund safety, and a pause would itself be a way to strand funds | No test was needed: nothing was added |

## Fund conservation

Confirmed against the contract in direct mode, across every outcome the jury
can produce and every deterministic exit. The credited total equals the escrow
exactly in every case. Stake is 500 per side, escrow 1000.

| Outcome | Holder | Buyer | Sink | Credited | Escrow |
| ------- | ------ | ----- | ---- | -------- | ------ |
| TRUE + TRUE | 500 | 500 | 0 | 1000 | 1000 |
| FALSE + TRUE | 0 | 1000 | 0 | 1000 | 1000 |
| TRUE + FALSE | 1000 | 0 | 0 | 1000 | 1000 |
| MISLEADING + TRUE | 250 | 750 | 0 | 1000 | 1000 |
| TRUE + MISLEADING | 750 | 250 | 0 | 1000 | 1000 |
| AMBIGUOUS or UNSUPPORTED, either side | 500 | 500 | 0 | 1000 | 1000 |
| FALSE + FALSE | 0 | 0 | 1000 | 1000 | 1000 |
| FALSE + MISLEADING | 0 | 250 | 750 | 1000 | 1000 |
| MISLEADING + MISLEADING | 250 | 250 | 500 | 1000 | 1000 |
| Odd stake (501 per side), any pair | conserves | conserves | conserves | 1002 | 1002 |
| No reveal, one side revealed | 1000 to the revealer | 0 | 0 | 1000 | 1000 |
| No reveal, neither side revealed | 500 | 500 | 0 | 1000 | 1000 |
| Inconclusive after the deadline | 500 | 500 | 0 | 1000 | 1000 |
| Refunded before the price lock | 500 | 500 | 0 | 1000 | 1000 |

The full 25-pair label matrix was run through adjudication and settlement, and
every pair conserves. Odd stakes conserve with no rounding leak, because
integer division rounds in the party's favour and the two halves are credited
separately.

A discarded jury round produces no row here, because it credits nothing. A
transaction carries two independent outcomes: status is the lifecycle, where
FINALIZED means the consensus process for that transaction is over, and result
is the acceptance, which says whether its writes were applied. Two rounds on
this contract finalized with a non-accepting result, TIMEOUT on match 3 and
NO_MAJORITY on match 8, and neither wrote anything to contract state. Both
stakes stayed in escrow, and each match was adjudicated again by a later
permissionless call rather than resolving through the inconclusive path. The
hashes are in `resolution.md`, item 4.

## What did not need changing

Worth recording, because an audit that finds everything broken usually is not
reading carefully. These were checked and found correct as they stood:

- The per-label payout rule conserves funds for all 25 label pairs, including
  odd stakes. The hardened contract changes where a slashed portion goes when
  both sides lie, and changes no amount.
- The withdrawal path follows checks-effects-interactions and cannot pay
  twice.
- Every role-gated method rejects both a stranger and the opposite seat.
- The commitment scheme binds state, salt, match id and agent address, so a
  commitment cannot be replayed across matches or seats. It is unchanged.
- The five-label rubric, its ordered decision procedure and the prompt
  injection defense are unchanged. The audit was about the escrow around the
  mechanic, not the mechanic.

## Verification

The hardened contract carries 127 direct mode tests, all passing. 77 of them
predate the review and keep the same count; three of those files were edited
during hardening, so they are the original suite by coverage rather than
untouched, and they are what demonstrates the game mechanic is intact. The
other 50 are the regression suite in `tests/direct/test_carnage_security.py`:
48 carry a finding id, 2 are the id-free conservation tests, and 4 findings
have no test for the reasons given in the tables above.

The deployed build was confirmed on-chain after redeployment, by reading
behaviour that exists only in the hardened contract: `get_match` on
`0xc60850c93d9AaB0e8C6c678B14b0B8db2d24337A` returns `sink_address`,
`pending_sink`, `escrow_total`, `credited_total` and `paid_total`, and
`get_match` on the superseded `0x77B486Def4Fc7B18D0a7Ace31Ec3A75A0E5878Fd`
returns none of them.

## Residual risks

Closed findings are not the whole picture. These are known, accepted and
recorded here so that nobody has to rediscover them:

- **No stake-to-price bound.** `stake_amount` is validated only as positive
  and below the protocol maximum. Nothing ties it to the price band or the
  deal price, so sizing the stake against the band is the match creator's job.
- **Coherence is recorded, not enforced.** The contract records whether the
  two revealed constraints bracket the deal price and never acts on it. That
  is the M6 decision, and it stands.
- **The sink started as the deployer.** That is how it stood at the time of
  this review. It has since been moved to
  `0x35294C883716E2fd7614eD85348bF4F712BCe07a` through the two-step handover,
  both transactions on-chain.
- **The deterministic exits have never run on-chain.** `refund_before_lock`,
  `resolve_no_reveal`, `resolve_inconclusive` and `force_settle` are proven in
  direct mode and nowhere else. The record holds no call to any of them.
- **`settle` carries no value guard.** By design, see L5. It is reachable only
  by the contract's own scheduled self-call.
- **`adjudicate` emits no event.** The verdict is readable from contract
  state, but a discarded round is visible only in the consensus log.
- **The `_require_not_resolved` docstring says four flags and checks five.**
  Left alone deliberately: the contract file in the repo is byte-identical to
  the deployed code, which is worth more than a corrected comment.
