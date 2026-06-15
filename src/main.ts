import { CONFIG } from './core/config'
import { Game } from './core/game'
import { hexToSeed, randomSeed, seedToHex } from './core/rng'
import { generateSessionAsync } from './core/rules'
import { DossierRenderer } from './ui/dossier'
import { FieldRenderer } from './ui/field'
import { bindInput } from './ui/input'
import { Panels } from './ui/panels'
import type { Session } from './core/types'

function el<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T
}

let game: Game | null = null
let booting = false
const sessionCache = new Map<number, Session>() // R-retry must not re-run validation
const debriefed = new WeakSet<Game>()

const field = new FieldRenderer(el('field'), el('overlay-canvas'))
const dossier = new DossierRenderer(el('dossier-canvas'), el('dossier-legend'))
const panels = new Panels({ onEngage: engage, onRetry: retry, onNew: fresh })
const drag = bindInput(() => game, el('field-stack'), {
  onEngage: engage,
  onRetry: retry,
  onNew: fresh,
})

function bumpRun(seed: number): number {
  const key = `axiom-run-${seedToHex(seed)}`
  const run = Number(localStorage.getItem(key) ?? 0) + 1
  localStorage.setItem(key, String(run))
  return run
}

async function boot(seed: number): Promise<void> {
  if (booting) return
  booting = true
  game = null
  panels.generating(seed, 0)
  let session = sessionCache.get(seed)
  if (!session) {
    session = await generateSessionAsync(seed, (attempt) => panels.generating(seed, attempt))
    sessionCache.set(seed, session)
  }
  history.replaceState(null, '', `#${seedToHex(seed)}`)
  game = new Game(session, bumpRun(seed))
  panels.briefing(game)
  layout()
  booting = false
}

function engage(): void {
  if (game?.phase === 'briefing') {
    game.start()
    panels.hideOverlay()
  }
}

function retry(): void {
  if (game && !booting) void boot(game.session.seed)
}

function fresh(): void {
  if (!booting) void boot(randomSeed())
}

function layout(): void {
  const wrap = el('field-wrap')
  const size = Math.max(240, Math.min(wrap.clientWidth, wrap.clientHeight) - 34)
  field.resize(size)
  const dossierBlock = el('dossier')
  dossier.resize(Math.max(120, dossierBlock.clientWidth - 28))
}

window.addEventListener('resize', layout)

window.addEventListener('hashchange', () => {
  const seed = hexToSeed(location.hash.slice(1))
  if (seed !== null && seed !== game?.session.seed) void boot(seed)
})

// fixed-step accumulator, clamped so background tabs can't queue a
// catch-up avalanche — dropped wall time just pauses the world
let last = performance.now()
let acc = 0
function frame(now: number): void {
  acc = Math.min(acc + (now - last) / 1000, CONFIG.dt * 8)
  last = now
  if (game) {
    let steps = 0
    while (acc >= CONFIG.dt && steps < 4) {
      game.tick()
      acc -= CONFIG.dt
      steps++
    }
    field.render(game, drag)
    dossier.render(game)
    panels.update()
    if (game.result && !debriefed.has(game)) {
      debriefed.add(game)
      panels.debrief(game.result, game.intel.knownLaws, game.intel.totalLaws)
    }
  }
  requestAnimationFrame(frame)
}

void boot(hexToSeed(location.hash.slice(1)) ?? randomSeed())
requestAnimationFrame(frame)
