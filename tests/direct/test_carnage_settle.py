import json

from conftest import (
    _addr,
    _new_match,
    _commit_both,
    _fund_both,
    _claim_both,
    _lock_price,
    _reveal_both,
    _run_to_revealed,
    _capture_post_messages,
    _contract_self_address,
    _transfers_to,
    STAKE,
)

HOLDER_PATTERN = r"(?s)minimum acceptable price.*<claim>.*</claim>"
BUYER_PATTERN = r"(?s)maximum budget.*<claim>.*</claim>"


def _adjudicate_with_labels(contract, direct_vm, match_id, holder_label, buyer_label):
    direct_vm.mock_llm(HOLDER_PATTERN, json.dumps({"label": holder_label, "reasoning": "x"}))
    direct_vm.mock_llm(BUYER_PATTERN, json.dumps({"label": buyer_label, "reasoning": "x"}))
    contract.adjudicate(match_id)
    direct_vm.clear_mocks()


def _settle_as_self(contract, direct_vm, match_id):
    direct_vm.sender = _contract_self_address(direct_vm)
    contract.settle(match_id)


# ---- scheduling ---------------------------------------------------------


def test_adjudicate_schedules_settle_via_finalized_self_call(direct_vm, direct_deploy, direct_alice, direct_bob, direct_owner):
    captured = _capture_post_messages(direct_vm)
    contract = direct_deploy("contracts/carnage.py")
    match_id = _run_to_revealed(contract, direct_vm, direct_alice, direct_bob, direct_owner)

    _adjudicate_with_labels(contract, direct_vm, match_id, "TRUE", "TRUE")

    scheduled = [c["PostMessage"] for c in captured if c.get("PostMessage", {}).get("calldata", {}).get("method") == "settle"]
    assert len(scheduled) == 1
    call = scheduled[0]
    assert call["address"] == _contract_self_address(direct_vm)
    assert call["calldata"]["args"] == [match_id]
    assert call["on"] == "finalized"


def test_settle_emits_no_transfers_only_state(direct_vm, direct_deploy, direct_alice, direct_bob, direct_owner):
    # settle() must not itself schedule any PostMessage -- that would chain a
    # second on="finalized" wait behind the one adjudicate() already imposed.
    contract = direct_deploy("contracts/carnage.py")
    match_id = _run_to_revealed(contract, direct_vm, direct_alice, direct_bob, direct_owner)
    _adjudicate_with_labels(contract, direct_vm, match_id, "FALSE", "MISLEADING")

    captured = _capture_post_messages(direct_vm)
    _settle_as_self(contract, direct_vm, match_id)

    assert captured == []


# ---- gating -------------------------------------------------------------


def test_settle_rejects_non_self_sender(direct_vm, direct_deploy, direct_alice, direct_bob, direct_owner):
    contract = direct_deploy("contracts/carnage.py")
    match_id = _run_to_revealed(contract, direct_vm, direct_alice, direct_bob, direct_owner)
    _adjudicate_with_labels(contract, direct_vm, match_id, "TRUE", "TRUE")

    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("settle is only reachable via the finalized self-call"):
        contract.settle(match_id)


def test_settle_requires_adjudicated(direct_vm, direct_deploy, direct_alice, direct_bob, direct_owner):
    contract = direct_deploy("contracts/carnage.py")
    match_id = _run_to_revealed(contract, direct_vm, direct_alice, direct_bob, direct_owner)

    with direct_vm.expect_revert("match has not been adjudicated"):
        _settle_as_self(contract, direct_vm, match_id)


def test_settle_idempotent(direct_vm, direct_deploy, direct_alice, direct_bob, direct_owner):
    contract = direct_deploy("contracts/carnage.py")
    match_id = _run_to_revealed(contract, direct_vm, direct_alice, direct_bob, direct_owner)
    _adjudicate_with_labels(contract, direct_vm, match_id, "TRUE", "TRUE")

    # adjudicate() already schedules one settle call; here we exercise the
    # method directly (as the self-call would) and confirm it can't re-run.
    _settle_as_self(contract, direct_vm, match_id)
    with direct_vm.expect_revert("match already settled"):
        _settle_as_self(contract, direct_vm, match_id)

    m = contract.get_match(match_id)
    assert m["settled"] is True


# ---- penalty table (credited to claimable balances, not paid out) ----------


