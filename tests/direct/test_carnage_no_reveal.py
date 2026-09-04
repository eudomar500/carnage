from conftest import (
    _addr,
    _new_match,
    _commit_both,
    _fund_both,
    _claim_both,
    _run_to_locked_price,
    _capture_post_messages,
    _transfers_to,
    HOLDER_SALT,
    BUYER_SALT,
    HOLDER_MIN_PRICE,
    BUYER_MAX_BUDGET,
    STAKE,
)

BEFORE_DEADLINE = "2026-06-01T00:00:00Z"
AFTER_DEADLINE = "2027-01-01T00:00:00Z"


def test_resolve_no_reveal_before_price_locked_rejected(direct_vm, direct_deploy, direct_alice, direct_bob, direct_owner):
    direct_vm.warp(AFTER_DEADLINE)
    contract = direct_deploy("contracts/carnage.py")
    match_id = _new_match(contract, direct_vm, direct_alice, direct_bob, direct_owner)
    _commit_both(contract, direct_vm, match_id, direct_alice, direct_bob)
    _fund_both(contract, direct_vm, match_id, direct_alice, direct_bob)
    _claim_both(contract, direct_vm, match_id, direct_alice, direct_bob)

    with direct_vm.expect_revert("deal price is not locked yet"):
        contract.resolve_no_reveal(match_id)


def test_resolve_no_reveal_before_deadline_rejected(direct_vm, direct_deploy, direct_alice, direct_bob, direct_owner):
    direct_vm.warp(BEFORE_DEADLINE)
    contract = direct_deploy("contracts/carnage.py")
    match_id = _run_to_locked_price(contract, direct_vm, direct_alice, direct_bob, direct_owner)

    direct_vm.sender = direct_alice
    contract.reveal_holder(match_id, HOLDER_MIN_PRICE, HOLDER_SALT)

    with direct_vm.expect_revert("reveal deadline has not passed yet"):
        contract.resolve_no_reveal(match_id)


def test_resolve_no_reveal_case_a_holder_revealed(direct_vm, direct_deploy, direct_alice, direct_bob, direct_owner, direct_charlie):
    direct_vm.warp(AFTER_DEADLINE)
    captured = _capture_post_messages(direct_vm)
    contract = direct_deploy("contracts/carnage.py")
    match_id = _run_to_locked_price(contract, direct_vm, direct_alice, direct_bob, direct_owner)

    direct_vm.sender = direct_alice
    contract.reveal_holder(match_id, HOLDER_MIN_PRICE, HOLDER_SALT)

    # permissionless: anyone can trigger resolution once the deadline has passed
    direct_vm.sender = direct_charlie
    outcome = contract.resolve_no_reveal(match_id)
    assert outcome == "HOLDER_REVEALED_BUYER_SLASHED"

    # resolve_no_reveal only writes claimable balances, no transfer of its own.
    assert captured == []

    m = contract.get_match(match_id)
    assert m["no_reveal_resolved"] is True
    assert m["holder_claimable"] == STAKE * 2
    assert m["buyer_claimable"] == 0


def test_resolve_no_reveal_case_a_buyer_revealed(direct_vm, direct_deploy, direct_alice, direct_bob, direct_owner):
    direct_vm.warp(AFTER_DEADLINE)
    contract = direct_deploy("contracts/carnage.py")
    match_id = _run_to_locked_price(contract, direct_vm, direct_alice, direct_bob, direct_owner)

    direct_vm.sender = direct_bob
    contract.reveal_buyer(match_id, BUYER_MAX_BUDGET, BUYER_SALT)

    outcome = contract.resolve_no_reveal(match_id)
    assert outcome == "BUYER_REVEALED_HOLDER_SLASHED"

    m = contract.get_match(match_id)
    assert m["buyer_claimable"] == STAKE * 2
    assert m["holder_claimable"] == 0


