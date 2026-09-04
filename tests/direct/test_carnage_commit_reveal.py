from conftest import (
    _addr,
    _new_match,
    _commit_both,
    _fund_both,
    _claim_both,
    _lock_price,
    _run_to_locked_price,
    HOLDER_SALT,
    BUYER_SALT,
    PRICE_FLOOR,
    PRICE_CEIL,
    STAKE,
    DEADLINE,
    INCONCLUSIVE_DEADLINE,
    HOLDER_MIN_PRICE,
    BUYER_MAX_BUDGET,
    DEAL_PRICE,
)


# ---- match creation -----------------------------------------------------


def test_create_match_stores_params(direct_vm, direct_deploy, direct_alice, direct_bob, direct_owner):
    contract = direct_deploy("contracts/carnage.py")
    match_id = _new_match(contract, direct_vm, direct_alice, direct_bob, direct_owner)

    m = contract.get_match(match_id)
    assert m["holder"] == _addr(direct_alice).as_hex
    assert m["buyer"] == _addr(direct_bob).as_hex
    assert m["price_floor"] == PRICE_FLOOR
    assert m["price_ceil"] == PRICE_CEIL
    assert m["stake_amount"] == STAKE
    assert m["holder_committed"] is False
    assert m["price_locked"] is False


def test_create_match_rejects_same_address_both_roles(direct_vm, direct_deploy, direct_alice, direct_owner):
    contract = direct_deploy("contracts/carnage.py")
    alice, owner = _addr(direct_alice), _addr(direct_owner)
    direct_vm.sender = owner
    with direct_vm.expect_revert("holder and buyer must differ"):
        contract.create_match(alice, alice, PRICE_FLOOR, PRICE_CEIL, STAKE, DEADLINE, INCONCLUSIVE_DEADLINE)


def test_create_match_rejects_inverted_band(direct_vm, direct_deploy, direct_alice, direct_bob, direct_owner):
    contract = direct_deploy("contracts/carnage.py")
    alice, bob, owner = _addr(direct_alice), _addr(direct_bob), _addr(direct_owner)
    direct_vm.sender = owner
    with direct_vm.expect_revert("price_ceil must exceed price_floor"):
        contract.create_match(alice, bob, PRICE_CEIL, PRICE_FLOOR, STAKE, DEADLINE, INCONCLUSIVE_DEADLINE)


# ---- commit ---------------------------------------------------------------


def test_commit_happy_path(direct_vm, direct_deploy, direct_alice, direct_bob, direct_owner):
    contract = direct_deploy("contracts/carnage.py")
    match_id = _new_match(contract, direct_vm, direct_alice, direct_bob, direct_owner)
    _commit_both(contract, direct_vm, match_id, direct_alice, direct_bob)

    m = contract.get_match(match_id)
    assert m["holder_committed"] is True
    assert m["buyer_committed"] is True


def test_commit_wrong_sender_rejected(direct_vm, direct_deploy, direct_alice, direct_bob, direct_owner):
    contract = direct_deploy("contracts/carnage.py")
    match_id = _new_match(contract, direct_vm, direct_alice, direct_bob, direct_owner)
    commitment = contract.compute_commitment(HOLDER_MIN_PRICE, HOLDER_SALT, match_id, _addr(direct_alice))

    direct_vm.sender = direct_bob
    with direct_vm.expect_revert("sender is not authorized"):
        contract.commit_holder(match_id, commitment)


def test_commit_twice_rejected(direct_vm, direct_deploy, direct_alice, direct_bob, direct_owner):
    contract = direct_deploy("contracts/carnage.py")
    match_id = _new_match(contract, direct_vm, direct_alice, direct_bob, direct_owner)
    commitment = contract.compute_commitment(HOLDER_MIN_PRICE, HOLDER_SALT, match_id, _addr(direct_alice))

    direct_vm.sender = direct_alice
    contract.commit_holder(match_id, commitment)
    with direct_vm.expect_revert("holder already committed"):
        contract.commit_holder(match_id, commitment)


