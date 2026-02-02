/**
 * OCFT - OpenClaw File Transfer Protocol
 * Message Types and Interfaces
 */

export const OCFT_VERSION = '1.0';

// Message Types
export type MessageType = 
  | 'offer'      // File transfer offer
  | 'accept'     // Accept transfer
  | 'reject'     // Reject transfer
  | 'chunk'      // Data chunk
  | 'ack'        // Chunk acknowledgement
  | 'complete'   // Transfer complete
  | 'error';     // Error

// Base Message
export interface OCFTMessage {
  version: string;
  type: MessageType;
  transferId: string;
  from: string;       // Sender bot ID
  to: string;         // Receiver bot ID
  timestamp: number;
  payload: unknown;
}

// Offer Payload - File transfer proposal
export interface OfferPayload {
  filename: string;
  size: number;
  mimeType: string;
  hash: string;        // SHA-256 of entire file
  chunkSize: number;   // bytes per chunk (default 48KB for base64 safety)
  totalChunks: number;
  secret?: string;     // Optional secret for auto-accept
  metadata?: Record<string, unknown>;
}

// Accept Payload
export interface AcceptPayload {
  ready: boolean;
}

// Reject Payload
export interface RejectPayload {
  reason: string;
}

// Chunk Payload
export interface ChunkPayload {
  index: number;
  data: string;        // Base64 encoded
  hash: string;        // SHA-256 of this chunk
}

// Ack Payload
export interface AckPayload {
  index: number;
  received: boolean;
  error?: string;
}

// Complete Payload
export interface CompletePayload {
  totalChunks: number;
  hash: string;        // Final hash verification
}

// Error Payload
export interface ErrorPayload {
  code: string;
  message: string;
  recoverable: boolean;
}

// Transfer State
export type TransferState = 
  | 'pending'      // Offer sent, waiting for response
  | 'accepted'     // Accepted, ready to send
  | 'rejected'     // Rejected
  | 'transferring' // Sending/receiving chunks
  | 'completing'   // All chunks sent, waiting for final ack
  | 'completed'    // Successfully completed
  | 'failed'       // Failed with error
  | 'cancelled';   // Cancelled by user

// Transfer Info (tracked by both sender and receiver)
export interface TransferInfo {
  id: string;
  direction: 'send' | 'receive';
  state: TransferState;
  peerId: string;
  filename: string;
  size: number;
  mimeType: string;
  hash: string;
  chunkSize: number;
  totalChunks: number;
  receivedChunks: Set<number>;
  startedAt: number;
  updatedAt: number;
  completedAt?: number;
  error?: string;
  localPath?: string;  // For receiver: where to save
}

// Create Message Helper
export function createMessage<T>(
  type: MessageType,
  transferId: string,
  from: string,
  to: string,
  payload: T
): OCFTMessage {
  return {
    version: OCFT_VERSION,
    type,
    transferId,
    from,
    to,
    timestamp: Date.now(),
    payload
  };
}

// Serialize/Deserialize
export function serialize(msg: OCFTMessage): string {
  return JSON.stringify(msg);
}

export function deserialize(data: string): OCFTMessage | null {
  try {
    const msg = JSON.parse(data);
    if (msg.version && msg.type && msg.transferId) {
      return msg as OCFTMessage;
    }
    return null;
  } catch {
    return null;
  }
}

// Magic prefix for OCFT messages (to identify in chat)
export const OCFT_PREFIX = '🔗OCFT:';

// Encode message for chat (with prefix)
export function encodeForChat(msg: OCFTMessage): string {
  const json = serialize(msg);
  const b64 = Buffer.from(json).toString('base64');
  return `${OCFT_PREFIX}${b64}`;
}

// Decode message from chat
export function decodeFromChat(text: string): OCFTMessage | null {
  if (!text.startsWith(OCFT_PREFIX)) return null;
  try {
    const b64 = text.slice(OCFT_PREFIX.length);
    const json = Buffer.from(b64, 'base64').toString('utf-8');
    return deserialize(json);
  } catch {
    return null;
  }
}
