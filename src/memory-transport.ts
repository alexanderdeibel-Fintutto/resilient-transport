import type { BroadcastHandlers, BroadcastTransport } from './types'

/** In-process transport for tests and demos. Instances sharing a bus see each other's broadcasts. */
export class MemoryBus {
  readonly subscribers = new Set<MemoryTransport>()
}

export class MemoryTransport implements BroadcastTransport {
  isConnected = false
  private handlers: BroadcastHandlers | null = null
  private listeners = new Set<(c: boolean) => void>()
  constructor(readonly type: string, private readonly bus: MemoryBus) {}

  subscribe(_code: string, handlers: BroadcastHandlers): void {
    this.handlers = handlers
    this.bus.subscribers.add(this)
    this.setConnected(true)
  }
  broadcast(event: string, payload: Record<string, unknown>): void {
    for (const s of this.bus.subscribers) if (s !== this) s.handlers?.onMessage?.(event, payload)
  }
  unsubscribe(): void {
    this.bus.subscribers.delete(this)
    this.handlers = null
    this.setConnected(false)
  }
  onConnectionChange(cb: (c: boolean) => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }
  /** Test helper: deliver a message to this transport's own subscriber. */
  deliver(event: string, payload: Record<string, unknown>): void { this.handlers?.onMessage?.(event, payload) }
  private setConnected(c: boolean): void {
    this.isConnected = c
    for (const l of this.listeners) l(c)
  }
}
