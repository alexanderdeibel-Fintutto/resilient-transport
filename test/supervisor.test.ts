import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { TransportSupervisor } from '../src/supervisor'
import { MemoryBus, MemoryTransport } from '../src/memory-transport'
import type { NetworkMode } from '../src/types'

function fakeMonitor() {
  const ls = new Set<(m: NetworkMode) => void>()
  return { subscribe: (l: (m: NetworkMode) => void) => (ls.add(l), () => ls.delete(l)), emit: (m: NetworkMode) => ls.forEach((l) => l(m)) }
}

function setup(extra: Record<string, unknown> = {}) {
  const bus = new MemoryBus()
  const monitor = fakeMonitor()
  const created: MemoryTransport[] = []
  const onModeChange = vi.fn()
  const sup = new TransportSupervisor<MemoryTransport>({
    createTransport: (mode) => { const t = new MemoryTransport(mode === 'primary' ? 'cloud' : 'lan', bus); created.push(t); return t },
    monitor, debounceMs: 5000, onModeChange, ...extra,
  })
  const got: Record<string, unknown>[] = []
  sup.start('CODE', { onMessage: (_e, p) => got.push(p) })
  return { sup, monitor, created, got, onModeChange }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('TransportSupervisor', () => {
  it('starts on primary and does not switch before the debounce elapsed', () => {
    const { sup, monitor } = setup()
    monitor.emit('offline')
    vi.advanceTimersByTime(4999)
    expect(sup.getMode()).toBe('primary')
    vi.advanceTimersByTime(1)
    expect(sup.getMode()).toBe('fallback')
  })

  it('a short outage (flap) never causes a switch', () => {
    const { sup, monitor, onModeChange } = setup()
    monitor.emit('offline')
    vi.advanceTimersByTime(2000)
    monitor.emit('online')
    vi.advanceTimersByTime(10_000)
    expect(sup.getMode()).toBe('primary')
    expect(onModeChange).not.toHaveBeenCalled()
  })

  it('returns to primary after recovery, also when degraded', () => {
    const { sup, monitor } = setup()
    monitor.emit('offline'); vi.advanceTimersByTime(5000)
    expect(sup.getMode()).toBe('fallback')
    monitor.emit('degraded'); vi.advanceTimersByTime(5000)
    expect(sup.getMode()).toBe('primary')
  })

  it('going offline again while a return to primary is pending cancels the return (fix vs. original)', () => {
    const { sup, monitor } = setup()
    monitor.emit('offline'); vi.advanceTimersByTime(5000)
    monitor.emit('online'); vi.advanceTimersByTime(2000)
    monitor.emit('offline'); vi.advanceTimersByTime(10_000)
    expect(sup.getMode()).toBe('fallback')
  })

  it('closes the old transport and keeps delivering through the new one', () => {
    const { sup, monitor, created, got } = setup()
    monitor.emit('offline'); vi.advanceTimersByTime(5000)
    expect(created[0]!.isConnected).toBe(false)
    expect(created[1]!.isConnected).toBe(true)
    created[1]!.deliver('t', { n: 1 })
    expect(got).toEqual([{ n: 1 }])
    expect(sup.getActive()).toBe(created[1])
  })

  it('drops duplicate messages by id when getMessageId is set', () => {
    const { sup, created, got } = setup({ getMessageId: (_e: string, p: Record<string, unknown>) => p.id as string })
    created[0]!.deliver('t', { id: 'a' })
    created[0]!.deliver('t', { id: 'a' })
    created[0]!.deliver('t', { id: 'b' })
    expect(got).toEqual([{ id: 'a' }, { id: 'b' }])
    expect(sup.getMode()).toBe('primary')
  })

  it('destroy() stops reacting to the network', () => {
    const { sup, monitor } = setup()
    sup.destroy()
    monitor.emit('offline'); vi.advanceTimersByTime(10_000)
    expect(sup.getMode()).toBe('primary')
  })
})
