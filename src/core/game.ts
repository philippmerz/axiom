import { CONFIG } from './config'
import { describeRule, fmtPrice, speciesToken } from './format'
import { Intel } from './intel'
import { Market } from './market'
import { ObjectiveTracker } from './objective'
import { Rng } from './rng'
import { Sim } from './sim'
import { ruleId } from './types'
import type { ContactRule, Dot, Session, Species } from './types'

export type Tool = 'deploy' | 'extract' | 'echo' | 'scan'
export type Phase = 'briefing' | 'running' | 'paused' | 'won' | 'lost'
export type LogClass = 'intel' | 'trade' | 'alert' | 'event'

export interface LogEntry {
  seq: number // monotonic; the log array is a ring, so length can't track newness
  time: number
  msg: string
  cls: LogClass
}

/** A tool action recorded while paused, replayed in order on resume.
 * Extract stores the target dot id (resolved at queue time) so a deferred
 * extract still hits the dot the player aimed at after it has moved. */
export type QueuedAction =
  | { kind: 'deploy'; x: number; y: number; species: number }
  | { kind: 'extract'; x: number; y: number; id: number }
  | { kind: 'echo'; x: number; y: number; species: number; flat: boolean }
  | { kind: 'scan'; x0: number; y0: number; x1: number; y1: number }

export interface Flash {
  kind: 'event' | 'deploy' | 'extract' | 'miss'
  x: number
  y: number
  color: string
  start: number // sim time
}

export interface GameResult {
  won: boolean
  grade: string | null
  reason: string
  timeLeft: number
  credits: number
  run: number
}

/** Session orchestration: owns the sim, market, intel and objective tracker,
 * applies player tools, and writes the event log. Pause is observation-only —
 * every tool requires phase === 'running'. */
export class Game {
  readonly sim: Sim
  readonly market: Market
  readonly intel: Intel
  readonly tracker: ObjectiveTracker
  credits = CONFIG.startCredits
  phase: Phase = 'briefing'
  tool: Tool = 'deploy'
  selected = 0
  /** Touch fallback for shift-click: when set, ECHO places a flat repulsor. */
  repelMode = false
  /** Field-space cursor, fed by input — the center of attention. */
  cursorX = -1000
  cursorY = -1000
  readonly log: LogEntry[] = []
  logSeq = 0 // total entries ever logged; the log array itself is a capped ring
  readonly flashes: Flash[] = []
  /** Moves recorded during the current pause, executed on resume. */
  pending: QueuedAction[] = []
  lastExtractAt = -Infinity
  result: GameResult | null = null

  constructor(readonly session: Session, readonly run: number) {
    // reuse the calibration sim seed so the player faces the exact trajectory
    // the objective targets were measured against
    this.sim = new Sim(session.ruleset, new Rng(session.simSeed))
    this.market = new Market(
      session.marketBases,
      session.burnin.meanCounts,
      new Rng((session.seed ^ 0x9e3779b9) >>> 0),
    )
    this.intel = new Intel(session.ruleset)
    this.tracker = new ObjectiveTracker(session.objective)
  }

  get time(): number {
    return this.sim.world.time
  }

  get species(): Species[] {
    return this.session.ruleset.species
  }

  /** A species reference for log/HUD text — a token the UI renders as a dot. */
  private glyph(s: number): string {
    return speciesToken(s)
  }

  note(msg: string, cls: LogClass): void {
    this.log.push({ seq: this.logSeq++, time: this.time, msg, cls })
    if (this.log.length > 120) this.log.shift()
  }

  // ---- main loop ----

