"""The withdrawals_enabled constructor flag, which only carnage_v06.py has.

Studio Next finalizes emit_transfer without moving value, so a claim there
would zero a credited balance and pay nothing. A deployment with
withdrawals_enabled=False must refuse the claim before touching the ledger.

The no-reveal path is used to reach a credited balance because it is fully
deterministic: no adjudication, so no LLM mock is involved.
"""

from conftest import (
    _addr,
    _capture_post_messages,
    _post_messages,
    _run_to_locked_price,
    _transfers_to,
    _warp,
    HOLDER_MIN_PRICE,
    HOLDER_SALT,
    STAKE,
)

BEFORE_DEADLINE = "2026-06-01T00:00:00Z"
AFTER_DEADLINE = "2027-01-01T00:00:00Z"


def _credit_holder_double_stake(contract, direct_vm, alice, direct_alice, direct_bob, direct_owner):
    match_id = _run_to_locked_price(contract, direct_vm, direct_alice, direct_bob, direct_owner)
    direct_vm.sender = alice
    contract.reveal_holder(match_id, HOLDER_MIN_PRICE, HOLDER_SALT)
    _warp(direct_vm, AFTER_DEADLINE)
    contract.resolve_no_reveal(match_id)
    return match_id


def test_withdrawals_disabled_rejects_claim_and_leaves_the_ledger_intact(
    direct_vm, direct_deploy, direct_alice, direct_bob, direct_owner
):
    direct_vm.warp(BEFORE_DEADLINE)
    contract = direct_deploy("contracts/carnage_v06.py", False)
    alice = _addr(direct_alice)
    match_id = _credit_holder_double_stake(contract, direct_vm, alice, direct_alice, direct_bob, direct_owner)

    before = contract.get_match(match_id)
    assert before["withdrawals_enabled"] is False
    assert before["holder_claimable"] == STAKE * 2
    assert before["paid_total"] == 0

    captured = _capture_post_messages(direct_vm)
    direct_vm.sender = alice
    with direct_vm.expect_revert(
        "withdrawals are disabled on this deployment: "
        "the network does not execute outbound transfers"
    ):
        contract.claim(match_id)

    after = contract.get_match(match_id)
    # The balance is still owed, still exactly what it was, and nothing was sent.
    assert after["holder_claimable"] == STAKE * 2
    assert after["buyer_claimable"] == before["buyer_claimable"]
    assert after["paid_total"] == 0
    assert after["credited_total"] == before["credited_total"]
    assert _transfers_to(captured, alice) == 0
    assert _post_messages(captured) == []


def test_withdrawals_disabled_guard_precedes_every_other_claim_check(
    direct_vm, direct_deploy, direct_alice, direct_bob, direct_owner
):
    # A sender with nothing claimable would normally get "sender has nothing
    # claimable"; the flag must be refused first, so no caller can tell the
    # two apart or reach the balance logic at all.
    direct_vm.warp(BEFORE_DEADLINE)
    contract = direct_deploy("contracts/carnage_v06.py", False)
    match_id = _run_to_locked_price(contract, direct_vm, direct_alice, direct_bob, direct_owner)

    direct_vm.sender = _addr(direct_owner)
    with direct_vm.expect_revert("withdrawals are disabled on this deployment"):
        contract.claim(match_id)


def test_withdrawals_enabled_still_pays(
    direct_vm, direct_deploy, direct_alice, direct_bob, direct_owner
):
    # The same contract with the flag on behaves exactly as carnage.py does:
    # one finalized transfer to the caller, claimable zeroed.
    direct_vm.warp(BEFORE_DEADLINE)
    contract = direct_deploy("contracts/carnage_v06.py", True)
    alice = _addr(direct_alice)
    match_id = _credit_holder_double_stake(contract, direct_vm, alice, direct_alice, direct_bob, direct_owner)

    assert contract.get_match(match_id)["withdrawals_enabled"] is True

    captured = _capture_post_messages(direct_vm)
    direct_vm.sender = alice
    paid = contract.claim(match_id)

    assert paid == STAKE * 2
    assert _transfers_to(captured, alice) == STAKE * 2
    m = contract.get_match(match_id)
    assert m["holder_claimable"] == 0
    assert m["paid_total"] == STAKE * 2
