"""Exploit-closed tests for the security batch.

Every test here maps to a finding in docs/security-audit.md. The naming
convention is the finding id, so a regression points straight back at what it
would reopen.
"""

import itertools
import json

from conftest import (
    _addr,
    _new_match,
    _commit_both,
    _fund_both,
    _claim_both,
    _lock_price,
    _reveal_both,
    _run_to_locked_price,
    _run_to_revealed,
    _capture_post_messages,
    _post_messages,
    _contract_self_address,
    _transfers_to,
    _warp,
    HOLDER_SALT,
    BUYER_SALT,
    HOLDER_MIN_PRICE,
    BUYER_MAX_BUDGET,
    DEAL_PRICE,
    STAKE,
    DEADLINE,
    INCONCLUSIVE_DEADLINE,
)

HOLDER_PATTERN = r"(?s)minimum acceptable price.*<claim>.*</claim>"
BUYER_PATTERN = r"(?s)maximum budget.*<claim>.*</claim>"

BEFORE = "2026-06-01T00:00:00Z"
AT_REVEAL_DEADLINE = DEADLINE
AFTER_REVEAL = "2027-01-01T00:00:00Z"
AFTER_INCONCLUSIVE = "2027-06-01T00:00:00Z"

LABELS = ("TRUE", "FALSE", "MISLEADING", "AMBIGUOUS", "UNSUPPORTED")
ADVERSE = ("FALSE", "MISLEADING")


def _adjudicate_with_labels(contract, direct_vm, match_id, holder_label, buyer_label):
    direct_vm.mock_llm(HOLDER_PATTERN, json.dumps({"label": holder_label, "reasoning": "x"}))
    direct_vm.mock_llm(BUYER_PATTERN, json.dumps({"label": buyer_label, "reasoning": "x"}))
    contract.adjudicate(match_id)
    direct_vm.clear_mocks()


def _settle_as_self(contract, direct_vm, match_id):
    prev = direct_vm.sender
    direct_vm.sender = _contract_self_address(direct_vm)
    contract.settle(match_id)
    direct_vm.sender = prev


def _balances(contract, match_id):
    m = contract.get_match(match_id)
    return m["holder_claimable"], m["buyer_claimable"], m["sink_claimable"]


def _assert_conserved(contract, match_id):
    m = contract.get_match(match_id)
    total = m["holder_claimable"] + m["buyer_claimable"] + m["sink_claimable"]
    assert m["credited_total"] == m["escrow_total"], "credited total must equal escrow"
    assert total + m["paid_total"] == m["escrow_total"], "credits plus payouts must equal escrow"


# ---- C1: the drain ---------------------------------------------------------


def test_c1_weaponized_drain_is_closed(direct_vm, direct_deploy, direct_alice, direct_bob, direct_owner):
    """The full attack from the audit, step by step, against the fixed contract.

    Before the fix this credited 4000 against 2000 escrowed and paid both
    claims out in full.
    """
    direct_vm.warp(BEFORE)
    contract = direct_deploy("contracts/carnage.py")
    alice, bob = _addr(direct_alice), _addr(direct_bob)

    # step 0: the attacker's preferred setup, deadlines already in the past,
    # is refused outright.
    direct_vm.sender = alice
    with direct_vm.expect_revert("more than 900 seconds in the future"):
        contract.create_match(alice, bob, 500, 1000, STAKE, "2020-01-01T00:00:00Z", "2020-02-01T00:00:00Z")

    # step 1: with honest deadlines, run the same sequence anyway.
    match_id = _run_to_locked_price(contract, direct_vm, direct_alice, direct_bob, direct_owner)
    direct_vm.sender = alice
    contract.reveal_holder(match_id, HOLDER_MIN_PRICE, HOLDER_SALT)

    _warp(direct_vm, AFTER_REVEAL)
    assert contract.resolve_no_reveal(match_id) == "HOLDER_REVEALED_BUYER_SLASHED"
    assert _balances(contract, match_id) == (STAKE * 2, 0, 0)

    # step 2: the late reveal that used to reopen the verdict path. Two
    # independent guards now refuse it, the terminal flag and the deadline.
    direct_vm.sender = bob
    with direct_vm.expect_revert("already resolved as a no-reveal"):
        contract.reveal_buyer(match_id, BUYER_MAX_BUDGET, BUYER_SALT)

    # step 3: neither follow-up resolution is reachable.
    with direct_vm.expect_revert("both parties must reveal before adjudication"):
        contract.adjudicate(match_id)
    _warp(direct_vm, AFTER_INCONCLUSIVE)
    with direct_vm.expect_revert("both parties must reveal before an inconclusive resolution"):
        contract.resolve_inconclusive(match_id)

    # nothing beyond the single resolution was ever credited
    assert _balances(contract, match_id) == (STAKE * 2, 0, 0)
    _assert_conserved(contract, match_id)

    # and the payout is bounded by the escrow
    direct_vm.sender = alice
    assert contract.claim(match_id) == STAKE * 2
    m = contract.get_match(match_id)
    assert m["paid_total"] == m["escrow_total"] == STAKE * 2


def test_c1_seq1_no_reveal_then_late_reveal_then_inconclusive_reverts(direct_vm, direct_deploy, direct_alice, direct_bob, direct_owner):
    direct_vm.warp(BEFORE)
    contract = direct_deploy("contracts/carnage.py")
    match_id = _run_to_locked_price(contract, direct_vm, direct_alice, direct_bob, direct_owner)
    direct_vm.sender = _addr(direct_alice)
    contract.reveal_holder(match_id, HOLDER_MIN_PRICE, HOLDER_SALT)

    _warp(direct_vm, AFTER_REVEAL)
    contract.resolve_no_reveal(match_id)

    direct_vm.sender = _addr(direct_bob)
    with direct_vm.expect_revert("already resolved as a no-reveal"):
        contract.reveal_buyer(match_id, BUYER_MAX_BUDGET, BUYER_SALT)

    _warp(direct_vm, AFTER_INCONCLUSIVE)
    with direct_vm.expect_revert("both parties must reveal before an inconclusive resolution"):
        contract.resolve_inconclusive(match_id)
    _assert_conserved(contract, match_id)


