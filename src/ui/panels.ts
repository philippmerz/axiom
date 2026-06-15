import { CONFIG } from '../core/config'
import { fmtClock, fmtCredits, fmtPrice } from '../core/format'
import { findContactRule } from '../core/objective'
import { seedToHex } from '../core/rng'
import type { Game, GameResult } from '../core/game'

export interface PanelHooks {
  onEngage: () => void
  onRetry: () => void
  onNew: () => void
  onLoadSeed: (hex: string) => void
}

function el<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T
}

/** All DOM chrome: header, objective block, market rows, log, tools, and the
 * briefing / debrief / generating overlay. Renders from game state only. */
export class Panels {
  private readonly protocolId = el('protocol-id')
  private readonly clock = el('clock')
  private readonly credits = el('credits')
  private readonly objectiveBody = el('objective-body')
  private readonly marketRows = el('market-rows')
  private readonly logLines = el('log-lines')
  private readonly tools = el('tools')
  private readonly hudTool = el('hud-tool')
  private readonly hudHint = el('hud-hint')
  private readonly overlay = el('overlay')
  private readonly overlayCard = el('overlay-card')
  private readonly mobileSpecies = el('mobile-species')
  private readonly mPause = el('m-pause')
  private readonly mRepel = el('m-repel')

  private game!: Game
  private sparks: Array<{ canvas: HTMLCanvasElement; drawn: number }> = []
  private renderedSeq = -1 // highest log entry seq appended to the DOM
  private glyphColor = new Map<string, string>()

  constructor(private readonly hooks: PanelHooks) {
    // mobile bottom-bar controls (hidden on desktop via CSS)
    this.mPause.addEventListener('click', () => this.game?.togglePause())
    this.mRepel.addEventListener('click', () => {
      if (this.game) this.game.repelMode = !this.game.repelMode
    })
    el('m-retry').addEventListener('click', this.hooks.onRetry)
    el('m-new').addEventListener('click', this.hooks.onNew)
  }

  bind(game: Game): void {
    this.game = game
    this.renderedSeq = -1
    this.logLines.innerHTML = ''
    const hex = seedToHex(game.session.seed)
    this.protocolId.textContent = `0x${hex}`
    this.protocolId.onclick = () => {
      void navigator.clipboard?.writeText(hex).catch(() => {})
      this.protocolId.classList.add('copied')
      setTimeout(() => this.protocolId.classList.remove('copied'), 1200)
    }
    this.glyphColor = new Map(game.species.map((s) => [s.glyph, s.color]))
    this.buildMarket()
    this.buildTools()
    this.buildMobileSpecies()
  }

  /** Thumb-zone species selector for the mobile bottom bar (mirrors the
   * market rows' select-on-tap; hidden on desktop). */
  private buildMobileSpecies(): void {
    this.mobileSpecies.innerHTML = ''
    for (const s of this.game.species) {
      const chip = document.createElement('button')
      chip.className = 'm-swatch'
      chip.dataset['species'] = String(s.id)
      chip.innerHTML = `<span class="dot" style="background:${s.color}"></span><span style="color:${s.color}">${s.glyph}</span>`
      chip.addEventListener('click', () => {
        this.game.selected = s.id
      })
      this.mobileSpecies.appendChild(chip)
    }
  }

  /** A "PROTOCOL [hex] LOAD" row — loading a seed reproduces the entire
   * session (rules, objective, trajectory all derive from it). */
  private seedLoadRow(currentHex: string): string {
    return (
      `<div class="seed-load">PROTOCOL ` +
      `<input id="seed-input" maxlength="8" spellcheck="false" value="${currentHex}" />` +
      `<button id="seed-load-btn">LOAD</button></div>`
    )
  }

  private wireSeedLoad(): void {
    const input = document.getElementById('seed-input') as HTMLInputElement | null
    const btn = document.getElementById('seed-load-btn')
    if (!input || !btn) return
    const submit = () => this.hooks.onLoadSeed(input.value.trim())
    btn.addEventListener('click', submit)
    input.addEventListener('keydown', (e) => {
      e.stopPropagation() // don't let tool/q/e/r/n keys fire while typing a seed
      if (e.key === 'Enter') submit()
    })
  }

