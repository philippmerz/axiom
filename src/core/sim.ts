import { CONFIG } from './config'
import { Rng } from './rng'
import type { Beacon, ContactRule, Dot, Ruleset, UnaryRule, World } from './types'

/** Rule tables flattened for the inner loop. */
interface Compiled {
  k: number
  strength: Float64Array // [self * k + other]
  radius: Float64Array
  gateSpecies: Int16Array // -1 = ungated
  gateCount: Int16Array
  needsGateCounts: boolean[] // species with any gated force rule
  /** Per-species force reach — dots only scan as far as their own laws. */
  rowMaxRadius: Float64Array
  contact: (ContactRule | null)[] // [a * k + b], mirrored
  unary: (UnaryRule | null)[]
  cellSize: number
}

const REPULSE_RANGE = 11 // universal close-range separation
const FORCE_SCALE = 78
const MIN_DIST = 4 // normalization floor — no NaN, no slingshots
const FINE_CELL = 36 // fine-grid cell size for contact-scale queries
export const GATE_RADIUS = 80 // all force gates count neighbors within this
const SPAWN_CROWD_LIMIT = 4 // spawn emission brake, mirrors fission crowding
const SPAWN_CROWD_RADIUS = 48

function compile(ruleset: Ruleset): Compiled {
  const k = ruleset.species.length
  const strength = new Float64Array(k * k)
  const radius = new Float64Array(k * k)
  const gateSpecies = new Int16Array(k * k).fill(-1)
  const gateCount = new Int16Array(k * k)
  const needsGateCounts = new Array<boolean>(k).fill(false)
  const rowMaxRadius = new Float64Array(k).fill(REPULSE_RANGE)
  let maxForceRadius = 0
  for (const f of ruleset.forces) {
    const i = f.self * k + f.other
    strength[i] = f.strength
    radius[i] = f.radius
    maxForceRadius = Math.max(maxForceRadius, f.radius)
    rowMaxRadius[f.self] = Math.max(rowMaxRadius[f.self] as number, f.radius)
    if (f.gate) {
      gateSpecies[i] = f.gate.species
      gateCount[i] = f.gate.count
      needsGateCounts[f.self] = true
    }
  }
  const contact: (ContactRule | null)[] = new Array(k * k).fill(null)
  for (const c of ruleset.contacts) {
    contact[c.a * k + c.b] = c
    contact[c.b * k + c.a] = c
  }
  const unary: (UnaryRule | null)[] = new Array(k).fill(null)
  for (const u of ruleset.unaries) unary[u.species] = u
  return {
    k,
    strength,
    radius,
    gateSpecies,
    gateCount,
    needsGateCounts,
    rowMaxRadius,
    contact,
    unary,
    cellSize: Math.max(48, Math.min(maxForceRadius, 130)),
  }
}

/** ±20% deterministic per-dot variance, so decay deaths don't synchronize. */
function lifeScale(id: number): number {
  const x = id * 0.6180339887
  return 0.8 + 0.4 * (x - Math.floor(x))
}

/** Dense flat-array spatial grid over the fixed field. Buckets are reused
 * across frames (cleared by length=0) to avoid GC, and indexed by cell —
 * no hashing. Iteration order is cell-major then insertion order, which is
 * dots-array order, so it stays deterministic. */
class Grid {
  readonly cols: number
  private readonly buckets: Dot[][]

  constructor(readonly cell: number) {
    this.cols = Math.ceil(CONFIG.fieldSize / cell) + 1
    this.buckets = Array.from({ length: this.cols * this.cols }, () => [])
  }

  private idx(x: number, y: number): number {
    let cx = (x / this.cell) | 0
    let cy = (y / this.cell) | 0
    if (cx < 0) cx = 0
    else if (cx >= this.cols) cx = this.cols - 1
    if (cy < 0) cy = 0
    else if (cy >= this.cols) cy = this.cols - 1
    return cy * this.cols + cx
  }

  rebuild(dots: Dot[]): void {
    for (const b of this.buckets) b.length = 0
    for (const d of dots) (this.buckets[this.idx(d.x, d.y)] as Dot[]).push(d)
  }

  bucket(cx: number, cy: number): Dot[] | null {
    if (cx < 0 || cy < 0 || cx >= this.cols || cy >= this.cols) return null
    return this.buckets[cy * this.cols + cx] as Dot[]
  }
}

/** Force ramp: zero at REPULSE_RANGE and at r, peaking midway. */
function ramp(dist: number, r: number): number {
  if (dist >= r) return 0
  return 1 - Math.abs(2 * dist - r - REPULSE_RANGE) / (r - REPULSE_RANGE)
}