def test_c1_seq2_no_reveal_then_adjudicate_reverts(direct_vm, direct_deploy, direct_alice, direct_bob, direct_owner):
    direct_vm.warp(BEFORE)
    contract = direct_deploy("contracts/carnage.py")
    match_id = _run_to_locked_price(contract, direct_vm, direct_alice, direct_bob, direct_owner)
    direct_vm.sender = _addr(direct_alice)
    contract.reveal_holder(match_id, HOLDER_MIN_PRICE, HOLDER_SALT)

    _warp(direct_vm, AFTER_REVEAL)
    contract.resolve_no_reveal(match_id)

    with direct_vm.expect_revert("both parties must reveal before adjudication"):
        contract.adjudicate(match_id)
    _assert_conserved(contract, match_id)


def test_c1_seq3_inconclusive_then_adjudicate_reverts(direct_vm, direct_deploy, direct_alice, direct_bob, direct_owner):
    direct_vm.warp(BEFORE)
    contract = direct_deploy("contracts/carnage.py")
    match_id = _run_to_revealed(contract, direct_vm, direct_alice, direct_bob, direct_owner)

    _warp(direct_vm, AFTER_INCONCLUSIVE)
    contract.resolve_inconclusive(match_id)
    assert _balances(contract, match_id) == (STAKE, STAKE, 0)

    with direct_vm.expect_revert("already resolved as inconclusive"):
        contract.adjudicate(match_id)

    # settle cannot be reached either, even from the contract itself
    direct_vm.sender = _contract_self_address(direct_vm)
    with direct_vm.expect_revert("match has not been adjudicated"):
        contract.settle(match_id)
    assert _balances(contract, match_id) == (STAKE, STAKE, 0)
    _assert_conserved(contract, match_id)


def test_c1_seq4_mutual_refund_then_late_reveals_revert(direct_vm, direct_deploy, direct_alice, direct_bob, direct_owner):
    direct_vm.warp(BEFORE)
    contract = direct_deploy("contracts/carnage.py")
    match_id = _run_to_locked_price(contract, direct_vm, direct_alice, direct_bob, direct_owner)

    _warp(direct_vm, AFTER_REVEAL)
    assert contract.resolve_no_reveal(match_id) == "BOTH_UNREVEALED_REFUNDED"

    direct_vm.sender = _addr(direct_alice)
    with direct_vm.expect_revert("already resolved as a no-reveal"):
        contract.reveal_holder(match_id, HOLDER_MIN_PRICE, HOLDER_SALT)
    direct_vm.sender = _addr(direct_bob)
    with direct_vm.expect_revert("already resolved as a no-reveal"):
        contract.reveal_buyer(match_id, BUYER_MAX_BUDGET, BUYER_SALT)

    assert _balances(contract, match_id) == (STAKE, STAKE, 0)
    _assert_conserved(contract, match_id)


def test_c1_adjudicate_then_resolvers_revert(direct_vm, direct_deploy, direct_alice, direct_bob, direct_owner):
    direct_vm.warp(BEFORE)
    contract = direct_deploy("contracts/carnage.py")
    match_id = _run_to_revealed(contract, direct_vm, direct_alice, direct_bob, direct_owner)
    _adjudicate_with_labels(contract, direct_vm, match_id, "TRUE", "TRUE")
    _settle_as_self(contract, direct_vm, match_id)

    _warp(direct_vm, AFTER_INCONCLUSIVE)
    with direct_vm.expect_revert("match was already adjudicated"):
        contract.resolve_inconclusive(match_id)
    with direct_vm.expect_revert("match has already been adjudicated"):
        contract.resolve_no_reveal(match_id)
    with direct_vm.expect_revert("match already adjudicated"):
        contract.adjudicate(match_id)
    _assert_conserved(contract, match_id)


# ---- C2: the credit invariant ---------------------------------------------


def test_c2_claim_never_exceeds_the_match_escrow(direct_vm, direct_deploy, direct_alice, direct_bob, direct_owner):
    """Two matches funded, one fully claimed: the second match's escrow is
    untouched and its own accounting still balances."""
    direct_vm.warp(BEFORE)
    contract = direct_deploy("contracts/carnage.py")
    alice, bob = _addr(direct_alice), _addr(direct_bob)

    first = _run_to_revealed(contract, direct_vm, direct_alice, direct_bob, direct_owner)
    second = _run_to_revealed(contract, direct_vm, direct_alice, direct_bob, direct_owner)

    _adjudicate_with_labels(contract, direct_vm, first, "TRUE", "TRUE")
    _settle_as_self(contract, direct_vm, first)

    direct_vm.sender = alice
    contract.claim(first)
    direct_vm.sender = bob
    contract.claim(first)

    m1 = contract.get_match(first)
    assert m1["paid_total"] == m1["escrow_total"] == STAKE * 2
    m2 = contract.get_match(second)
    assert m2["paid_total"] == 0
    assert m2["credited_total"] == 0
    assert m2["escrow_total"] == STAKE * 2

    # the untouched match still settles to exactly its own escrow
    _adjudicate_with_labels(contract, direct_vm, second, "FALSE", "TRUE")
    _settle_as_self(contract, direct_vm, second)
    _assert_conserved(contract, second)


# ---- C3: nothing is stranded before the price lock -------------------------