def test_settle_both_true_credits_both_full_stakes(direct_vm, direct_deploy, direct_alice, direct_bob, direct_owner):
    contract = direct_deploy("contracts/carnage.py")
    match_id = _run_to_revealed(contract, direct_vm, direct_alice, direct_bob, direct_owner)
    _adjudicate_with_labels(contract, direct_vm, match_id, "TRUE", "TRUE")

    _settle_as_self(contract, direct_vm, match_id)

    m = contract.get_match(match_id)
    assert m["holder_claimable"] == STAKE
    assert m["buyer_claimable"] == STAKE


def test_settle_ambiguous_and_unsupported_credit_stake_like_true(direct_vm, direct_deploy, direct_alice, direct_bob, direct_owner):
    contract = direct_deploy("contracts/carnage.py")
    match_id = _run_to_revealed(contract, direct_vm, direct_alice, direct_bob, direct_owner)
    _adjudicate_with_labels(contract, direct_vm, match_id, "AMBIGUOUS", "UNSUPPORTED")

    _settle_as_self(contract, direct_vm, match_id)

    m = contract.get_match(match_id)
    assert m["holder_claimable"] == STAKE
    assert m["buyer_claimable"] == STAKE


def test_settle_false_credits_full_stake_to_counterparty(direct_vm, direct_deploy, direct_alice, direct_bob, direct_owner):
    contract = direct_deploy("contracts/carnage.py")
    match_id = _run_to_revealed(contract, direct_vm, direct_alice, direct_bob, direct_owner)
    # Holder lied outright; buyer told the truth.
    _adjudicate_with_labels(contract, direct_vm, match_id, "FALSE", "TRUE")

    _settle_as_self(contract, direct_vm, match_id)

    m = contract.get_match(match_id)
    # Holder's stake (slashed) and buyer's own stake (returned) both credit buyer.
    assert m["buyer_claimable"] == STAKE * 2
    assert m["holder_claimable"] == 0


def test_settle_misleading_splits_stake_evenly(direct_vm, direct_deploy, direct_alice, direct_bob, direct_owner):
    contract = direct_deploy("contracts/carnage.py")
    match_id = _run_to_revealed(contract, direct_vm, direct_alice, direct_bob, direct_owner)
    _adjudicate_with_labels(contract, direct_vm, match_id, "MISLEADING", "TRUE")

    _settle_as_self(contract, direct_vm, match_id)

    m = contract.get_match(match_id)
    # Holder: half slashed to buyer, half returned to holder.
    assert m["holder_claimable"] == STAKE // 2
    # Buyer: half of holder's slashed stake + buyer's own full stake back.
    assert m["buyer_claimable"] == STAKE // 2 + STAKE


def test_settle_both_adverse_labels_slash_independently(direct_vm, direct_deploy, direct_alice, direct_bob, direct_owner):
    contract = direct_deploy("contracts/carnage.py")
    match_id = _run_to_revealed(contract, direct_vm, direct_alice, direct_bob, direct_owner)
    _adjudicate_with_labels(contract, direct_vm, match_id, "FALSE", "MISLEADING")

    _settle_as_self(contract, direct_vm, match_id)

    m = contract.get_match(match_id)
    # Holder's FALSE: full stake to buyer. Buyer's MISLEADING: half to holder, half to buyer.
    assert m["holder_claimable"] == STAKE // 2
    assert m["buyer_claimable"] == STAKE + STAKE // 2


def test_settle_conserves_odd_stake_with_no_rounding_leak(direct_vm, direct_deploy, direct_alice, direct_bob, direct_owner):
    contract = direct_deploy("contracts/carnage.py")
    alice, bob, owner = _addr(direct_alice), _addr(direct_bob), _addr(direct_owner)
    odd_stake = 501

    direct_vm.sender = owner
    match_id = contract.create_match(alice, bob, 500, 1000, odd_stake, "2026-12-31T00:00:00Z", "2027-01-31T00:00:00Z")
    _commit_both(contract, direct_vm, match_id, direct_alice, direct_bob)

    direct_vm.sender = alice
    direct_vm.value = odd_stake
    contract.fund_holder(match_id)
    direct_vm.value = 0
    direct_vm.sender = bob
    direct_vm.value = odd_stake
    contract.fund_buyer(match_id)
    direct_vm.value = 0

    _claim_both(contract, direct_vm, match_id, direct_alice, direct_bob)
    _lock_price(contract, direct_vm, match_id, direct_alice, direct_bob)
    _reveal_both(contract, direct_vm, match_id, direct_alice, direct_bob)

    _adjudicate_with_labels(contract, direct_vm, match_id, "MISLEADING", "TRUE")
    _settle_as_self(contract, direct_vm, match_id)

    m = contract.get_match(match_id)
    # Holder's MISLEADING splits as floor(501/2)=250 to buyer, remainder
    # 501-250=251 back to holder -- using the remainder (not stake//2 twice)
    # is what keeps the odd atto instead of losing it.
    assert m["holder_claimable"] == 251
    assert m["buyer_claimable"] == 250 + odd_stake
    assert m["holder_claimable"] + m["buyer_claimable"] == 2 * odd_stake  # exact conservation


