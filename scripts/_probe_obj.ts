import { CONFIG } from '../src/core/config'
import { generateSession } from '../src/core/rules'

const N = Number(process.argv[2] ?? 500)
let suppressNoStop = 0, suppressTotal = 0
let preserveMinLE0 = 0, preserveTotal = 0
let containMaxLow = 0, containTotal = 0
let preserveImmortalish = 0
let fallback = 0
let suppressTargetMeanMin = Infinity
const kinds: Record<string,number> = {}

for (let i = 0; i < N; i++) {
  const seed = (Math.imul(i + 1, 0x9e3779b9) ^ 0xabcdef) >>> 0
  const sess = generateSession(seed)
  if (sess.rejected >= CONFIG.burnin.maxAttempts) fallback++
  const p = sess.objective.primary
  kinds[p.kind] = (kinds[p.kind] ?? 0) + 1
  const rs = sess.ruleset
  if (p.kind === 'suppress') {
    suppressTotal++
    const hasFission = rs.unaries.some(u => u.species === p.species && u.kind === 'fission')
    const producers = rs.contacts.filter(c => {
      const o = c.outcome
      return (o.kind==='convert'&&o.into===p.species)||(o.kind==='spawn'&&o.child===p.species)||(o.kind==='merge'&&o.into===p.species)
    }).length + rs.unaries.filter(u=>u.kind==='decay'&&u.into===p.species).length + (hasFission?1:0)
    if (hasFission && producers === 1) suppressNoStop++
  }
  const c = sess.objective.constraint
  if (c.kind === 'preserve') {
    preserveTotal++
    if (c.min <= 0) preserveMinLE0++
    const mortalByContact = rs.contacts.some(cc => (cc.outcome.kind==='consume'&&cc.b===c.species)||(cc.outcome.kind==='convert'&&cc.b===c.species)||(cc.outcome.kind==='merge'&&(cc.a===c.species||cc.b===c.species)))
    const mortalByDecay = rs.unaries.some(u=>u.species===c.species&&u.kind==='decay')
    if (!mortalByContact && !mortalByDecay) preserveImmortalish++
  }
  if (c.kind === 'contain') {
    containTotal++
    if (c.max < 1) containMaxLow++
  }
}
console.log('kinds', kinds, 'fallback', fallback)
console.log('suppress total', suppressTotal, 'self-sustaining-fission-only', suppressNoStop)
console.log('preserve total', preserveTotal, 'min<=0', preserveMinLE0, 'immortal(no kill path)', preserveImmortalish)
console.log('contain total', containTotal, 'max<1', containMaxLow)
