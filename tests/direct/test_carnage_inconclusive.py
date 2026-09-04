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
    _transfers_to,
    _emitted_events,
    STAKE,
    DEADLINE,
)

BEFORE_INCONCLUSIVE_DEADLINE = "2026-06-01T00:00:00Z"
AFTER_INCONCLUSIVE_DEADLINE = "2027-06-01T00:00:00Z"


def test_create_match_rejects_inconclusive_deadline_before_reveal_deadline(direct_vm, direct_deploy, direct_alice, direct_bob, direct_owner):
    contract = direct_deploy("contracts/carnage.py")
    alice, bob, owner = _addr(direct_alice), _addr(direct_bob), _addr(direct_owner)
    direct_vm.sender = owner
    with direct_vm.expect_revert("inconclusive_deadline must be after reveal_deadline"):
        contract.create_match(alice, bob, 500, 1000, STAKE, DEADLINE, "2020-01-01T00:00:00Z")


def test_resolve_inconclusive_before_deadline_rejected(direct_vm, direct_deploy, direct_alice, direct_bob, direct_owner):
    direct_vm.warp(BEFORE_INCONCLUSIVE_DEADLINE)
    contract = direct_deploy("contracts/carnage.py")
    match_id = _run_to_revealed(contract, direct_vm, direct_alice, direct_bob, direct_owner)

    with direct_vm.expect_revert("inconclusive_deadline has not passed yet"):
        contract.resolve_inconclusive(match_id)


def test_resolve_inconclusive_requires_both_revealed(direct_vm, direct_deploy, direct_alice, direct_bob, direct_owner):
    direct_vm.warp(AFTER_INCONCLUSIVE_DEADLINE)
    contract = direct_deploy("contracts/carnage.py")
    match_id = _run_to_locked_price(contract, direct_vm, direct_alice, direct_bob, direct_owner)
    # only holder reveals
    direct_vm.sender = direct_alice
    contract.reveal_holder(match_id, 650, "0x" + "11" * 16)

    with direct_vm.expect_revert("both parties must reveal before an inconclusive resolution"):
        contract.resolve_inconclusive(match_id)


def test_resolve_inconclusive_rejected_if_adjudicated(direct_vm, direct_deploy, direct_alice, direct_bob, direct_owner):
    direct_vm.warp(AFTER_INCONCLUSIVE_DEADLINE)
    contract = direct_deploy("contracts/carnage.py")
    match_id = _run_to_revealed(contract, direct_vm, direct_alice, direct_bob, direct_owner)

    direct_vm.mock_llm(r"(?s)minimum acceptable price.*<claim>.*</claim>", json.dumps({"label": "TRUE", "reasoning": "x"}))
    direct_vm.mock_llm(r"(?s)maximum budget.*<claim>.*</claim>", json.dumps({"label": "TRUE", "reasoning": "x"}))
    contract.adjudicate(match_id)

    with direct_vm.expect_revert("match was already adjudicated"):
        contract.resolve_inconclusive(match_id)


def test_resolve_inconclusive_credits_both_stakes_in_full(direct_vm, direct_deploy, direct_alice, direct_bob, direct_owner):
    direct_vm.warp(AFTER_INCONCLUSIVE_DEADLINE)
    captured = _capture_post_messages(direct_vm)
    contract = direct_deploy("contracts/carnage.py")
    match_id = _run_to_revealed(contract, direct_vm, direct_alice, direct_bob, direct_owner)

    contract.resolve_inconclusive(match_id)

    # each side is credited exactly its own stake -- no slash, no counterparty
    # transfer, no sink -- and resolve_inconclusive itself moves no funds:
    # it only writes claimable balances, same pull pattern as settle(). The
    # only captured call is the MatchInconclusiveRefunded event, no PostMessage.
    assert [c for c in captured if "PostMessage" in c] == []

    m = contract.get_match(match_id)
    assert m["holder_claimable"] == STAKE
    assert m["buyer_claimable"] == STAKE
    assert m["inconclusive_resolved"] is True
    assert m["adjudicated"] is False
    assert m["settled"] is False


def test_resolve_inconclusive_then_claim_pays_out_full_stake_each(direct_vm, direct_deploy, direct_alice, direct_bob, direct_owner):
    direct_vm.warp(AFTER_INCONCLUSIVE_DEADLINE)
    contract = direct_deploy("contracts/carnage.py")
    alice, bob = _addr(direct_alice), _addr(direct_bob)
    match_id = _run_to_revealed(contract, direct_vm, direct_alice, direct_bob, direct_owner)
    contract.resolve_inconclusive(match_id)

    captured = _capture_post_messages(direct_vm)
    direct_vm.sender = alice
    holder_paid = contract.claim(match_id)
    direct_vm.sender = bob
    buyer_paid = contract.claim(match_id)

    assert holder_paid == STAKE
    assert buyer_paid == STAKE
    assert _transfers_to(captured, alice) == STAKE
    assert _transfers_to(captured, bob) == STAKE

    m = contract.get_match(match_id)
    assert m["holder_claimable"] == 0
    assert m["buyer_claimable"] == 0


def test_resolve_inconclusive_is_permissionless(direct_vm, direct_deploy, direct_alice, direct_bob, direct_owner, direct_charlie):
    direct_vm.warp(AFTER_INCONCLUSIVE_DEADLINE)
    contract = direct_deploy("contracts/carnage.py")
    match_id = _run_to_revealed(contract, direct_vm, direct_alice, direct_bob, direct_owner)

    direct_vm.sender = direct_charlie
    contract.resolve_inconclusive(match_id)  # does not raise

    m = contract.get_match(match_id)
    assert m["inconclusive_resolved"] is True


def test_resolve_inconclusive_twice_rejected(direct_vm, direct_deploy, direct_alice, direct_bob, direct_owner):
    direct_vm.warp(AFTER_INCONCLUSIVE_DEADLINE)
    contract = direct_deploy("contracts/carnage.py")
    match_id = _run_to_revealed(contract, direct_vm, direct_alice, direct_bob, direct_owner)

    contract.resolve_inconclusive(match_id)
    with direct_vm.expect_revert("inconclusive resolution already applied"):
        contract.resolve_inconclusive(match_id)


def test_resolve_inconclusive_emits_event(direct_vm, direct_deploy, direct_alice, direct_bob, direct_owner):
    direct_vm.warp(AFTER_INCONCLUSIVE_DEADLINE)
    captured = _capture_post_messages(direct_vm)
    contract = direct_deploy("contracts/carnage.py")
    alice, bob = _addr(direct_alice), _addr(direct_bob)
    match_id = _run_to_revealed(contract, direct_vm, direct_alice, direct_bob, direct_owner)

    contract.resolve_inconclusive(match_id)

    events = _emitted_events(captured)
    assert len(events) == 1
    assert events[0] == {
        "match_id": match_id,
        "holder": alice,
        "buyer": bob,
        "stake_amount": STAKE,
    }
