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

/** Plain-words law description, used by log, dossier caption and scans. */
export function describeRule(rule: Rule, species: Species[]): string {
  const g = (s: number) => species[s]?.glyph ?? '?'
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
