import { generateSession } from '../src/core/rules'
import { Game } from '../src/core/game'
import { CONFIG } from '../src/core/config'

function runDeploySpam(seed: number) {
  const session = generateSession(seed)
  const obj = session.objective.primary
  if (obj.kind !== 'amplify') return { kind: obj.kind, won: null as boolean | null }

  const game = new Game(session, 1)
  game.start()
  game.tool = 'deploy'
  game.selected = obj.species
  const cx = CONFIG.fieldSize / 2
  const cy = CONFIG.fieldSize / 2

  const target = obj.target
  const constraint = session.objective.constraint
  const startCount = game.sim.world.counts[obj.species] as number
  const startCredits = game.credits
  let spikeCost = 0
  let spiked = false
  let spikeTime = -1

  const steps = Math.round(CONFIG.deadline / CONFIG.dt) + 5
  for (let i = 0; i < steps; i++) {
    let guard = 0
    while (
      game.phase === 'running' &&
      (game.sim.world.counts[obj.species] as number) < target + 6 &&
      guard++ < 120
    ) {
      const before = game.credits
      // deterministic position (count is all that matters)
      game.deployAt(cx + ((i * 7 + guard * 13) % 60) - 30, cy + ((i * 11 + guard * 5) % 60) - 30)
      if (game.credits === before) break
    }
    if (!spiked && (game.sim.world.counts[obj.species] as number) >= target) {
      spiked = true
      spikeCost = startCredits - game.credits
      spikeTime = game.time
    }
    game.tick()
    if (game.phase !== 'running') break
  }

  return {
    kind: 'amplify' as const,
    won: game.phase === 'won',
    reason: game.result?.reason ?? 'timeout',
    target,
    startCount,
    finalCredits: Math.round(game.credits),
    spikeCost: Math.round(spikeCost),
    spikeTime: Math.round(spikeTime * 100) / 100,
    constraintKind: constraint.kind,
    constraintSpecies: constraint.species,
    amplifySpecies: obj.species,
    constraintConflicts: constraint.species === obj.species,
  }
}

let amplifyCount = 0
let wins = 0
const examples: any[] = []
const N = 120
for (let seed = 1; seed <= N; seed++) {
  const r = runDeploySpam(seed)
  if (r.kind !== 'amplify') continue
  amplifyCount++
  if (r.won) wins++
  if (examples.length < 15) examples.push({ seed, ...r })
  process.stdout.write(`seed ${seed}: AMPLIFY won=${r.won} spikeCost=${(r as any).spikeCost} spikeTime=${(r as any).spikeTime} target=${(r as any).target} start=${(r as any).startCount} finalCr=${(r as any).finalCredits} conflict=${(r as any).constraintConflicts}\n`)
}

console.log(`\n=== AMPLIFY objectives: ${amplifyCount}/${N} seeds; deploy-spam WON: ${wins}/${amplifyCount} ===`)
