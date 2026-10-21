import type { BroadcastHandlers, BroadcastTransport, NetworkMode, TransportMode } from './types'

export interface SupervisorOptions<T extends BroadcastTransport> {
  /** Build a fresh transport for the given mode, e.g. cloud for 'primary', LAN relay for 'fallback'. */
  createTransport: (mode: TransportMode) => T
  /** Anything with subscribe(listener) => unsubscribe, typically a NetworkMonitor. */
  monitor: { subscribe(listener: (mode: NetworkMode) => void): () => void }
  /** A mode has to be requested for this long before the switch happens. Prevents flapping. */
  debounceMs?: number
  /**
   * If given, messages with an id seen before are dropped. During a switch both transports
   * may briefly deliver the same message; this makes "no duplicates" true instead of hoped for.
   */
  getMessageId?: (event: string, payload: Record<string, unknown>) => string | undefined
  dedupeWindow?: number
  onModeChange?: (mode: TransportMode, transport: T) => void
}

/**
 * Keeps a session alive across network changes without restarting it.
 *   offline            -> switch to 'fallback' (after debounce)
 *   online / degraded  -> switch back to 'primary' (after debounce)
 *   recovery during a pending switch to fallback cancels it
 * The new transport subscribes BEFORE the old one is closed, so nothing falls into a gap.
 */
export class TransportSupervisor<T extends BroadcastTransport> {
  private active: T
  private mode: TransportMode = 'primary'
  private code = ''
  private handlers: BroadcastHandlers = {}
  private timer: ReturnType<typeof setTimeout> | null = null
  private unsubMonitor: (() => void) | null = null
  private seen = new Set<string>()
  private readonly debounceMs: number
  private readonly dedupeWindow: number

  constructor(private readonly o: SupervisorOptions<T>) {
    this.debounceMs = o.debounceMs ?? 5_000
    this.dedupeWindow = o.dedupeWindow ?? 500
    this.active = o.createTransport('primary')
  }

  getActive(): T { return this.active }
  getMode(): TransportMode { return this.mode }

  start(code: string, handlers: BroadcastHandlers, initial?: NetworkMode): void {
    this.code = code
    this.handlers = handlers
    this.active.subscribe(code, this.wrap(handlers))
    this.unsubMonitor = this.o.monitor.subscribe((m) => this.onNetwork(m))
    if (initial) this.onNetwork(initial)
  }

  switchTo(mode: TransportMode): void {
    if (mode === this.mode) return
    const next = this.o.createTransport(mode)
    next.subscribe(this.code, this.wrap(this.handlers))
    const previous = this.active
    this.active = next
    this.mode = mode
    previous.unsubscribe()
    this.o.onModeChange?.(mode, next)
  }

  destroy(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.unsubMonitor?.()
    this.active.unsubscribe()
  }

  private onNetwork(net: NetworkMode): void {
    if (net === 'offline') {
      if (this.mode === 'primary') this.schedule('fallback')
      else this.cancel() // already on fallback: drop any pending return to primary
    } else if (this.mode === 'fallback') {
      this.schedule('primary')
    } else {
      this.cancel() // recovered while still on primary: drop pending fallback
    }
  }

  private schedule(mode: TransportMode): void {
    this.cancel()
    this.timer = setTimeout(() => { this.timer = null; this.switchTo(mode) }, this.debounceMs)
  }

  private cancel(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  private wrap(h: BroadcastHandlers): BroadcastHandlers {
    const { getMessageId } = this.o
    if (!getMessageId || !h.onMessage) return h
    const deliver = h.onMessage
    return {
      ...h,
      onMessage: (event, payload) => {
        const id = getMessageId(event, payload)
        if (id !== undefined) {
          if (this.seen.has(id)) return
          this.seen.add(id)
          if (this.seen.size > this.dedupeWindow) this.seen.delete(this.seen.values().next().value as string)
        }
        deliver(event, payload)
      },
    }
  }
}
