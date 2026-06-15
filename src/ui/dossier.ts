import { describeRule } from '../core/format'
import type { Game } from '../core/game'
import type { ContactRule, ForceRule, Rule, Species } from '../core/types'

/** The intel board: species as nodes on a ring, confirmed laws as typed
 * edges. Contact laws witnessed once or twice appear as faint mystery lines —
 * you know *something* happens there, not what. */
export class DossierRenderer {
  private readonly ctx: CanvasRenderingContext2D
  private cssW = 0
  private cssH = 0

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly legend: HTMLElement,
  ) {
    this.ctx = canvas.getContext('2d') as CanvasRenderingContext2D
  }

  resize(cssW: number): void {
    const dpr = window.devicePixelRatio || 1
    this.cssW = cssW
    this.cssH = Math.round(cssW * 0.68)
    this.canvas.width = Math.round(cssW * dpr)
    this.canvas.height = Math.round(this.cssH * dpr)
    this.canvas.style.width = `${cssW}px`
    this.canvas.style.height = `${this.cssH}px`
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  }

  render(game: Game): void {
    const ctx = this.ctx
    const species = game.species
    const k = species.length
    const cx = this.cssW / 2
    const cy = this.cssH / 2
    const radius = Math.min(this.cssW, this.cssH) * 0.36
    ctx.clearRect(0, 0, this.cssW, this.cssH)

    const pos = (s: number): [number, number] => {
      const angle = -Math.PI / 2 + (s / k) * Math.PI * 2
      return [cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius]
    }

    const known = game.intel.knownRules()
    for (const rule of known) {
      if (rule.kind === 'force') this.forceEdge(rule, pos, species)
    }
    for (const rule of known) {
      if (rule.kind === 'contact') this.contactEdge(rule, pos, species, false)
    }
    // mystery lines: witnessed but unconfirmed contact laws
    for (const rule of game.session.ruleset.contacts) {
      if (!game.intel.knows(rule) && game.intel.seenCount(rule) > 0) {
        this.contactEdge(rule, pos, species, true)
      }
    }
    for (const rule of known) {
      if (rule.kind === 'fission' || rule.kind === 'decay') this.unaryMark(rule, pos, species)
    }

    // nodes on top
    for (const s of species) {
      const [x, y] = pos(s.id)
      ctx.fillStyle = s.color
      ctx.beginPath()
      ctx.arc(x, y, 3.5, 0, Math.PI * 2)
      ctx.fill()
      ctx.font = '10px ui-monospace, monospace'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      const lx = cx + (x - cx) * 1.22
      const ly = cy + (y - cy) * 1.22
      ctx.fillText(s.glyph, lx, ly)
    }

    this.updateLegend(game, known)
  }

  private forceEdge(rule: ForceRule, pos: (s: number) => [number, number], species: Species[]): void {
    const ctx = this.ctx
    const [x0, y0] = pos(rule.self)
    const [x1, y1] = pos(rule.other)
    // bow the arc so A→B and B→A don't overlap
    const mx = (x0 + x1) / 2 + (y1 - y0) * 0.18
    const my = (y0 + y1) / 2 - (x1 - x0) * 0.18
    ctx.strokeStyle = rule.strength > 0 ? '#9be564' : '#e8442a'
    ctx.globalAlpha = Math.abs(rule.strength) >= 0.5 ? 0.55 : 0.3
    ctx.setLineDash([3, 4])
    ctx.beginPath()
    ctx.moveTo(x0, y0)
    ctx.quadraticCurveTo(mx, my, x1, y1)
    ctx.stroke()
    ctx.setLineDash([])
    if (rule.gate) {
      ctx.fillStyle = species[rule.gate.species]?.color ?? '#fff'
      ctx.fillRect(mx - 2, my - 2, 4, 4) // condition marker in gate color
    }
    ctx.globalAlpha = 1
  }

  private contactEdge(
    rule: ContactRule,
    pos: (s: number) => [number, number],
    species: Species[],
    mystery: boolean,
  ): void {
    const ctx = this.ctx
    if (rule.a === rule.b) {
      // self-law: small loop beside the node
      const [x, y] = pos(rule.a)
      ctx.strokeStyle = mystery ? '#4d555e' : '#9aa3ab'
      ctx.globalAlpha = mystery ? 0.35 : 0.7
      ctx.beginPath()
      ctx.arc(x + 8, y - 8, 6, 0, Math.PI * 2)
      ctx.stroke()
      if (!mystery) this.outcomeMark(rule, x + 8, y - 16, species)
      ctx.globalAlpha = 1
      return
    }
    const [x0, y0] = pos(rule.a)
    const [x1, y1] = pos(rule.b)
    if (mystery) {
      ctx.strokeStyle = '#4d555e'
      ctx.globalAlpha = 0.35
      ctx.setLineDash([2, 5])
      ctx.beginPath()
      ctx.moveTo(x0, y0)
      ctx.lineTo(x1, y1)
      ctx.stroke()
      ctx.setLineDash([])
      ctx.fillStyle = '#4d555e'
      ctx.font = '9px ui-monospace, monospace'
      ctx.fillText('?', (x0 + x1) / 2, (y0 + y1) / 2 - 4)
      ctx.globalAlpha = 1
      return
    }
    ctx.strokeStyle = '#9aa3ab'
    ctx.globalAlpha = 0.7
    ctx.beginPath()
    ctx.moveTo(x0, y0)
    ctx.lineTo(x1, y1)
    ctx.stroke()
    ctx.globalAlpha = 1
    this.outcomeMark(rule, (x0 + x1) / 2, (y0 + y1) / 2, species)
  }

  /** Outcome glyph at the edge midpoint, colored by the species the outcome
   * is "about" — the product, or the consumed party. */
  private outcomeMark(rule: ContactRule, x: number, y: number, species: Species[]): void {
    const ctx = this.ctx
    const o = rule.outcome
    const subject = o.kind === 'consume' ? rule.b : o.kind === 'spawn' ? o.child : o.into
    const glyph =
      o.kind === 'consume' ? '✕' : o.kind === 'convert' ? '⇒' : o.kind === 'spawn' ? '+' : '⊕'
    ctx.fillStyle = '#07090c'
    ctx.fillRect(x - 5, y - 5, 10, 10)
    ctx.fillStyle = species[subject]?.color ?? '#fff'
    ctx.font = '9px ui-monospace, monospace'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(glyph, x, y)
  }

  private unaryMark(
    rule: Extract<Rule, { kind: 'fission' | 'decay' }>,
    pos: (s: number) => [number, number],
    species: Species[],
  ): void {
    const ctx = this.ctx
    const [x, y] = pos(rule.species)
    ctx.font = '9px ui-monospace, monospace'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    if (rule.kind === 'fission') {
      ctx.fillStyle = species[rule.species]?.color ?? '#fff'
      ctx.fillText('×2', x, y - 11)
    } else {
      ctx.fillStyle = rule.into === null ? '#4d555e' : species[rule.into]?.color ?? '#fff'
      ctx.fillText('†', x, y - 11)
    }
  }

  private updateLegend(game: Game, known: Rule[]): void {
    const counter = `LAWS ${game.intel.knownLaws}/${game.intel.totalLaws} KNOWN`
    if (known.length === 0) {
      this.legend.textContent = `${counter} — LAWS APPEAR AS WITNESSED`
      return
    }
    // cycle through known laws so the board explains itself
    const idx = Math.floor(game.time / 3) % known.length
    const rule = known[idx] as Rule
    this.legend.textContent = `${counter} · ${describeRule(rule, game.species)}`
  }
}
