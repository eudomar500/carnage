# tests/direct_v06

Direct-mode suite for `contracts/carnage_v06.py`, the consensus v0.6 fork of
the contract. 131 tests.

`tests/direct` is the Bradbury suite and stays as it is: it targets
`contracts/carnage.py` on the released toolchain in `requirements.txt`. This
tree targets the fork on the v0.6 release candidates. The two toolchains pull
incompatible `genlayer-py` majors, so they need separate virtualenvs and must
never share one.

## Running it

    python3 -m venv .venv-v06
    .venv-v06/bin/pip install -r requirements-v06.txt
    .venv-v06/bin/pytest tests/direct_v06

Run from the repository root; the tests resolve `contracts/carnage_v06.py`
relative to the working directory.

The first run downloads the GenVM v0.6 runner tree (a few hundred MB) into
`~/.cache/gltest-direct` and takes a couple of minutes. Later runs use the
cache. `pytest -p no:randomly` is not required but makes failures easier to
compare between runs.

## How this tree differs from tests/direct

Four differences, three of them forced by gltest 0.30 rather than by anything
in the contract. Each is marked at its site.

1. **Constructor argument.** `carnage_v06.py` takes `withdrawals_enabled`, so
   every deploy is `direct_deploy("contracts/carnage_v06.py", True)`.
2. **SDK import path.** `genlayer.py.types` moved to `genlayer.types`.
3. **LLM mock payload.** `exec_prompt(response_format="json")` now receives the
   mock as a JSON string whose content is the JSON text, so mocks are
   double-encoded: `json.dumps(json.dumps(payload))`.
4. **Hook entry shape.** The `_gl_call_hook` entry is `EmitInternalMessage`,
   not `PostMessage`, and the calldata method key moved from `"method"` to
   `""` -- the same rename genlayer-js 2.0 made. `conftest._calldata_method`,
   `_scheduled_calls`, `_post_messages` and `_transfers_to` are the only places
   that know this; tests go through them rather than reading the shape inline.

`conftest._warp` also has to write `gl.message.raw["datetime"]` instead of
`gl.message_raw["datetime"]`.

## Behavioural differences worth knowing

**Malformed LLM output is rejected one layer earlier.** The v0.6 runner parses
and validates the `response_format="json"` reply itself, so a leader reply that
is not valid JSON raises `genlayer.nondet.NondetException` before the contract
runs, and carnage's own `[LLM_ERROR] adjudicator returned non-dict output`
branch is unreachable for that input. It is not dead code in general: valid
JSON of the wrong shape (a list, a number) still reaches the contract and is
caught there. `test_adjudicate_rejects_non_json_output` pins down both halves,
so if either layer stops rejecting you can tell which one moved.

**`withdrawals_enabled`.** `test_carnage_withdrawals_flag.py` covers the flag,
which only the fork has. Studio Next finalizes `emit_transfer` without moving
value, so a claim there would zero a credited balance and pay nothing; a
deployment with `withdrawals_enabled=False` must refuse the claim before
touching the ledger. The tests assert the refusal, that the guard runs ahead of
every other check in `claim`, and that the flag set to `True` still pays
exactly as `carnage.py` does. They use the no-reveal path, so no LLM mock is
involved.
