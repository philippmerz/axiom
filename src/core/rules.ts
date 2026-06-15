import { CONFIG } from './config'
import { generateObjective } from './objective'
import { Rng } from './rng'
import { GATE_RADIUS, Sim } from './sim'
import { ruleId } from './types'
import type {
  BurninStats,
  ContactOutcome,
  ContactRule,
  ForceRule,
  Ruleset,
  Session,
  Species,
  UnaryRule,
} from './types'

// Species colors deliberately exclude the chrome hues (accent cyan,
// warn amber, alert red) so field and UI semantics never collide.
const PALETTE = ['#ececec', '#e05299', '#8be05a', '#8b7bf7', '#4f86f7', '#f08c42', '#43d9ad']

const DESIGNATIONS: ReadonlyArray<readonly [string, string]> = [
  ['Σ', 'SIGMA'],
  ['Θ', 'THETA'],
  ['Δ', 'DELTA'],
  ['Λ', 'LAMBDA'],
  ['Ψ', 'PSI'],
  ['Ω', 'OMEGA'],
  ['Κ', 'KAPPA'],
]

function generateSpecies(rng: Rng, k: number): Species[] {
  const colors = rng.shuffle([...PALETTE]).slice(0, k)
  const names = rng.shuffle([...DESIGNATIONS]).slice(0, k)
  return colors.map((color, id) => {
    const [glyph, name] = names[id] as readonly [string, string]
    return { id, name, glyph, color }
  })
}

function generateForces(rng: Rng, k: number): ForceRule[] {
  const forces: ForceRule[] = []
  let strong = 0
  for (let self = 0; self < k; self++) {
    for (let other = 0; other < k; other++) {
      if (!rng.chance(0.45)) continue
      let strength = (rng.chance(0.55) ? 1 : -1) * rng.range(0.25, 1)
      // cap strong relations at ~k so motion stays decomposable by eye
      if (Math.abs(strength) > 0.55) {
        if (strong >= k) strength = Math.sign(strength) * rng.range(0.25, 0.55)
        else strong++
      }
      // most forces are local; a few act across the field so motion roams
      const radius = rng.chance(0.15) ? rng.range(140, 220) : rng.range(40, 130)
      forces.push({ kind: 'force', self, other, strength, radius })
    }
  }
  // guarantee chase pairs (A hunts B, B flees A) — they can never reach a
  // static equilibrium, so the field stays alive and readable
  const chases = k >= 6 ? 2 : 1
  const order = rng.shuffle([...Array(k).keys()])
  for (let c = 0; c < chases; c++) {
    const hunter = order[(c * 2) % k] as number
    const prey = order[(c * 2 + 1) % k] as number
    setForce(forces, hunter, prey, rng.range(0.6, 1), rng.range(70, 130))
    setForce(forces, prey, hunter, -rng.range(0.5, 0.9), rng.range(60, 120))
  }
  // 1–2 strong pairs become conditional — physics that switches on context
  const strongPairs = forces.filter((f) => Math.abs(f.strength) >= 0.5 && k > 2)
  const gates = Math.min(rng.int(1, 3), strongPairs.length)
  for (const f of rng.shuffle(strongPairs).slice(0, gates)) {
    const others = [...Array(k).keys()].filter((s) => s !== f.self && s !== f.other)
    if (others.length === 0) continue
    f.gate = { species: rng.pick(others), count: 3, radius: GATE_RADIUS }
  }
  return forces
}

function setForce(forces: ForceRule[], self: number, other: number, strength: number, radius: number): void {
  const existing = forces.find((f) => f.self === self && f.other === other)
  if (existing) {
    existing.strength = strength
    existing.radius = radius
    delete existing.gate
  } else {
    forces.push({ kind: 'force', self, other, strength, radius })
  }
}

