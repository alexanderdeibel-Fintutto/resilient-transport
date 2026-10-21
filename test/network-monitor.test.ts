import { describe, it, expect, vi } from 'vitest'
import { NetworkMonitor } from '../src/network-monitor'
import type { NetworkMode } from '../src/types'

function setup(opts: { probe?: () => Promise<void>; browserOnline?: { v: boolean }; now?: () => number } = {}) {
  const online = opts.browserOnline ?? { v: true }
  const m = new NetworkMonitor({
    probe: opts.probe ?? (async () => {}),
    isBrowserOnline: () => online.v,
    now: opts.now,
  })
  const seen: NetworkMode[] = []
  m.subscribe((x) => seen.push(x))
  return { m, seen, online }
}

describe('NetworkMonitor', () => {
  it('stays online on successful probes', async () => {
    const { m, seen } = setup()
    await m.check()
    expect(m.getMode()).toBe('online')
    expect(seen).toEqual([])
  })

  it('reports degraded for a slow probe', async () => {
    let t = 0
    const { m } = setup({ now: () => (t += 4000) })
    await m.check()
    expect(m.getMode()).toBe('degraded')
  })

  it('a blocked probe while the OS says online only degrades, never offline', async () => {
    const { m, seen } = setup({ probe: async () => { throw new Error('CSP') } })
    await m.check()
    expect(m.getMode()).toBe('online') // first failure: still tolerated
    await m.check()
    await m.check()
    await m.check()
    expect(m.getMode()).toBe('degraded')
    expect(seen).toEqual(['degraded'])
  })

  it('goes offline immediately when the OS says so and recovers afterwards', async () => {
    const { m, seen, online } = setup()
    online.v = false
    m.notifyBrowserEvent(false)
    expect(m.getMode()).toBe('offline')
    online.v = true
    m.notifyBrowserEvent(true)
    await vi.waitFor(() => expect(m.getMode()).toBe('online'))
    expect(seen).toEqual(['offline', 'online'])
  })
})
