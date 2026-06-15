/** Generation worker: runs the (CPU-heavy, fully deterministic) session
 * generator off the main thread so validation sims never freeze the UI.
 * Streams an attempt counter back, then the finished session. */
import { generateSession } from './core/rules'
import type { Session } from './core/types'

export type WorkerOut =
  | { type: 'progress'; attempt: number }
  | { type: 'done'; session: Session }

self.onmessage = (e: MessageEvent<{ seed: number }>) => {
  const session = generateSession(e.data.seed, (attempt) => {
    const msg: WorkerOut = { type: 'progress', attempt }
    self.postMessage(msg)
  })
  const done: WorkerOut = { type: 'done', session }
  self.postMessage(done)
}
