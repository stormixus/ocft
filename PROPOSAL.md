# OpenClaw File Transfer Protocol (OCFT)

## 개요

OpenClaw 봇 간 파일을 안전하고 효율적으로 전송하는 프로토콜.

## 시나리오

```
[Bot A] ──파일──> [Bot B]
   │                 │
   └── Telegram/Discord/Direct ──┘
```

## 전송 방식

### Option 1: 메시지 채널 경유 (Telegram/Discord)
- 장점: 기존 인프라 활용, NAT 통과 용이
- 단점: 파일 크기 제한, 느림, 채널 의존

### Option 2: 직접 연결 (WebSocket/HTTP)
- 장점: 빠름, 대용량 지원
- 단점: 네트워크 설정 필요, 방화벽 이슈

### Option 3: 릴레이 서버 경유
- 장점: NAT 통과, 안정적
- 단점: 중앙 서버 필요

## 추천: 하이브리드 방식

1. **작은 파일 (<1MB)**: Base64 인코딩 → 메시지 채널
2. **큰 파일 (>1MB)**: 릴레이 서버 또는 직접 연결

---

## 프로토콜 설계

### 메시지 포맷

```typescript
interface OCFTMessage {
  version: '1.0';
  type: 'offer' | 'accept' | 'reject' | 'chunk' | 'ack' | 'complete' | 'error';
  transferId: string;
  from: string;      // 보내는 봇 ID
  to: string;        // 받는 봇 ID
  timestamp: number;
  payload: any;
}
```

### 전송 흐름

```
[Sender]                    [Receiver]
    │                           │
    │── OFFER ─────────────────>│  (파일 메타데이터)
    │<───────────── ACCEPT ─────│  (수락)
    │── CHUNK[0] ──────────────>│
    │<───────────── ACK[0] ─────│
    │── CHUNK[1] ──────────────>│
    │<───────────── ACK[1] ─────│
    │...                        │
    │── COMPLETE ──────────────>│
    │<───────────── ACK ────────│
```

### Offer 페이로드

```typescript
interface OfferPayload {
  filename: string;
  size: number;
  mimeType: string;
  hash: string;         // SHA-256
  chunkSize: number;    // 기본 64KB
  totalChunks: number;
  metadata?: object;    // 추가 정보
}
```

### Chunk 페이로드

```typescript
interface ChunkPayload {
  index: number;
  data: string;         // Base64
  hash: string;         // 청크 해시
}
```

---

## 구현 계획

### Phase 1: 코어 프로토콜
- [ ] 메시지 포맷 정의
- [ ] 직렬화/역직렬화
- [ ] 청크 분할/조립
- [ ] 해시 검증

### Phase 2: 전송 레이어
- [ ] 메시지 채널 어댑터 (Telegram/Discord)
- [ ] WebSocket 직접 연결
- [ ] 릴레이 서버 (선택)

### Phase 3: OpenClaw 통합
- [ ] 스킬로 패키징
- [ ] CLI 명령어
- [ ] 자동 수락 정책

---

## 파일 구조

```
openclaw-file-protocol/
├── src/
│   ├── protocol.ts      # 메시지 정의
│   ├── chunker.ts       # 파일 분할/조립
│   ├── crypto.ts        # 해싱/암호화
│   ├── sender.ts        # 전송 로직
│   ├── receiver.ts      # 수신 로직
│   └── adapters/
│       ├── telegram.ts  # Telegram 어댑터
│       ├── websocket.ts # WebSocket 어댑터
│       └── relay.ts     # 릴레이 서버
├── package.json
└── README.md
```

---

## 보안 고려사항

1. **인증**: 봇 ID 검증
2. **암호화**: 선택적 E2E 암호화
3. **검증**: 청크 및 전체 파일 해시 검증
4. **제한**: 최대 파일 크기, 전송 속도 제한
5. **정책**: 자동 수락 화이트리스트

---

## 다음 단계

군주님, 어떤 방식으로 진행할까요?

1. **메시지 채널 우선** — Telegram 메시지로 작은 파일 전송
2. **WebSocket 우선** — 직접 연결로 빠른 전송
3. **릴레이 서버 우선** — 중앙 서버 경유

또는 특정 요구사항이 있으시면 말씀해주세요.
