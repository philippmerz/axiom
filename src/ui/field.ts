import { CONFIG } from '../core/config'
import type { Flash, Game } from '../core/game'

export interface DragState {
  active: boolean
  x0: number
  y0: number
  x1: number
  y1: number
}

/** Two stacked canvases: a persistent trail layer (dots, phosphor fade) and
 * an overlay cleared every frame (beacons, rings, cursor, alarms). Both draw
 * in field coordinates; resize() owns the transform. */
export class FieldRenderer {
  private readonly trail: CanvasRenderingContext2D
  private readonly over: CanvasRenderingContext2D
  private scale = 1

  constructor(
    private readonly trailCanvas: HTMLCanvasElement,
    private readonly overlayCanvas: HTMLCanvasElement,
  ) {
    this.trail = trailCanvas.getContext('2d') as CanvasRenderingContext2D
    this.over = overlayCanvas.getContext('2d') as CanvasRenderingContext2D
  }

  resize(cssSize: number): void {
    const dpr = window.devicePixelRatio || 1
    const px = Math.round(cssSize * dpr)
    for (const c of [this.trailCanvas, this.overlayCanvas]) {
      c.width = px
      c.height = px
      c.style.width = `${cssSize}px`
      c.style.height = `${cssSize}px`
    }
    const stack = this.trailCanvas.parentElement
    if (stack) {
      stack.style.width = `${cssSize}px`
      stack.style.height = `${cssSize}px`
    }
    this.scale = px / CONFIG.fieldSize
  }

  render(game: Game, drag: DragState): void {
    this.renderTrail(game)
    this.renderOverlay(game, drag)
  }