function generateContacts(rng: Rng, k: number, forces: ForceRule[]): ContactRule[] {
  const pull = (a: number, b: number) =>
    forces.some((f) => f.self === a && f.other === b && f.strength > 0.25)
  // weight pairs whose forces actually bring them together — a contact rule
  // between mutually-avoiding species is dead code
  const weighted: Array<[number, number]> = []
  for (let a = 0; a < k; a++) {
    for (let b = a; b < k; b++) {
      const w = pull(a, b) || pull(b, a) ? 3 : 1
      for (let i = 0; i < w; i++) weighted.push([a, b])
    }
  }
  const n = rng.int(3, 7)
  const rules: ContactRule[] = []
  let spawns = 0
  while (rules.length < n && weighted.length > 0) {
    const idx = rng.int(0, weighted.length)
    const [a, b] = weighted[idx] as [number, number]
    for (let i = weighted.length - 1; i >= 0; i--) {
      const p = weighted[i] as [number, number]
      if (p[0] === a && p[1] === b) weighted.splice(i, 1)
    }
    const outcome = generateOutcome(rng, k, a, b, spawns)
    if (outcome.kind === 'spawn') spawns++
    // lethal reactions are slower — predation that outpaces reproduction
    // just sterilizes the world
    const lethal = outcome.kind === 'consume' || outcome.kind === 'merge'
    const cooldown = lethal ? rng.range(1.8, 3.2) : rng.range(1.2, 2.2)
    rules.push({ kind: 'contact', a, b, outcome, cooldown })
  }
  return rules
}

function generateOutcome(
  rng: Rng,
  k: number,
  a: number,
  b: number,
  spawnsSoFar: number,
): ContactOutcome {
  // Same-species contact only fuses — anything else is either a no-op
  // or an uncontrollable autocatalytic amplifier.
  if (a === b) return { kind: 'merge', into: rng.int(0, k) }
  const roll = rng.next()
  if (roll < 0.3) return { kind: 'consume' }
  if (roll < 0.62) {
    const others = [...Array(k).keys()].filter((s) => s !== b)
    return { kind: 'convert', into: rng.pick(others) }
  }
  // At most one spawn rule per session, never emitting its own inputs —
  // autocatalytic loops are unplayable, not difficult.
  if (roll < 0.8 && spawnsSoFar === 0) {
    const safe = [...Array(k).keys()].filter((s) => s !== a && s !== b)
    if (safe.length > 0) return { kind: 'spawn', child: rng.pick(safe) }
  }
  return { kind: 'merge', into: rng.int(0, k) }
}

function generateUnaries(rng: Rng, k: number, contacts: ContactRule[]): UnaryRule[] {
  // Ecological consistency: a species drains through decay or predation; it
  // refills through fission or contact inflow. A drain with no refill is a
  // guaranteed first-minute extinction, which wastes the whole session.
  const prey = new Set<number>()
  const inflow = new Set<number>()
  for (const c of contacts) {
    const o = c.outcome
    if (o.kind === 'consume' || o.kind === 'convert') prey.add(c.b)
    if (o.kind === 'merge' && c.a !== c.b) {
      prey.add(c.a)
      prey.add(c.b)
    }
    if (o.kind === 'convert' || o.kind === 'merge') inflow.add(o.into)
    if (o.kind === 'spawn') inflow.add(o.child)
  }

  const unaries: UnaryRule[] = []
  for (let s = 0; s < k; s++) {
    const roll = rng.next()
    if (prey.has(s) && !inflow.has(s)) {
      // hunted with no inflow: reproduce or vanish
      if (roll < 0.7) unaries.push(makeFission(rng, s))
    } else if (inflow.has(s)) {
      // produced by reactions: a natural conduit, decay is sustainable here
      if (roll < 0.25) unaries.push(makeFission(rng, s))
      else if (roll < 0.7) unaries.push(makeDecay(rng, k, s))
    } else if (roll < 0.35) {
      unaries.push(makeFission(rng, s))
    }
  }
  // Every world needs at least one source and one true sink, or it can
  // only monotonically shrink / grow.
  if (!unaries.some((u) => u.kind === 'fission')) {
    const s = rng.int(0, k)
    const i = unaries.findIndex((u) => u.species === s)
    if (i >= 0) unaries.splice(i, 1)
    unaries.push(makeFission(rng, s))
  }
  const hasSink =
    unaries.some((u) => u.kind === 'decay' && u.into === null) ||
    contacts.some((c) => c.outcome.kind === 'consume' || c.outcome.kind === 'merge')
  if (!hasSink) {
    // sinkless contacts are all convert/spawn, so inflow species exist —
    // put the mandatory decay-null where the world can sustain it
    const candidates = [...inflow].filter(
      (s) => !unaries.some((u) => u.species === s && u.kind === 'fission'),
    )
    const s = candidates.length > 0 ? rng.pick(candidates) : rng.int(0, k)
    const i = unaries.findIndex((u) => u.species === s)
    if (i >= 0) unaries.splice(i, 1)
    unaries.push({ kind: 'decay', species: s, lifetime: rng.range(14, 40), into: null })
  }
  return unaries
}