  tick(): void {
    if (this.phase !== 'running') return
    const beaconsBefore = this.sim.world.beacons
    this.sim.step()
    const w = this.sim.world

    const alive = new Set(w.beacons.map((b) => b.id))
    const expired = beaconsBefore.filter((b) => !alive.has(b.id))
    this.intel.echoStep(w)
    for (const rule of this.intel.echoFinish(expired)) {
      this.note(`ECHO CONFIRMS: ${describeRule(rule, this.species)}`, 'intel')
    }

    for (const e of w.events) {
      if (e.kind !== 'contact') continue
      this.tracker.noteFire(ruleId(e.rule))
      this.flashes.push({ kind: 'event', x: e.x, y: e.y, color: this.eventColor(e.rule), start: this.time })
    }

    const report = this.intel.noteEvents(w.events, this.cursorX, this.cursorY)
    for (const { rule, seen } of report.progressed) {
      const label =
        rule.kind === 'contact'
          ? `CONTACT ${this.glyph(rule.a)}·${this.glyph(rule.b)}`
          : `LIFECYCLE ${this.glyph(rule.species)}`
      this.note(`${label} OBSERVED (${seen}/${CONFIG.observationsToConfirm})`, 'event')
    }
    for (const rule of report.confirmed) {
      this.note(`LAW CONFIRMED: ${describeRule(rule, this.species)}`, 'intel')
    }

    this.market.step(w.counts, CONFIG.dt)
    this.tracker.update(w.counts, this.credits, this.time, CONFIG.dt)
    this.drainPending() // fire extracts that were rate-limited at resume

    while (this.flashes.length > 0 && this.time - (this.flashes[0] as Flash).start > 1.2) {
      this.flashes.shift()
    }

    if (this.tracker.status === 'won') this.finish(true, 'OBJECTIVE COMPLETE')
    else if (this.tracker.status === 'lost') {
      this.finish(false, this.tracker.failReason ?? 'SESSION FAILED')
    }
  }

  /** Event rings take the color of the species the outcome is "about". */
  private eventColor(rule: ContactRule): string {
    const out = rule.outcome
    const s =
      out.kind === 'consume'
        ? rule.b
        : out.kind === 'spawn'
          ? out.child
          : out.into
    return this.species[s]?.color ?? '#fff'
  }

  private finish(won: boolean, reason: string): void {
    this.phase = won ? 'won' : 'lost'
    const timeLeft = Math.max(0, this.session.objective.deadline - this.time)
    const frac = timeLeft / this.session.objective.deadline
    let grade: string | null = null
    if (won) {
      if (frac >= 0.4 && this.credits >= CONFIG.startCredits) grade = 'S'
      else if (frac >= 0.25) grade = 'A'
      else if (frac >= 0.1) grade = 'B'
      else grade = 'C'
    }
    this.result = { won, grade, reason, timeLeft, credits: this.credits, run: this.run }
    this.note(won ? `OBJECTIVE COMPLETE — GRADE ${grade}` : `SESSION FAILED — ${reason}`, won ? 'intel' : 'alert')
  }

  // ---- phase control ----

  start(): void {
    if (this.phase === 'briefing') {
      this.phase = 'running'
      this.note('ENGAGED — LAWS UNKNOWN', 'event')
    }
  }

  togglePause(): void {
    if (this.phase === 'running') {
      this.phase = 'paused'
      this.note('PAUSED — PLAN MOVES, RESUME TO EXECUTE', 'event')
    } else if (this.phase === 'paused') {
      this.phase = 'running'
      this.flushQueue()
    }
  }