  private renderTrail(game: Game): void {
    const ctx = this.trail
    ctx.setTransform(this.scale, 0, 0, this.scale, 0, 0)
    if (game.phase !== 'paused') {
      ctx.globalCompositeOperation = 'destination-out'
      ctx.fillStyle = 'rgba(0, 0, 0, 0.16)'
      ctx.fillRect(0, 0, CONFIG.fieldSize, CONFIG.fieldSize)
      ctx.globalCompositeOperation = 'source-over'
      const time = game.time
      for (const d of game.sim.world.dots) {
        const species = game.species[d.species]
        if (!species) continue
        ctx.globalAlpha = d.immuneUntil > time ? 0.45 : 1 // refractory dots read as "spent"
        ctx.fillStyle = species.color
        ctx.beginPath()
        ctx.arc(d.x, d.y, CONFIG.dotRadius, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.globalAlpha = 1
    }
  }

  private renderOverlay(game: Game, drag: DragState): void {
    const ctx = this.over
    const size = CONFIG.fieldSize
    ctx.setTransform(this.scale, 0, 0, this.scale, 0, 0)
    ctx.clearRect(0, 0, size, size)

    this.grid(ctx)
    this.beacons(ctx, game)
    for (const f of game.flashes) this.flash(ctx, f, game.time)
    if (game.pending.length > 0) this.queued(ctx, game)
    if (game.phase === 'running' || game.phase === 'paused') this.cursor(ctx, game, drag)
    if (game.tracker.violating && game.phase !== 'briefing') this.alarmBorder(ctx, game)
    if (game.phase === 'paused') this.pausedLabel(ctx, game)
  }

  /** Ghost previews of moves queued during a pause, numbered in fire order. */
  private queued(ctx: CanvasRenderingContext2D, game: Game): void {
    ctx.font = '9px ui-monospace, monospace'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    game.pending.forEach((a, i) => {
      const color =
        a.kind === 'deploy' || a.kind === 'echo'
          ? game.species[a.species]?.color ?? '#fff'
          : a.kind === 'extract'
            ? '#e8442a'
            : '#5fd8eb'
      const x = a.kind === 'scan' ? a.x0 : a.x
      const y = a.kind === 'scan' ? a.y0 : a.y
      ctx.globalAlpha = 0.85
      ctx.strokeStyle = color
      ctx.fillStyle = color
      ctx.setLineDash([3, 3])
      if (a.kind === 'deploy') {
        ctx.beginPath()
        ctx.arc(x, y, CONFIG.dotRadius + 1.5, 0, Math.PI * 2)
        ctx.stroke()
      } else if (a.kind === 'echo') {
        ctx.beginPath()
        ctx.arc(x, y, 8, 0, Math.PI * 2)
        ctx.stroke()
      } else if (a.kind === 'extract') {
        const r = 7
        ctx.beginPath()
        ctx.moveTo(x - r, y - r)
        ctx.lineTo(x + r, y + r)
        ctx.moveTo(x + r, y - r)
        ctx.lineTo(x - r, y + r)
        ctx.stroke()
      } else {
        ctx.beginPath()
        ctx.moveTo(a.x0, a.y0)
        ctx.lineTo(a.x1, a.y1)
        ctx.stroke()
      }
      ctx.setLineDash([])
      ctx.globalAlpha = 0.6
      ctx.fillText(String(i + 1), x + 11, y - 9) // fire-order index
      ctx.globalAlpha = 1
    })
  }

  private grid(ctx: CanvasRenderingContext2D): void {
    const size = CONFIG.fieldSize
    ctx.strokeStyle = '#181d23'
    ctx.lineWidth = 1
    const step = 90
    const arm = 4
    for (let x = step; x < size; x += step) {
      for (let y = step; y < size; y += step) {
        ctx.beginPath()
        ctx.moveTo(x - arm, y)
        ctx.lineTo(x + arm, y)
        ctx.moveTo(x, y - arm)
        ctx.lineTo(x, y + arm)
        ctx.stroke()
      }
    }
  }

  private beacons(ctx: CanvasRenderingContext2D, game: Game): void {
    for (const b of game.sim.world.beacons) {
      const lifeLeft = (b.expiresAt - game.time) / CONFIG.echoDuration
      const pulse = 1 - ((game.time * 1.4) % 1) // 0..1 sawtooth
      if (b.kind === 'echo') {
        const color = game.species[b.species]?.color ?? '#fff'
        ctx.strokeStyle = color
        ctx.globalAlpha = 0.65
        ctx.beginPath()
        ctx.arc(b.x, b.y, 7, 0, Math.PI * 2)
        ctx.stroke()
        ctx.globalAlpha = 0.25 * lifeLeft + 0.08
        ctx.beginPath()
        ctx.arc(b.x, b.y, 7 + pulse * 26, 0, Math.PI * 2)
        ctx.stroke()
        ctx.globalAlpha = 0.9
        ctx.fillStyle = color
        ctx.font = '11px ui-monospace, monospace'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(game.species[b.species]?.glyph ?? '?', b.x, b.y - 14)
      } else {
        ctx.strokeStyle = '#9aa3ab'
        ctx.globalAlpha = 0.5
        // expanding ring: motion encodes "pushes outward"
        ctx.beginPath()
        ctx.arc(b.x, b.y, 8 + (1 - pulse) * 30, 0, Math.PI * 2)
        ctx.stroke()
        ctx.beginPath()
        ctx.arc(b.x, b.y, 4, 0, Math.PI * 2)
        ctx.stroke()
      }
      ctx.globalAlpha = 1
    }
  }

  private flash(ctx: CanvasRenderingContext2D, f: Flash, time: number): void {
    const age = (time - f.start) / 1.2 // 0..1
    if (age < 0 || age > 1) return
    ctx.strokeStyle = f.color
    switch (f.kind) {
      case 'event': {
        ctx.globalAlpha = (1 - age) * 0.9
        ctx.beginPath()
        ctx.arc(f.x, f.y, 4 + age * 22, 0, Math.PI * 2)
        ctx.stroke()
        break
      }
      case 'extract': {
        ctx.globalAlpha = (1 - age) * 0.9
        ctx.beginPath()
        ctx.arc(f.x, f.y, 16 * (1 - age) + 2, 0, Math.PI * 2)
        ctx.stroke()
        break
      }
      case 'deploy': {
        ctx.globalAlpha = (1 - age) * 0.7
        ctx.beginPath()
        ctx.arc(f.x, f.y, 3 + age * 10, 0, Math.PI * 2)
        ctx.stroke()
        break
      }
      case 'miss': {
        ctx.globalAlpha = (1 - age) * 0.6
        const r = 7
        ctx.beginPath()
        ctx.moveTo(f.x - r, f.y - r)
        ctx.lineTo(f.x + r, f.y + r)
        ctx.moveTo(f.x + r, f.y - r)
        ctx.lineTo(f.x - r, f.y + r)
        ctx.stroke()
        break
      }
    }
    ctx.globalAlpha = 1
  }

  private cursor(ctx: CanvasRenderingContext2D, game: Game, drag: DragState): void {
    const x = game.cursorX
    const y = game.cursorY
    if (x < 0 || y < 0 || x > CONFIG.fieldSize || y > CONFIG.fieldSize) return

    // attention radius — the zone where your witnessing counts
    ctx.strokeStyle = '#ffffff'
    ctx.globalAlpha = 0.05
    ctx.beginPath()
    ctx.arc(x, y, CONFIG.attentionRadius, 0, Math.PI * 2)
    ctx.stroke()
    ctx.globalAlpha = 1

    const selectedColor = game.species[game.selected]?.color ?? '#fff'
    switch (game.tool) {
      case 'deploy': {
        ctx.globalAlpha = 0.55
        ctx.fillStyle = selectedColor
        ctx.beginPath()
        ctx.arc(x, y, CONFIG.dotRadius, 0, Math.PI * 2)
        ctx.fill()
        ctx.globalAlpha = 1
        break
      }
      case 'extract': {
        // corner ticks converge as the cooldown recovers
        const ready = game.extractReady()
        const gap = CONFIG.extractRadius + (1 - ready) * 14
        ctx.strokeStyle = ready >= 1 ? '#9aa3ab' : '#4d555e'
        const t = 5
        for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
          ctx.beginPath()
          ctx.moveTo(x + sx * gap, y + sy * gap - sy * t)
          ctx.lineTo(x + sx * gap, y + sy * gap)
          ctx.lineTo(x + sx * gap - sx * t, y + sy * gap)
          ctx.stroke()
        }
        break
      }
      case 'echo': {
        ctx.strokeStyle = selectedColor
        ctx.globalAlpha = 0.6
        ctx.beginPath()
        ctx.arc(x, y, 7, 0, Math.PI * 2)
        ctx.stroke()
        ctx.globalAlpha = 0.15
        ctx.beginPath()
        ctx.arc(x, y, CONFIG.beaconRadius, 0, Math.PI * 2)
        ctx.stroke()
        ctx.globalAlpha = 1
        break
      }
      case 'scan': {
        ctx.strokeStyle = '#5fd8eb'
        ctx.globalAlpha = drag.active ? 0.9 : 0.6
        if (drag.active) {
          ctx.setLineDash([4, 4])
          ctx.beginPath()
          ctx.moveTo(drag.x0, drag.y0)
          ctx.lineTo(drag.x1, drag.y1)
          ctx.stroke()
          ctx.setLineDash([])
          ctx.beginPath()
          ctx.arc(drag.x0, drag.y0, 9, 0, Math.PI * 2)
          ctx.stroke()
        }
        ctx.beginPath()
        ctx.arc(x, y, 9, 0, Math.PI * 2)
        ctx.stroke()
        ctx.globalAlpha = 1
        break
      }
    }
  }

  private alarmBorder(ctx: CanvasRenderingContext2D, game: Game): void {
    // cadence accelerates as the grace window drains — urgency as motion
    const urgency = 1 - game.tracker.graceLeft / game.session.objective.graceSeconds
    const hz = 1 + urgency * 5
    const on = (game.time * hz) % 1 < 0.5
    if (!on) return
    ctx.strokeStyle = '#e8442a'
    ctx.globalAlpha = 0.35 + urgency * 0.45
    ctx.lineWidth = 2
    ctx.strokeRect(1, 1, CONFIG.fieldSize - 2, CONFIG.fieldSize - 2)
    ctx.globalAlpha = 1
    ctx.lineWidth = 1
  }

  private pausedLabel(ctx: CanvasRenderingContext2D, game?: Game): void {
    ctx.fillStyle = '#9aa3ab'
    ctx.font = '10px ui-monospace, monospace'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    const n = game?.pending.length ?? 0
    const label = n > 0 ? `▮▮ PAUSED — ${n} MOVE${n > 1 ? 'S' : ''} QUEUED · RESUME TO EXECUTE` : '▮▮ PAUSED — PLAN MOVES, RESUME TO EXECUTE'
    ctx.fillText(label, CONFIG.fieldSize / 2, 10)
  }
}
