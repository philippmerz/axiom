import type { ContactOutcome, Rule, Species } from './types'

export function outcomeGlyph(outcome: ContactOutcome): string {
  switch (outcome.kind) {
    case 'consume':
      return '✕'
    case 'convert':
      return '⇒'
    case 'spawn':
      return '+'
    case 'merge':
      return '⊕'
  }
}

/** A species is denoted by its colored dot, never a letter. In built strings
 * it appears as this sentinel token (the id wrapped in U+0001 controls); the
 * UI (speciesDots) swaps each token for an inline colored dot. The control
 * char never occurs in normal text, so it won't collide with the digits in
 * durations or counts. */
export function speciesToken(id: number): string {
  return `${id}`
}

/** Matches species tokens so the UI can replace them with colored dots. */
export const SPECIES_TOKEN_RE = /(\d+)/g

/** Plain-words law description, used by log, dossier caption and scans.
 * Species appear as tokens that the UI renders as colored dots. */
export function describeRule(rule: Rule, _species: Species[]): string {
  const g = speciesToken
  switch (rule.kind) {
    case 'force': {
      const verb = rule.strength > 0 ? 'DRAWN TO' : 'REPELLED BY'
      const power = Math.abs(rule.strength) >= 0.5 ? '' : 'WEAKLY '
      const gate = rule.gate ? ` — ONLY NEAR ≥${rule.gate.count} ${g(rule.gate.species)}` : ''
      return `${g(rule.self)} ${power}${verb} ${g(rule.other)}${gate}`
    }
    case 'contact': {
      const a = g(rule.a)
      const b = g(rule.b)
      const o = rule.outcome
      switch (o.kind) {
        case 'consume':
          return `${a} CONSUMES ${b}`
        case 'convert':
          return `${a} CONVERTS ${b} ⇒ ${g(o.into)}`
        case 'spawn':
          return `${a} + ${b} EMIT ${g(o.child)}`
        case 'merge':
          return `${a} ⊕ ${b} FUSE ⇒ ${g(o.into)}`
      }
      break
    }
    case 'fission':
      return `${g(rule.species)} SELF-REPLICATES ~${Math.round(rule.period)}S`
    case 'decay':
      return rule.into === null
        ? `${g(rule.species)} DECAYS ~${Math.round(rule.lifetime)}S`
        : `${g(rule.species)} DECAYS ⇒ ${g(rule.into)} ~${Math.round(rule.lifetime)}S`
  }
}

export function fmtCredits(n: number): string {
  return Math.floor(n).toLocaleString('en-US')
}

export function fmtClock(secondsLeft: number): string {
  const s = Math.max(0, Math.ceil(secondsLeft))
  const m = Math.floor(s / 60)
  return `T−${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

export function fmtPrice(n: number): string {
  return n >= 100 ? String(Math.round(n)) : n.toFixed(1)
}