export class Sim {
  readonly world: World
  private readonly c: Compiled
  private readonly rng: Rng
  /** Coarse grid sized for force queries, fine grid for contact-scale ones. */
  private readonly grid: Grid
  private readonly fineGrid: Grid
  private readonly gateScratch: Int32Array

  constructor(readonly ruleset: Ruleset, rng: Rng) {
    this.rng = rng
    this.c = compile(ruleset)
    this.grid = new Grid(this.c.cellSize)
    this.fineGrid = new Grid(FINE_CELL)
    this.gateScratch = new Int32Array(this.c.k)
    this.world = {
      time: 0,
      dots: [],
      beacons: [],
      counts: new Array(this.c.k).fill(0),
      nextId: 1,
      events: [],
    }
    const size = CONFIG.fieldSize
    for (let s = 0; s < this.c.k; s++) {
      for (let i = 0; i < CONFIG.initialPerSpecies; i++) {
        const dot = this.createDot(s, rng.range(30, size - 30), rng.range(30, size - 30))
        const u = this.c.unary[s]
        if (u?.kind === 'decay') dot.age = rng.range(0, u.lifetime * 0.7)
        this.world.dots.push(dot)
      }
    }
    this.refreshCounts()
  }

  private createDot(species: number, x: number, y: number): Dot {
    const id = this.world.nextId++
    const u = this.c.unary[species]
    return {
      id,
      species,
      x,
      y,
      vx: this.rng.range(-12, 12),
      vy: this.rng.range(-12, 12),
      age: 0,
      immuneUntil: this.world.time + 0.4,
      nextFission:
        u?.kind === 'fission' ? this.world.time + u.period * this.rng.range(0.5, 1.5) : Infinity,
    }
  }

  // ---- spatial grids ----

  private buildGrid(): void {
    this.grid.rebuild(this.world.dots)
    this.fineGrid.rebuild(this.world.dots)
  }

  private forEachNeighbor(x: number, y: number, r: number, fn: (other: Dot) => void): void {
    const grid = r <= 100 ? this.fineGrid : this.grid
    const cs = grid.cell
    const reach = Math.ceil(r / cs)
    const cx = (x / cs) | 0
    const cy = (y / cs) | 0
    const r2 = r * r
    for (let gx = cx - reach; gx <= cx + reach; gx++) {
      for (let gy = cy - reach; gy <= cy + reach; gy++) {
        const cell = grid.bucket(gx, gy)
        if (!cell) continue
        for (const o of cell) {
          const dx = o.x - x
          const dy = o.y - y
          if (dx * dx + dy * dy <= r2) fn(o)
        }
      }
    }
  }

  // ---- step ----

  step(): void {
    const { dt } = CONFIG
    const w = this.world
    w.events = []
    this.buildGrid()
    this.applyForces(dt)
    this.move(dt)
    const dead = new Set<number>()
    const born: Dot[] = []
    this.applyContacts(dead, born)
    this.applyUnary(dead, born)
    if (dead.size > 0) w.dots = w.dots.filter((d) => !dead.has(d.id))
    for (const d of born) {
      if (w.dots.length >= CONFIG.maxDots) break
      w.dots.push(d)
    }
    w.beacons = w.beacons.filter((b) => b.expiresAt > w.time)
    this.refreshCounts()
    w.time += dt
  }