def test_c3_refund_before_lock_one_side_funded(direct_vm, direct_deploy, direct_alice, direct_bob, direct_owner):
    direct_vm.warp(BEFORE)
    contract = direct_deploy("contracts/carnage.py")
    alice = _addr(direct_alice)
    match_id = _new_match(contract, direct_vm, direct_alice, direct_bob, direct_owner)
    _commit_both(contract, direct_vm, match_id, direct_alice, direct_bob)
    direct_vm.sender = alice
    direct_vm.value = STAKE
    contract.fund_holder(match_id)
    direct_vm.value = 0

    _warp(direct_vm, AFTER_REVEAL)
    contract.refund_before_lock(match_id)

    assert _balances(contract, match_id) == (STAKE, 0, 0)
    _assert_conserved(contract, match_id)
    direct_vm.sender = alice
    assert contract.claim(match_id) == STAKE


def test_c3_refund_before_lock_both_funded_no_claims(direct_vm, direct_deploy, direct_alice, direct_bob, direct_owner):
    direct_vm.warp(BEFORE)
    contract = direct_deploy("contracts/carnage.py")
    match_id = _new_match(contract, direct_vm, direct_alice, direct_bob, direct_owner)
    _commit_both(contract, direct_vm, match_id, direct_alice, direct_bob)
    _fund_both(contract, direct_vm, match_id, direct_alice, direct_bob)

    _warp(direct_vm, AFTER_REVEAL)
    contract.refund_before_lock(match_id)

    assert _balances(contract, match_id) == (STAKE, STAKE, 0)
    _assert_conserved(contract, match_id)


def test_c3_refund_before_lock_prices_never_matched(direct_vm, direct_deploy, direct_alice, direct_bob, direct_owner):
    direct_vm.warp(BEFORE)
    contract = direct_deploy("contracts/carnage.py")
    alice, bob = _addr(direct_alice), _addr(direct_bob)
    match_id = _new_match(contract, direct_vm, direct_alice, direct_bob, direct_owner)
    _commit_both(contract, direct_vm, match_id, direct_alice, direct_bob)
    _fund_both(contract, direct_vm, match_id, direct_alice, direct_bob)
    _claim_both(contract, direct_vm, match_id, direct_alice, direct_bob)
    direct_vm.sender = alice
    contract.propose_price_holder(match_id, 800)
    direct_vm.sender = bob
    contract.propose_price_buyer(match_id, 700)
    assert contract.get_match(match_id)["price_locked"] is False

    _warp(direct_vm, AFTER_REVEAL)
    contract.refund_before_lock(match_id)

    assert _balances(contract, match_id) == (STAKE, STAKE, 0)
    _assert_conserved(contract, match_id)


def test_c3_refund_before_lock_is_permissionless(direct_vm, direct_deploy, direct_alice, direct_bob, direct_owner, direct_charlie):
    direct_vm.warp(BEFORE)
    contract = direct_deploy("contracts/carnage.py")
    match_id = _new_match(contract, direct_vm, direct_alice, direct_bob, direct_owner)
    _commit_both(contract, direct_vm, match_id, direct_alice, direct_bob)
    _fund_both(contract, direct_vm, match_id, direct_alice, direct_bob)

    _warp(direct_vm, AFTER_REVEAL)
    direct_vm.sender = _addr(direct_charlie)
    contract.refund_before_lock(match_id)
    assert contract.get_match(match_id)["refunded_before_lock"] is True


def test_c3_refund_before_lock_rejected_before_deadline(direct_vm, direct_deploy, direct_alice, direct_bob, direct_owner):
    direct_vm.warp(BEFORE)
    contract = direct_deploy("contracts/carnage.py")
    match_id = _new_match(contract, direct_vm, direct_alice, direct_bob, direct_owner)
    _commit_both(contract, direct_vm, match_id, direct_alice, direct_bob)
    _fund_both(contract, direct_vm, match_id, direct_alice, direct_bob)

    with direct_vm.expect_revert("lock deadline has not passed yet"):
        contract.refund_before_lock(match_id)


def test_c3_refund_before_lock_rejected_once_price_locked(direct_vm, direct_deploy, direct_alice, direct_bob, direct_owner):
    direct_vm.warp(BEFORE)
    contract = direct_deploy("contracts/carnage.py")
    match_id = _run_to_locked_price(contract, direct_vm, direct_alice, direct_bob, direct_owner)

    _warp(direct_vm, AFTER_REVEAL)
    with direct_vm.expect_revert("deal price is already locked"):
        contract.refund_before_lock(match_id)


def test_c3_refund_before_lock_twice_rejected(direct_vm, direct_deploy, direct_alice, direct_bob, direct_owner):
    direct_vm.warp(BEFORE)
    contract = direct_deploy("contracts/carnage.py")
    match_id = _new_match(contract, direct_vm, direct_alice, direct_bob, direct_owner)
    _commit_both(contract, direct_vm, match_id, direct_alice, direct_bob)
    _fund_both(contract, direct_vm, match_id, direct_alice, direct_bob)

    _warp(direct_vm, AFTER_REVEAL)
    contract.refund_before_lock(match_id)
    with direct_vm.expect_revert("match was already refunded"):
        contract.refund_before_lock(match_id)


def test_c3_refund_emits_event_and_moves_no_funds_itself(direct_vm, direct_deploy, direct_alice, direct_bob, direct_owner):
    direct_vm.warp(BEFORE)
    contract = direct_deploy("contracts/carnage.py")
    match_id = _new_match(contract, direct_vm, direct_alice, direct_bob, direct_owner)
    _commit_both(contract, direct_vm, match_id, direct_alice, direct_bob)
    _fund_both(contract, direct_vm, match_id, direct_alice, direct_bob)

    _warp(direct_vm, AFTER_REVEAL)
    captured = _capture_post_messages(direct_vm)
    contract.refund_before_lock(match_id)

    assert _post_messages(captured) == []
    assert len([c for c in captured if "EmitEvent" in c]) == 1


# ---- C4 and H1 and M2 and M4: create_match validation ----------------------