# ---- claim ----------------------------------------------------------------


def test_claim_pays_out_and_zeroes_claimable(direct_vm, direct_deploy, direct_alice, direct_bob, direct_owner):
    contract = direct_deploy("contracts/carnage.py")
    alice, bob = _addr(direct_alice), _addr(direct_bob)
    match_id = _run_to_revealed(contract, direct_vm, direct_alice, direct_bob, direct_owner)
    _adjudicate_with_labels(contract, direct_vm, match_id, "MISLEADING", "TRUE")
    _settle_as_self(contract, direct_vm, match_id)

    captured = _capture_post_messages(direct_vm)

    direct_vm.sender = alice
    holder_paid = contract.claim(match_id)
    direct_vm.sender = bob
    buyer_paid = contract.claim(match_id)

    assert holder_paid == STAKE // 2
    assert buyer_paid == STAKE // 2 + STAKE
    assert _transfers_to(captured, alice) == STAKE // 2
    assert _transfers_to(captured, bob) == STAKE // 2 + STAKE

    m = contract.get_match(match_id)
    assert m["holder_claimable"] == 0
    assert m["buyer_claimable"] == 0


def test_claim_is_a_single_finalized_transfer_to_the_caller(direct_vm, direct_deploy, direct_alice, direct_bob, direct_owner):
    contract = direct_deploy("contracts/carnage.py")
    alice = _addr(direct_alice)
    match_id = _run_to_revealed(contract, direct_vm, direct_alice, direct_bob, direct_owner)
    _adjudicate_with_labels(contract, direct_vm, match_id, "TRUE", "TRUE")
    _settle_as_self(contract, direct_vm, match_id)

    captured = _capture_post_messages(direct_vm)
    direct_vm.sender = alice
    contract.claim(match_id)

    assert len(captured) == 1
    pm = captured[0]["PostMessage"]
    assert pm["address"] == alice
    assert pm["value"] == STAKE
    assert pm["calldata"] == {}
    assert pm["on"] == "finalized"


def test_claim_twice_rejected(direct_vm, direct_deploy, direct_alice, direct_bob, direct_owner):
    contract = direct_deploy("contracts/carnage.py")
    alice = _addr(direct_alice)
    match_id = _run_to_revealed(contract, direct_vm, direct_alice, direct_bob, direct_owner)
    _adjudicate_with_labels(contract, direct_vm, match_id, "TRUE", "TRUE")
    _settle_as_self(contract, direct_vm, match_id)

    direct_vm.sender = alice
    contract.claim(match_id)
    with direct_vm.expect_revert("nothing claimable for sender in this match"):
        contract.claim(match_id)


def test_claim_before_settle_rejected(direct_vm, direct_deploy, direct_alice, direct_bob, direct_owner):
    contract = direct_deploy("contracts/carnage.py")
    match_id = _run_to_revealed(contract, direct_vm, direct_alice, direct_bob, direct_owner)

    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("nothing claimable for sender in this match"):
        contract.claim(match_id)


def test_claim_rejects_unrelated_sender(direct_vm, direct_deploy, direct_alice, direct_bob, direct_owner, direct_charlie):
    contract = direct_deploy("contracts/carnage.py")
    match_id = _run_to_revealed(contract, direct_vm, direct_alice, direct_bob, direct_owner)
    _adjudicate_with_labels(contract, direct_vm, match_id, "TRUE", "TRUE")
    _settle_as_self(contract, direct_vm, match_id)

    direct_vm.sender = direct_charlie
    with direct_vm.expect_revert("sender has nothing claimable in this match"):
        contract.claim(match_id)


def test_claim_one_side_does_not_affect_the_other(direct_vm, direct_deploy, direct_alice, direct_bob, direct_owner):
    contract = direct_deploy("contracts/carnage.py")
    alice, bob = _addr(direct_alice), _addr(direct_bob)
    match_id = _run_to_revealed(contract, direct_vm, direct_alice, direct_bob, direct_owner)
    _adjudicate_with_labels(contract, direct_vm, match_id, "TRUE", "TRUE")
    _settle_as_self(contract, direct_vm, match_id)

    direct_vm.sender = alice
    contract.claim(match_id)

    m = contract.get_match(match_id)
    assert m["holder_claimable"] == 0
    assert m["buyer_claimable"] == STAKE  # buyer's credit is untouched