  private applyForces(dt: number): void {
    const { strength, radius, gateSpecies, gateCount, needsGateCounts, k } = this.c
    for (const d of this.world.dots) {
      let ax = this.rng.range(-1, 1) * CONFIG.jitter
      let ay = this.rng.range(-1, 1) * CONFIG.jitter
      const row = d.species * k

      let gates: Int32Array | null = null
      if (needsGateCounts[d.species]) {
        gates = this.gateScratch.fill(0)
        this.forEachNeighbor(d.x, d.y, GATE_RADIUS, (o) => {
          if (o !== d) gates![o.species] = (gates![o.species] as number) + 1
        })
      }
      const gateOpen = (i: number): boolean =>
        gateSpecies[i] === -1 || (gates !== null && gates[gateSpecies[i] as number]! >= (gateCount[i] as number))

      // inlined neighbor walk — this is the hottest loop in the game
      const cs = this.grid.cell
      const maxR = this.c.rowMaxRadius[d.species] as number
      const maxR2 = maxR * maxR
      const reach = Math.ceil(maxR / cs)
      const cx = (d.x / cs) | 0
      const cy = (d.y / cs) | 0
      for (let gx = cx - reach; gx <= cx + reach; gx++) {
        for (let gy = cy - reach; gy <= cy + reach; gy++) {
          const cell = this.grid.bucket(gx, gy)
          if (!cell) continue
          for (const o of cell) {
            if (o === d) continue
            const dx = o.x - d.x
            const dy = o.y - d.y
            const d2 = dx * dx + dy * dy
            if (d2 > maxR2) continue
            const i = row + o.species
            const s = strength[i] as number
            // most pairs have no law and aren't touching — no sqrt for them
            if (s === 0 && d2 >= REPULSE_RANGE * REPULSE_RANGE) continue
            const dist = Math.sqrt(d2)
            let f = 0
            if (dist < REPULSE_RANGE) {
              f = 2.6 * (dist / REPULSE_RANGE - 1) // separation, all species
            } else if (dist < (radius[i] as number) && gateOpen(i)) {
              f = s * ramp(dist, radius[i] as number)
            }
            if (f !== 0) {
              const dn = Math.max(dist, MIN_DIST)
              ax += (dx / dn) * f * FORCE_SCALE
              ay += (dy / dn) * f * FORCE_SCALE
            }
          }
        }
      }

      for (const b of this.world.beacons) {
        const dx = b.x - d.x
        const dy = b.y - d.y
        const dist = Math.sqrt(dx * dx + dy * dy)
        let a = 0
        if (b.kind === 'flat') {
          if (dist < CONFIG.beaconRadius) a = -CONFIG.flatStrength * (1 - dist / CONFIG.beaconRadius)
        } else {
          // phantom dot: the generated force law decides the reaction
          const i = row + b.species
          const s = strength[i] as number
          if (s !== 0 && dist < (radius[i] as number) && gateOpen(i)) {
            a = s * ramp(dist, radius[i] as number) * FORCE_SCALE * CONFIG.echoWeight
          }
        }
        if (a !== 0) {
          const dn = Math.max(dist, MIN_DIST)
          ax += (dx / dn) * a
          ay += (dy / dn) * a
        }
      }

      d.vx += ax * dt
      d.vy += ay * dt
    }
  }

  private move(dt: number): void {
    const size = CONFIG.fieldSize
    const m = CONFIG.wallMargin
    for (const d of this.world.dots) {
      if (d.x < m) d.vx += CONFIG.wallPush * (1 - d.x / m) * dt
      if (d.x > size - m) d.vx -= CONFIG.wallPush * (1 - (size - d.x) / m) * dt
      if (d.y < m) d.vy += CONFIG.wallPush * (1 - d.y / m) * dt
      if (d.y > size - m) d.vy -= CONFIG.wallPush * (1 - (size - d.y) / m) * dt
      const damp = Math.max(0, 1 - CONFIG.friction * dt)
      d.vx *= damp
      d.vy *= damp
      const speed = Math.sqrt(d.vx * d.vx + d.vy * d.vy)
      if (speed > CONFIG.maxSpeed) {
        d.vx *= CONFIG.maxSpeed / speed
        d.vy *= CONFIG.maxSpeed / speed
      }
      d.x = Math.min(size - 2, Math.max(2, d.x + d.vx * dt))
      d.y = Math.min(size - 2, Math.max(2, d.y + d.vy * dt))
      d.age += dt
    }
  }

  /** Collect candidate pairs, then resolve in id order — contact outcomes
   * never depend on spatial-hash iteration order. */
  private applyContacts(dead: Set<number>, born: Dot[]): void {
    const { contact, k } = this.c
    const w = this.world
    const pairs: Array<{ a: Dot; b: Dot; rule: ContactRule }> = []
    for (const d of w.dots) {
      if (d.immuneUntil > w.time) continue
      this.forEachNeighbor(d.x, d.y, CONFIG.contactRadius, (o) => {
        if (o.id <= d.id || o.immuneUntil > w.time) return
        const rule = contact[d.species * k + o.species]
        if (!rule) return
        const [a, b] = d.species === rule.a ? [d, o] : [o, d]
        pairs.push({ a, b, rule })
      })
    }
    pairs.sort((p, q) => {
      const pLo = Math.min(p.a.id, p.b.id)
      const qLo = Math.min(q.a.id, q.b.id)
      return pLo - qLo || Math.max(p.a.id, p.b.id) - Math.max(q.a.id, q.b.id)
    })
    for (const { a, b, rule } of pairs) {
      if (dead.has(a.id) || dead.has(b.id)) continue
      if (a.immuneUntil > w.time || b.immuneUntil > w.time) continue
      if (!matches(rule, a.species, b.species)) continue // earlier convert changed roles
      this.fireContact(rule, a, b, dead, born)
    }
  }

