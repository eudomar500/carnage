"""Shared match-progression helpers for direct-mode Carnage tests."""

HOLDER_SALT = "0x" + "11" * 16
BUYER_SALT = "0x" + "22" * 16

PRICE_FLOOR = 500
PRICE_CEIL = 1000
STAKE = 500
DEADLINE = "2026-12-31T00:00:00Z"
INCONCLUSIVE_DEADLINE = "2027-01-31T00:00:00Z"

HOLDER_MIN_PRICE = 650
BUYER_MAX_BUDGET = 900
DEAL_PRICE = 750

HOLDER_CLAIM = "My minimum is 650."
BUYER_CLAIM = "My budget tops out around 900."


def _addr(raw):
    """Coerce a direct-mode test fixture (raw bytes) into a genlayer Address.

    direct_alice/direct_bob/direct_owner are resolved by pytest before any
    contract has been deployed in the test, so genlayer.py.types isn't on
    sys.path yet and the fixture falls back to plain bytes. Call this after
    the first direct_deploy() in a test, once genlayer is importable.
    """
    from genlayer.py.types import Address

    if isinstance(raw, Address):
        return raw
    return Address(raw)


def _new_match(contract, direct_vm, holder, buyer, owner):
    holder, buyer, owner = _addr(holder), _addr(buyer), _addr(owner)
    direct_vm.sender = owner
    return contract.create_match(
        holder, buyer, PRICE_FLOOR, PRICE_CEIL, STAKE, DEADLINE, INCONCLUSIVE_DEADLINE
    )


def _commit_both(contract, direct_vm, match_id, holder, buyer):
    holder, buyer = _addr(holder), _addr(buyer)
    holder_commitment = contract.compute_commitment(
        HOLDER_MIN_PRICE, HOLDER_SALT, match_id, holder
    )
    buyer_commitment = contract.compute_commitment(
        BUYER_MAX_BUDGET, BUYER_SALT, match_id, buyer
    )
    direct_vm.sender = holder
    contract.commit_holder(match_id, holder_commitment)
    direct_vm.sender = buyer
    contract.commit_buyer(match_id, buyer_commitment)


def _fund_both(contract, direct_vm, match_id, holder, buyer):
    holder, buyer = _addr(holder), _addr(buyer)
    direct_vm.sender = holder
    direct_vm.value = STAKE
    contract.fund_holder(match_id)
    direct_vm.value = 0

    direct_vm.sender = buyer
    direct_vm.value = STAKE
    contract.fund_buyer(match_id)
    direct_vm.value = 0


def _claim_both(contract, direct_vm, match_id, holder, buyer, holder_claim=HOLDER_CLAIM, buyer_claim=BUYER_CLAIM):
    holder, buyer = _addr(holder), _addr(buyer)
    direct_vm.sender = holder
    contract.anchor_claim_holder(match_id, holder_claim)
    direct_vm.sender = buyer
    contract.anchor_claim_buyer(match_id, buyer_claim)


def _lock_price(contract, direct_vm, match_id, holder, buyer, price=DEAL_PRICE):
    holder, buyer = _addr(holder), _addr(buyer)
    direct_vm.sender = holder
    contract.propose_price_holder(match_id, price)
    direct_vm.sender = buyer
    contract.propose_price_buyer(match_id, price)


def _reveal_both(contract, direct_vm, match_id, holder, buyer):
    holder, buyer = _addr(holder), _addr(buyer)
    direct_vm.sender = holder
    contract.reveal_holder(match_id, HOLDER_MIN_PRICE, HOLDER_SALT)
    direct_vm.sender = buyer
    contract.reveal_buyer(match_id, BUYER_MAX_BUDGET, BUYER_SALT)


def _run_to_locked_price(contract, direct_vm, holder, buyer, owner):
    match_id = _new_match(contract, direct_vm, holder, buyer, owner)
    _commit_both(contract, direct_vm, match_id, holder, buyer)
    _fund_both(contract, direct_vm, match_id, holder, buyer)
    _claim_both(contract, direct_vm, match_id, holder, buyer)
    _lock_price(contract, direct_vm, match_id, holder, buyer)
    return match_id


def _capture_post_messages(direct_vm):
    """Install a _gl_call_hook that records every PostMessage (emit/emit_transfer)
    the contract sends, instead of letting direct mode silently drop it.

    Direct mode doesn't apply cross-contract value transfers to balances, but
    the hook still sees the exact decoded request -- recipient, value, and
    calldata -- so tests can assert precisely who got paid how much, even
    though no real consensus/finalization is being simulated.
    """
    captured = []

    def hook(vm, request):
        captured.append(request)
        return None

    direct_vm._gl_call_hook = hook
    return captured


def _contract_self_address(direct_vm):
    from genlayer.py.types import Address

    return Address(direct_vm._contract_address)


def _emitted_events(captured):
    """Blob payload of every event emitted so far, in emission order."""
    return [entry["EmitEvent"]["blob"] for entry in captured if "EmitEvent" in entry]


def _transfers_to(captured, address):
    """Total value sent to `address` via plain emit_transfer (no method call)."""
    total = 0
    for entry in captured:
        pm = entry.get("PostMessage")
        if pm is None or pm.get("calldata") != {}:
            continue
        if pm["address"] == address:
            total += int(pm["value"])
    return total


def _run_to_revealed(contract, direct_vm, holder, buyer, owner, holder_claim=HOLDER_CLAIM, buyer_claim=BUYER_CLAIM):
    match_id = _new_match(contract, direct_vm, holder, buyer, owner)
    _commit_both(contract, direct_vm, match_id, holder, buyer)
    _fund_both(contract, direct_vm, match_id, holder, buyer)
    _claim_both(contract, direct_vm, match_id, holder, buyer, holder_claim, buyer_claim)
    _lock_price(contract, direct_vm, match_id, holder, buyer)
    _reveal_both(contract, direct_vm, match_id, holder, buyer)
    return match_id
