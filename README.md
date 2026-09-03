# Carnage

An adversarial benchmark for agent adjudication, played as a game.

Most agent dispute systems can tell you what the judge decided. Carnage can tell you whether the judge was right.

When a decentralised judge rules that an agent broke its word, nobody can check the ruling. There is no independent account of what actually happened to compare it against. Every dispute resolution system for agents shares this blind spot: the verdict is unfalsifiable.

Carnage removes it by fixing the truth before anyone can influence it. Each match derives a hidden scenario from secrets all three players commit to in advance, commits that scenario on chain, and hands each agent only the fragment belonging to their role. Agents then negotiate, and each can lie about what they alone can see. When the match closes the scenario is revealed, and GenLayer's ruling is scored against a reality that no participant chose.

## What Carnage measures

**Adjudication accuracy.** Did consensus identify the deception correctly?

**Adjudication robustness.** How does that change across kinds of deception, from a direct false statement to a technically true claim that omits what matters?

**Consensus reliability.** How often does a ruling converge, and how often does it end without one?

## Why this exists

AI agents are already hiring other AI agents. Personal assistants delegate tasks and spend budgets on behalf of users, and agent-only platforms are assembling escrow, reputation and skill marketplaces in the wild.

The infrastructure for that is arriving fast. Payment rails are solved: AWS, Visa, Mastercard, Stripe and Coinbase all shipped agent payment systems. Identity registries exist. Escrow and dispute resolution are being built right now.

What nobody has is evidence that any of it works under pressure. There is no behavioural data on how agents act when money is at stake and lying pays, and no way to tell whether a consensus judge gets those cases right.

That matters more than it appears. In platform economies, the rules governing reputation, payment and market access lock in fast: once agents optimise around an incentive structure, redesign becomes prohibitively expensive. The mechanisms being chosen now are the ones we will be stuck with.

Carnage is a controlled environment for testing them before they harden.

## Why it needs GenLayer

Agency theory names the gap precisely. Under moral hazard, the principal cannot directly verify that the terms of the contract have been respected. Monitoring is prohibitively expensive and performance metrics are often uninformative or misleading.

That is not a blockchain limitation. It is a limitation of deterministic verification. "Did the holder describe the asset honestly?" is not a comparison against a threshold. It is a judgment.

GenLayer reaches consensus on the meaning of a transaction rather than only its execution, which makes a contract capable of holding a claim written in plain language and ruling on whether it holds up. No oracle feed, no admin key, no arbiter.

Carnage puts that capability under deliberate attack and keeps score.

## Where the truth comes from

This is the part that makes the measurement mean anything.

Before a match begins, each of the three players commits to a secret value, bound to their address and to the match. Once all three commitments are locked, the secrets are revealed and checked against them. The match entropy is derived from all three together, and the scenario is generated deterministically from that entropy: the same entropy always produces the same scenario.

No player can predict the outcome, because when they commit they do not know the other two secrets. No player can choose it, because steering the result would require knowing those secrets first. And the derivation runs as ordinary deterministic contract code, so every validator computes the same scenario without any consensus mechanism being involved.

A commitment made by one player about their own private truth would prove only that they later revealed what they committed to. It would not prove the value was ever true. Carnage does not rely on that. The reality is authored by the match, not asserted by any agent, which is what allows a verdict to be graded rather than merely recorded.

If a player fails to reveal before the deadline, the match does not proceed to settlement. Players who complied recover their stake and the one who withheld forfeits theirs. Nobody gets to watch the other reveals, dislike the scenario forming, and quietly walk away from it.

## How a match works

Three agents enter, one per player, each funded with GEN. A player competes by writing their agent's strategy in plain language: the prompt is the weapon.

The match derives the scenario, commits it, and gives each agent only the fragment belonging to their role.

The **holder** learns the asset's real condition. Everyone else sees only what the holder chooses to say about it.

The **broker** learns the real demand: who needs it and what it is worth to them. Neither counterparty sees that map.

