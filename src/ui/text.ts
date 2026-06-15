import { SPECIES_TOKEN_RE } from '../core/format'
import type { Species } from '../core/types'

function esc(text: string): string {
  return text.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c] as string)
}

/** Render a built string for the DOM, swapping each species token (@id@) for
 * an inline colored dot. The single visual token for an entity. */
export function speciesDots(text: string, species: Species[]): string {
  return esc(text).replace(SPECIES_TOKEN_RE, (_, id: string) => {
    const color = species[Number(id)]?.color ?? '#fff'
    return `<span class="sp-dot" style="background:${color}"></span>`
  })
}

/** A standalone inline colored dot for one species (DOM). */
export function speciesDot(s: Species): string {
  return `<span class="sp-dot" style="background:${s.color}"></span>`
}