  private fireContact(rule: ContactRule, a: Dot, b: Dot, dead: Set<number>, born: Dot[]): void {
    const w = this.world
    const until = w.time + rule.cooldown
    a.immuneUntil = until
    b.immuneUntil = until
    const mx = (a.x + b.x) / 2
    const my = (a.y + b.y) / 2
    const out = rule.outcome
    switch (out.kind) {
      case 'consume':
        dead.add(b.id)
        break
      case 'convert':
        this.morph(b, out.into, until)
        break
      case 'spawn': {
        // same brake as fission: no emission into an already-dense site
        let crowd = 0
        this.forEachNeighbor(mx, my, SPAWN_CROWD_RADIUS, (o) => {
          if (o.species === out.child) crowd++
        })
        if (crowd > SPAWN_CROWD_LIMIT) break
        const child = this.createDot(out.child, mx + this.rng.range(-6, 6), my + this.rng.range(-6, 6))
        child.immuneUntil = until
        born.push(child)
        break
      }
      case 'merge': {
        dead.add(a.id)
        dead.add(b.id)
        const merged = this.createDot(out.into, mx, my)
        merged.immuneUntil = until
        born.push(merged)
        break
      }
    }
    w.events.push({ kind: 'contact', rule, x: mx, y: my })
  }

  /** Change a dot's species in place, resetting its lifecycle clocks. */
  private morph(d: Dot, into: number, immuneUntil: number): void {
    d.species = into
    d.age = 0
    d.immuneUntil = immuneUntil
    const u = this.c.unary[into]
    d.nextFission =
      u?.kind === 'fission' ? this.world.time + u.period * this.rng.range(0.5, 1.5) : Infinity
  }

  private applyUnary(dead: Set<number>, born: Dot[]): void {
    const w = this.world
    for (const d of w.dots) {
      if (dead.has(d.id)) continue
      const u = this.c.unary[d.species]
      if (!u) continue
      if (u.kind === 'decay') {
        if (d.age >= u.lifetime * lifeScale(d.id)) {
          if (u.into === null) dead.add(d.id)
          else this.morph(d, u.into, w.time + 0.4)
          w.events.push({ kind: 'unary', rule: u, x: d.x, y: d.y })
        }
      } else if (w.time >= d.nextFission) {
        let crowd = 0
        this.forEachNeighbor(d.x, d.y, u.crowdRadius, (o) => {
          if (o.species === d.species) crowd++
        })
        if (crowd - 1 <= u.crowdLimit) {
          const child = this.createDot(
            d.species,
            d.x + this.rng.range(-6, 6),
            d.y + this.rng.range(-6, 6),
          )
          born.push(child)
          d.nextFission = w.time + u.period * this.rng.range(0.8, 1.2)
          w.events.push({ kind: 'unary', rule: u, x: d.x, y: d.y })
        } else {
          d.nextFission = w.time + 1.5 // crowded — retry later
        }
      }
    }
  }

  private refreshCounts(): void {
    this.world.counts.fill(0)
    for (const d of this.world.dots) {
      this.world.counts[d.species] = (this.world.counts[d.species] ?? 0) + 1
    }
  }

  // ---- player interventions ----

  deploy(species: number, x: number, y: number): Dot | null {
    if (this.world.dots.length >= CONFIG.maxDots) return null
    const dot = this.createDot(species, x, y)
    this.world.dots.push(dot)
    this.refreshCounts()
    return dot
  }

  extract(id: number): Dot | null {
    const i = this.world.dots.findIndex((d) => d.id === id)
    if (i < 0) return null
    const [dot] = this.world.dots.splice(i, 1)
    this.refreshCounts()
    return dot ?? null
  }

  nearestDot(x: number, y: number, maxR: number): Dot | null {
    let best: Dot | null = null
    let bestD2 = maxR * maxR
    for (const d of this.world.dots) {
      const dx = d.x - x
      const dy = d.y - y
      const d2 = dx * dx + dy * dy
      if (d2 < bestD2) {
        bestD2 = d2
        best = d
      }
    }
    return best
  }

  addBeacon(kind: 'echo' | 'flat', x: number, y: number, species: number): Beacon {
    const beacon: Beacon = {
      id: this.world.nextId++,
      kind,
      x,
      y,
      species,
      expiresAt: this.world.time + CONFIG.echoDuration,
    }
    this.world.beacons.push(beacon)
    return beacon
  }

  meanSpeed(): number {
    const dots = this.world.dots
    if (dots.length === 0) return 0
    let sum = 0
    for (const d of dots) sum += Math.sqrt(d.vx * d.vx + d.vy * d.vy)
    return sum / dots.length
  }

  /** Share of dots in visible motion — the liveliness measure. A field with
   * one vigorous chase among calm grazers is alive; a frozen field is not. */
  movingFraction(threshold: number): number {
    const dots = this.world.dots
    if (dots.length === 0) return 0
    const t2 = threshold * threshold
    let moving = 0
    for (const d of dots) if (d.vx * d.vx + d.vy * d.vy > t2) moving++
    return moving / dots.length
  }
}

function matches(rule: ContactRule, sa: number, sb: number): boolean {
  return (rule.a === sa && rule.b === sb) || (rule.a === sb && rule.b === sa)
}