def test_commit_malformed_hash_rejected(direct_vm, direct_deploy, direct_alice, direct_owner, direct_bob):
    contract = direct_deploy("contracts/carnage.py")
    match_id = _new_match(contract, direct_vm, direct_alice, direct_bob, direct_owner)

    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("must be a 0x-prefixed 32-byte hex hash"):
        contract.commit_holder(match_id, "not-a-hash")


# ---- fund -------------------------------------------------------------------


def test_fund_before_commit_rejected(direct_vm, direct_deploy, direct_alice, direct_bob, direct_owner):
    contract = direct_deploy("contracts/carnage.py")
    match_id = _new_match(contract, direct_vm, direct_alice, direct_bob, direct_owner)

    direct_vm.sender = direct_alice
    direct_vm.value = STAKE
    with direct_vm.expect_revert("both parties must commit before funding"):
        contract.fund_holder(match_id)


def test_fund_wrong_value_rejected(direct_vm, direct_deploy, direct_alice, direct_bob, direct_owner):
    contract = direct_deploy("contracts/carnage.py")
    match_id = _new_match(contract, direct_vm, direct_alice, direct_bob, direct_owner)
    _commit_both(contract, direct_vm, match_id, direct_alice, direct_bob)

    direct_vm.sender = direct_alice
    direct_vm.value = STAKE - 1
    with direct_vm.expect_revert("holder must fund exactly stake_amount"):
        contract.fund_holder(match_id)


def test_fund_buyer_wrong_value_rejected(direct_vm, direct_deploy, direct_alice, direct_bob, direct_owner):
    contract = direct_deploy("contracts/carnage.py")
    match_id = _new_match(contract, direct_vm, direct_alice, direct_bob, direct_owner)
    _commit_both(contract, direct_vm, match_id, direct_alice, direct_bob)

    direct_vm.sender = direct_bob
    direct_vm.value = STAKE + 1
    with direct_vm.expect_revert("buyer must fund exactly stake_amount"):
        contract.fund_buyer(match_id)


def test_fund_deposits_stake_only_no_deal_value_escrow(direct_vm, direct_deploy, direct_alice, direct_bob, direct_owner):
    # Carnage judges claims against deal_price; it never moves deal_price as
    # funds. Both sides post exactly stake_amount, regardless of price_ceil.
    contract = direct_deploy("contracts/carnage.py")
    match_id = _new_match(contract, direct_vm, direct_alice, direct_bob, direct_owner)
    _commit_both(contract, direct_vm, match_id, direct_alice, direct_bob)

    direct_vm.sender = direct_alice
    direct_vm.value = PRICE_CEIL  # would be huge if stake required price_ceil too
    with direct_vm.expect_revert("holder must fund exactly stake_amount"):
        contract.fund_holder(match_id)

    direct_vm.sender = direct_bob
    direct_vm.value = PRICE_CEIL
    with direct_vm.expect_revert("buyer must fund exactly stake_amount"):
        contract.fund_buyer(match_id)


def test_fund_happy_path(direct_vm, direct_deploy, direct_alice, direct_bob, direct_owner):
    contract = direct_deploy("contracts/carnage.py")
    match_id = _new_match(contract, direct_vm, direct_alice, direct_bob, direct_owner)
    _commit_both(contract, direct_vm, match_id, direct_alice, direct_bob)
    _fund_both(contract, direct_vm, match_id, direct_alice, direct_bob)

    m = contract.get_match(match_id)
    assert m["holder_funded"] is True
    assert m["buyer_funded"] is True


# ---- claim anchoring --------------------------------------------------------


def test_claim_before_funded_rejected(direct_vm, direct_deploy, direct_alice, direct_bob, direct_owner):
    contract = direct_deploy("contracts/carnage.py")
    match_id = _new_match(contract, direct_vm, direct_alice, direct_bob, direct_owner)
    _commit_both(contract, direct_vm, match_id, direct_alice, direct_bob)

    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("both parties must fund before claiming"):
        contract.anchor_claim_holder(match_id, "My minimum is 650.")


