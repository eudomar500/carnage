# Carnage security audit

A full security audit was performed on the Carnage contract before launch,
covering escrow safety, the state machine, every resolution path, access
control and input validation. It produced **22 findings across four severity
levels. All 22 are resolved** in the hardened contract deployed at
`0xc60850c93d9AaB0e8C6c678B14b0B8db2d24337A` on Bradbury.

The audit was run against an earlier deployment, which is deprecated and
should not be interacted with. This document summarises what was found and how
each class of issue was closed. It deliberately describes the fixes rather
than the failures: there are no triggering sequences, code paths or
reproduction steps here, and none are needed to judge whether the current
contract is sound. What matters is the invariant it now holds, and that is
stated and checked below.

Method: line by line reading of the contract, plus direct mode tests against
the real thing for every finding and every fix. The hardened contract ships
with 127 passing tests, 50 of which exist specifically to prove that the
issues below stay closed.

## The invariant

Everything in the audit was measured against one rule:

> Funds are never permanently stranded, every failure state has a
> permissionless deadline-gated recovery that returns the stakes to their
> owners, and no path can ever credit more than a match actually holds.

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

### Critical (5), all resolved

| Issue class | Resolved by |
| ----------- | ----------- |
| Escrow accounting: a resolution path could credit more than the match held | Per-match escrow ledger (`escrow_total`, `credited_total`, `paid_total`) that caps every credit and every payout, plus a single terminal-state guard checked from every resolution path |
| Payout isolation: balances are pooled across matches, so an over-credit in one match could draw on another's stake | The withdrawal path now refuses to let a match pay out more than that match funded |
| Stranded funds: several states between funding and the price lock had no exit at all | New permissionless `refund_before_lock`, deadline-gated, returning each side exactly what it funded |
| Deadline handling: a deadline accepted at creation could make the deterministic exits unusable later | Deadlines are validated and converted at creation, and every later check compares integers, so no resolution path can fail on a stored value |
| Settlement liveness: an adjudicated match whose scheduled settlement never ran had no way to be settled by anyone | New permissionless `force_settle`, available after a grace period longer than the appeal window, applying the same stored labels through the same rule |

### High (4), all resolved

| Issue class | Resolved by |
| ----------- | ----------- |
| Deadline validation: a match could be created with deadlines that left no usable window | Both deadlines must now be in the future at creation, with a minimum reveal window reserved |
| Phase overlap: the negotiation phase was not bounded relative to the reveal phase | A derived lock deadline sits a full reveal window before the reveal deadline, and price proposals are refused after it |
| Reveal timing: reveals were not bounded by the reveal deadline | Reveals are rejected at or after the deadline, and the deterministic resolvers require it to be strictly past, so the two can never both be legal |
| Sink accessibility: a protocol sink balance could be unreachable in some configurations, and the sink could not be changed | The withdrawal path now pays every role the caller holds in one call, and the sink is transferable through a two-step propose and accept |

### Medium (7), all resolved

| Issue class | Resolved by |
| ----------- | ----------- |
| Mutual no-reveal policy: a liveness failure by both sides was treated as a forfeiture | Both sides are now refunded their own stake, and the sink takes nothing |
| Incentive symmetry: two adverse labels cancelled out, paying two liars what two honest players get | When both labels are adverse the slashed portions go to the protocol sink instead of crossing |
| Arithmetic bounds: an extreme stake could take a resolution path outside its numeric range | Stake and price ceilings capped at `2**128 - 1`, and stakes credited separately rather than as a doubled value |
| Error typing: some invalid input surfaced as a raw runtime error rather than the contract's own rejection class | Input parsing wrapped so every rejection is a `UserError` carrying the `[EXPECTED]` marker |
| Match creation is unrestricted, and abandoned matches accumulate | Reviewed and accepted for now: creation holds no funds. Abandoned matches now reach a terminal state through the new refund path |
| Evidence coherence was neither checked nor visible | Recorded and exposed as a flag, deliberately not enforced, so bluffing remains possible and the relationship remains visible |
| Observability: most resolution paths emitted nothing | Every resolution path and the withdrawal path now emit an event carrying the outcome and the amounts |

### Low (6), all resolved

| Issue class | Resolved by |
| ----------- | ----------- |
| A view could be used in a way that exposed a secret before it was committed | Documented as verification only, and the front end now derives the value locally so the secret never leaves the browser |
| Deadline boundary semantics were not consistent | Deadlines are exclusive on both sides, so the deadline instant belongs to neither phase |
| Unbounded inputs on a hashing helper | Upper bound added alongside the existing lower bound |
| State visibility: the sink and the escrow ledger were not readable from outside | Both exposed through the match view |
| Value could reach methods that had no use for it | Every externally reachable method except the two funding calls now rejects a transfer of value |
| No pause or upgrade path | Reviewed and deliberately not added. The recovery paths above make an emergency stop unnecessary for fund safety, and a pause would itself be a way to strand funds |

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
| Undetermined at consensus | nothing committed, retryable, exits through the inconclusive path | | | 0 | 1000 |

The full 25-pair label matrix was run through adjudication and settlement, and
every pair conserves. Odd stakes conserve with no rounding leak, because
integer division rounds in the agent's favour and the two halves are credited
separately.

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

The hardened contract carries 127 direct mode tests. 77 of them are the
original suite, which still passes and is what demonstrates the game mechanic
is intact. 50 are new and exist to keep the audit findings closed: each maps
to a finding and fails if that class of issue is reintroduced.

The deployed build was confirmed on-chain after redeployment, by reading
behavior that exists only in the hardened contract.
