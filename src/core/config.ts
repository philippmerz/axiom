/** Global tunables — the single source of truth for every fixed constant.
 * Everything generated-per-session lives in rules.ts. All timing is sim time
 * (World.time), never wall clock, so pause and tab-throttling stay safe. */
export const CONFIG = {
  // world
  fieldSize: 720, // logical units, square
  dt: 1 / 60,
  friction: 1.6, // s⁻¹ velocity damping
  jitter: 22, // thermal acceleration, keeps the field alive
  maxSpeed: 120,
  wallMargin: 14,
  wallPush: 260,
  contactRadius: 7,
  dotRadius: 3.2,
  maxDots: 900, // hard cap; spawns beyond this are dropped

  // seeding
  initialPerSpecies: 26,

  // validation: a 60s burn-in gate, then the same world runs on to the full
  // session horizon (deadline). Objectives are calibrated against that
  // measured null trajectory, so they cannot complete or fail untouched.
  // A doomed world is obvious within ~25s, so the gate is short — that makes
  // each REJECTED candidate cheap. The accepted winner still runs the full
  // horizon for calibration, and the continuation catches late degeneration.
  burnin: {
    seconds: 26, // gate window
    minPerSpecies: 2,
    maxPerSpecies: 230,
    minTotal: 40,
    maxTotal: 560, // start is ~156; readable worlds settle well under this
    crowdAbortFrac: 0.82, // abort a candidate sustained this far above maxTotal
    crowdAbortSecs: 4,
    minContactEvents: 6, // over the (shorter) gate window
    minDeaths: 3, // the guaranteed sink must actually function
    minMovingFraction: 0.12, // ≥12% of dots in visible motion (speed > 8)
    movingSpeed: 8,
    maxAttempts: 24,
    relaxAfter: 10, // late attempts lower the bar so generation terminates fast
    transient: 18, // settling seconds excluded from mean-population stats
    nullMaxPerSpecies: 300, // hard physics bounds over the full horizon
    nullMaxTotal: 640,
  },

  // economy — pipeline: fair = base · clamp(scarcity); EMA tracks fair;
  // ask/bid apply order impact and noise on top. All stepped in sim ticks.
  market: {
    scarcityClamp: [0.3, 4] as const, // extinction can't be self-funding
    smoothing: 2.2, // s⁻¹ EMA rate toward fair price
    impactPerTrade: 0.1, // steep enough that buy-to-win spikes are costly
    impactMax: 0.9,
    impactHalfLife: 45, // s — spamming one species stays expensive
    noiseTheta: 0.4, // OU mean-reversion
    noiseSigma: 0.05,
    noiseClamp: 0.12,
    askPremium: 1.04,
    sellHaircut: 0.18,
    sparkTicks: 120,
    sparkInterval: 1.0, // seconds per sparkline sample
  },

  // session
  startCredits: 400,
  deadline: 300,
  holdSeconds: 18, // long enough that a purchased spike decays first
  graceSeconds: 8,

  // tools
  extractCooldown: 1.5,
  echoCost: 45,
  echoDuration: 12,
  echoWeight: 4, // phantom dot counts as this many real dots
  flatCost: 90, // shift-echo: known-quantity repulsor, all species
  flatStrength: 80,
  beaconRadius: 170,
  scanBaseCost: 40,
  scanCostGrowth: 1.25,
  extractRadius: 18,

  // intel
  observationsToConfirm: 3,
  attentionRadius: 170, // events only count as witnessed near the cursor
  echoMinSamples: 140, // dot-steps near an echo needed before it can confirm
  echoBiasThreshold: 0.12, // directional skew (toward−away)/n that signals a law
  echoConfirms: 1, // one clean experiment confirms a force law
} as const
