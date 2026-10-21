/** Handlers a subscriber registers. Kept deliberately small. */
export interface BroadcastHandlers {
  onMessage?: (event: string, payload: Record<string, unknown>) => void
}

/** The only contract a transport has to fulfil to be supervised or encrypted. */
export interface BroadcastTransport {
  /** Free-form label, e.g. 'cloud', 'lan', 'ble'. */
  readonly type: string
  readonly isConnected: boolean
  subscribe(code: string, handlers: BroadcastHandlers): void
  broadcast(event: string, payload: Record<string, unknown>): void
  unsubscribe(): void
  onConnectionChange(callback: (connected: boolean) => void): () => void
}

export type NetworkMode = 'online' | 'degraded' | 'offline'
export type TransportMode = 'primary' | 'fallback'