  /** Wrap every species glyph in its color — keeps text scannable when the
   * log talks about five different Greek letters at once. */
  private colorize(text: string): string {
    let html = text.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c] as string)
    for (const [glyph, color] of this.glyphColor) {
      html = html.replaceAll(glyph, `<span style="color:${color}">${glyph}</span>`)
    }
    return html
  }

  // ---- static builds ----

  private buildMarket(): void {
    this.marketRows.innerHTML = ''
    this.sparks = []
    for (const s of this.game.species) {
      const row = document.createElement('div')
      row.className = 'mkt-row'
      row.dataset['species'] = String(s.id)
      row.title = s.name
      const spark = document.createElement('canvas')
      spark.className = 'mkt-spark'
      row.innerHTML =
        `<span class="mkt-swatch" style="background:${s.color}"></span>` +
        `<span class="mkt-name" style="color:${s.color}">${s.glyph}</span>` +
        `<span class="mkt-pop"></span>` +
        `<span class="mkt-price"></span>`
      row.appendChild(spark)
      const trend = document.createElement('span')
      trend.className = 'mkt-trend'
      row.appendChild(trend)
      row.addEventListener('click', () => {
        this.game.selected = s.id
      })
      this.marketRows.appendChild(row)
      this.sparks.push({ canvas: spark, drawn: 0 })
    }
  }

  private buildTools(): void {
    const defs: Array<[string, string]> = [
      ['deploy', 'DEPLOY'],
      ['extract', 'EXTRACT'],
      ['echo', 'ECHO'],
      ['scan', 'SCAN'],
    ]
    this.tools.innerHTML = ''
    defs.forEach(([tool, label], i) => {
      const b = document.createElement('button')
      b.className = 'tool'
      b.dataset['tool'] = tool
      b.innerHTML = `<span class="key">${i + 1}</span> ${label}<br><span class="tool-cost"></span>`
      b.addEventListener('click', () => {
        this.game.tool = tool as Game['tool']
      })
      this.tools.appendChild(b)
    })
  }

  // ---- per-frame update ----

  update(): void {
    const g = this.game
    const timeLeft = g.session.objective.deadline - g.time
    this.clock.textContent = fmtClock(timeLeft)
    this.clock.classList.toggle('low', timeLeft < 60 && (g.phase === 'running' || g.phase === 'paused'))
    this.credits.textContent = `CR ${fmtCredits(g.credits)}`
    this.updateObjective()
    this.updateMarket()
    this.updateLog()
    this.updateTools()
    this.updateHud()
    this.updateMobile()
  }

  private updateMobile(): void {
    const g = this.game
    for (const chip of this.mobileSpecies.children) {
      const el = chip as HTMLElement
      el.classList.toggle('selected', Number(el.dataset['species']) === g.selected)
    }
    this.mPause.classList.toggle('active', g.phase === 'paused')
    this.mPause.textContent = g.phase === 'paused' ? '▶ RESUME' : '❚❚ PAUSE'
    this.mRepel.classList.toggle('active', g.repelMode)
  }

  private updateObjective(): void {
    const g = this.game
    const { primary, constraint } = g.session.objective
    const t = g.tracker
    const counts = g.sim.world.counts
    const glyph = (s: number) => g.species[s]?.glyph ?? '?'

    let pText = ''
    let pNow = ''
    switch (primary.kind) {
      case 'amplify':
        pText = `AMPLIFY ${glyph(primary.species)} ≥ ${primary.target}`
        pNow = t.primaryMet
          ? `HOLD ${Math.max(0, t.holdLeft).toFixed(1)}S`
          : `NOW ${counts[primary.species]}`
        break
      case 'suppress':
        pText = `SUPPRESS ${glyph(primary.species)} ⇒ 0`
        pNow = t.primaryMet
          ? `HOLD ${Math.max(0, t.holdLeft).toFixed(1)}S`
          : `NOW ${counts[primary.species]}`
        break
      case 'accumulate':
        pText = `ACCUMULATE ≥ CR ${fmtCredits(primary.credits)}`
        pNow = `NOW ${fmtCredits(g.credits)}`
        break
      case 'catalyze': {
        const rule = findContactRule(g.session.ruleset, primary.ruleKey)
        pText = rule
          ? `CATALYZE ${glyph(rule.a)}·${glyph(rule.b)} × ${primary.target}`
          : `CATALYZE × ${primary.target}`
        pNow = `${t.fireCount}/${primary.target}`
        break
      }
    }

    const cGlyph = glyph(constraint.species)
    const cText =
      constraint.kind === 'contain'
        ? `CONTAIN ${cGlyph} ≤ ${constraint.max}`
        : `PRESERVE ${cGlyph} ≥ ${constraint.min}`
    const cNow = t.violating
      ? `FAIL IN ${Math.max(0, t.graceLeft).toFixed(1)}S`
      : `NOW ${counts[constraint.species]}`

    this.objectiveBody.innerHTML =
      `<div class="obj-line">` +
      `<span class="obj-glyph ${t.primaryMet ? 'ok' : ''}">◆</span>` +
      `<span class="obj-text">${this.colorize(pText)}</span>` +
      `<span class="obj-progress ${t.primaryMet ? 'ok' : ''}">${pNow}</span></div>` +
      `<div class="obj-line">` +
      `<span class="obj-glyph ${t.violating ? 'bad' : ''}">▣</span>` +
      `<span class="obj-text">${this.colorize(cText)}</span>` +
      `<span class="obj-progress ${t.violating ? 'bad' : ''}">${cNow}</span></div>`
  }

  private updateMarket(): void {
    const g = this.game
    const rows = this.marketRows.children
    for (let s = 0; s < g.species.length; s++) {
      const row = rows[s] as HTMLElement | undefined
      if (!row) continue
      row.classList.toggle('selected', g.selected === s)
      const pop = g.sim.world.counts[s] as number
      const popEl = row.querySelector('.mkt-pop') as HTMLElement
      popEl.textContent = String(pop)
      popEl.classList.toggle('mkt-extinct', pop === 0)
      const priceEl = row.querySelector('.mkt-price') as HTMLElement
      priceEl.textContent = fmtPrice(g.market.ask(s))
      const trend = g.market.trend(s)
      priceEl.className = `mkt-price ${trend > 0 ? 'up' : trend < 0 ? 'down' : ''}`
      const trendEl = row.querySelector('.mkt-trend') as HTMLElement
      trendEl.textContent = trend > 0 ? '▲' : trend < 0 ? '▼' : '·'
      trendEl.style.color = trend > 0 ? 'var(--ok)' : trend < 0 ? 'var(--alert)' : 'var(--text-dim)'
      this.drawSpark(s)
    }
  }

  private drawSpark(s: number): void {
    const entry = this.sparks[s]
    const history = this.game.market.history[s]
    const samples = this.game.market.samples
    const dpr = window.devicePixelRatio || 1
    const c = entry?.canvas
    if (!entry || !history || !c) return
    const w = c.clientWidth || 60
    const h = c.clientHeight || 14
    const dprStale = c.width !== Math.round(w * dpr)
    // redraw on a new sample (history is a capped ring, so length stops
    // changing — key on the monotonic sample count) or a DPR change
    if (samples === entry.drawn && !dprStale) return
    entry.drawn = samples
    if (dprStale) {
      c.width = Math.round(w * dpr)
      c.height = Math.round(h * dpr)
    }
    const ctx = c.getContext('2d') as CanvasRenderingContext2D
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)
    const min = Math.min(...history)
    const max = Math.max(...history)
    const span = Math.max(0.001, max - min)
    ctx.strokeStyle = '#3d4854'
    ctx.lineWidth = 1
    ctx.beginPath()
    history.forEach((p, i) => {
      const x = (i / (CONFIG.market.sparkTicks - 1)) * w
      const y = h - 2 - ((p - min) / span) * (h - 4)
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    })
    ctx.stroke()
  }

  private updateLog(): void {
    const g = this.game
    const atBottom =
      this.logLines.scrollTop + this.logLines.clientHeight >= this.logLines.scrollHeight - 8
    // append every entry newer than what we've shown — the log array is a
    // capped ring, so we key on monotonic seq, not array length
    for (const entry of g.log) {
      if (entry.seq <= this.renderedSeq) continue
      this.renderedSeq = entry.seq
      const line = document.createElement('div')
      line.className = `log-line ${entry.cls}`
      line.innerHTML =
        `<span class="log-time">${entry.time.toFixed(0).padStart(3, '0')}</span>` +
        `<span class="log-msg">${this.colorize(entry.msg)}</span>`
      this.logLines.appendChild(line)
      while (this.logLines.children.length > 120) this.logLines.firstChild?.remove()
    }
    if (atBottom) this.logLines.scrollTop = this.logLines.scrollHeight
  }

  private updateTools(): void {
    const g = this.game
    for (const b of this.tools.children) {
      const btn = b as HTMLElement
      const tool = btn.dataset['tool']
      btn.classList.toggle('active', g.tool === tool)
      const cost = btn.querySelector('.tool-cost') as HTMLElement
      switch (tool) {
        case 'deploy':
          cost.textContent = `−${fmtPrice(g.market.ask(g.selected))}`
          break
        case 'extract':
          cost.textContent = g.extractReady() >= 1 ? '+BID' : '···'
          break
        case 'echo':
          cost.textContent = `−${CONFIG.echoCost}`
          break
        case 'scan':
          cost.textContent = `−${g.intel.scanCost()}`
          break
      }
    }
  }

  private updateHud(): void {
    const g = this.game
    const glyph = g.species[g.selected]?.glyph ?? '?'
    let tool = ''
    let hint = ''
    switch (g.tool) {
      case 'deploy':
        tool = `DEPLOY ${glyph}`
        hint = `CLICK TO PLACE AT ASK · Q/E SELECT CLASS`
        break
      case 'extract':
        tool = 'EXTRACT'
        hint = g.extractReady() >= 1 ? 'CLICK DOT — SELLS AT BID' : 'RECHARGING'
        break
      case 'echo':
        tool = `ECHO ${glyph}`
        hint = `PHANTOM ${glyph} — REACTION UNKNOWN · ⇧CLICK FLAT REPULSOR −${CONFIG.flatCost}`
        break
      case 'scan':
        tool = `SCAN −${g.intel.scanCost()}`
        hint = 'CLICK DOT: LIFECYCLE · DRAG DOT→DOT: PAIR LAW'
        break
    }
    this.hudTool.innerHTML = this.colorize(tool)
    this.hudHint.textContent =
      g.phase === 'paused' ? 'PAUSED — TAP TO QUEUE MOVES, RESUME TO EXECUTE' : hint
  }

  // ---- overlays ----

  generating(seed: number, attempt: number): void {
    this.overlay.classList.remove('hidden')
    this.overlayCard.innerHTML =
      `<h1>AXIOM <span class="accent">// 0x${seedToHex(seed)}</span></h1>` +
      `<div class="brief-row dim">CALIBRATING PROTOCOL — CANDIDATE ${String(attempt + 1).padStart(2, '0')}</div>`
  }

  briefing(game: Game): void {
    this.bind(game)
    const o = game.session.objective
    const k = game.species.length
    const glyph = (s: number) => game.species[s]?.glyph ?? '?'
    let pText = ''
    switch (o.primary.kind) {
      case 'amplify':
        pText = `AMPLIFY ${glyph(o.primary.species)} TO ≥ ${o.primary.target} AND HOLD ${o.holdSeconds}S`
        break
      case 'suppress':
        pText = `SUPPRESS ${glyph(o.primary.species)} TO 0 AND HOLD ${o.holdSeconds}S`
        break
      case 'accumulate':
        pText = `ACCUMULATE CR ${fmtCredits(o.primary.credits)}`
        break
      case 'catalyze': {
        const rule = findContactRule(game.session.ruleset, o.primary.ruleKey)
        pText = rule
          ? `CATALYZE ${o.primary.target} REACTIONS BETWEEN ${glyph(rule.a)} AND ${glyph(rule.b)}`
          : ''
        break
      }
    }
    const cText =
      o.constraint.kind === 'contain'
        ? `CONTAIN ${glyph(o.constraint.species)} ≤ ${o.constraint.max}`
        : `PRESERVE ${glyph(o.constraint.species)} ≥ ${o.constraint.min}`
    this.overlay.classList.remove('hidden')
    this.overlayCard.innerHTML =
      `<h1>AXIOM <span class="accent">// 0x${seedToHex(game.session.seed)}</span></h1>` +
      `<div class="brief-row">${k} ENTITY CLASSES — <b>ALL LAWS UNKNOWN</b></div>` +
      `<div class="brief-row">OBJECTIVE — <b>${this.colorize(pText)}</b></div>` +
      `<div class="brief-row">CONSTRAINT — <b>${this.colorize(cText)}</b> (BREACH > ${o.graceSeconds}S = FAILURE)</div>` +
      `<div class="brief-row dim">FUNDS CR ${fmtCredits(CONFIG.startCredits)} · DEADLINE ${fmtClock(o.deadline)} · RUN ${game.run}</div>` +
      `<button class="engage" id="engage-btn">ENGAGE</button>` +
      this.seedLoadRow(seedToHex(game.session.seed))
    el('engage-btn').addEventListener('click', this.hooks.onEngage)
    this.wireSeedLoad()
  }

  debrief(result: GameResult, lawsKnown: number, lawsTotal: number): void {
    this.overlay.classList.remove('hidden')
    const head = result.won
      ? `<div class="grade win">GRADE ${result.grade}</div>`
      : `<div class="grade fail">FAILED</div>`
    this.overlayCard.innerHTML =
      `<h1>SESSION ${result.won ? 'COMPLETE' : 'TERMINATED'}</h1>` +
      head +
      `<div class="brief-row">${result.reason}</div>` +
      `<div class="brief-row dim">T${result.timeLeft > 0 ? '−' : '+'}${fmtClock(result.timeLeft).slice(2)} REMAINING · CR ${fmtCredits(result.credits)} · LAWS ${lawsKnown}/${lawsTotal} · RUN ${result.run}</div>` +
      `<button class="engage" id="retry-btn">R RETRY</button> ` +
      `<button class="engage" id="new-btn">N NEW PROTOCOL</button>` +
      this.seedLoadRow(seedToHex(this.game.session.seed))
    el('retry-btn').addEventListener('click', this.hooks.onRetry)
    el('new-btn').addEventListener('click', this.hooks.onNew)
    this.wireSeedLoad()
  }

  hideOverlay(): void {
    this.overlay.classList.add('hidden')
  }
}