def test_c4_naive_deadlines_rejected(direct_vm, direct_deploy, direct_alice, direct_bob, direct_owner):
    direct_vm.warp(BEFORE)
    contract = direct_deploy("contracts/carnage.py")
    alice, bob, owner = _addr(direct_alice), _addr(direct_bob), _addr(direct_owner)
    direct_vm.sender = owner
    with direct_vm.expect_revert("must carry a timezone offset"):
        contract.create_match(alice, bob, 500, 1000, STAKE, "2026-12-31T00:00:00", "2027-01-31T00:00:00")


def test_c4_mixed_naive_and_aware_deadlines_rejected(direct_vm, direct_deploy, direct_alice, direct_bob, direct_owner):
    direct_vm.warp(BEFORE)
    contract = direct_deploy("contracts/carnage.py")
    alice, bob, owner = _addr(direct_alice), _addr(direct_bob), _addr(direct_owner)
    direct_vm.sender = owner
    with direct_vm.expect_revert("must carry a timezone offset"):
        contract.create_match(alice, bob, 500, 1000, STAKE, "2026-12-31T00:00:00", INCONCLUSIVE_DEADLINE)


def test_m4_malformed_deadline_raises_expected_user_error(direct_vm, direct_deploy, direct_alice, direct_bob, direct_owner):
    direct_vm.warp(BEFORE)
    contract = direct_deploy("contracts/carnage.py")
    alice, bob, owner = _addr(direct_alice), _addr(direct_bob), _addr(direct_owner)
    direct_vm.sender = owner
    with direct_vm.expect_revert("is not a valid ISO 8601 timestamp"):
        contract.create_match(alice, bob, 500, 1000, STAKE, "not-a-date", "also-not-a-date")


def test_h1_past_deadlines_rejected(direct_vm, direct_deploy, direct_alice, direct_bob, direct_owner):
    direct_vm.warp("2026-09-08T00:00:00Z")
    contract = direct_deploy("contracts/carnage.py")
    alice, bob, owner = _addr(direct_alice), _addr(direct_bob), _addr(direct_owner)
    direct_vm.sender = owner
    with direct_vm.expect_revert("more than 900 seconds in the future"):
        contract.create_match(alice, bob, 500, 1000, STAKE, "2020-01-01T00:00:00Z", "2020-02-01T00:00:00Z")


def test_h1_reveal_window_shorter_than_the_minimum_rejected(direct_vm, direct_deploy, direct_alice, direct_bob, direct_owner):
    direct_vm.warp("2026-09-08T00:00:00Z")
    contract = direct_deploy("contracts/carnage.py")
    alice, bob, owner = _addr(direct_alice), _addr(direct_bob), _addr(direct_owner)
    direct_vm.sender = owner
    # 10 minutes out, inside the 15 minute minimum reveal window
    with direct_vm.expect_revert("more than 900 seconds in the future"):
        contract.create_match(alice, bob, 500, 1000, STAKE, "2026-09-08T00:10:00Z", "2026-09-09T00:00:00Z")


def test_h1_deadline_ordering_message_is_unchanged(direct_vm, direct_deploy, direct_alice, direct_bob, direct_owner):
    direct_vm.warp(BEFORE)
    contract = direct_deploy("contracts/carnage.py")
    alice, bob, owner = _addr(direct_alice), _addr(direct_bob), _addr(direct_owner)
    direct_vm.sender = owner
    with direct_vm.expect_revert("inconclusive_deadline must be after reveal_deadline"):
        contract.create_match(alice, bob, 500, 1000, STAKE, DEADLINE, "2026-07-01T00:00:00Z")


def test_m2_stake_above_the_protocol_maximum_rejected(direct_vm, direct_deploy, direct_alice, direct_bob, direct_owner):
    direct_vm.warp(BEFORE)
    contract = direct_deploy("contracts/carnage.py")
    alice, bob, owner = _addr(direct_alice), _addr(direct_bob), _addr(direct_owner)
    direct_vm.sender = owner
    with direct_vm.expect_revert("stake_amount exceeds the protocol maximum"):
        contract.create_match(alice, bob, 500, 1000, 2 ** 255, DEADLINE, INCONCLUSIVE_DEADLINE)


def test_m2_price_ceiling_above_the_protocol_maximum_rejected(direct_vm, direct_deploy, direct_alice, direct_bob, direct_owner):
    direct_vm.warp(BEFORE)
    contract = direct_deploy("contracts/carnage.py")
    alice, bob, owner = _addr(direct_alice), _addr(direct_bob), _addr(direct_owner)
    direct_vm.sender = owner
    with direct_vm.expect_revert("price_ceil exceeds the protocol maximum"):
        contract.create_match(alice, bob, 500, 2 ** 200, STAKE, DEADLINE, INCONCLUSIVE_DEADLINE)


# ---- C5: force_settle ------------------------------------------------------


def test_c5_force_settle_recovers_an_unsettled_verdict(direct_vm, direct_deploy, direct_alice, direct_bob, direct_owner, direct_charlie):
    direct_vm.warp(BEFORE)
    contract = direct_deploy("contracts/carnage.py")
    match_id = _run_to_revealed(contract, direct_vm, direct_alice, direct_bob, direct_owner)
    _adjudicate_with_labels(contract, direct_vm, match_id, "FALSE", "TRUE")

    # the scheduled self-call never arrives
    assert _balances(contract, match_id) == (0, 0, 0)

    _warp(direct_vm, "2026-06-03T00:00:00Z")
    direct_vm.sender = _addr(direct_charlie)
    contract.force_settle(match_id)

    m = contract.get_match(match_id)
    assert m["settled"] is True
    # identical to what the normal path would have credited
    assert _balances(contract, match_id) == (0, STAKE * 2, 0)
    _assert_conserved(contract, match_id)


