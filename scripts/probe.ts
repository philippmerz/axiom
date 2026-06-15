/** Diagnostic: why do generated candidates fail the 60s gate?
 * Usage: npx tsx scripts/probe.ts [count=60] */
import { CONFIG } from '../src/core/config'
import { Rng } from '../src/core/rng'
import { generateRuleset } from '../src/core/rules'
import { Sim } from '../src/core/sim'
import { ruleId } from '../src/core/types'

const COUNT = Number(process.argv[2]?.split('=')[1] ?? 60)
const reasons = new Map<string, number>()
const bump = (r: string) => reasons.set(r, (reasons.get(r) ?? 0) + 1)

for (let i = 0; i < COUNT; i++) {
  const root = new Rng((Math.imul(i + 1, 0x9e3779b9) ^ 0x12345678) >>> 0)
  const ruleset = generateRuleset(new Rng(root.fork()))
  const sim = new Sim(ruleset, new Rng(root.fork()))
  const b = CONFIG.burnin
  const perSec = Math.round(1 / CONFIG.dt)
  const gateSteps = Math.round(b.seconds / CONFIG.dt)
  let contactEvents = 0
  let deaths = 0
  let zeroStreak = 0
  const fires = new Map<string, number>()
  let aborted = ''
  for (let s = 0; s < gateSteps && !aborted; s++) {
    sim.step()
    for (const e of sim.world.events) {
      if (e.kind === 'contact') {
        contactEvents++
        fires.set(ruleId(e.rule), (fires.get(ruleId(e.rule)) ?? 0) + 1)
        if (e.rule.outcome.kind === 'consume') deaths++
        if (e.rule.outcome.kind === 'merge') deaths += 2
      } else if (e.rule.kind === 'decay' && e.rule.into === null) deaths++
    }
    if (s % perSec === 0) {
      if (sim.world.counts.some((c) => c > b.maxPerSpecies * 1.5)) aborted = 'abort:blowup'
      else if (sim.world.dots.length > b.maxTotal * 1.15) aborted = 'abort:total'
      else if (s > 20 * perSec && sim.world.dots.length < 10) aborted = 'abort:dead'
      zeroStreak = sim.world.counts.some((c) => c === 0) ? zeroStreak + 1 : 0
      if (zeroStreak > 10 && !aborted) aborted = 'abort:extinct'
    }
  }
  if (aborted) {
    bump(aborted)
    continue
  }
  const total = sim.world.dots.length
  const lively = [...fires.values()].filter((n) => n >= 3).length
  if (total < b.minTotal) bump('gate:total-low')
  else if (total > b.maxTotal) bump('gate:total-high')
  else if (contactEvents < b.minContactEvents) bump('gate:few-contacts')
  else if (deaths < b.minDeaths) bump('gate:few-deaths')
  else if (sim.movingFraction(b.movingSpeed) < b.minMovingFraction) bump('gate:static')
  else if (lively < 2) bump('gate:few-lively-rules')
  else if (sim.world.counts.some((c) => c < b.minPerSpecies)) bump('gate:species-extinct')
  else if (sim.world.counts.some((c) => c > b.maxPerSpecies)) bump('gate:species-high')
  else bump('PASS')
}

for (const [r, n] of [...reasons.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`${String(n).padStart(4)}  ${r}`)
}
