import { decrypt, encrypt, clearKeyCache } from './crypto'
import type { BroadcastHandlers, BroadcastTransport } from './types'

export interface EncryptedTransportOptions {
  /** Domain-separation salt for key derivation. */
  salt: string
  /**
   * Default false: messages that fail to decrypt, or arrive unencrypted, are dropped and reported.
   * Set true only for migration phases. It lets an attacker on the network downgrade to plaintext.
   */
  allowPlaintextFallback?: boolean
  onError?: (kind: 'encrypt-failed' | 'decrypt-failed' | 'plaintext-rejected', event: string) => void
}

/**
 * Decorator: encrypts outgoing payloads and decrypts incoming ones for any BroadcastTransport.
 * The session code is the shared secret, so there is no key-exchange step.
 * Outgoing messages keep their order even though encryption is asynchronous.
 */
export class EncryptedBroadcastTransport implements BroadcastTransport {
  private code: string | null = null
  private sendChain: Promise<void> = Promise.resolve()
  private receiveChain: Promise<void> = Promise.resolve()

  constructor(
    private readonly inner: BroadcastTransport,
    private readonly opts: EncryptedTransportOptions,
  ) {}

  get type(): string { return this.inner.type }
  get isConnected(): boolean { return this.inner.isConnected }
  onConnectionChange(cb: (connected: boolean) => void): () => void { return this.inner.onConnectionChange(cb) }

  subscribe(code: string, handlers: BroadcastHandlers): void {
    this.code = code
    const { onMessage } = handlers
    this.inner.subscribe(code, {
      ...handlers,
      onMessage: onMessage
        ? (event, payload) => {
            this.receiveChain = this.receiveChain.then(() => this.receive(code, event, payload, onMessage))
          }
        : undefined,
    })
  }

  broadcast(event: string, payload: Record<string, unknown>): void {
    const code = this.code
    if (!code) { this.inner.broadcast(event, payload); return }
    this.sendChain = this.sendChain.then(async () => {
      try {
        this.inner.broadcast(event, { _encrypted: await encrypt(JSON.stringify(payload), code, this.opts) })
      } catch {
        this.opts.onError?.('encrypt-failed', event)
        if (this.opts.allowPlaintextFallback) this.inner.broadcast(event, payload)
      }
    })
  }

  unsubscribe(): void {
    this.inner.unsubscribe()
    clearKeyCache()
    this.code = null
  }

  private async receive(
    code: string, event: string, payload: Record<string, unknown>,
    deliver: NonNullable<BroadcastHandlers['onMessage']>,
  ): Promise<void> {
    if (typeof payload._encrypted !== 'string') {
      if (this.opts.allowPlaintextFallback) deliver(event, payload)
      else this.opts.onError?.('plaintext-rejected', event)
      return
    }
    try {
      deliver(event, JSON.parse(await decrypt(payload._encrypted, code, this.opts)) as Record<string, unknown>)
    } catch {
      this.opts.onError?.('decrypt-failed', event)
    }
  }
}