def test_c5_force_settle_rejected_before_the_grace_period(direct_vm, direct_deploy, direct_alice, direct_bob, direct_owner):
    direct_vm.warp(BEFORE)
    contract = direct_deploy("contracts/carnage.py")
    match_id = _run_to_revealed(contract, direct_vm, direct_alice, direct_bob, direct_owner)
    _adjudicate_with_labels(contract, direct_vm, match_id, "TRUE", "TRUE")

    with direct_vm.expect_revert("settle grace period has not passed yet"):
        contract.force_settle(match_id)


def test_c5_force_settle_rejected_after_a_normal_settle(direct_vm, direct_deploy, direct_alice, direct_bob, direct_owner):
    direct_vm.warp(BEFORE)
    contract = direct_deploy("contracts/carnage.py")
    match_id = _run_to_revealed(contract, direct_vm, direct_alice, direct_bob, direct_owner)
    _adjudicate_with_labels(contract, direct_vm, match_id, "TRUE", "TRUE")
    _settle_as_self(contract, direct_vm, match_id)

    _warp(direct_vm, "2026-06-03T00:00:00Z")
    with direct_vm.expect_revert("match already settled"):
        contract.force_settle(match_id)
    _assert_conserved(contract, match_id)


def test_c5_force_settle_rejected_without_a_verdict(direct_vm, direct_deploy, direct_alice, direct_bob, direct_owner):
    direct_vm.warp(BEFORE)
    contract = direct_deploy("contracts/carnage.py")
    match_id = _run_to_revealed(contract, direct_vm, direct_alice, direct_bob, direct_owner)

    _warp(direct_vm, AFTER_INCONCLUSIVE)
    with direct_vm.expect_revert("match has not been adjudicated"):
        contract.force_settle(match_id)


# ---- H3 and L2: reveal timing ---------------------------------------------


def test_h3_reveal_after_the_deadline_rejected(direct_vm, direct_deploy, direct_alice, direct_bob, direct_owner):
    direct_vm.warp(BEFORE)
    contract = direct_deploy("contracts/carnage.py")
    match_id = _run_to_locked_price(contract, direct_vm, direct_alice, direct_bob, direct_owner)

    _warp(direct_vm, AFTER_REVEAL)
    direct_vm.sender = _addr(direct_alice)
    with direct_vm.expect_revert("reveal deadline has passed"):
        contract.reveal_holder(match_id, HOLDER_MIN_PRICE, HOLDER_SALT)


def test_l2_deadline_instant_belongs_to_neither_phase(direct_vm, direct_deploy, direct_alice, direct_bob, direct_owner):
    direct_vm.warp(BEFORE)
    contract = direct_deploy("contracts/carnage.py")
    match_id = _run_to_locked_price(contract, direct_vm, direct_alice, direct_bob, direct_owner)

    _warp(direct_vm, AT_REVEAL_DEADLINE)
    direct_vm.sender = _addr(direct_alice)
    with direct_vm.expect_revert("reveal deadline has passed"):
        contract.reveal_holder(match_id, HOLDER_MIN_PRICE, HOLDER_SALT)
    with direct_vm.expect_revert("reveal deadline has not passed yet"):
        contract.resolve_no_reveal(match_id)


# ---- H2: the price lock cannot run into the reveal window ------------------


def test_h2_price_lock_after_the_lock_deadline_rejected(direct_vm, direct_deploy, direct_alice, direct_bob, direct_owner):
    direct_vm.warp(BEFORE)
    contract = direct_deploy("contracts/carnage.py")
    alice = _addr(direct_alice)
    match_id = _new_match(contract, direct_vm, direct_alice, direct_bob, direct_owner)
    _commit_both(contract, direct_vm, match_id, direct_alice, direct_bob)
    _fund_both(contract, direct_vm, match_id, direct_alice, direct_bob)
    _claim_both(contract, direct_vm, match_id, direct_alice, direct_bob)

    # 5 minutes before the reveal deadline, inside the reserved reveal window
    _warp(direct_vm, "2026-12-30T23:55:00Z")
    direct_vm.sender = alice
    with direct_vm.expect_revert("lock deadline has passed"):
        contract.propose_price_holder(match_id, DEAL_PRICE)

    # and the match is not stuck: it exits through the refund path
    _warp(direct_vm, AFTER_REVEAL)
    contract.refund_before_lock(match_id)
    assert _balances(contract, match_id) == (STAKE, STAKE, 0)
    _assert_conserved(contract, match_id)


def test_h2_normal_timing_is_unaffected(direct_vm, direct_deploy, direct_alice, direct_bob, direct_owner):
    """A match negotiated well ahead of the deadline behaves exactly as before."""
    direct_vm.warp(BEFORE)
    contract = direct_deploy("contracts/carnage.py")
    match_id = _run_to_revealed(contract, direct_vm, direct_alice, direct_bob, direct_owner)
    _adjudicate_with_labels(contract, direct_vm, match_id, "TRUE", "TRUE")
    _settle_as_self(contract, direct_vm, match_id)
    assert _balances(contract, match_id) == (STAKE, STAKE, 0)
    _assert_conserved(contract, match_id)


# ---- H4: the sink ----------------------------------------------------------