def test_resolve_no_reveal_case_b_neither_revealed(direct_vm, direct_deploy, direct_alice, direct_bob, direct_owner):
    direct_vm.warp(AFTER_DEADLINE)
    contract = direct_deploy("contracts/carnage.py")
    match_id = _run_to_locked_price(contract, direct_vm, direct_alice, direct_bob, direct_owner)

    outcome = contract.resolve_no_reveal(match_id)
    assert outcome == "BOTH_FORFEITED"

    m = contract.get_match(match_id)
    assert m["sink_claimable"] == STAKE * 2
    assert m["holder_claimable"] == 0
    assert m["buyer_claimable"] == 0


def test_resolve_no_reveal_rejected_if_both_revealed(direct_vm, direct_deploy, direct_alice, direct_bob, direct_owner):
    direct_vm.warp(AFTER_DEADLINE)
    contract = direct_deploy("contracts/carnage.py")
    match_id = _run_to_locked_price(contract, direct_vm, direct_alice, direct_bob, direct_owner)

    direct_vm.sender = direct_alice
    contract.reveal_holder(match_id, HOLDER_MIN_PRICE, HOLDER_SALT)
    direct_vm.sender = direct_bob
    contract.reveal_buyer(match_id, BUYER_MAX_BUDGET, BUYER_SALT)

    with direct_vm.expect_revert("both parties already revealed"):
        contract.resolve_no_reveal(match_id)


def test_resolve_no_reveal_twice_rejected(direct_vm, direct_deploy, direct_alice, direct_bob, direct_owner):
    direct_vm.warp(AFTER_DEADLINE)
    contract = direct_deploy("contracts/carnage.py")
    match_id = _run_to_locked_price(contract, direct_vm, direct_alice, direct_bob, direct_owner)

    contract.resolve_no_reveal(match_id)
    with direct_vm.expect_revert("no-reveal already resolved"):
        contract.resolve_no_reveal(match_id)


# ---- claim after no-reveal resolution ---------------------------------------


def test_claim_after_case_a_pays_revealer_double_stake(direct_vm, direct_deploy, direct_alice, direct_bob, direct_owner):
    direct_vm.warp(AFTER_DEADLINE)
    contract = direct_deploy("contracts/carnage.py")
    alice = _addr(direct_alice)
    match_id = _run_to_locked_price(contract, direct_vm, direct_alice, direct_bob, direct_owner)

    direct_vm.sender = alice
    contract.reveal_holder(match_id, HOLDER_MIN_PRICE, HOLDER_SALT)
    contract.resolve_no_reveal(match_id)

    captured = _capture_post_messages(direct_vm)
    direct_vm.sender = alice
    paid = contract.claim(match_id)

    assert paid == STAKE * 2
    assert _transfers_to(captured, alice) == STAKE * 2

    m = contract.get_match(match_id)
    assert m["holder_claimable"] == 0


def test_claim_after_case_b_pays_sink_address(direct_vm, direct_deploy, direct_alice, direct_bob, direct_owner):
    # The deploying account (direct_owner) is the default sink_address.
    direct_vm.warp(AFTER_DEADLINE)
    contract = direct_deploy("contracts/carnage.py")
    owner = _addr(direct_owner)
    match_id = _run_to_locked_price(contract, direct_vm, direct_alice, direct_bob, direct_owner)

    contract.resolve_no_reveal(match_id)

    captured = _capture_post_messages(direct_vm)
    direct_vm.sender = owner
    paid = contract.claim(match_id)

    assert paid == STAKE * 2
    assert _transfers_to(captured, owner) == STAKE * 2

    m = contract.get_match(match_id)
    assert m["sink_claimable"] == 0


def test_claim_rejected_for_non_revealer_after_case_a(direct_vm, direct_deploy, direct_alice, direct_bob, direct_owner):
    direct_vm.warp(AFTER_DEADLINE)
    contract = direct_deploy("contracts/carnage.py")
    match_id = _run_to_locked_price(contract, direct_vm, direct_alice, direct_bob, direct_owner)

    direct_vm.sender = direct_alice
    contract.reveal_holder(match_id, HOLDER_MIN_PRICE, HOLDER_SALT)
    contract.resolve_no_reveal(match_id)

    # buyer never revealed and has nothing claimable
    direct_vm.sender = direct_bob
    with direct_vm.expect_revert("nothing claimable for sender in this match"):
        contract.claim(match_id)
