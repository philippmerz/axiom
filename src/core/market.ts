import { CONFIG } from './config'
import { Rng } from './rng'

/** x^(7/8) from IEEE-exact ops only (√√√ composition) so headless and
 * browser runs price identically. */
function pow78(x: number): number {
  const s1 = Math.sqrt(x)
  const s2 = Math.sqrt(s1)
  const s3 = Math.sqrt(s2)
  return s1 * s2 * s3
}

/** Pinned pipeline: fair = base · clamp(scarcity); an EMA tracks fair; ask
 * and bid apply order impact and OU noise on top. Impact is incremented
 * synchronously inside trades and decays slowly (45s half-life), so spamming
 * one species is self-defeating — the anti-money-printer.
 * Scarcity is anchored to each species' own burn-in mean, so prices read as
 * deviation-from-baseline, not absolute population. */
export class Market {
  private readonly k: number
  private readonly refPop: number[]
  private readonly ema: number[]
  private readonly buyImpact: number[]
  private readonly sellImpact: number[]
  private readonly noise: number[]
  private readonly impactStepDecay: number
  readonly history: number[][]
  private sparkTimer = 0

  constructor(
    readonly base: number[],
    burninMeans: number[],
    private readonly rng: Rng,
  ) {
    this.k = base.length
    this.refPop = burninMeans.map((m) => m + 4)
    this.ema = [...base]
    this.buyImpact = new Array<number>(this.k).fill(0)
    this.sellImpact = new Array<number>(this.k).fill(0)
    this.noise = new Array<number>(this.k).fill(0)
    this.history = base.map((b) => [b])
    this.impactStepDecay = Math.pow(0.5, CONFIG.dt / CONFIG.market.impactHalfLife)
  }

  private fair(s: number, pop: number): number {
    const m = CONFIG.market
    const raw = pow78((this.refPop[s] as number) / (pop + 4))
    const scarcity = Math.min(m.scarcityClamp[1], Math.max(m.scarcityClamp[0], raw))
    return (this.base[s] as number) * scarcity
  }

  step(counts: number[], dt: number): void {
    const m = CONFIG.market
    const alpha = Math.min(1, m.smoothing * dt)
    for (let s = 0; s < this.k; s++) {
      const fair = this.fair(s, counts[s] as number)
      this.ema[s] = (this.ema[s] as number) + alpha * (fair - (this.ema[s] as number))
      this.buyImpact[s] = (this.buyImpact[s] as number) * this.impactStepDecay
      this.sellImpact[s] = (this.sellImpact[s] as number) * this.impactStepDecay
      const n = this.noise[s] as number
      const dn = -m.noiseTheta * n * dt + m.noiseSigma * Math.sqrt(dt) * this.rng.range(-1, 1)
      this.noise[s] = Math.min(m.noiseClamp, Math.max(-m.noiseClamp, n + dn))
    }
    this.sparkTimer += dt
    if (this.sparkTimer >= m.sparkInterval) {
      this.sparkTimer -= m.sparkInterval
      for (let s = 0; s < this.k; s++) {
        const h = this.history[s] as number[]
        h.push(this.mid(s))
        if (h.length > m.sparkTicks) h.shift()
      }
    }
  }

  mid(s: number): number {
    return Math.max(0.5, (this.ema[s] as number) * (1 + (this.noise[s] as number)))
  }

  ask(s: number): number {
    return this.mid(s) * (1 + (this.buyImpact[s] as number)) * CONFIG.market.askPremium
  }

  bid(s: number): number {
    return this.mid(s) * (1 - (this.sellImpact[s] as number)) * (1 - CONFIG.market.sellHaircut)
  }

  recordBuy(s: number): void {
    const m = CONFIG.market
    this.buyImpact[s] = Math.min(m.impactMax, (this.buyImpact[s] as number) + m.impactPerTrade)
  }

  recordSell(s: number): void {
    const m = CONFIG.market
    this.sellImpact[s] = Math.min(m.impactMax, (this.sellImpact[s] as number) + m.impactPerTrade)
  }

  /** −1 | 0 | +1 over the last ~5 sparkline samples, for the price arrows. */
  trend(s: number): number {
    const h = this.history[s] as number[]
    if (h.length < 6) return 0
    const now = h[h.length - 1] as number
    const then = h[h.length - 6] as number
    if (now > then * 1.03) return 1
    if (now < then * 0.97) return -1
    return 0
  }
}