def test_h4_party_who_is_also_the_sink_claims_both_roles(direct_vm, direct_deploy, direct_alice, direct_bob, direct_owner):
    """The deployer is the default sink. Seat it as the holder and give it an
    adverse label on both sides, so it is owed a party credit and a sink
    credit in the same match."""
    direct_vm.warp(BEFORE)
    contract = direct_deploy("contracts/carnage.py")
    owner, bob = _addr(direct_owner), _addr(direct_bob)

    direct_vm.sender = owner
    match_id = contract.create_match(owner, bob, 500, 1000, STAKE, DEADLINE, INCONCLUSIVE_DEADLINE)
    holder_commitment = contract.compute_commitment(HOLDER_MIN_PRICE, HOLDER_SALT, match_id, owner)
    buyer_commitment = contract.compute_commitment(BUYER_MAX_BUDGET, BUYER_SALT, match_id, bob)
    direct_vm.sender = owner
    contract.commit_holder(match_id, holder_commitment)
    direct_vm.sender = bob
    contract.commit_buyer(match_id, buyer_commitment)
    for addr, fund in ((owner, contract.fund_holder), (bob, contract.fund_buyer)):
        direct_vm.sender = addr
        direct_vm.value = STAKE
        fund(match_id)
        direct_vm.value = 0
    direct_vm.sender = owner
    contract.anchor_claim_holder(match_id, "my floor is 650")
    direct_vm.sender = bob
    contract.anchor_claim_buyer(match_id, "my ceiling is 900")
    direct_vm.sender = owner
    contract.propose_price_holder(match_id, DEAL_PRICE)
    direct_vm.sender = bob
    contract.propose_price_buyer(match_id, DEAL_PRICE)
    direct_vm.sender = owner
    contract.reveal_holder(match_id, HOLDER_MIN_PRICE, HOLDER_SALT)
    direct_vm.sender = bob
    contract.reveal_buyer(match_id, BUYER_MAX_BUDGET, BUYER_SALT)

    _adjudicate_with_labels(contract, direct_vm, match_id, "MISLEADING", "MISLEADING")
    _settle_as_self(contract, direct_vm, match_id)

    m = contract.get_match(match_id)
    holder_credit = m["holder_claimable"]
    sink_credit = m["sink_claimable"]
    assert holder_credit > 0 and sink_credit > 0

    captured = _capture_post_messages(direct_vm)
    direct_vm.sender = owner
    paid = contract.claim(match_id)

    # both roles paid in one call, not first-match-wins
    assert paid == holder_credit + sink_credit
    assert _transfers_to(captured, owner) == holder_credit + sink_credit
    m = contract.get_match(match_id)
    assert m["holder_claimable"] == 0
    assert m["sink_claimable"] == 0


def _zero_address():
    from genlayer.py.types import Address

    return Address(b"\x00" * 20)


def test_h4_sink_handover_needs_a_propose_and_an_accept(direct_vm, direct_deploy, direct_alice, direct_bob, direct_owner, direct_charlie):
    direct_vm.warp(BEFORE)
    contract = direct_deploy("contracts/carnage.py")
    owner, charlie = _addr(direct_owner), _addr(direct_charlie)
    match_id = _new_match(contract, direct_vm, direct_alice, direct_bob, direct_owner)

    direct_vm.sender = owner
    contract.propose_sink_address(charlie)

    # the role has not moved yet
    m = contract.get_match(match_id)
    assert m["sink_address"] == owner.as_hex
    assert m["pending_sink"] == charlie.as_hex

    direct_vm.sender = charlie
    contract.accept_sink_address()

    m = contract.get_match(match_id)
    assert m["sink_address"] == charlie.as_hex
    assert m["pending_sink"] == _zero_address().as_hex


def test_h4_non_sink_cannot_propose(direct_vm, direct_deploy, direct_alice, direct_bob, direct_owner, direct_charlie):
    direct_vm.warp(BEFORE)
    contract = direct_deploy("contracts/carnage.py")
    alice, charlie = _addr(direct_alice), _addr(direct_charlie)

    direct_vm.sender = alice
    with direct_vm.expect_revert("sender is not authorized for this role"):
        contract.propose_sink_address(charlie)


def test_h4_only_the_pending_address_can_accept(direct_vm, direct_deploy, direct_alice, direct_bob, direct_owner, direct_charlie):
    direct_vm.warp(BEFORE)
    contract = direct_deploy("contracts/carnage.py")
    owner, alice, charlie = _addr(direct_owner), _addr(direct_alice), _addr(direct_charlie)

    direct_vm.sender = owner
    contract.propose_sink_address(charlie)

    direct_vm.sender = alice
    with direct_vm.expect_revert("sender is not the pending sink"):
        contract.accept_sink_address()

    # the outgoing sink cannot wave it through on the proposed party's behalf
    direct_vm.sender = owner
    with direct_vm.expect_revert("sender is not the pending sink"):
        contract.accept_sink_address()

    match_id = _new_match(contract, direct_vm, direct_alice, direct_bob, direct_owner)
    assert contract.get_match(match_id)["sink_address"] == owner.as_hex


def test_h4_accept_without_a_pending_proposal_rejected(direct_vm, direct_deploy, direct_alice, direct_bob, direct_owner, direct_charlie):
    direct_vm.warp(BEFORE)
    contract = direct_deploy("contracts/carnage.py")

    direct_vm.sender = _addr(direct_charlie)
    with direct_vm.expect_revert("no sink transfer is pending"):
        contract.accept_sink_address()


def test_h4_a_proposal_can_be_overwritten_before_acceptance(direct_vm, direct_deploy, direct_alice, direct_bob, direct_owner, direct_charlie):
    direct_vm.warp(BEFORE)
    contract = direct_deploy("contracts/carnage.py")
    owner, bob, charlie = _addr(direct_owner), _addr(direct_bob), _addr(direct_charlie)

    direct_vm.sender = owner
    contract.propose_sink_address(charlie)
    contract.propose_sink_address(bob)

    # the superseded address cannot claim the role
    direct_vm.sender = charlie
    with direct_vm.expect_revert("sender is not the pending sink"):
        contract.accept_sink_address()

    direct_vm.sender = bob
    contract.accept_sink_address()

    match_id = _new_match(contract, direct_vm, direct_alice, direct_bob, direct_owner)
    assert contract.get_match(match_id)["sink_address"] == bob.as_hex


def test_h4_accept_cannot_be_replayed(direct_vm, direct_deploy, direct_alice, direct_bob, direct_owner, direct_charlie):
    direct_vm.warp(BEFORE)
    contract = direct_deploy("contracts/carnage.py")
    owner, charlie = _addr(direct_owner), _addr(direct_charlie)

    direct_vm.sender = owner
    contract.propose_sink_address(charlie)
    direct_vm.sender = charlie
    contract.accept_sink_address()

    # pending_sink was cleared, so the same call cannot take the role again
    with direct_vm.expect_revert("no sink transfer is pending"):
        contract.accept_sink_address()