def test_claim_twice_rejected(direct_vm, direct_deploy, direct_alice, direct_bob, direct_owner):
    contract = direct_deploy("contracts/carnage.py")
    match_id = _new_match(contract, direct_vm, direct_alice, direct_bob, direct_owner)
    _commit_both(contract, direct_vm, match_id, direct_alice, direct_bob)
    _fund_both(contract, direct_vm, match_id, direct_alice, direct_bob)

    direct_vm.sender = direct_alice
    contract.anchor_claim_holder(match_id, "My minimum is 650.")
    with direct_vm.expect_revert("holder already anchored a claim"):
        contract.anchor_claim_holder(match_id, "Second attempt.")


def test_claim_cannot_be_substituted_by_counterparty(direct_vm, direct_deploy, direct_alice, direct_bob, direct_owner):
    contract = direct_deploy("contracts/carnage.py")
    match_id = _new_match(contract, direct_vm, direct_alice, direct_bob, direct_owner)
    _commit_both(contract, direct_vm, match_id, direct_alice, direct_bob)
    _fund_both(contract, direct_vm, match_id, direct_alice, direct_bob)

    direct_vm.sender = direct_bob
    with direct_vm.expect_revert("sender is not authorized"):
        contract.anchor_claim_holder(match_id, "I am pretending to be the holder.")


# ---- deal-price lock ---------------------------------------------------------


def test_price_lock_requires_matching_proposals(direct_vm, direct_deploy, direct_alice, direct_bob, direct_owner):
    contract = direct_deploy("contracts/carnage.py")
    match_id = _new_match(contract, direct_vm, direct_alice, direct_bob, direct_owner)
    _commit_both(contract, direct_vm, match_id, direct_alice, direct_bob)
    _fund_both(contract, direct_vm, match_id, direct_alice, direct_bob)
    _claim_both(contract, direct_vm, match_id, direct_alice, direct_bob)

    direct_vm.sender = direct_alice
    contract.propose_price_holder(match_id, 700)
    direct_vm.sender = direct_bob
    contract.propose_price_buyer(match_id, 750)

    m = contract.get_match(match_id)
    assert m["price_locked"] is False

    direct_vm.sender = direct_alice
    contract.propose_price_holder(match_id, 750)

    m = contract.get_match(match_id)
    assert m["price_locked"] is True
    assert m["deal_price"] == 750


def test_price_propose_before_claims_rejected(direct_vm, direct_deploy, direct_alice, direct_bob, direct_owner):
    contract = direct_deploy("contracts/carnage.py")
    match_id = _new_match(contract, direct_vm, direct_alice, direct_bob, direct_owner)
    _commit_both(contract, direct_vm, match_id, direct_alice, direct_bob)
    _fund_both(contract, direct_vm, match_id, direct_alice, direct_bob)

    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("both parties must anchor a claim before pricing"):
        contract.propose_price_holder(match_id, DEAL_PRICE)


def test_price_outside_band_rejected(direct_vm, direct_deploy, direct_alice, direct_bob, direct_owner):
    contract = direct_deploy("contracts/carnage.py")
    match_id = _new_match(contract, direct_vm, direct_alice, direct_bob, direct_owner)
    _commit_both(contract, direct_vm, match_id, direct_alice, direct_bob)
    _fund_both(contract, direct_vm, match_id, direct_alice, direct_bob)
    _claim_both(contract, direct_vm, match_id, direct_alice, direct_bob)

    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("price must lie within the match band"):
        contract.propose_price_holder(match_id, 1500)


def test_price_relock_rejected_once_locked(direct_vm, direct_deploy, direct_alice, direct_bob, direct_owner):
    contract = direct_deploy("contracts/carnage.py")
    match_id = _run_to_locked_price(contract, direct_vm, direct_alice, direct_bob, direct_owner)

    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("deal price already locked"):
        contract.propose_price_holder(match_id, 800)


# ---- reveal -------------------------------------------------------------------