function makeFission(rng: Rng, species: number): UnaryRule {
  return {
    kind: 'fission',
    species,
    period: rng.range(5, 11),
    crowdLimit: rng.int(2, 5),
    crowdRadius: rng.range(36, 56),
  }
}

function makeDecay(rng: Rng, k: number, species: number): UnaryRule {
  const others = [...Array(k).keys()].filter((s) => s !== species)
  return {
    kind: 'decay',
    species,
    lifetime: rng.range(14, 40),
    into: rng.chance(0.5) ? null : rng.pick(others),
  }
}

export function generateRuleset(rng: Rng): Ruleset {
  const k = rng.chance(0.5) ? 5 : 6
  const species = generateSpecies(rng, k)
  const forces = generateForces(rng, k)
  const contacts = generateContacts(rng, k, forces)
  return {
    species,
    forces,
    contacts,
    unaries: generateUnaries(rng, k, contacts),
  }
}

// ---- validation ----

class StatsCollector {
  readonly sums: number[]
  readonly peaks: number[]
  readonly mins: number[]
  ruleFires: Record<string, number> = {}
  births = 0
  deaths = 0
  contactEvents = 0
  samples = 0

  constructor(readonly sim: Sim) {
    this.sums = new Array<number>(sim.world.counts.length).fill(0)
    this.peaks = [...sim.world.counts]
    this.mins = [...sim.world.counts]
    for (const c of sim.ruleset.contacts) this.ruleFires[ruleId(c)] = 0
  }

  afterStep(): void {
    for (const e of this.sim.world.events) {
      if (e.kind === 'contact') {
        this.contactEvents++
        const key = ruleId(e.rule)
        this.ruleFires[key] = (this.ruleFires[key] ?? 0) + 1
        const out = e.rule.outcome
        if (out.kind === 'consume') this.deaths++
        else if (out.kind === 'spawn') this.births++
        else if (out.kind === 'merge') {
          this.deaths += 2
          this.births++
        }
      } else if (e.rule.kind === 'fission') this.births++
      else if (e.rule.kind === 'decay' && e.rule.into === null) this.deaths++
    }
  }

  /** Peaks/mins over the whole run; means exclude the settling transient. */
  sample(time: number): void {
    const post = time >= CONFIG.burnin.transient
    if (post) this.samples++
    const counts = this.sim.world.counts
    for (let s = 0; s < counts.length; s++) {
      const c = counts[s] as number
      if (post) this.sums[s] = (this.sums[s] as number) + c
      if (c > (this.peaks[s] as number)) this.peaks[s] = c
      if (c < (this.mins[s] as number)) this.mins[s] = c
    }
  }

  build(): BurninStats {
    return {
      meanCounts: this.sums.map((s) => s / Math.max(1, this.samples)),
      peakCounts: [...this.peaks],
      minCounts: [...this.mins],
      finalCounts: [...this.sim.world.counts],
      ruleFires: this.ruleFires,
      births: this.births,
      deaths: this.deaths,
      contactEvents: this.contactEvents,
      meanSpeed: this.sim.meanSpeed(),
    }
  }
}

/** Simulate the candidate world untouched for the full session horizon.
 * A 60s burn-in gate rejects obviously degenerate worlds cheaply; the
 * remainder measures the true null trajectory that objective calibration
 * is anchored to. Returns null on rejection. */
function runValidation(sim: Sim, relax: boolean): BurninStats | null {
  const b = CONFIG.burnin
  const stats = new StatsCollector(sim)
  const perSec = Math.round(1 / CONFIG.dt)
  const gateSteps = Math.round(b.seconds / CONFIG.dt)
  const totalSteps = Math.round(CONFIG.deadline / CONFIG.dt)

  let zeroStreak = 0
  let crowdStreak = 0
  for (let i = 0; i < totalSteps; i++) {
    sim.step()
    stats.afterStep()
    if (i % perSec !== 0) continue
    stats.sample(sim.world.time)
    const total = sim.world.dots.length
    if (i < gateSteps) {
      // cheap early aborts inside the gate window. The expensive reject is a
      // slow grower creeping toward the cap: it survives the loose bounds for
      // 60s while every step gets slower, so abort it the moment it's clearly
      // not settling under the gate ceiling.
      if (sim.world.counts.some((c) => c > b.maxPerSpecies)) return null
      if (total > b.maxTotal) return null
      crowdStreak = total > b.maxTotal * b.crowdAbortFrac ? crowdStreak + 1 : 0
      if (crowdStreak > b.crowdAbortSecs) return null // sustained near cap = grower
      if (i > 20 * perSec && total < 10) return null // dead world
      // a species extinct for 10s straight is not coming back
      zeroStreak = sim.world.counts.some((c) => c === 0) ? zeroStreak + 1 : 0
      if (zeroStreak > 10) return null
    } else {
      // full-horizon physics bounds: slow exponentials die here
      if (sim.world.counts.some((c) => c > b.nullMaxPerSpecies)) return null
      if (total > b.nullMaxTotal || total === 0) return null
    }
    if (i === gateSteps && !passesGate(sim, stats, relax)) return null
  }
  const first = sim.world.dots[0]
  if (first && !Number.isFinite(first.x + first.vx)) return null
  return stats.build()
}