def test_h4_proposing_the_zero_address_cancels_a_pending_handover(direct_vm, direct_deploy, direct_alice, direct_bob, direct_owner, direct_charlie):
    direct_vm.warp(BEFORE)
    contract = direct_deploy("contracts/carnage.py")
    owner, charlie = _addr(direct_owner), _addr(direct_charlie)

    direct_vm.sender = owner
    contract.propose_sink_address(charlie)
    contract.propose_sink_address(_zero_address())

    direct_vm.sender = charlie
    with direct_vm.expect_revert("no sink transfer is pending"):
        contract.accept_sink_address()

    match_id = _new_match(contract, direct_vm, direct_alice, direct_bob, direct_owner)
    assert contract.get_match(match_id)["sink_address"] == owner.as_hex


def test_h4_the_new_sink_can_claim_sink_credits_after_the_handover(direct_vm, direct_deploy, direct_alice, direct_bob, direct_owner, direct_charlie):
    """The role really moves: the new sink collects, the old one cannot."""
    direct_vm.warp(BEFORE)
    contract = direct_deploy("contracts/carnage.py")
    owner, charlie = _addr(direct_owner), _addr(direct_charlie)

    direct_vm.sender = owner
    contract.propose_sink_address(charlie)
    direct_vm.sender = charlie
    contract.accept_sink_address()

    match_id = _run_to_revealed(contract, direct_vm, direct_alice, direct_bob, direct_owner)
    _adjudicate_with_labels(contract, direct_vm, match_id, "FALSE", "FALSE")
    _settle_as_self(contract, direct_vm, match_id)

    m = contract.get_match(match_id)
    assert m["sink_claimable"] == STAKE * 2

    direct_vm.sender = owner
    with direct_vm.expect_revert("sender has nothing claimable in this match"):
        contract.claim(match_id)

    direct_vm.sender = charlie
    assert contract.claim(match_id) == STAKE * 2


# ---- M5: both sides adverse -----------------------------------------------


def test_m5_both_adverse_sends_the_crossed_portion_to_the_sink(direct_vm, direct_deploy, direct_alice, direct_bob, direct_owner):
    direct_vm.warp(BEFORE)
    contract = direct_deploy("contracts/carnage.py")
    for holder_label, buyer_label in itertools.product(ADVERSE, ADVERSE):
        match_id = _run_to_revealed(contract, direct_vm, direct_alice, direct_bob, direct_owner)
        _adjudicate_with_labels(contract, direct_vm, match_id, holder_label, buyer_label)
        _settle_as_self(contract, direct_vm, match_id)
        holder, buyer, sink = _balances(contract, match_id)
        assert sink > 0, f"{holder_label} + {buyer_label} must forfeit to the sink"
        assert holder + buyer + sink == STAKE * 2
        _assert_conserved(contract, match_id)


