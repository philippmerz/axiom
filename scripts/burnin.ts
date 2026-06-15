/** Seed-sweep harness: generates N sessions headlessly, then replays each
 * one's null trajectory (no player input) for the full deadline and checks
 * fairness invariants:
 *   - physics stays finite (NaN poisoning would blank the field silently)
 *   - the objective does not complete itself (auto-win)
 *   - the constraint does not fail by natural drift (auto-loss)
 * Usage: npm run burnin [-- count=40 offset=0 verbose]
 */
import { CONFIG } from '../src/core/config'
import { describeRule } from '../src/core/format'
import { ObjectiveTracker } from '../src/core/objective'
import { Rng } from '../src/core/rng'
import { generateSession } from '../src/core/rules'
import { Sim } from '../src/core/sim'
import { ruleId } from '../src/core/types'
import type { Session } from '../src/core/types'

const args = new Map(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.split('=')
    return [k as string, v ?? 'true'] as const
  }),
)
const COUNT = Number(args.get('count') ?? 40)
const OFFSET = Number(args.get('offset') ?? 0)
const VERBOSE = args.has('verbose')

interface Outcome {
  seed: number
  kind: string
  constraint: string
  rejected: number
  genMs: number
  laws: number
  result: 'ok' | 'auto-win' | 'auto-loss' | 'nan'
  detail: string
}

function nullTrajectory(session: Session): { result: Outcome['result']; detail: string } {
  const sim = new Sim(session.ruleset, new Rng(session.simSeed))
  const tracker = new ObjectiveTracker(session.objective)
  const steps = Math.round(session.objective.deadline / CONFIG.dt)
  for (let i = 0; i < steps; i++) {
    sim.step()
    for (const e of sim.world.events) {
      if (e.kind === 'contact') tracker.noteFire(ruleId(e.rule))
    }
    tracker.update(sim.world.counts, CONFIG.startCredits, sim.world.time, CONFIG.dt)
    if (i % 60 === 0) {
      for (const d of sim.world.dots) {
        if (!Number.isFinite(d.x + d.y + d.vx + d.vy)) {
          return { result: 'nan', detail: `NaN at t=${sim.world.time.toFixed(1)}s` }
        }
      }
    }
    if (tracker.status === 'won') {
      return { result: 'auto-win', detail: `won untouched at t=${sim.world.time.toFixed(0)}s` }
    }
    if (tracker.status === 'lost' && tracker.failReason !== 'DEADLINE EXPIRED') {
      return {
        result: 'auto-loss',
        detail: `${tracker.failReason} untouched at t=${sim.world.time.toFixed(0)}s`,
      }
    }
  }
  return { result: 'ok', detail: `pop ${sim.world.dots.length} at deadline` }
}

const outcomes: Outcome[] = []
for (let i = 0; i < COUNT; i++) {
  const seed = (Math.imul(OFFSET + i + 1, 2654435761) ^ 0xa5a5a5a5) >>> 0
  const t0 = performance.now()
  const session = generateSession(seed)
  const genMs = performance.now() - t0
  const { result, detail } = nullTrajectory(session)
  const laws =
    session.ruleset.contacts.length + session.ruleset.unaries.length + session.ruleset.forces.length
  const o: Outcome = {
    seed,
    kind: session.objective.primary.kind,
    constraint: session.objective.constraint.kind,
    rejected: session.rejected,
    genMs,
    laws,
    result,
    detail,
  }
  outcomes.push(o)
  const flag = result === 'ok' ? ' ' : '!'
  console.log(
    `${flag} ${seed.toString(16).padStart(8, '0')} ${o.kind.padEnd(10)} ${o.constraint.padEnd(8)}` +
      ` rej=${String(o.rejected).padStart(2)} laws=${String(laws).padStart(2)}` +
      ` gen=${genMs.toFixed(0).padStart(5)}ms ${result}${result === 'ok' ? '' : ` (${detail})`}`,
  )
  if (VERBOSE) {
    for (const r of session.ruleset.contacts) console.log(`    ${describeRule(r, session.ruleset.species)}`)
    for (const r of session.ruleset.unaries) console.log(`    ${describeRule(r, session.ruleset.species)}`)
  }
}

const by = (r: Outcome['result']) => outcomes.filter((o) => o.result === r).length
const kinds = new Map<string, number>()
for (const o of outcomes) kinds.set(o.kind, (kinds.get(o.kind) ?? 0) + 1)
const meanGen = outcomes.reduce((a, o) => a + o.genMs, 0) / outcomes.length
const meanRej = outcomes.reduce((a, o) => a + o.rejected, 0) / outcomes.length

console.log('---')
console.log(
  `${COUNT} seeds | ok=${by('ok')} auto-win=${by('auto-win')} auto-loss=${by('auto-loss')} nan=${by('nan')}`,
)
console.log(
  `objectives: ${[...kinds.entries()].map(([k, n]) => `${k}=${n}`).join(' ')} | mean gen ${meanGen.toFixed(0)}ms, mean rejected ${meanRej.toFixed(1)}`,
)

const bad = by('nan') + by('auto-win') + by('auto-loss')
if (by('nan') > 0 || bad / COUNT > 0.2) {
  console.error(`FAIL: ${bad}/${COUNT} degenerate sessions`)
  process.exit(1)
}
console.log('PASS')