  /** Run every action queued during the pause, in order. Deploy/echo/scan
   * fire immediately. Extracts honor the 1.5s cooldown — those rate-limited at
   * the instant of resume stay queued and drain one-by-one over the next ticks
   * (see drainPending), so queueing several extracts plays them out over time
   * rather than collapsing to one. */
  private flushQueue(): void {
    if (this.pending.length === 0) return
    const queued = this.pending
    this.pending = []
    const deferred: QueuedAction[] = []
    let done = 0
    for (const a of queued) {
      switch (a.kind) {
        case 'deploy': {
          const before = this.credits
          this.doDeploy(a.species, a.x, a.y)
          if (this.credits !== before) done++
          break
        }
        case 'echo': {
          const before = this.credits
          this.doEcho(a.x, a.y, a.species, a.flat)
          if (this.credits !== before) done++
          break
        }
        case 'scan':
          if (this.doScan(a.x0, a.y0, a.x1, a.y1)) done++
          break
        case 'extract': {
          const r = this.fireExtract(a.id, a.x, a.y)
          if (r === 'ok') done++
          else if (r === 'cooldown') deferred.push(a) // drains over the next ticks
          break
        }
      }
    }
    this.pending = deferred
    const held = deferred.length ? ` · ${deferred.length} EXTRACT HELD` : ''
    this.note(`RESUMED — ${done}/${queued.length} MOVES EXECUTED${held}`, 'event')
  }

  /** Fire extracts that were rate-limited at resume, one per cooldown window,
   * while running. Called each tick. */
  private drainPending(): void {
    if (this.pending.length === 0 || this.extractReady() < 1) return
    const i = this.pending.findIndex((a) => a.kind === 'extract')
    if (i < 0) return
    const a = this.pending[i] as Extract<QueuedAction, { kind: 'extract' }>
    this.pending.splice(i, 1)
    this.fireExtract(a.id, a.x, a.y)
  }

  // ---- tools ----
  // Each public entry point gates on phase: while paused it records the move
  // for replay on resume; while running it fires immediately. The do* methods
  // hold the real logic and take explicit params (so a queued deploy keeps the
  // species it was queued with, not whatever is selected at resume).

  private noFunds(): void {
    this.note('INSUFFICIENT FUNDS', 'alert')
  }

  deployAt(x: number, y: number): void {
    if (this.phase === 'paused') {
      this.pending.push({ kind: 'deploy', x, y, species: this.selected })
      this.note(`QUEUED DEPLOY ${this.glyph(this.selected)}`, 'event')
      return
    }
    if (this.phase !== 'running') return
    this.doDeploy(this.selected, x, y)
  }

  private doDeploy(species: number, x: number, y: number): void {
    const cost = this.market.ask(species)
    if (this.credits < cost) return this.noFunds()
    const dot = this.sim.deploy(species, x, y)
    if (!dot) return this.note('FIELD SATURATED — DEPLOY ABORTED', 'alert')
    this.credits -= cost
    this.market.recordBuy(species)
    this.flashes.push({ kind: 'deploy', x, y, color: this.species[species]?.color ?? '#fff', start: this.time })
    this.note(`DEPLOY ${this.glyph(species)} −${fmtPrice(cost)}`, 'trade')
  }

  extractReady(): number {
    return Math.min(1, (this.time - this.lastExtractAt) / CONFIG.extractCooldown)
  }

  extractAt(x: number, y: number): void {
    if (this.phase === 'paused') {
      // resolve the target now so a deferred extract hits the same dot later
      const dot = this.sim.nearestDot(x, y, CONFIG.extractRadius)
      this.pending.push({ kind: 'extract', x, y, id: dot?.id ?? -1 })
      this.note('QUEUED EXTRACT', 'event')
      return
    }
    if (this.phase !== 'running') return
    if (this.extractReady() < 1) return
    const dot = this.sim.nearestDot(x, y, CONFIG.extractRadius)
    if (!dot) {
      this.flashes.push({ kind: 'miss', x, y, color: '#555', start: this.time })
      return
    }
    this.sellDot(dot)
  }

  /** Fire a queued extract against its captured dot id. */
  private fireExtract(id: number, x: number, y: number): 'ok' | 'cooldown' | 'gone' {
    if (this.extractReady() < 1) return 'cooldown'
    const dot = id >= 0 ? this.sim.world.dots.find((d) => d.id === id) : undefined
    if (!dot) {
      this.flashes.push({ kind: 'miss', x, y, color: '#555', start: this.time })
      return 'gone'
    }
    this.sellDot(dot)
    return 'ok'
  }