def test_m5_single_liar_outcomes_are_unchanged(direct_vm, direct_deploy, direct_alice, direct_bob, direct_owner):
    """The slash still lands on the honest counterparty, same amounts as before."""
    direct_vm.warp(BEFORE)
    contract = direct_deploy("contracts/carnage.py")
    expected = {
        ("FALSE", "TRUE"): (0, STAKE * 2, 0),
        ("TRUE", "FALSE"): (STAKE * 2, 0, 0),
        ("MISLEADING", "TRUE"): (STAKE - STAKE // 2, STAKE + STAKE // 2, 0),
        ("TRUE", "MISLEADING"): (STAKE + STAKE // 2, STAKE - STAKE // 2, 0),
        ("FALSE", "AMBIGUOUS"): (0, STAKE * 2, 0),
        ("MISLEADING", "UNSUPPORTED"): (STAKE - STAKE // 2, STAKE + STAKE // 2, 0),
    }
    for (holder_label, buyer_label), want in expected.items():
        match_id = _run_to_revealed(contract, direct_vm, direct_alice, direct_bob, direct_owner)
        _adjudicate_with_labels(contract, direct_vm, match_id, holder_label, buyer_label)
        _settle_as_self(contract, direct_vm, match_id)
        assert _balances(contract, match_id) == want, f"{holder_label} + {buyer_label}"
        _assert_conserved(contract, match_id)


def test_conservation_across_every_label_pair(direct_vm, direct_deploy, direct_alice, direct_bob, direct_owner):
    direct_vm.warp(BEFORE)
    contract = direct_deploy("contracts/carnage.py")
    for holder_label, buyer_label in itertools.product(LABELS, LABELS):
        match_id = _run_to_revealed(contract, direct_vm, direct_alice, direct_bob, direct_owner)
        _adjudicate_with_labels(contract, direct_vm, match_id, holder_label, buyer_label)
        _settle_as_self(contract, direct_vm, match_id)
        holder, buyer, sink = _balances(contract, match_id)
        assert holder + buyer + sink == STAKE * 2, f"{holder_label} + {buyer_label}"
        _assert_conserved(contract, match_id)


def test_conservation_with_an_odd_stake_and_both_adverse(direct_vm, direct_deploy, direct_alice, direct_bob, direct_owner):
    direct_vm.warp(BEFORE)
    contract = direct_deploy("contracts/carnage.py")
    alice, bob, owner = _addr(direct_alice), _addr(direct_bob), _addr(direct_owner)
    odd = 501

    direct_vm.sender = owner
    match_id = contract.create_match(alice, bob, 500, 1000, odd, DEADLINE, INCONCLUSIVE_DEADLINE)
    _commit_both(contract, direct_vm, match_id, direct_alice, direct_bob)
    for addr, fund in ((alice, contract.fund_holder), (bob, contract.fund_buyer)):
        direct_vm.sender = addr
        direct_vm.value = odd
        fund(match_id)
        direct_vm.value = 0
    _claim_both(contract, direct_vm, match_id, direct_alice, direct_bob)
    _lock_price(contract, direct_vm, match_id, direct_alice, direct_bob)
    _reveal_both(contract, direct_vm, match_id, direct_alice, direct_bob)
    _adjudicate_with_labels(contract, direct_vm, match_id, "MISLEADING", "MISLEADING")
    _settle_as_self(contract, direct_vm, match_id)

    holder, buyer, sink = _balances(contract, match_id)
    assert holder + buyer + sink == odd * 2
    _assert_conserved(contract, match_id)


# ---- L5, L3, M6, M7, L4 ----------------------------------------------------


def test_l5_non_payable_method_rejects_value(direct_vm, direct_deploy, direct_alice, direct_bob, direct_owner):
    direct_vm.warp(BEFORE)
    contract = direct_deploy("contracts/carnage.py")
    match_id = _new_match(contract, direct_vm, direct_alice, direct_bob, direct_owner)

    direct_vm.sender = _addr(direct_alice)
    direct_vm.value = 999
    try:
        with direct_vm.expect_revert("this method does not accept value"):
            contract.commit_holder(match_id, "0x" + "cd" * 32)
    finally:
        direct_vm.value = 0


def test_l3_oversized_salt_rejected(direct_vm, direct_deploy, direct_alice, direct_bob, direct_owner):
    direct_vm.warp(BEFORE)
    contract = direct_deploy("contracts/carnage.py")
    _new_match(contract, direct_vm, direct_alice, direct_bob, direct_owner)
    with direct_vm.expect_revert("salt must be at most 64 bytes"):
        contract.compute_commitment(650, "0x" + "11" * 65, 1, _addr(direct_alice))


def test_m6_coherence_is_recorded_but_not_enforced(direct_vm, direct_deploy, direct_alice, direct_bob, direct_owner):
    """An incoherent pair of reveals still settles. The flag just records it."""
    direct_vm.warp(BEFORE)
    contract = direct_deploy("contracts/carnage.py")
    alice, bob, owner = _addr(direct_alice), _addr(direct_bob), _addr(direct_owner)

    direct_vm.sender = owner
    match_id = contract.create_match(alice, bob, 500, 1000, STAKE, DEADLINE, INCONCLUSIVE_DEADLINE)
    # holder's minimum sits above the buyer's budget: the deal price cannot
    # be bracketed by the two revealed constraints
    holder_state, buyer_state = 900, 600
    holder_commitment = contract.compute_commitment(holder_state, HOLDER_SALT, match_id, alice)
    buyer_commitment = contract.compute_commitment(buyer_state, BUYER_SALT, match_id, bob)
    direct_vm.sender = alice
    contract.commit_holder(match_id, holder_commitment)
    direct_vm.sender = bob
    contract.commit_buyer(match_id, buyer_commitment)
    _fund_both(contract, direct_vm, match_id, direct_alice, direct_bob)
    _claim_both(contract, direct_vm, match_id, direct_alice, direct_bob)
    _lock_price(contract, direct_vm, match_id, direct_alice, direct_bob)

    direct_vm.sender = alice
    contract.reveal_holder(match_id, holder_state, HOLDER_SALT)
    direct_vm.sender = bob
    contract.reveal_buyer(match_id, buyer_state, BUYER_SALT)

    m = contract.get_match(match_id)
    assert m["coherence_known"] is True
    assert m["coherent"] is False

    # and it settles normally regardless
    _adjudicate_with_labels(contract, direct_vm, match_id, "TRUE", "TRUE")
    _settle_as_self(contract, direct_vm, match_id)
    _assert_conserved(contract, match_id)


def test_m6_coherent_match_records_true(direct_vm, direct_deploy, direct_alice, direct_bob, direct_owner):
    direct_vm.warp(BEFORE)
    contract = direct_deploy("contracts/carnage.py")
    match_id = _run_to_revealed(contract, direct_vm, direct_alice, direct_bob, direct_owner)
    m = contract.get_match(match_id)
    assert m["coherence_known"] is True
    assert m["coherent"] is True


def test_m7_every_resolution_path_emits_an_event(direct_vm, direct_deploy, direct_alice, direct_bob, direct_owner):
    direct_vm.warp(BEFORE)
    contract = direct_deploy("contracts/carnage.py")
    alice = _addr(direct_alice)

    captured = _capture_post_messages(direct_vm)
    match_id = _run_to_revealed(contract, direct_vm, direct_alice, direct_bob, direct_owner)
    _adjudicate_with_labels(contract, direct_vm, match_id, "TRUE", "TRUE")
    _settle_as_self(contract, direct_vm, match_id)
    direct_vm.sender = alice
    contract.claim(match_id)

    events = [c["EmitEvent"] for c in captured if "EmitEvent" in c]
    assert len(events) == 2  # MatchSettled, MatchClaimed


def test_l4_get_match_exposes_the_sink_and_the_escrow_ledger(direct_vm, direct_deploy, direct_alice, direct_bob, direct_owner):
    direct_vm.warp(BEFORE)
    contract = direct_deploy("contracts/carnage.py")
    owner = _addr(direct_owner)
    match_id = _run_to_locked_price(contract, direct_vm, direct_alice, direct_bob, direct_owner)

    m = contract.get_match(match_id)
    assert m["sink_address"] == owner.as_hex
    assert m["no_reveal_outcome"] == ""
    assert m["escrow_total"] == STAKE * 2
    assert m["holder_escrow"] == STAKE
    assert m["buyer_escrow"] == STAKE
    assert m["credited_total"] == 0
    assert m["paid_total"] == 0
    assert m["refunded_before_lock"] is False
    assert m["lock_deadline"] > 0