function passesGate(sim: Sim, stats: StatsCollector, relax: boolean): boolean {
  const b = CONFIG.burnin
  const total = sim.world.dots.length
  if (total < b.minTotal || total > b.maxTotal) return false
  if (stats.contactEvents < (relax ? 6 : b.minContactEvents)) return false
  if (stats.deaths < (relax ? 2 : b.minDeaths)) return false
  if (sim.movingFraction(b.movingSpeed) < (relax ? 0.06 : b.minMovingFraction)) return false
  const livelyRules = Object.values(stats.ruleFires).filter((n) => n >= 3).length
  if (livelyRules < (relax ? 1 : 2)) return false
  const maxPer = relax ? b.maxPerSpecies * 1.3 : b.maxPerSpecies
  return sim.world.counts.every((c) => c >= b.minPerSpecies && c <= maxPer)
}

function deriveMarketBases(stats: BurninStats, rng: Rng): number[] {
  return stats.meanCounts.map((mean) => {
    // naturally-rare species are worth more, via √ so spreads stay sane
    const rarity = Math.min(2.5, Math.max(0.6, Math.sqrt(26 / (mean + 4))))
    return Math.min(40, Math.max(3, rng.range(7, 12) * rarity))
  })
}

function attemptOnce(root: Rng, attempt: number): Session | null {
  const genSeed = root.fork()
  const simSeed = root.fork()
  const calibSeed = root.fork()
  const ruleset = generateRuleset(new Rng(genSeed))
  const sim = new Sim(ruleset, new Rng(simSeed))
  const stats = runValidation(sim, attempt >= CONFIG.burnin.relaxAfter)
  if (!stats) return null
  const calibRng = new Rng(calibSeed)
  const marketBases = deriveMarketBases(stats, calibRng)
  return {
    seed: 0, // stamped by the caller
    simSeed,
    ruleset,
    objective: generateObjective(ruleset, stats, marketBases, calibRng),
    burnin: stats,
    marketBases,
    rejected: attempt,
  }
}

/** Last resort if every candidate fails: take one final ruleset as-is,
 * collect stats without rejecting, and play it anyway. */
function fallbackSession(root: Rng): Session {
  const ruleset = generateRuleset(new Rng(root.fork()))
  const simSeed = root.fork()
  const sim = new Sim(ruleset, new Rng(simSeed))
  const calibRng = new Rng(root.fork())
  const stats = new StatsCollector(sim)
  const steps = Math.round(CONFIG.deadline / CONFIG.dt)
  const perSec = Math.round(1 / CONFIG.dt)
  for (let i = 0; i < steps; i++) {
    sim.step()
    stats.afterStep()
    if (i % perSec === 0) stats.sample(sim.world.time)
  }
  const burnin = stats.build()
  const marketBases = deriveMarketBases(burnin, calibRng)
  return {
    seed: 0,
    simSeed,
    ruleset,
    objective: generateObjective(ruleset, burnin, marketBases, calibRng),
    burnin,
    marketBases,
    rejected: CONFIG.burnin.maxAttempts,
  }
}

/** Synchronous and deterministic: the same seed always yields the same
 * session. In the browser this runs inside a Web Worker (see worker.ts) so
 * the validation sims never block the UI; onAttempt streams progress out. */
export function generateSession(seed: number, onAttempt?: (attempt: number) => void): Session {
  const root = new Rng(seed)
  for (let attempt = 0; attempt < CONFIG.burnin.maxAttempts; attempt++) {
    onAttempt?.(attempt)
    const session = attemptOnce(root, attempt)
    if (session) return { ...session, seed }
  }
  return { ...fallbackSession(root), seed }
}