  private sellDot(dot: Dot): void {
    const value = this.market.bid(dot.species)
    this.sim.extract(dot.id)
    this.market.recordSell(dot.species)
    this.credits += value
    this.lastExtractAt = this.time
    this.flashes.push({ kind: 'extract', x: dot.x, y: dot.y, color: this.species[dot.species]?.color ?? '#fff', start: this.time })
    this.note(`EXTRACT ${this.glyph(dot.species)} +${fmtPrice(value)}`, 'trade')
  }

  echoAt(x: number, y: number, flat: boolean): void {
    if (this.phase === 'paused') {
      this.pending.push({ kind: 'echo', x, y, species: this.selected, flat })
      this.note(`QUEUED ${flat ? 'REPULSOR' : 'ECHO ' + this.glyph(this.selected)}`, 'event')
      return
    }
    if (this.phase !== 'running') return
    this.doEcho(x, y, this.selected, flat)
  }

  private doEcho(x: number, y: number, species: number, flat: boolean): void {
    const cost = flat ? CONFIG.flatCost : CONFIG.echoCost
    if (this.credits < cost) return this.noFunds()
    this.credits -= cost
    this.sim.addBeacon(flat ? 'flat' : 'echo', x, y, species)
    this.note(flat ? `REPULSOR DEPLOYED −${cost}` : `ECHO ${this.glyph(species)} −${cost}`, 'trade')
  }

  /** SCAN: a click queries a dot's lifecycle; a drag from dot A to dot B
   * queries the (A,B) relation — contact law first, then force laws. */
  scanDrag(x0: number, y0: number, x1: number, y1: number): void {
    if (this.phase === 'paused') {
      this.pending.push({ kind: 'scan', x0, y0, x1, y1 })
      this.note('QUEUED SCAN', 'event')
      return
    }
    if (this.phase !== 'running') return
    this.doScan(x0, y0, x1, y1)
  }

  /** Returns true if the scan actually revealed something (or charged). */
  private doScan(x0: number, y0: number, x1: number, y1: number): boolean {
    const start = this.sim.nearestDot(x0, y0, 24)
    if (!start) {
      this.flashes.push({ kind: 'miss', x: x0, y: y0, color: '#555', start: this.time })
      return false
    }
    const dragged = Math.hypot(x1 - x0, y1 - y0) >= 14
    const end = dragged ? this.sim.nearestDot(x1, y1, 24) : start
    if (!end) {
      this.flashes.push({ kind: 'miss', x: x1, y: y1, color: '#555', start: this.time })
      return false
    }
    const cost = this.intel.scanCost()

    if (end.id === start.id) {
      if (this.credits < cost) {
        this.noFunds()
        return false
      }
      const rule = this.intel.scanUnary(start.species)
      if (!rule) {
        this.note(`NO UNKNOWN LIFECYCLE: ${this.glyph(start.species)}`, 'event')
        return false
      }
      this.credits -= cost
      this.note(`SCAN −${cost}: ${describeRule(rule, this.species)}`, 'intel')
      return true
    }

    const a = start.species
    const b = end.species
    if (this.credits < cost) {
      this.noFunds()
      return false
    }
    const result = this.intel.scanPair(a, b)
    if (!result) {
      this.note(`NO UNKNOWN LAWS: ${this.glyph(a)}·${this.glyph(b)}`, 'event')
      return false
    }
    if (result.zero) {
      const half = Math.ceil(cost / 2)
      this.credits -= half
      this.note(`SCAN −${half}: ${this.glyph(a)} ⊘ ${this.glyph(b)} — NO INTERACTION`, 'intel')
      return true
    }
    this.credits -= cost
    for (const rule of result.revealed) {
      this.note(`SCAN −${cost}: ${describeRule(rule, this.species)}`, 'intel')
    }
    return true
  }
}
