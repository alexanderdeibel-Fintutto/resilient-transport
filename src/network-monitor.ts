import type { NetworkMode } from './types'

export interface NetworkMonitorOptions {
  /** Resolves if the network is reachable, rejects otherwise. Must honour the signal. */
  probe: (signal: AbortSignal) => Promise<void>
  /** Browser/OS opinion. Default: navigator.onLine when available, else true. */
  isBrowserOnline?: () => boolean
  intervalMs?: number
  timeoutMs?: number
  /** Probe latency above this counts as 'degraded'. */
  degradedLatencyMs?: number
  /** Consecutive probe failures before leaving 'online'. */
  failuresForDegraded?: number
  now?: () => number
}

type Listener = (mode: NetworkMode) => void

/**
 * Three-state network monitor: online, degraded, offline.
 *
 * Why three states: a blocked or slow probe endpoint (strict CSP, captive portal,
 * flaky venue Wi-Fi) must not be mistaken for "no network". While the OS still
 * reports a connection, repeated probe failures only downgrade to 'degraded'.
 * Only the OS reporting offline yields 'offline'.
 */
export class NetworkMonitor {
  private mode: NetworkMode
  private listeners = new Set<Listener>()
  private failures = 0
  private timer: ReturnType<typeof setInterval> | null = null
  private readonly o: Required<Omit<NetworkMonitorOptions, 'probe'>> & Pick<NetworkMonitorOptions, 'probe'>

  constructor(options: NetworkMonitorOptions) {
    this.o = {
      probe: options.probe,
      isBrowserOnline: options.isBrowserOnline ?? (() => (typeof navigator === 'undefined' ? true : navigator.onLine)),
      intervalMs: options.intervalMs ?? 15_000,
      timeoutMs: options.timeoutMs ?? 5_000,
      degradedLatencyMs: options.degradedLatencyMs ?? 3_000,
      failuresForDegraded: options.failuresForDegraded ?? 2,
      now: options.now ?? Date.now,
    }
    this.mode = this.o.isBrowserOnline() ? 'online' : 'offline'
  }

  getMode(): NetworkMode {
    return this.mode
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => void this.check(), this.o.intervalMs)
    void this.check()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.listeners.clear()
  }

  /** Call from window 'online'/'offline' events for instant reaction. */
  notifyBrowserEvent(online: boolean): void {
    if (!online) {
      this.failures = this.o.failuresForDegraded
      this.setMode('offline')
    } else {
      this.failures = 0
      void this.check()
    }
  }

  async check(): Promise<NetworkMode> {
    if (!this.o.isBrowserOnline()) {
      this.setMode('offline')
      return this.mode
    }
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.o.timeoutMs)
    const started = this.o.now()
    try {
      await this.o.probe(controller.signal)
      this.failures = 0
      this.setMode(this.o.now() - started > this.o.degradedLatencyMs ? 'degraded' : 'online')
    } catch {
      this.failures++
      if (this.failures >= this.o.failuresForDegraded) {
        this.setMode(this.o.isBrowserOnline() ? 'degraded' : 'offline')
      }
    } finally {
      clearTimeout(timer)
    }
    return this.mode
  }

  private setMode(next: NetworkMode): void {
    if (next === this.mode) return
    this.mode = next
    for (const l of this.listeners) l(next)
  }
}
