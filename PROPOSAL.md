# OCFT - OpenClaw File Transfer Protocol

P2P file transfer protocol for AI agents via message channels.

## Overview

OCFT enables agents to transfer files directly through existing chat channels (Telegram, Discord, etc.) using a simple offer/accept handshake with chunked data transfer.

## Transmission Methods

### Option 1: Message Channel (Telegram/Discord)
- Pros: Uses existing infrastructure, NAT traversal built-in
- Cons: File size limits, slower, channel-dependent

### Option 2: Direct Connection (WebSocket/HTTP)
- Pros: Fast, large file support
- Cons: Firewall issues, network configuration required

### Option 3: Relay Server
- Pros: NAT traversal, reliable
- Cons: Central server required

## Recommended: Hybrid Approach

1. **Small files (<1MB)**: Base64 encoded via message channel
2. **Large files (>1MB)**: Relay server or direct connection

---

## Protocol Design

### Message Format

```typescript
interface OCFTMessage {
  version: '1.0';
  type: 'offer' | 'accept' | 'reject' | 'chunk' | 'ack' | 'complete' | 'error';
  transferId: string;
  from: string;      // Sender bot ID
  to: string;        // Receiver bot ID
  timestamp: number;
  payload: any;
}
```

### Transfer Flow

```
[Sender]                    [Receiver]
    │                           │
    │── OFFER ─────────────────>│  (file metadata)
    │<───────────── ACCEPT ─────│  (accepted)
    │── CHUNK[0] ──────────────>│
    │<───────────── ACK[0] ─────│
    │── CHUNK[1] ──────────────>│
    │<───────────── ACK[1] ─────│
    │...                        │
    │── COMPLETE ──────────────>│
    │<───────────── ACK ────────│
```

### Offer Payload

```typescript
interface OfferPayload {
  filename: string;
  size: number;
  mimeType: string;
  hash: string;         // SHA-256
  chunkSize: number;    // Default 64KB
  totalChunks: number;
  secret?: string;      // For auto-accept
  metadata?: object;
}
```

### Chunk Payload

```typescript
interface ChunkPayload {
  index: number;
  data: string;         // Base64
  hash: string;         // Chunk hash
}
```

---

## Implementation Plan

### Phase 1: Core Protocol
- [x] Message format definition
- [x] Serialization/deserialization
- [x] Chunk split/reassembly
- [x] Hash verification

### Phase 2: Transport Layer
- [x] Message channel adapter (Telegram/Discord)
- [ ] WebSocket direct connection
- [ ] Relay server (optional)

### Phase 3: OpenClaw Integration
- [ ] Package as skill
- [ ] CLI commands
- [ ] Auto-accept policies

---

## File Structure

```
openclaw-file-protocol/
├── src/
│   ├── protocol.ts      # Message definitions
│   ├── chunker.ts       # File split/reassembly
│   ├── transfer.ts      # Transfer logic
│   ├── cli.ts           # CLI tool
│   └── demo.ts          # Demo script
├── package.json
└── README.md
```

---

## Security Considerations

1. **Authentication**: Bot ID verification
2. **Encryption**: Optional E2E encryption
3. **Verification**: Chunk and full file hash verification
4. **Limits**: Max file size, transfer rate limiting
5. **Policy**: Auto-accept whitelist via secrets

---

## Secret-Based Auto-Accept

When sender knows receiver's secret, files are automatically accepted without manual approval:

```
Sender includes receiver's secret in OFFER
  → Receiver verifies secret matches their own
  → Auto-ACCEPT (no user interaction needed)
```

This enables trusted agent networks to share files seamlessly.
