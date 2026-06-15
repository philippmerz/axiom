/** Deterministic seeded RNG (splitmix32). One instance per concern so
 * generation, simulation and market noise don't perturb each other. */
export class Rng {
  private state: number

  constructor(seed: number) {
    this.state = seed >>> 0
  }

  /** Uniform float in [0, 1). */
  next(): number {
    this.state = (this.state + 0x9e3779b9) >>> 0
    let z = this.state
    z ^= z >>> 16
    z = Math.imul(z, 0x21f0aaad)
    z ^= z >>> 15
    z = Math.imul(z, 0x735a2d97)
    z ^= z >>> 15
    return (z >>> 0) / 4294967296
  }

  range(min: number, max: number): number {
    return min + this.next() * (max - min)
  }

  int(min: number, maxExclusive: number): number {
    return min + Math.floor(this.next() * (maxExclusive - min))
  }

  pick<T>(items: readonly T[]): T {
    const item = items[this.int(0, items.length)]
    if (item === undefined) throw new Error('pick from empty array')
    return item
  }

  /** In-place Fisher–Yates shuffle; returns the same array. */
  shuffle<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i--) {
      const j = this.int(0, i + 1)
      const a = items[i] as T
      items[i] = items[j] as T
      items[j] = a
    }
    return items
  }

  chance(p: number): boolean {
    return this.next() < p
  }

  /** Derive an independent child seed (for sub-systems / retries). */
  fork(): number {
    return Math.floor(this.next() * 4294967296) >>> 0
  }
}

export function randomSeed(): number {
  return Math.floor(Math.random() * 4294967296) >>> 0
}

export function seedToHex(seed: number): string {
  return seed.toString(16).toUpperCase().padStart(8, '0')
}

export function hexToSeed(hex: string): number | null {
  if (!/^[0-9a-fA-F]{1,8}$/.test(hex)) return null
  return parseInt(hex, 16) >>> 0
}
