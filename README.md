# OCFT - OpenClaw File Transfer Protocol

봇 간 메시지 채널(Telegram/Discord 등)을 통한 P2P 파일 전송 프로토콜.

## 특징

- 🔗 **메시지 기반**: 기존 채팅 채널을 통한 파일 전송
- 📦 **청크 전송**: 대용량 파일을 작은 조각으로 분할
- ✅ **무결성 검증**: SHA-256 해시로 청크/파일 검증
- 🤝 **요청/수락**: 명시적 수락 또는 자동 수락 정책
- 🔒 **보안**: 신뢰할 수 있는 피어 화이트리스트

## 설치

```bash
npm install
```

## 데모

```bash
npm run demo
```

## 프로토콜 흐름

```
[Sender]                    [Receiver]
    │                           │
    │── OFFER ─────────────────>│  파일 메타데이터
    │<───────────── ACCEPT ─────│  수락
    │── CHUNK[0] ──────────────>│  데이터 청크
    │<───────────── ACK[0] ─────│  수신 확인
    │── CHUNK[1] ──────────────>│
    │<───────────── ACK[1] ─────│
    │...                        │
    │── COMPLETE ──────────────>│  전송 완료
    │<───────────── ACK ────────│  최종 확인
```

## 메시지 타입

| Type | 설명 |
|------|------|
| `offer` | 파일 전송 제안 (메타데이터 포함) |
| `accept` | 전송 수락 |
| `reject` | 전송 거절 |
| `chunk` | 데이터 청크 (Base64) |
| `ack` | 청크 수신 확인 |
| `complete` | 전송 완료 |
| `error` | 오류 |

## 사용법

```typescript
import { TransferManager } from './transfer.js';

// 봇 초기화
const bot = new TransferManager({
  botId: 'my-bot',
  downloadDir: './downloads',
  autoAccept: true,
  trustedPeers: ['friend-bot'],
  maxFileSize: 100 * 1024 * 1024 // 100MB
}, async (to, message) => {
  // 메시지 전송 함수 (Telegram/Discord API 호출)
  await sendMessage(to, message);
});

// 이벤트 핸들러
bot.on('offer-received', (transfer) => {
  console.log(`Offer: ${transfer.filename}`);
  // bot.acceptTransfer(transfer.id) 또는
  // bot.rejectTransfer(transfer.id, 'reason')
});

bot.on('transfer-completed', (transfer) => {
  console.log(`Saved: ${transfer.localPath}`);
});

// 파일 전송
const transferId = await bot.sendFile('other-bot', '/path/to/file.txt');

// 수신 메시지 처리
bot.handleMessage(fromId, messageText);
```

## 파일 구조

```
src/
├── protocol.ts   # 메시지 타입 정의
├── chunker.ts    # 파일 분할/조립
├── transfer.ts   # TransferManager
└── demo.ts       # 데모
```

## 메시지 포맷

OCFT 메시지는 `🔗OCFT:` 접두사 + Base64 인코딩된 JSON:

```
🔗OCFT:eyJ2ZXJzaW9uIjoiMS4wIiwidHlwZSI6Im9mZmVyIi4uLn0=
```

## 제한사항

- 청크 크기: 48KB (Base64 안전 범위)
- 기본 최대 파일 크기: 100MB
- Telegram 메시지 제한 고려 필요

## License

MIT
