# OCFT - OpenClaw File Transfer Protocol

P2P file transfer between AI agents via message channels.

## Features

- 🔗 **Message-based**: Transfer files through existing chat channels
- 📦 **Chunked transfer**: Split large files into small pieces
- ✅ **Integrity verification**: SHA-256 hash for chunks and files
- 🤝 **Request/Accept**: Explicit acceptance or auto-accept policy
- 🔒 **Security**: Trusted peer whitelist with secrets

## Installation

```bash
npm install -g ocft
```

## Quick Start

```bash
# Initialize your node (generates unique ID and secret)
ocft init

# View your status
ocft status

# Export your connection info to share with peers
ocft export

# Add a trusted peer
ocft add-peer <nodeId> <secret> --name "Friend"

# Or import from URI
ocft import ocft://eyJub2RlSWQ...
```

## CLI Commands

| Command | Description |
|---------|-------------|
| `ocft init` | Initialize node with unique ID and secret |
| `ocft status` | Show node status and configuration |
| `ocft show-secret` | Display full secret (careful!) |
| `ocft export` | Export connection info as URI |
| `ocft import <uri>` | Import peer from ocft:// URI |
| `ocft add-peer <id> <secret>` | Add a trusted peer |
| `ocft remove-peer <id>` | Remove a trusted peer |
| `ocft list-peers` | List all trusted peers |
| `ocft set-download <dir>` | Set download directory |
| `ocft verify <secret>` | Verify if a secret matches yours |

## Protocol Flow

```
[Sender]                    [Receiver]
    │                           │
    │── OFFER ─────────────────>│  (file metadata + secret)
    │<───────────── ACCEPT ─────│  (auto-accept if secret valid)
    │── CHUNK[0] ──────────────>│
    │<───────────── ACK[0] ─────│
    │── CHUNK[1] ──────────────>│
    │<───────────── ACK[1] ─────│
    │...                        │
    │── COMPLETE ──────────────>│
    │<───────────── ACK ────────│
```

## Secret-Based Auto-Accept

When the sender knows the receiver's secret, files are automatically accepted without manual approval:

1. Bot A shares their secret with Bot B
2. Bot B adds Bot A as trusted peer with the secret
3. When Bot B sends a file to Bot A, it includes A's secret
4. Bot A verifies the secret and auto-accepts

This enables trusted agent networks to share files seamlessly.

## Programmatic Usage

```typescript
import { TransferManager } from 'ocft';

const bot = new TransferManager({
  botId: 'my-bot',
  secret: 'my-secret',
  downloadDir: './downloads',
  trustedPeers: [
    { id: 'friend-bot', secret: 'friends-secret' }
  ]
}, async (to, message) => {
  // Your message sending function
  await sendMessage(to, message);
});

// Event handlers
bot.on('offer-received', (transfer) => {
  console.log(`Incoming: ${transfer.filename}`);
});

bot.on('transfer-completed', (transfer) => {
  console.log(`Saved: ${transfer.localPath}`);
});

// Send a file
await bot.sendFile('friend-bot', '/path/to/file.txt');

// Handle incoming messages
bot.handleMessage(fromId, messageText);
```

## Message Format

OCFT messages use a `🔗OCFT:` prefix with Base64-encoded JSON:

```
🔗OCFT:eyJ2ZXJzaW9uIjoiMS4wIiwidHlwZSI6Im9mZmVyIi4uLn0=
```

This allows file transfers over any text-based channel (Telegram, Discord, Slack, etc).

## Configuration

Config is stored at `~/.ocft/config.json`:

```json
{
  "nodeId": "ocft_abc123_xyz789",
  "secret": "your-secret-key",
  "trustedPeers": [],
  "downloadDir": "~/Downloads/ocft"
}
```

## Limitations

- Chunk size: 48KB (safe for Base64 in messages)
- Default max file size: 100MB
- Designed for text-based channels

## License

MIT
