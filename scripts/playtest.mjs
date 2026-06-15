/** Real-time headless gameplay smoke test via Chrome DevTools Protocol.
 * Launches Chrome with remote debugging, loads a seed, engages, drives a few
 * tool actions, and asserts the game state stays sane (no NaN, no throw,
 * credits finite, dots present). Usage: node scripts/playtest.mjs [hex] */
import { spawn } from 'node:child_process'

const SEED = process.argv[2] ?? '99CB56C7'
const PORT = 9351
const URL = `http://localhost:5174/#${SEED}`
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const chrome = spawn(CHROME, [
  '--headless=new',
  '--disable-gpu',
  '--no-sandbox',
  `--remote-debugging-port=${PORT}`,
  '--window-size=1280,800',
  URL,
])
chrome.on('error', (e) => { console.error('chrome spawn failed', e); process.exit(2) })

async function cdpTarget() {
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`http://localhost:${PORT}/json`)
      const targets = await res.json()
      const page = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
      if (page) return page
    } catch {
      // chrome not up yet
    }
    await sleep(250)
  }
  throw new Error('no CDP page target')
}

function client(wsUrl) {
  const ws = new WebSocket(wsUrl)
  let id = 0
  const pending = new Map()
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data)
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg.result)
      pending.delete(msg.id)
    }
  })
  const ready = new Promise((r) => ws.addEventListener('open', r))
  const send = (method, params = {}) =>
    new Promise((resolve) => {
      const myId = ++id
      pending.set(myId, resolve)
      ws.send(JSON.stringify({ id: myId, method, params }))
    })
  return { ready, send, close: () => ws.close() }
}

const evalJs = (c, expr) =>
  c.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
    .then((r) => r?.result?.value)

try {
  const page = await cdpTarget()
  const c = client(page.webSocketDebuggerUrl)
  await c.ready
  await c.send('Runtime.enable')

  // wait for generation (worker) to finish → briefing phase
  let phase = null
  for (let i = 0; i < 80; i++) {
    phase = await evalJs(c, 'window.__axiom?.game?.phase ?? null')
    if (phase === 'briefing') break
    await sleep(500)
  }
  if (phase !== 'briefing') throw new Error(`stuck before briefing (phase=${phase})`)
  const genInfo = await evalJs(c, 'JSON.stringify({rej: window.__axiom.game.session.rejected, kind: window.__axiom.game.session.objective.primary.kind, laws: window.__axiom.game.intel.totalLaws})')
  console.log('generated:', genInfo)

  // engage and run real-time, exercising tools
  await evalJs(c, 'window.__axiom.engage()')
  await sleep(300)
  // drive: deploy a few, extract, echo, scan a pair, advance time
  await evalJs(c, `(() => {
    const g = window.__axiom.game
    g.tool = 'deploy'; g.deployAt(360, 360); g.deployAt(380, 360)
    g.tool = 'echo'; g.echoAt(300, 300, false)
    g.tool = 'extract'; g.cursorX = 360; g.cursorY = 360; g.extractAt(360, 360)
    return 1
  })()`)
  await sleep(2500) // let the sim run ~2.5s real time

  const state = await evalJs(c, `(() => {
    const g = window.__axiom.game
    const w = g.sim.world
    const anyNaN = w.dots.some(d => !Number.isFinite(d.x+d.y+d.vx+d.vy))
    return JSON.stringify({
      phase: g.phase, time: +g.time.toFixed(1), dots: w.dots.length,
      credits: +g.credits.toFixed(1), creditsFinite: Number.isFinite(g.credits),
      counts: w.counts, anyNaN,
      prices: g.species.map((_,s)=>+g.market.ask(s).toFixed(1)),
      pricesFinite: g.species.every((_,s)=>Number.isFinite(g.market.ask(s)) && g.market.ask(s) > 0),
      logLen: g.log.length,
    })
  })()`)
  console.log('after-play:', state)
  const s = JSON.parse(state)

  const fail = []
  if (s.anyNaN) fail.push('NaN in dots')
  if (!s.creditsFinite) fail.push('credits not finite')
  if (!s.pricesFinite) fail.push('prices not finite/positive')
  if (s.dots < 5) fail.push('field nearly empty')
  if (s.time < 2) fail.push('time did not advance')

  c.close()
  console.log(fail.length ? 'FAIL: ' + fail.join('; ') : 'PASS')
  process.exitCode = fail.length ? 1 : 0
} catch (e) {
  console.error('ERROR', e.message)
  process.exitCode = 2
} finally {
  chrome.kill('SIGKILL')
}
