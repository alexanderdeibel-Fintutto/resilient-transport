// AES-256-GCM with a key derived from a shared session code via PBKDF2.
// Works anywhere globalThis.crypto.subtle exists (browsers, Node >= 19, Deno, Workers).

const IV_LENGTH = 12
const ITERATIONS = 100_000
const MAX_CACHED_KEYS = 8
const keyCache = new Map<string, CryptoKey>()

export interface CryptoOptions {
  /** Domain-separation salt. Use a value unique to your application. */
  salt: string
}

export function isCryptoSupported(): boolean {
  return typeof crypto !== 'undefined' && !!crypto.subtle && typeof crypto.getRandomValues === 'function'
}

export function clearKeyCache(): void {
  keyCache.clear()
}

async function getKey(code: string, salt: string): Promise<CryptoKey> {
  const id = `${salt}\u0000${code}`
  const hit = keyCache.get(id)
  if (hit) return hit
  const enc = new TextEncoder()
  const material = await crypto.subtle.importKey('raw', enc.encode(code), 'PBKDF2', false, ['deriveKey'])
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: enc.encode(salt), iterations: ITERATIONS, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
  if (keyCache.size >= MAX_CACHED_KEYS) keyCache.delete(keyCache.keys().next().value as string)
  keyCache.set(id, key)
  return key
}

function toBase64(bytes: Uint8Array): string {
  let s = ''
  // chunked: spreading a large array into String.fromCharCode overflows the call stack
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

/** Returns base64(IV || ciphertext || auth tag). A fresh random IV per message. */
export async function encrypt(plaintext: string, code: string, opts: CryptoOptions): Promise<string> {
  const key = await getKey(code, opts.salt)
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH))
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext)))
  const out = new Uint8Array(IV_LENGTH + ct.length)
  out.set(iv, 0)
  out.set(ct, IV_LENGTH)
  return toBase64(out)
}

/** Throws if the code is wrong or the data was modified (GCM authentication). */
export async function decrypt(encoded: string, code: string, opts: CryptoOptions): Promise<string> {
  const key = await getKey(code, opts.salt)
  const all = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0))
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: all.slice(0, IV_LENGTH) }, key, all.slice(IV_LENGTH))
  return new TextDecoder().decode(pt)
}
