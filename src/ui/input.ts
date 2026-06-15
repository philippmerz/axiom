import { CONFIG } from '../core/config'
import type { Game, Tool } from '../core/game'
import type { DragState } from './field'

export interface InputHooks {
  onEngage: () => void
  onRetry: () => void
  onNew: () => void
}

const TOOL_KEYS: Record<string, Tool> = {
  '1': 'deploy',
  '2': 'extract',
  '3': 'echo',
  '4': 'scan',
}

/** Pointer + keyboard wiring. Returns the live drag state so the field
 * renderer can draw the scan line. */
export function bindInput(
  getGame: () => Game | null,
  stack: HTMLElement,
  hooks: InputHooks,
): DragState {
  const drag: DragState = { active: false, x0: 0, y0: 0, x1: 0, y1: 0 }

  const toField = (e: PointerEvent): { x: number; y: number } => {
    const r = stack.getBoundingClientRect()
    return {
      x: ((e.clientX - r.left) / r.width) * CONFIG.fieldSize,
      y: ((e.clientY - r.top) / r.height) * CONFIG.fieldSize,
    }
  }

  stack.addEventListener('pointermove', (e) => {
    const g = getGame()
    if (!g) return
    const p = toField(e)
    g.cursorX = p.x
    g.cursorY = p.y
    if (drag.active) {
      drag.x1 = p.x
      drag.y1 = p.y
    }
  })

  stack.addEventListener('pointerleave', () => {
    const g = getGame()
    if (!g) return
    g.cursorX = -1000
    g.cursorY = -1000
  })

  stack.addEventListener('pointerdown', (e) => {
    const g = getGame()
    if (!g) return
    const p = toField(e)
    switch (g.tool) {
      case 'deploy':
        g.deployAt(p.x, p.y)
        break
      case 'extract':
        g.extractAt(p.x, p.y)
        break
      case 'echo':
        g.echoAt(p.x, p.y, e.shiftKey)
        break
      case 'scan':
        drag.active = true
        drag.x0 = drag.x1 = p.x
        drag.y0 = drag.y1 = p.y
        stack.setPointerCapture(e.pointerId)
        break
    }
  })

  stack.addEventListener('pointerup', (e) => {
    const g = getGame()
    if (g && drag.active && g.tool === 'scan') {
      const p = toField(e)
      g.scanDrag(drag.x0, drag.y0, p.x, p.y)
    }
    drag.active = false
  })

  window.addEventListener('keydown', (e) => {
    const g = getGame()
    if (!g || e.repeat || e.metaKey || e.ctrlKey) return
    const k = e.key.toLowerCase()
    const tool = TOOL_KEYS[k]
    if (tool) {
      g.tool = tool
    } else if (k === ' ') {
      e.preventDefault()
      if (g.phase === 'briefing') hooks.onEngage()
      else g.togglePause()
    } else if (k === 'q' || k === 'e') {
      const n = g.species.length
      g.selected = (g.selected + (k === 'e' ? 1 : n - 1)) % n
    } else if (k === 'r') {
      hooks.onRetry()
    } else if (k === 'n') {
      hooks.onNew()
    }
  })

  return drag
}
