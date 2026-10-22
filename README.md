# resilient-transport

Keep a live session running when the network changes, without restarting it and without delivering messages twice. Small, dependency-free TypeScript with tests.

Extracted from the transport layer of a production real-time translation system (a guide speaks, visitors hear it live in their own language on their phones, reading along optional). Rewritten for standalone use, with the weak spots I found while extracting it fixed. See "What changed vs. the production code".

```
                 offline, held for 5 s                  online or degraded, held for 5 s
   ┌─────────┐ ───────────────────────────▶ ┌──────────┐ ───────────────────────────▶ ┌─────────┐
   │ primary │                              │ fallback │                              │ primary │
   └─────────┘ ◀─── recovery within 5 s ─── └──────────┘ ◀─ offline again within 5 s ─ └─────────┘
      (cloud)        cancels the switch         (LAN relay)     cancels the return         (cloud)
```

## Parts

| Module | What it does |
|---|---|
| `NetworkMonitor` | Three states: `online`, `degraded`, `offline`. Probe failures while the OS still reports a connection only degrade. This is deliberate: a blocked probe endpoint or a captive portal must not be treated as "no network". |
| `TransportSupervisor` | Switches between a primary and a fallback transport. Debounced against flapping. The new transport subscribes before the old one closes. Optional de-duplication by message id. |
| `EncryptedBroadcastTransport` | Decorator for any transport. AES-256-GCM, key derived from the shared session code with PBKDF2. Keeps message order although encryption is async. |
| `MemoryTransport` | In-process transport for tests and demos. |

The only interface you implement is `BroadcastTransport` (six members, see `src/types.ts`).

## Use

```ts
import { NetworkMonitor, TransportSupervisor, EncryptedBroadcastTransport } from './src'

const monitor = new NetworkMonitor({
  probe: async (signal) => { await fetch('https://example.com/health', { signal, cache: 'no-store' }) },
})
window.addEventListener('online', () => monitor.notifyBrowserEvent(true))
window.addEventListener('offline', () => monitor.notifyBrowserEvent(false))
monitor.start()

const supervisor = new TransportSupervisor({
  monitor,
  createTransport: (mode) =>
    new EncryptedBroadcastTransport(
      mode === 'primary' ? new MyCloudTransport() : new MyLanRelayTransport(),
      { salt: 'my-app-v1' },
    ),
  getMessageId: (_event, payload) => payload.id as string | undefined,
  onModeChange: (mode) => console.log('now on', mode),
})
supervisor.start('SESSION-CODE', { onMessage: (event, payload) => render(event, payload) })
```

## Run the tests

```bash
npm install
npm test          # 21 tests: crypto, encryption decorator, network monitor, supervisor
npm run typecheck
```

## What changed vs. the production code

| Production code | Here |
|---|---|
| Plaintext fallback whenever decryption or encryption failed | Off by default. Unencrypted or undecryptable messages are dropped and reported through `onError`. A silent fallback lets an attacker on the network downgrade the session. |
| Fixed, hard-coded key-derivation salt | `salt` is a required option. |
| `btoa(String.fromCharCode(...bytes))`, which overflows the call stack on large payloads | Chunked conversion, tested with a ~280 KB message. |
| Async encryption could reorder messages | Outgoing and incoming messages are chained and keep their order. |
| Supervisor: going offline again while a return to the primary was pending did not cancel the return | Cancelled, with a test. |
| "No duplicate messages" in a comment, but nothing enforced it | Optional id-based de-duplication, with a test. |
| Tied to Supabase, Capacitor and app-internal modules | No dependencies. Transports are injected. |

## Honest limits

- **The key comes from a short session code.** A passive attacker who records ciphertext can brute-force a low-entropy code offline. The scheme deters casual snooping on a shared LAN or hotspot. It is not a substitute for a real key exchange when the content is sensitive.
- No forward secrecy, no replay protection, and no sender authentication: everyone who knows the code can send.
- Only two modes (primary and fallback). In the full product there are more transport tiers, and the operator chooses the tier before a session starts. Only the switch between cloud and local network is automatic.
- Tests run against an in-memory transport. Real WebSocket, Bluetooth or cloud transports are not part of this repository.

## About

Built by Alexander Deibel. I build and operate AI and real-time products and set up agentic engineering workflows for teams. Contact: hello@fintutto.de
