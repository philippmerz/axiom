import { CONFIG } from './config'
import { ruleId, rulesOf } from './types'
import type { Beacon, ContactRule, Rule, Ruleset, SimEvent, UnaryRule, World } from './types'

export interface IntelReport {
  /** Rules that just crossed the confirmation threshold. */
  confirmed: Rule[]
  /** Witness progress on still-unconfirmed rules. */
  progressed: Array<{ rule: ContactRule | UnaryRule; seen: number }>
}

interface EchoTrack {
  beacon: Beacon
  radialSums: Float64Array // signed radial velocity toward the echo, per species
  samples: Float64Array
}

/** What the player knows. Contact and unary laws confirm after being
 * witnessed near the cursor (you learn what you watch); force laws confirm
 * through echo experiments or paid scans. */
export class Intel {
  readonly known = new Set<string>()
  /** Pairs proven to have no contact rule and no forces, via scan. */
  readonly knownZero = new Set<string>()
  private readonly obs = new Map<string, number>()
  private readonly echoObs = new Map<string, number>()
  private readonly byId = new Map<string, Rule>()
  private readonly echoes = new Map<number, EchoTrack>()
  scansUsed = 0

  constructor(readonly ruleset: Ruleset) {
    for (const r of rulesOf(ruleset)) this.byId.set(ruleId(r), r)
  }

  get totalLaws(): number {
    return this.byId.size
  }

  get knownLaws(): number {
    return this.known.size
  }

  knows(rule: Rule): boolean {
    return this.known.has(ruleId(rule))
  }

  seenCount(rule: Rule): number {
    return this.obs.get(ruleId(rule)) ?? 0
  }

  /** Witness events — only those inside the attention radius around the
   * cursor count. Returns confirmations and progress for the log. */
  noteEvents(events: SimEvent[], cursorX: number, cursorY: number): IntelReport {
    const report: IntelReport = { confirmed: [], progressed: [] }
    const r2 = CONFIG.attentionRadius * CONFIG.attentionRadius
    for (const e of events) {
      const dx = e.x - cursorX
      const dy = e.y - cursorY
      if (dx * dx + dy * dy > r2) continue
      const id = ruleId(e.rule)
      if (this.known.has(id)) continue
      const seen = (this.obs.get(id) ?? 0) + 1
      this.obs.set(id, seen)
      if (seen >= CONFIG.observationsToConfirm) {
        this.known.add(id)
        report.confirmed.push(e.rule)
      } else {
        report.progressed.push({ rule: e.rule, seen })
      }
    }
    return report
  }

  // ---- echo experiments ----

  /** Accumulate each species' radial response to active echoes. */
  echoStep(world: World): void {
    for (const b of world.beacons) {
      if (b.kind !== 'echo') continue
      let track = this.echoes.get(b.id)
      if (!track) {
        const k = this.ruleset.species.length
        track = { beacon: b, radialSums: new Float64Array(k), samples: new Float64Array(k) }
        this.echoes.set(b.id, track)
      }
      for (const d of world.dots) {
        const dx = b.x - d.x
        const dy = b.y - d.y
        const dist = Math.sqrt(dx * dx + dy * dy)
        if (dist < 12 || dist > CONFIG.beaconRadius) continue
        track.radialSums[d.species] = (track.radialSums[d.species] as number) + (d.vx * dx + d.vy * dy) / dist
        track.samples[d.species] = (track.samples[d.species] as number) + 1
      }
    }
  }

  /** Settle expired echoes: a consistent mean response in the direction the
   * (hidden) force law predicts counts as one experimental observation. */
  echoFinish(expired: Beacon[]): Rule[] {
    const confirmed: Rule[] = []
    for (const b of expired) {
      const track = this.echoes.get(b.id)
      this.echoes.delete(b.id)
      if (!track || b.kind !== 'echo') continue
      for (let s = 0; s < this.ruleset.species.length; s++) {
        const n = track.samples[s] as number
        if (n < 90) continue // need ~1.5s of aggregate dot-observations
        const mean = (track.radialSums[s] as number) / n
        if (Math.abs(mean) < CONFIG.echoResponseThreshold) continue
        const rule = this.ruleset.forces.find((f) => f.self === s && f.other === b.species)
        if (!rule || this.knows(rule)) continue
        if (Math.sign(rule.strength) !== Math.sign(mean)) continue // noise, not law
        const id = ruleId(rule)
        const seen = (this.echoObs.get(id) ?? 0) + 1
        this.echoObs.set(id, seen)
        if (seen >= CONFIG.echoConfirms) {
          this.known.add(id)
          confirmed.push(rule)
        }
      }
    }
    return confirmed
  }

  // ---- scans ----

  scanCost(): number {
    return Math.round(CONFIG.scanBaseCost * Math.pow(CONFIG.scanCostGrowth, this.scansUsed))
  }

  /** Directed query on a species pair: the contact rule if one is unknown,
   * else both force laws; a pair with neither is marked known-zero.
   * Returns null when nothing about the pair is left to learn. */
  scanPair(a: number, b: number): { revealed: Rule[]; zero: boolean } | null {
    const contact = this.ruleset.contacts.find(
      (c) => (c.a === a && c.b === b) || (c.a === b && c.b === a),
    )
    if (contact && !this.knows(contact)) {
      this.scansUsed++
      this.known.add(ruleId(contact))
      return { revealed: [contact], zero: false }
    }
    const forces = this.ruleset.forces.filter(
      (f) =>
        ((f.self === a && f.other === b) || (f.self === b && f.other === a)) && !this.knows(f),
    )
    if (forces.length > 0) {
      this.scansUsed++
      for (const f of forces) this.known.add(ruleId(f))
      return { revealed: forces, zero: false }
    }
    const zeroKey = `Z:${Math.min(a, b)}+${Math.max(a, b)}`
    const anyForce = this.ruleset.forces.some(
      (f) => (f.self === a && f.other === b) || (f.self === b && f.other === a),
    )
    if (!contact && !anyForce && !this.knownZero.has(zeroKey)) {
      this.scansUsed++
      this.knownZero.add(zeroKey)
      return { revealed: [], zero: true }
    }
    return null
  }

  /** Single-dot query: the species' unary law (lifecycle). */
  scanUnary(s: number): Rule | null {
    const rule = this.ruleset.unaries.find((u) => u.species === s)
    if (!rule || this.knows(rule)) return null
    this.scansUsed++
    this.known.add(ruleId(rule))
    return rule
  }

  knownRules(): Rule[] {
    return rulesOf(this.ruleset).filter((r) => this.known.has(ruleId(r)))
  }
}
