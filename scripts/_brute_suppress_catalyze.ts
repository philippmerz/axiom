import { CONFIG } from '../src/core/config'
import { generateSession } from '../src/core/rules'
import { Game } from '../src/core/game'
import { findContactRule } from '../src/core/objective'

// ---- SUPPRESS: extract-spam the target species, no law knowledge ----
// Player extracts the nearest dot of the target species every cooldown.
// To win, count must reach 0 and HOLD for holdSeconds (18s).
function runSuppressSpam(seed: number) {
  const session = generateSession(seed)
  const obj = session.objective.primary
  if (obj.kind !== 'suppress') return null
  const game = new Game(session, 1)
  game.start()
  game.tool = 'extract'
  const targetSp = obj.species
  const steps = Math.round(CONFIG.deadline / CONFIG.dt) + 5
  for (let i = 0; i < steps; i++) {
    // Whenever extract is ready, target the nearest dot of the target species.
    if (game.extractReady() >= 1) {
      let best: { x: number; y: number } | null = null
      let bestD2 = Infinity
      for (const d of game.sim.world.dots) {
        if (d.species !== targetSp) continue
        // extract at the dot's location (cheat: perfect targeting)
        const d2 = d.x * d.x + d.y * d.y
        if (d2 < bestD2) {
          bestD2 = d2
          best = { x: d.x, y: d.y }
        }
      }
      if (best) game.extractAt(best.x, best.y)
    }
    game.tick()
    if (game.phase !== 'running') break
  }
  return {
    seed,
    won: game.phase === 'won',
    reason: game.result?.reason ?? 'timeout',
    finalCount: game.sim.world.counts[targetSp],
    constraint: session.objective.constraint.kind,
  }
}

// ---- CATALYZE: co-deploy the two participants tightly, no law knowledge ----
function runCatalyzeCoDeploy(seed: number) {
  const session = generateSession(seed)
  const obj = session.objective.primary
  if (obj.kind !== 'catalyze') return null
  const rule = findContactRule(session.ruleset, obj.ruleKey)
  if (!rule) return null
  const game = new Game(session, 1)
  game.start()
  const cx = CONFIG.fieldSize / 2
  const cy = CONFIG.fieldSize / 2
  const target = obj.target
  const constraintSp = session.objective.constraint.species
  const constraintIsParticipant = constraintSp === rule.a || constraintSp === rule.b
  const steps = Math.round(CONFIG.deadline / CONFIG.dt) + 5
  for (let i = 0; i < steps; i++) {
    // Re-cluster a fresh pair of participants near center every ~0.5s.
    if (i % 30 === 0 && game.phase === 'running') {
      for (const sp of [rule.a, rule.b]) {
        game.selected = sp
        const before = game.credits
        game.deployAt(cx + (Math.random() - 0.5) * 30, cy + (Math.random() - 0.5) * 30)
        if (game.credits === before) {
          /* couldn't afford or saturated */
        }
      }
    }
    game.tick()
    if (game.phase !== 'running') break
  }
  return {
    seed,
    won: game.phase === 'won',
    reason: game.result?.reason ?? 'timeout',
    fireCount: game.tracker.fireCount,
    target,
    constraint: session.objective.constraint.kind,
    constraintIsParticipant,
  }
}

let supN = 0, supW = 0
const supEx: any[] = []
let catN = 0, catW = 0
const catEx: any[] = []
for (let seed = 1; seed <= 250; seed++) {
  const s = runSuppressSpam(seed)
  if (s) {
    supN++
    if (s.won) supW++
    if (supEx.length < 10) supEx.push(s)
  }
  const c = runCatalyzeCoDeploy(seed)
  if (c) {
    catN++
    if (c.won) catW++
    if (catEx.length < 10) catEx.push(c)
  }
}
console.log(`SUPPRESS extract-spam: WON ${supW}/${supN}`)
console.log(JSON.stringify(supEx, null, 2))
console.log(`CATALYZE co-deploy: WON ${catW}/${catN}`)
console.log(JSON.stringify(catEx, null, 2))
