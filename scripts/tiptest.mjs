/** Verify the dossier hover tooltip: confirm a law, sweep the pointer over the
 * dossier canvas, assert the tooltip becomes visible with natural-language text.
 * Usage: node scripts/tiptest.mjs [hex] */
import { spawn } from 'node:child_process'

const SEED = process.argv[2] ?? '7F03C8B6'
const PORT = 9371
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox',
  `--remote-debugging-port=${PORT}`, '--window-size=1280,800',
  `http://localhost:5174/#${SEED}`,
])

async function target() {
  for (let i = 0; i < 40; i++) {
    try {
      const t = await (await fetch(`http://localhost:${PORT}/json`)).json()
      const p = t.find((x) => x.type === 'page' && x.webSocketDebuggerUrl)
      if (p) return p
    } catch {}
    await sleep(250)
  }
  throw new Error('no target')
}
function client(wsUrl) {
  const ws = new WebSocket(wsUrl)
  let id = 0
  const pending = new Map()
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data)
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id) }
  })
  const ready = new Promise((r) => ws.addEventListener('open', r))
  const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })) })
  return { ready, send }
}
const evalJs = (c, e) => c.send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }).then((r) => r?.result?.value)

try {
  const page = await target()
  const c = client(page.webSocketDebuggerUrl)
  await c.ready
  await c.send('Runtime.enable')
  for (let i = 0; i < 80; i++) { if (await evalJs(c, 'window.__axiom?.game?.phase')) break; await sleep(500) }

  const result = await evalJs(c, `(async () => {
    const g = window.__axiom.game
    window.__axiom.engage()
    // confirm every contact + force law so the dossier is fully drawn
    for (const cr of g.session.ruleset.contacts) g.intel.scanPair(cr.a, cr.b)
    for (const f of g.session.ruleset.forces) g.intel.known.add('F:'+f.self+'<'+f.other)
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
    const cv = document.getElementById('dossier-canvas')
    const tip = document.getElementById('dossier-tip')
    const r = cv.getBoundingClientRect()
    let hits = 0, sample = null
    for (let gx = 4; gx <= 20; gx++) {
      for (let gy = 3; gy <= 14; gy++) {
        const x = r.left + (r.width * gx) / 24
        const y = r.top + (r.height * gy) / 16
        cv.dispatchEvent(new PointerEvent('pointermove', { clientX: x, clientY: y, bubbles: true }))
        if (!tip.classList.contains('hidden')) { hits++; if (!sample) sample = tip.textContent }
      }
    }
    return JSON.stringify({ hits, sample, laws: g.intel.knownLaws })
  })()`)
  console.log('tooltip test:', result)
  const s = JSON.parse(result)
  console.log(s.hits > 0 && s.sample ? 'PASS' : 'FAIL: no tooltip shown')
  process.exitCode = s.hits > 0 && s.sample ? 0 : 1
} catch (e) {
  console.error('ERR', e.message); process.exitCode = 2
} finally {
  chrome.kill('SIGKILL')
}
