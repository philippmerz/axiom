/** Measures, for accumulate-objective sessions, the credit target vs. an
 * idealized naive extract-only income baseline. Tests the claim that passive
 * harvesting alone clears the ACCUMULATE goal without any law inference. */
import { CONFIG } from '../src/core/config'
import { Market } from '../src/core/market'
import { Rng } from '../src/core/rng'
import { generateSession } from '../src/core/rules'
import { Sim } from '../src/core/sim'

const COUNT = Number(process.argv[2] ?? 300)

interface Row {
  seed: number
  target: number
  marginNeeded: number
  naiveIncome: number
  births: number
  meanBase: number
  cleared: boolean
  fracOfNaive: number
}

const rows: Row[] = []
for (let i = 0; i < COUNT; i++) {
  const seed = (Math.imul(i + 1, 2654435761) ^ 0x12345678) >>> 0
  const session = generateSession(seed)
  if (session.objective.primary.kind !== 'accumulate') continue

  const target = session.objective.primary.credits
  const marginNeeded = target - CONFIG.startCredits

  // Replay null trajectory while a naive harvester extracts the single
  // most-valuable dot in the whole field every cooldown. This is an UPPER
  // bound on dumb extract-only income (perfect target selection, no skill).
  const sim = new Sim(session.ruleset, new Rng(session.simSeed))
  const market = new Market(session.marketBases, session.burnin.meanCounts, new Rng(session.simSeed))
  let credits = CONFIG.startCredits
  let lastExtractAt = -CONFIG.extractCooldown
  const steps = Math.round(CONFIG.deadline / CONFIG.dt)
  for (let s = 0; s < steps; s++) {
    sim.step()
    market.step(sim.world.counts, CONFIG.dt)
    const t = sim.world.time
    if (t - lastExtractAt >= CONFIG.extractCooldown && sim.world.dots.length > 0) {
      // pick the dot whose species currently bids highest
      let best = sim.world.dots[0]!
      let bestBid = market.bid(best.species)
      for (const d of sim.world.dots) {
        const b = market.bid(d.species)
        if (b > bestBid) {
          bestBid = b
          best = d
        }
      }
      credits += bestBid
      sim.extract(best.id)
      market.recordSell(best.species)
      lastExtractAt = t
    }
  }

  const naiveIncome = credits - CONFIG.startCredits
  const meanBase =
    session.marketBases.reduce((a, b) => a + b, 0) / Math.max(1, session.marketBases.length)
  const row: Row = {
    seed,
    target,
    marginNeeded,
    naiveIncome,
    births: session.burnin.births,
    meanBase,
    cleared: credits >= target,
    fracOfNaive: marginNeeded / Math.max(1, naiveIncome),
  }
  rows.push(row)
  process.stdout.write(
    `seed=${row.seed.toString(16).padStart(8, '0')} target=${row.target.toFixed(0).padStart(5)} marginNeeded=${row.marginNeeded.toFixed(0).padStart(5)}` +
      ` naiveIncome=${row.naiveIncome.toFixed(0).padStart(6)} births=${String(row.births).padStart(4)} meanBase=${row.meanBase.toFixed(1)}` +
      ` frac=${row.fracOfNaive.toFixed(2)} ${row.cleared ? 'CLEARED' : 'short'}\n`,
  )
}

const clearedCount = rows.filter((r) => r.cleared).length
console.log(`accumulate sessions: ${rows.length} of ${COUNT} seeds`)
console.log(
  `naive-farm CLEARS target: ${clearedCount}/${rows.length} (${((100 * clearedCount) / Math.max(1, rows.length)).toFixed(0)}%)`,
)
const meanFrac = rows.reduce((a, r) => a + r.fracOfNaive, 0) / Math.max(1, rows.length)
console.log(`mean (marginNeeded / naiveIncome): ${meanFrac.toFixed(2)}  (<1 means farming alone suffices)`)
console.log('---- sample rows ----')
for (const r of rows.slice(0, 20)) {
  console.log(
    `seed=${r.seed.toString(16).padStart(8, '0')} target=${r.target.toFixed(0).padStart(5)} marginNeeded=${r.marginNeeded.toFixed(0).padStart(5)}` +
      ` naiveIncome=${r.naiveIncome.toFixed(0).padStart(6)} births=${String(r.births).padStart(4)} meanBase=${r.meanBase.toFixed(1)}` +
      ` frac=${r.fracOfNaive.toFixed(2)} ${r.cleared ? 'CLEARED' : 'short'}`,
  )
}
