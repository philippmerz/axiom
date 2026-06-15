/** Shared types. core/ never imports from ui/ and never touches the DOM. */

export interface Species {
  id: number
  /** Internal designation (e.g. "SIGMA") — kept for debugging/seeds, never
   * shown in the UI. Players identify a species only by its color. */
  name: string
  color: string
}

/** How a dot of `self` accelerates toward (+) or away from (−) dots of `other`.
 * A gated force is only active while the moving dot has at least `gate.count`
 * dots of `gate.species` within `gate.radius` — conditional physics that
 * rewards careful observation and makes the pair a premium scan target. */
export interface ForceRule {
  kind: 'force'
  self: number
  other: number
  strength: number
  radius: number
  gate?: { species: number; count: number; radius: number }
}

export type ContactOutcome =
  | { kind: 'consume' } // a survives, b destroyed
  | { kind: 'convert'; into: number } // b becomes `into`
  | { kind: 'spawn'; child: number } // both survive, a new `child` appears
  | { kind: 'merge'; into: number } // both destroyed, one `into` appears

export interface ContactRule {
  kind: 'contact'
  a: number
  b: number
  outcome: ContactOutcome
  /** Seconds a participant is contact-immune after any rule fires on it. */
  cooldown: number
}

export type UnaryRule =
  | {
      kind: 'fission'
      species: number
      period: number
      /** Fission is suppressed when more than this many same-species
       * neighbors crowd within crowdRadius — the population brake. */
      crowdLimit: number
      crowdRadius: number
    }
  | { kind: 'decay'; species: number; lifetime: number; into: number | null }

export type Rule = ForceRule | ContactRule | UnaryRule

export interface Ruleset {
  species: Species[]
  forces: ForceRule[]
  contacts: ContactRule[]
  unaries: UnaryRule[]
}

/** Stable identity for intel tracking and dossier rendering. */
export function ruleId(rule: Rule): string {
  switch (rule.kind) {
    case 'force':
      return `F:${rule.self}<${rule.other}`
    case 'contact':
      return `C:${rule.a}+${rule.b}`
    case 'fission':
      return `U:${rule.species}:fission`
    case 'decay':
      return `U:${rule.species}:decay`
  }
}

export function rulesOf(ruleset: Ruleset): Rule[] {
  return [...ruleset.contacts, ...ruleset.unaries, ...ruleset.forces]
}

// ---- simulation ----

export interface Dot {
  id: number
  species: number
  x: number
  y: number
  vx: number
  vy: number
  age: number
  /** Sim time until which contact rules ignore this dot. */
  immuneUntil: number
  nextFission: number
}

/** echo: a phantom dot of `species` — every dot reacts to it through the
 * generated force matrix, so its effect is itself a session unknown.
 * flat: a known-quantity repulsor pushing all species. */
export interface Beacon {
  id: number
  kind: 'echo' | 'flat'
  x: number
  y: number
  species: number // ignored for 'flat'
  expiresAt: number
}

export type SimEvent =
  | { kind: 'contact'; rule: ContactRule; x: number; y: number }
  | { kind: 'unary'; rule: UnaryRule; x: number; y: number }

export interface World {
  time: number
  dots: Dot[]
  beacons: Beacon[]
  counts: number[]
  nextId: number
  /** Events emitted during the latest step; consumer reads then clears. */
  events: SimEvent[]
}

// ---- objective ----

export type PrimarySpec =
  | { kind: 'amplify'; species: number; target: number }
  | { kind: 'suppress'; species: number }
  | { kind: 'accumulate'; credits: number }
  /** Cause `target` firings of one specific contact rule — a flow objective
   * that cannot be bought, only engineered. */
  | { kind: 'catalyze'; ruleKey: string; target: number }

export type ConstraintSpec =
  | { kind: 'contain'; species: number; max: number }
  | { kind: 'preserve'; species: number; min: number }

export interface ObjectiveSpec {
  primary: PrimarySpec
  constraint: ConstraintSpec
  deadline: number
  /** Seconds amplify/suppress must hold to count as done. */
  holdSeconds: number
  /** Seconds the constraint may be violated before failure. */
  graceSeconds: number
}

// ---- generation ----

/** Measured over the generator's full-horizon null run (no player input).
 * Peaks and mins cover the whole window including the settling transient —
 * they bound what the session does untouched; means exclude the transient. */
export interface BurninStats {
  meanCounts: number[]
  peakCounts: number[]
  minCounts: number[]
  finalCounts: number[]
  /** Firings per contact rule over the full horizon, keyed by ruleId. */
  ruleFires: Record<string, number>
  births: number
  deaths: number
  contactEvents: number
  meanSpeed: number
}

export interface Session {
  seed: number
  /** The sim RNG seed the objective was calibrated against. The live game
   * MUST reuse it, so the trajectory the player faces is the one the
   * objective targets were measured on — otherwise constraints drift past
   * their ceilings untouched. */
  simSeed: number
  ruleset: Ruleset
  objective: ObjectiveSpec
  burnin: BurninStats
  /** Per-species market base prices, derived from burn-in scarcity. */
  marketBases: number[]
  /** Candidate rulesets rejected by validation before this one passed. */
  rejected: number
}
