/** Generate PWA icons at exact sizes via CDP device-metrics (avoids Chrome's
 * minimum window-size cropping). Renders the dossier-ring mark. */
import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'

const PORT = 9391
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const SVG = `<!doctype html><html><head><meta charset="utf8"><style>
html,body{margin:0;padding:0;width:100%;height:100%;background:#050608;overflow:hidden}
svg{display:block;width:100vw;height:100vh}</style></head><body>
<svg viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
<rect width="512" height="512" fill="#050608"/>
<g stroke="#5fd8eb" stroke-opacity="0.18" stroke-width="2" fill="none">
<polygon points="256,108 386,183 386,329 256,404 126,329 126,183"/>
<line x1="256" y1="108" x2="256" y2="404"/><line x1="386" y1="183" x2="126" y2="329"/>
<line x1="386" y1="329" x2="126" y2="183"/></g>
<g><circle cx="256" cy="108" r="30" fill="#ececec"/><circle cx="386" cy="183" r="30" fill="#e05299"/>
<circle cx="386" cy="329" r="30" fill="#8be05a"/><circle cx="256" cy="404" r="30" fill="#8b7bf7"/>
<circle cx="126" cy="329" r="30" fill="#4f86f7"/><circle cx="126" cy="183" r="30" fill="#f08c42"/></g>
<circle cx="256" cy="256" r="9" fill="#5fd8eb"/></svg></body></html>`

const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', `--remote-debugging-port=${PORT}`, 'about:blank'])
async function target() {
  for (let i = 0; i < 40; i++) {
    try { const t = await (await fetch(`http://localhost:${PORT}/json`)).json(); const p = t.find((x) => x.type === 'page'); if (p?.webSocketDebuggerUrl) return p } catch {}
    await sleep(250)
  }
  throw new Error('no target')
}
function client(wsUrl) {
  const ws = new WebSocket(wsUrl); let id = 0; const pending = new Map()
  ws.addEventListener('message', (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id) } })
  const ready = new Promise((r) => ws.addEventListener('open', r))
  const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })) })
  return { ready, send }
}
try {
  const page = await target()
  const c = client(page.webSocketDebuggerUrl)
  await c.ready
  await c.send('Page.enable')
  await c.send('Page.navigate', { url: 'data:text/html;charset=utf-8,' + encodeURIComponent(SVG) })
  await sleep(600)
  for (const size of [192, 512]) {
    await c.send('Emulation.setDeviceMetricsOverride', { width: size, height: size, deviceScaleFactor: 1, mobile: false })
    await sleep(120)
    const shot = await c.send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: size, height: size, scale: 1 } })
    writeFileSync(`/Users/philipp/IdeaProjects/iq/public/icon-${size}.png`, Buffer.from(shot.data, 'base64'))
    console.log('wrote icon-' + size + '.png')
  }
} catch (e) {
  console.error('ERR', e.message); process.exitCode = 1
} finally {
  chrome.kill('SIGKILL')
}
