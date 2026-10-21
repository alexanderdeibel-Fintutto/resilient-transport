import { describe, it, expect, vi } from 'vitest'
import { EncryptedBroadcastTransport } from '../src/encrypted-transport'
import { MemoryBus, MemoryTransport } from '../src/memory-transport'

const flush = () => new Promise((r) => setTimeout(r, 20))

function pair(opts: { allowPlaintextFallback?: boolean } = {}) {
  const bus = new MemoryBus()
  const onError = vi.fn()
  const a = new EncryptedBroadcastTransport(new MemoryTransport('a', bus), { salt: 's', onError, ...opts })
  const b = new EncryptedBroadcastTransport(new MemoryTransport('b', bus), { salt: 's', onError, ...opts })
  return { bus, a, b, onError }
}

describe('EncryptedBroadcastTransport', () => {
  it('delivers decrypted payloads and puts only ciphertext on the wire', async () => {
    const { bus, a, b } = pair()
    const received: unknown[] = []
    const wire = new MemoryTransport('spy', bus)
    const spied: Record<string, unknown>[] = []
    wire.subscribe('X', { onMessage: (_e, p) => spied.push(p) })
    b.subscribe('X', { onMessage: (_e, p) => received.push(p) })
    a.subscribe('X', {})
    a.broadcast('t', { text: 'Hallo' })
    await flush()
    expect(received).toEqual([{ text: 'Hallo' }])
    expect(JSON.stringify(spied)).not.toContain('Hallo')
  })

  it('keeps message order although encryption is async', async () => {
    const { a, b } = pair()
    const got: number[] = []
    b.subscribe('X', { onMessage: (_e, p) => got.push(p.n as number) })
    a.subscribe('X', {})
    for (let i = 0; i < 30; i++) a.broadcast('t', { n: i })
    await flush()
    await flush()
    expect(got).toEqual(Array.from({ length: 30 }, (_, i) => i))
  })

  it('drops plaintext by default and reports it (no silent downgrade)', async () => {
    const { bus, b, onError } = pair()
    const got: unknown[] = []
    b.subscribe('X', { onMessage: (_e, p) => got.push(p) })
    const attacker = new MemoryTransport('evil', bus)
    attacker.subscribe('X', {})
    attacker.broadcast('t', { text: 'forged' })
    await flush()
    expect(got).toEqual([])
    expect(onError).toHaveBeenCalledWith('plaintext-rejected', 't')
  })

  it('accepts plaintext only when explicitly allowed', async () => {
    const { bus, b } = pair({ allowPlaintextFallback: true })
    const got: unknown[] = []
    b.subscribe('X', { onMessage: (_e, p) => got.push(p) })
    const other = new MemoryTransport('old-client', bus)
    other.subscribe('X', {})
    other.broadcast('t', { text: 'legacy' })
    await flush()
    expect(got).toEqual([{ text: 'legacy' }])
  })

  it('drops messages encrypted under another session code', async () => {
    const bus = new MemoryBus()
    const onError = vi.fn()
    const a = new EncryptedBroadcastTransport(new MemoryTransport('a', bus), { salt: 's', onError })
    const b = new EncryptedBroadcastTransport(new MemoryTransport('b', bus), { salt: 's', onError })
    const got: unknown[] = []
    b.subscribe('RIGHT1', { onMessage: (_e, p) => got.push(p) })
    a.subscribe('OTHER2', {})
    a.broadcast('t', { text: 'x' })
    await flush()
    expect(got).toEqual([])
    expect(onError).toHaveBeenCalledWith('decrypt-failed', 't')
  })
})