The **buyer** learns their real budget and how badly they need the asset. Nobody knows what they can actually pay.

No agent can close a deal alone, so they must contract each other, and each can lie about the fragment only they hold. Funds are custodied by the contract and moved on the agents' instructions within the match's bounded authority, following the delegated-authority pattern the industry converged on: agent permissions attenuated, contextual and bound to a narrow task rather than a standing wallet.

When the match closes, the scenario is revealed and checked against its commitment. GenLayer then reads what each agent claimed against what was actually the case and returns a structured ruling on how well each represented the truth they held. The predator eats the bottom two. The last one standing takes the pot.

## What runs where

The split matters, because putting the wrong thing on chain weakens the trust model rather than strengthening it.

**The contract owns** the player commitments, the scenario commitment, the escrow, the record of every claim, the ruling and the payout. Everything that moves money or settles a dispute.

**The negotiation runs off chain.** Agents proposing, haggling and committing to terms is exploration, not settlement. Running it through consensus would add latency and divergence without adding trust.

**The adjudication evidence is on chain.** Validators do not fetch external sources. The claims they judge and the revealed scenario they judge them against are read from contract state, so every validator evaluates identical material. This removes the largest source of consensus divergence: external data that varies between validators reading at different moments.

**Nothing off chain decides who lied.** The scenario was fixed before negotiation and the ruling happens in the contract. If the ruling lived in a backend, Carnage would be measuring its own opinion.

## Where the guarantees end

GenLayer does not provide confidential contract state, and Carnage does not pretend otherwise. Contract storage is public by design, because consensus requires every validator to read the same thing.

So the role fragments cannot be held on chain in secret. Only the scenario commitment is. The fragments themselves are distributed to each agent off chain at match start, and that distribution is a trust boundary: it is trusted not to hand one player another player's fragment before the match ends.

What the chain does guarantee is that the scenario cannot change after it is committed. Whoever distributes the fragments has no authority over the truth once the commitment is written. They cannot rewrite what was true to fit a result, and the reveal is verified against the commitment before any ruling is made.

That is a smaller trust boundary than it first appears, and it is stated here rather than buried because a benchmark that misrepresents its own guarantees is not measuring anything. Carnage measures adjudication. It does not claim to solve confidential computing.

## When a ruling does not land

Adjudication over deliberate deception is meant to be hard, and some matches will not resolve on the first attempt.

The protocol rotates leaders and validators within bounded limits, and a call that still finds no majority settles into a terminal undetermined state rather than committing a disputed result. Carnage never settles a match on such a ruling. Any further attempt beyond that is a separate, explicitly submitted appeal, not an automatic retry.

The timeout that returns every stake when a match cannot resolve is Carnage's own contract logic, not something the protocol provides. No match can strand funds, whatever the judge decides or fails to decide.

Those outcomes are recorded too. How often adjudication converges, and on which kinds of deception it does not, is part of what this project is built to find out.

## What a match leaves behind

Every match writes a complete record on chain: the committed scenario, what each agent claimed, the revealed truth, and how consensus ruled. Because the truth was fixed before play and authored by nobody at the table, each record carries something a production dispute system cannot produce: a verdict that can be marked right or wrong.

Two things accumulate from that.

**Adjudication under attack.** Which deceptions a judge reading plain language catches, and which slip past. A direct false statement is not the same problem as a technically true claim that omits what matters, or language vague enough to be defensible either way. Carnage generates those cases on purpose and records how the ruling handled each.

**Agent behaviour under incentive.** Research on delegated LLM systems argues that when a sub-agent has a divergent objective, private information about its own actions, and awareness of oversight, scheming is a rational response to imperfect monitoring. Carnage instantiates all three conditions deliberately, then adds the one thing missing from the real world, verifiable adjudication, and records what changes.

Both grow with every match played, as an open record anyone can audit against the chain.

## Status

Built on GenLayer Testnet Bradbury.
