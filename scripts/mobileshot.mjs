/** Mobile-viewport screenshot via CDP device emulation.
 * Usage: node scripts/mobileshot.mjs <hex> <out.png> [setupB64] [scrollY] */
import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'

const [seed = '7F03C8B6', out = '/tmp/m.png', setupB64 = '', scrollY = '0'] = process.argv.slice(2)
const PORT = 9381
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox',
  `--remote-debugging-port=${PORT}`, `http://localhost:5174/#${seed}`,
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
const ev = (c, e) => c.send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }).then((r) => r?.result?.value)

try {
  const page = await target()
  const c = client(page.webSocketDebuggerUrl)
  await c.ready
  await c.send('Runtime.enable')
  await c.send('Emulation.setDeviceMetricsOverride', {
    width: 390, height: 844, deviceScaleFactor: 3, mobile: true,
  })
  await c.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
  for (let i = 0; i < 80; i++) { if (await ev(c, 'window.__axiom?.game?.phase')) break; await sleep(500) }
  if (setupB64) {
    await c.send('Runtime.evaluate', { expression: Buffer.from(setupB64, 'base64').toString('utf8'), awaitPromise: true })
    await sleep(500)
  }
  if (scrollY !== '0') { await ev(c, `window.scrollTo(0, ${Number(scrollY)})`); await sleep(200) }
  const shot = await c.send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(out, Buffer.from(shot.data, 'base64'))
  console.log('wrote', out)
} catch (e) {
  console.error('ERR', e.message); process.exitCode = 1
} finally {
  chrome.kill('SIGKILL')
}
