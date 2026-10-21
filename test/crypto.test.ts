import { describe, it, expect } from 'vitest'
import { encrypt, decrypt } from '../src/crypto'

const o = { salt: 'test-app-v1' }

describe('crypto', () => {
  it('round-trips unicode and large payloads', async () => {
    const big = 'Führung 🌍 '.repeat(20_000)
    expect(await decrypt(await encrypt(big, 'ABC123', o), 'ABC123', o)).toBe(big)
  })
  it('uses a fresh IV per message', async () => {
    const a = await encrypt('same', 'ABC123', o)
    const b = await encrypt('same', 'ABC123', o)
    expect(a).not.toBe(b)
  })
  it('rejects a wrong code', async () => {
    await expect(decrypt(await encrypt('x', 'ABC123', o), 'WRONG1', o)).rejects.toBeDefined()
  })
  it('rejects a different salt', async () => {
    await expect(decrypt(await encrypt('x', 'ABC123', o), 'ABC123', { salt: 'other' })).rejects.toBeDefined()
  })
  it('detects tampering', async () => {
    const enc = await encrypt('secret', 'ABC123', o)
    const bytes = Uint8Array.from(atob(enc), (c) => c.charCodeAt(0))
    bytes[bytes.length - 1] = (bytes[bytes.length - 1] ?? 0) ^ 1
    await expect(decrypt(btoa(String.fromCharCode(...bytes)), 'ABC123', o)).rejects.toBeDefined()
  })
})
