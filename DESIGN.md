# AXIOM

A single-session strategy game about inferring hidden laws and exploiting them
under pressure. TypeScript, Canvas 2D, zero runtime dependencies.

## Concept

Each session, the game **generates an actual ruleset from scratch** — a small
formal system of interaction laws between 5–6 species of colored dots. Not
randomized weights on fixed rules: the generator draws rules from a grammar
(forces, contact reactions, unary lifecycle rules), composes them into a
candidate physics, and **validates it by headless burn-in simulation**,
rejecting degenerate worlds (instant extinction, population explosion, static
goo). The surviving ruleset is calibrated: objective targets are derived from
the burn-in's measured baseline, so generated goals are always nontrivial but
achievable.

The player is an operator. They do not control a dot. They watch the field,
form hypotheses about the laws, and spend a scarce budget on interventions and
intel. The win condition is a generated objective with a deadline, plus a
generated standing constraint that conflicts with it in interesting ways.

**The core skill:** read motion → infer law → exploit law → don't go broke.

## Why this design

- *Movement, contact, transformation* are the only primitives that stay
  intuitive with zero real-world reference. Everything is shown through them.
- The market is endogenous: prices float on live population scarcity, so the
  ecology IS the economy. Pumping a species crashes its price; farming a
  conversion chain is an arbitrage you discover, not a button you press.
- Intel is the scarcest resource. You can buy truth (SCAN) or earn it by
  observation (rules auto-confirm after being witnessed 3×). Every credit
  spent on knowing is a credit not spent on doing.

## Rule grammar (generated per session)

Species: K ∈ {5,6} classes, each with a color and a Greek designation
(Σ, Θ, Δ, Λ, Ψ, Ω — assignment shuffled per session).

1. **Force matrix** — for each ordered pair (A,B): attraction in [-1,1]
   (sparse: ~55% of pairs are zero), with radius 40–130 px. Asymmetric forces
   produce chasing, orbiting, fleeing, herding — the readable "texture" of the
   session. Discovered only via SCAN.
2. **Contact rules** (3–6 per session) — deterministic, with per-pair cooldown.
   On contact of A,B one of:
   - CONSUME: A destroys B
   - CONVERT: B becomes species C
   - SPAWN: A and B persist, emit a new C
   - MERGE: A and B fuse into one C
   Discovered by witnessing 3 events, or via SCAN.
3. **Unary rules** — per species, at most one of:
   - FISSION: splits into two every t seconds, suppressed by local crowding
   - DECAY: dies (or converts to C) after lifetime t
   The generator guarantees ≥1 FISSION source and ≥1 sink (DECAY or CONSUME).
4. **Globals** — friction, thermal jitter, soft walls. Fixed, not generated.

### Validation (burn-in)

Simulate 45s headless from the standard seeding (~26 dots/species). Reject if
any species leaves [3, 240], total leaves [40, 650], fewer than 20 contact
events fired, or mean speed collapses (static world). Up to 40 attempts with
derived sub-seeds; criteria relax slightly on late attempts. Burn-in stats
(per-species mean populations, event rates) feed objective calibration and
market base prices.

## Economy

- Price per species: `p = base · (P_ref / (pop + 4))^0.85`, smoothed (EMA),
  plus a decaying order-impact term (buys push ask up, sells push bid down)
  and small OU noise. Sell haircut 18%.
- Income: EXTRACT dots and sell at bid. Spending: DEPLOY at ask, BEACON, SCAN.
- Base prices randomized per session, scaled inversely to burn-in abundance —
  rare-by-nature species are worth more.

## Objective (generated)

Primary (one of, with species + targets drawn from burn-in baseline):
- AMPLIFY: get count(X) ≥ N (≈1.8× baseline peak) — hold for 6s
- SUPPRESS: drive count(X) to 0 — hold for 6s
- ACCUMULATE: bank ≥ C credits

Standing constraint (always one, violating it for >8s = immediate failure):
- CONTAIN: count(Y) must stay ≤ M (≈1.6× baseline mean)
- PRESERVE: count(Z) must stay ≥ 2

Deadline T = 300s. The generator picks constraint species that are *coupled*
to the primary species through the rule graph when possible, so the conflict
is real. Score on win: time remaining + credits, letter-graded.

## Player tools (keys 1–4, mouse on field)

1. **DEPLOY** — buy one dot of the selected species at ask, place it.
2. **EXTRACT** — remove the dot nearest the click (within 18 px), sell at bid.
3. **BEACON** — place a 12s attractor for the selected species (shift-click:
   repulsor). Flat cost. The main "shepherding" tool.
4. **SCAN** — click a dot: reveals one still-unknown rule involving that
   species. Cost escalates ×1.5 per scan.

Space pauses (tactical pause: tools usable while paused). R restarts the same
protocol (seed), N generates a new one. Seed is shown and enterable via URL
hash (`#7F3A9C12`).

## Presentation

"Technical minimal" ops-room chrome. Pure black field; dots with short
phosphor trails (translucent fade instead of clear). Hairline #222 borders,
corner ticks, sparse grid crosses. Single monospace stack, uppercase
letter-spaced micro-labels, dim #9aa text, cyan accents, amber/red alerts.

Right rail (320 px):
- header: AXIOM // PROTOCOL 0x____, clock, credits
- OBJECTIVE block with live status glyphs
- MARKET: per-species row — swatch, designation, pop count, price, 120-tick
  sparkline (this is the buy/select row)
- DOSSIER: the signature viz — species as nodes on a ring; discovered laws
  drawn as typed edges (contact = solid arrow w/ outcome glyph, force = thin
  dashed arc, unary = self-loop). Starts empty; fills as you learn. The
  dossier is the player's growing model of the world, drawn as an intel board.
- EVENT LOG: timestamped mono lines (rule confirmations, violations, trades).

No bars, no toggles. State is shown by the field itself, the dossier, and the
ticker.

## Architecture

Zero runtime deps. Vite + TypeScript dev tooling only.

    src/core/rng.ts        seeded RNG (splitmix32), hex seed utils
    src/core/types.ts      all shared types — single source of truth
    src/core/rules.ts      rule grammar, generator, burn-in validator
    src/core/sim.ts        simulation: spatial hash, forces, contacts, unary
    src/core/market.ts     price dynamics, order impact, sparkline history
    src/core/objective.ts  objective generation + live evaluation
    src/core/intel.ts      observation counting, confirmation, scan logic
    src/core/game.ts       session state, tick orchestration, tools, scoring
    src/ui/field.ts        canvas renderer (field, trails, beacons, cursor)
    src/ui/dossier.ts      canvas renderer (relation ring)
    src/ui/panels.ts       DOM: market, objective, log, status
    src/ui/input.ts        mouse/keys → tool intents
    src/main.ts            bootstrap, rAF loop, fixed-step accumulator
    scripts/burnin.ts      headless harness: sweep seeds, assert sanity

`core/` never imports from `ui/` and never touches the DOM — it must run
headless under tsx for the harness and for burn-in. Fixed timestep 1/60s with
an accumulator; rendering reads state, never mutates it.

## Code style

Simple, elegant, readable. Plain data + functions over class hierarchies.
No abstraction until the third use. Every module under ~300 lines. Comments
only for non-obvious constraints (e.g. why a magic constant balances).
