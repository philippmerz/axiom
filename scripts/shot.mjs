/** Real-time headless screenshot. Loads a seed, waits for briefing, runs
 * optional setup JS, captures PNG. Usage: node scripts/shot.mjs <hex> <out.png> [setupJsBase64] */
import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'

const [seed = '99CB56C7', out = '/tmp/shot.png', setupB64 = ''] = process.argv.slice(2)
const PORT = 9361
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox',
  `--remote-debugging-port=${PORT}`, '--window-size=1280,800', '--hide-scrollbars',
  `http://localhost:5174/#${seed}`,
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
  return { ready, send, close: () => ws.close() }
}

try {
  const page = await target()
  const c = client(page.webSocketDebuggerUrl)
  await c.ready
  await c.send('Runtime.enable')
  let phase = null
  for (let i = 0; i < 80; i++) {
    const r = await c.send('Runtime.evaluate', { expression: 'window.__axiom?.game?.phase ?? null', returnByValue: true })
    phase = r?.result?.value
    if (phase) break
    await sleep(500)
  }
  if (setupB64) {
    const js = Buffer.from(setupB64, 'base64').toString('utf8')
    await c.send('Runtime.evaluate', { expression: js, awaitPromise: true })
    await sleep(600)
  }
  const shot = await c.send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(out, Buffer.from(shot.data, 'base64'))
  console.log('wrote', out, 'phase', phase)
  c.close()
} catch (e) {
  console.error('ERR', e.message); process.exitCode = 1
} finally {
  chrome.kill('SIGKILL')
}