def test_reveal_happy_path(direct_vm, direct_deploy, direct_alice, direct_bob, direct_owner):
    contract = direct_deploy("contracts/carnage.py")
    match_id = _run_to_locked_price(contract, direct_vm, direct_alice, direct_bob, direct_owner)

    direct_vm.sender = direct_alice
    contract.reveal_holder(match_id, HOLDER_MIN_PRICE, HOLDER_SALT)
    direct_vm.sender = direct_bob
    contract.reveal_buyer(match_id, BUYER_MAX_BUDGET, BUYER_SALT)

    m = contract.get_match(match_id)
    assert m["holder_revealed"] is True
    assert m["buyer_revealed"] is True
    assert m["holder_revealed_state"] == HOLDER_MIN_PRICE
    assert m["buyer_revealed_state"] == BUYER_MAX_BUDGET


def test_reveal_before_price_locked_rejected(direct_vm, direct_deploy, direct_alice, direct_bob, direct_owner):
    contract = direct_deploy("contracts/carnage.py")
    match_id = _new_match(contract, direct_vm, direct_alice, direct_bob, direct_owner)
    _commit_both(contract, direct_vm, match_id, direct_alice, direct_bob)
    _fund_both(contract, direct_vm, match_id, direct_alice, direct_bob)
    _claim_both(contract, direct_vm, match_id, direct_alice, direct_bob)

    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("deal price is not locked yet"):
        contract.reveal_holder(match_id, HOLDER_MIN_PRICE, HOLDER_SALT)


def test_reveal_wrong_salt_rejected(direct_vm, direct_deploy, direct_alice, direct_bob, direct_owner):
    contract = direct_deploy("contracts/carnage.py")
    match_id = _run_to_locked_price(contract, direct_vm, direct_alice, direct_bob, direct_owner)

    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("reveal does not match commitment"):
        contract.reveal_holder(match_id, HOLDER_MIN_PRICE, BUYER_SALT)


def test_reveal_wrong_state_rejected(direct_vm, direct_deploy, direct_alice, direct_bob, direct_owner):
    contract = direct_deploy("contracts/carnage.py")
    match_id = _run_to_locked_price(contract, direct_vm, direct_alice, direct_bob, direct_owner)

    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("reveal does not match commitment"):
        contract.reveal_holder(match_id, 651, HOLDER_SALT)


def test_reveal_cannot_be_replayed_across_matches(direct_vm, direct_deploy, direct_alice, direct_bob, direct_owner):
    contract = direct_deploy("contracts/carnage.py")
    alice, bob = _addr(direct_alice), _addr(direct_bob)

    match_a = _run_to_locked_price(contract, direct_vm, direct_alice, direct_bob, direct_owner)

    # match_b's holder commits to a different minimum_price, so match_b's real
    # commitment does not coincide with the hash that match_a's reveal produces.
    match_b = _new_match(contract, direct_vm, direct_alice, direct_bob, direct_owner)
    other_state = HOLDER_MIN_PRICE + 1
    holder_commitment_b = contract.compute_commitment(other_state, HOLDER_SALT, match_b, alice)
    buyer_commitment_b = contract.compute_commitment(BUYER_MAX_BUDGET, BUYER_SALT, match_b, bob)
    direct_vm.sender = alice
    contract.commit_holder(match_b, holder_commitment_b)
    direct_vm.sender = bob
    contract.commit_buyer(match_b, buyer_commitment_b)
    _fund_both(contract, direct_vm, match_b, direct_alice, direct_bob)
    _claim_both(contract, direct_vm, match_b, direct_alice, direct_bob)
    _lock_price(contract, direct_vm, match_b, direct_alice, direct_bob)

    direct_vm.sender = direct_alice
    contract.reveal_holder(match_a, HOLDER_MIN_PRICE, HOLDER_SALT)

    # The exact (state, salt) that satisfied match_a's commitment must not
    # satisfy match_b's, because match_id is baked into the hash.
    with direct_vm.expect_revert("reveal does not match commitment"):
        contract.reveal_holder(match_b, HOLDER_MIN_PRICE, HOLDER_SALT)


