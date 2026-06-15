import { CONFIG } from './core/config'
import { Game } from './core/game'
import { hexToSeed, randomSeed, seedToHex } from './core/rng'
import { generateSession } from './core/rules'
import { DossierRenderer } from './ui/dossier'
import { FieldRenderer } from './ui/field'
import { bindHelp } from './ui/help'
import { bindInput } from './ui/input'
import { Panels } from './ui/panels'
import type { Session } from './core/types'
import type { WorkerOut } from './worker'

function el<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T
}

let game: Game | null = null
let booting = false
let bootToken = 0
const sessionCache = new Map<number, Session>() // R-retry must not re-run validation
const debriefed = new WeakSet<Game>()

/** Generate a session off the main thread. Falls back to synchronous
 * generation if Workers are unavailable. */
function generateAsync(seed: number, onAttempt: (n: number) => void): Promise<Session> {
  if (typeof Worker === 'undefined') {
    return Promise.resolve(generateSession(seed, onAttempt))
  }
  return new Promise((resolve) => {
    const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (e: MessageEvent<WorkerOut>) => {
      if (e.data.type === 'progress') onAttempt(e.data.attempt)
      else {
        worker.terminate()
        resolve(e.data.session)
      }
    }
    worker.postMessage({ seed })
  })
}

const field = new FieldRenderer(el('field'), el('overlay-canvas'))
const dossier = new DossierRenderer(el('dossier-canvas'), el('dossier-legend'), el('dossier-tip'))
const panels = new Panels({ onEngage: engage, onRetry: retry, onNew: fresh, onLoadSeed: loadSeed })
const drag = bindInput(() => game, el('field-stack'), {
  onEngage: engage,
  onRetry: retry,
  onNew: fresh,
})
bindHelp()

function loadSeed(hex: string): void {
  const seed = hexToSeed(hex)
  if (seed === null || booting) return
  void boot(seed)
}

function bumpRun(seed: number): number {
  const key = `axiom-run-${seedToHex(seed)}`
  const run = Number(localStorage.getItem(key) ?? 0) + 1
  localStorage.setItem(key, String(run))
  return run
}

async function boot(seed: number): Promise<void> {
  if (booting) return
  booting = true
  const token = ++bootToken
  game = null
  panels.generating(seed, 0)
  let session = sessionCache.get(seed)
  if (!session) {
    session = await generateAsync(seed, (attempt) => {
      if (token === bootToken) panels.generating(seed, attempt)
    })
    if (token !== bootToken) return // superseded by a newer boot
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

// debug handle for the headless playtest harness (harmless in prod)
;(window as unknown as { __axiom: unknown }).__axiom = {
  get game() {
    return game
  },
  engage,
  loadSeed,
}

void boot(hexToSeed(location.hash.slice(1)) ?? randomSeed())
requestAnimationFrame(frame)