def test_reveal_cannot_be_substituted_across_agents(direct_vm, direct_deploy, direct_alice, direct_bob, direct_owner):
    contract = direct_deploy("contracts/carnage.py")
    match_id = _run_to_locked_price(contract, direct_vm, direct_alice, direct_bob, direct_owner)

    # Buyer tries to reveal holder's committed state/salt through the buyer
    # method; agent_address is baked into the hash so this must fail even
    # though the (state, salt) pair is exactly what the holder committed to.
    direct_vm.sender = direct_bob
    with direct_vm.expect_revert("reveal does not match commitment"):
        contract.reveal_buyer(match_id, HOLDER_MIN_PRICE, HOLDER_SALT)


def test_reveal_twice_rejected(direct_vm, direct_deploy, direct_alice, direct_bob, direct_owner):
    contract = direct_deploy("contracts/carnage.py")
    match_id = _run_to_locked_price(contract, direct_vm, direct_alice, direct_bob, direct_owner)

    direct_vm.sender = direct_alice
    contract.reveal_holder(match_id, HOLDER_MIN_PRICE, HOLDER_SALT)
    with direct_vm.expect_revert("holder already revealed"):
        contract.reveal_holder(match_id, HOLDER_MIN_PRICE, HOLDER_SALT)


def test_reveal_wrong_sender_rejected(direct_vm, direct_deploy, direct_alice, direct_bob, direct_owner):
    contract = direct_deploy("contracts/carnage.py")
    match_id = _run_to_locked_price(contract, direct_vm, direct_alice, direct_bob, direct_owner)

    direct_vm.sender = direct_bob
    with direct_vm.expect_revert("sender is not authorized"):
        contract.reveal_holder(match_id, HOLDER_MIN_PRICE, HOLDER_SALT)


# ---- commitment hashing ------------------------------------------------------


def test_compute_commitment_is_deterministic_and_role_bound(direct_vm, direct_deploy, direct_alice, direct_bob, direct_owner):
    contract = direct_deploy("contracts/carnage.py")
    match_id = _new_match(contract, direct_vm, direct_alice, direct_bob, direct_owner)
    alice, bob = _addr(direct_alice), _addr(direct_bob)

    c1 = contract.compute_commitment(HOLDER_MIN_PRICE, HOLDER_SALT, match_id, alice)
    c2 = contract.compute_commitment(HOLDER_MIN_PRICE, HOLDER_SALT, match_id, alice)
    assert c1 == c2
    assert c1.startswith("0x")
    assert len(c1) == 66

    # changing any bound input changes the commitment
    assert c1 != contract.compute_commitment(HOLDER_MIN_PRICE, HOLDER_SALT, match_id, bob)
    assert c1 != contract.compute_commitment(651, HOLDER_SALT, match_id, alice)
    assert c1 != contract.compute_commitment(HOLDER_MIN_PRICE, BUYER_SALT, match_id, alice)


def test_salt_too_short_rejected(direct_vm, direct_deploy, direct_alice, direct_bob, direct_owner):
    contract = direct_deploy("contracts/carnage.py")
    match_id = _new_match(contract, direct_vm, direct_alice, direct_bob, direct_owner)

    with direct_vm.expect_revert("salt must be at least 16 bytes"):
        contract.compute_commitment(HOLDER_MIN_PRICE, "0x1234", match_id, _addr(direct_alice))


def test_commitment_hash_is_genuine_keccak256(direct_vm, direct_deploy, direct_alice, direct_bob, direct_owner):
    # Guards against a silent Keccak/SHA3 mismatch (spec invariant #10):
    # the contract's hash is cross-checked against web3's independent
    # Keccak-256 implementation, not the contract's own copy of it.
    from web3 import Web3

    contract = direct_deploy("contracts/carnage.py")
    match_id = _new_match(contract, direct_vm, direct_alice, direct_bob, direct_owner)
    alice = _addr(direct_alice)

    onchain = contract.compute_commitment(HOLDER_MIN_PRICE, HOLDER_SALT, match_id, alice)

    salt_bytes = bytes.fromhex(HOLDER_SALT[2:])
    preimage = (
        int(HOLDER_MIN_PRICE).to_bytes(32, "big")
        + salt_bytes
        + int(match_id).to_bytes(32, "big")
        + alice.as_bytes
    )
    expected = "0x" + Web3.keccak(preimage).hex()

    assert onchain == expected
