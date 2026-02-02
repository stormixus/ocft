/**
 * OCFT - Transfer Manager
 * Handles sending and receiving file transfers
 */

import { nanoid } from 'nanoid';
import { 
  OCFTMessage, MessageType, TransferInfo, TransferState,
  OfferPayload, AcceptPayload, RejectPayload, ChunkPayload, AckPayload, CompletePayload, ErrorPayload,
  createMessage, encodeForChat, decodeFromChat, OCFT_PREFIX
} from './protocol.js';
import { getFileInfo, readChunk, ChunkAssembler, DEFAULT_CHUNK_SIZE } from './chunker.js';
import { EventEmitter } from 'events';

export interface TrustedPeer {
  id: string;
  secret: string;
  name?: string;
  expiresAt?: number;  // TTL: timestamp when this peer's trust expires
}

export interface TransferManagerConfig {
  botId: string;                    // This bot's ID
  secret: string;                   // This node's secret
  secretTTL?: number;               // Secret TTL in milliseconds (default: no expiry)
  downloadDir: string;              // Where to save received files
  autoAccept?: boolean;             // Auto-accept from trusted peers (by ID)
  trustedPeers?: TrustedPeer[];     // Trusted peers with secrets
  maxFileSize?: number;             // Max file size to accept (bytes)
  chunkSize?: number;               // Chunk size
}

export interface SendMessageFn {
  (to: string, message: string): Promise<void>;
}

export class TransferManager extends EventEmitter {
  private config: TransferManagerConfig;
  private transfers: Map<string, TransferInfo> = new Map();
  private assemblers: Map<string, ChunkAssembler> = new Map();
  private sendMessage: SendMessageFn;
  private filePaths: Map<string, string> = new Map(); // transferId -> local file path
  
  constructor(config: TransferManagerConfig, sendMessage: SendMessageFn) {
    super();
    this.config = {
      autoAccept: false,
      trustedPeers: [],
      maxFileSize: 100 * 1024 * 1024, // 100MB default
      chunkSize: DEFAULT_CHUNK_SIZE,
      ...config
    };
    this.sendMessage = sendMessage;
  }
  
  // ============ PUBLIC API ============
  
  // Start sending a file to a peer
  async sendFile(peerId: string, filePath: string): Promise<string> {
    const fileInfo = await getFileInfo(filePath, this.config.chunkSize);
    const transferId = `xfer_${nanoid(12)}`;
    
    const transfer: TransferInfo = {
      id: transferId,
      direction: 'send',
      state: 'pending',
      peerId,
      filename: fileInfo.filename,
      size: fileInfo.size,
      mimeType: fileInfo.mimeType,
      hash: fileInfo.hash,
      chunkSize: fileInfo.chunkSize,
      totalChunks: fileInfo.totalChunks,
      receivedChunks: new Set(),
      startedAt: Date.now(),
      updatedAt: Date.now(),
      localPath: filePath
    };
    
    this.transfers.set(transferId, transfer);
    this.filePaths.set(transferId, filePath);
    
    // Send offer
    const offer = createMessage<OfferPayload>('offer', transferId, this.config.botId, peerId, {
      filename: fileInfo.filename,
      size: fileInfo.size,
      mimeType: fileInfo.mimeType,
      hash: fileInfo.hash,
      chunkSize: fileInfo.chunkSize,
      totalChunks: fileInfo.totalChunks,
      secret: this.getPeerSecret(peerId),  // Include peer's secret for auto-accept
      secretTTL: this.config.secretTTL ? Date.now() + this.config.secretTTL : undefined
    });
    
    await this.send(peerId, offer);
    this.emit('offer-sent', transfer);
    
    return transferId;
  }
  
  // Accept a pending transfer
  async acceptTransfer(transferId: string, resumeFrom?: number): Promise<void> {
    const transfer = this.transfers.get(transferId);
    if (!transfer || transfer.direction !== 'receive' || transfer.state !== 'pending') {
      throw new Error('Invalid transfer or already processed');
    }
    
    transfer.state = 'accepted';
    transfer.updatedAt = Date.now();
    transfer.resumable = true;
    
    // Create assembler
    const outputPath = `${this.config.downloadDir}/${transfer.filename}`;
    transfer.localPath = outputPath;
    const assembler = new ChunkAssembler(outputPath, transfer.hash, transfer.totalChunks);
    this.assemblers.set(transferId, assembler);
    
    // Send accept (with optional resume point)
    const accept = createMessage<AcceptPayload>('accept', transferId, this.config.botId, transfer.peerId, {
      ready: true,
      resumeFrom: resumeFrom
    });
    
    await this.send(transfer.peerId, accept);
    this.emit('transfer-accepted', transfer);
  }
  
  // Reject a pending transfer
  async rejectTransfer(transferId: string, reason: string): Promise<void> {
    const transfer = this.transfers.get(transferId);
    if (!transfer || transfer.direction !== 'receive' || transfer.state !== 'pending') {
      throw new Error('Invalid transfer or already processed');
    }
    
    transfer.state = 'rejected';
    transfer.updatedAt = Date.now();
    transfer.error = reason;
    
    const reject = createMessage<RejectPayload>('reject', transferId, this.config.botId, transfer.peerId, {
      reason
    });
    
    await this.send(transfer.peerId, reject);
    this.emit('transfer-rejected', transfer);
  }
  
  // Get transfer status
  getTransfer(transferId: string): TransferInfo | undefined {
    return this.transfers.get(transferId);
  }
  
  // List all transfers
  listTransfers(): TransferInfo[] {
    return Array.from(this.transfers.values());
  }
  
  // ============ MESSAGE HANDLING ============
  
  // Process incoming message (call this when receiving a message)
  async handleMessage(fromId: string, text: string): Promise<boolean> {
    if (!text.startsWith(OCFT_PREFIX)) return false;
    
    const msg = decodeFromChat(text);
    if (!msg) return false;
    if (msg.to !== this.config.botId) return false;
    
    switch (msg.type) {
      case 'offer':
        await this.handleOffer(msg);
        break;
      case 'accept':
        await this.handleAccept(msg);
        break;
      case 'reject':
        await this.handleReject(msg);
        break;
      case 'chunk':
        await this.handleChunk(msg);
        break;
      case 'ack':
        await this.handleAck(msg);
        break;
      case 'complete':
        await this.handleComplete(msg);
        break;
      case 'error':
        await this.handleError(msg);
        break;
    }
    
    return true;
  }
  
  // ============ HANDLERS ============
  
  private async handleOffer(msg: OCFTMessage): Promise<void> {
    const payload = msg.payload as OfferPayload;
    
    // Check file size limit
    if (payload.size > (this.config.maxFileSize || Infinity)) {
      const reject = createMessage<RejectPayload>('reject', msg.transferId, this.config.botId, msg.from, {
        reason: `File too large: ${payload.size} bytes exceeds limit`
      });
      await this.send(msg.from, reject);
      return;
    }
    
    const transfer: TransferInfo = {
      id: msg.transferId,
      direction: 'receive',
      state: 'pending',
      peerId: msg.from,
      filename: payload.filename,
      size: payload.size,
      mimeType: payload.mimeType,
      hash: payload.hash,
      chunkSize: payload.chunkSize,
      totalChunks: payload.totalChunks,
      receivedChunks: new Set(),
      startedAt: Date.now(),
      updatedAt: Date.now()
    };
    
    this.transfers.set(msg.transferId, transfer);
    this.emit('offer-received', transfer);
    
    // Auto-accept if sender knows our secret (with TTL check)
    if (this.isValidSecret(payload.secret, payload.secretTTL)) {
      await this.acceptTransfer(msg.transferId, payload.resumeFrom);
      return;
    }
    
    // Auto-accept if peer is in trusted list (legacy) with valid trust
    if (this.config.autoAccept) {
      const trustedPeer = this.config.trustedPeers?.find(p => p.id === msg.from);
      if (trustedPeer && this.isPeerTrustValid(trustedPeer)) {
        await this.acceptTransfer(msg.transferId, payload.resumeFrom);
      }
    }
  }
  
  private async handleAccept(msg: OCFTMessage): Promise<void> {
    const transfer = this.transfers.get(msg.transferId);
    if (!transfer || transfer.direction !== 'send') return;
    
    transfer.state = 'transferring';
    transfer.updatedAt = Date.now();
    this.emit('transfer-started', transfer);
    
    // Check for resume point
    const payload = msg.payload as AcceptPayload;
    const startIndex = payload.resumeFrom ?? 0;
    
    // Start sending chunks from resume point
    await this.sendNextChunk(msg.transferId, startIndex);
  }
  
  private async handleReject(msg: OCFTMessage): Promise<void> {
    const transfer = this.transfers.get(msg.transferId);
    if (!transfer) return;
    
    const payload = msg.payload as RejectPayload;
    transfer.state = 'rejected';
    transfer.error = payload.reason;
    transfer.updatedAt = Date.now();
    
    this.emit('transfer-rejected', transfer);
  }
  
  private async handleChunk(msg: OCFTMessage): Promise<void> {
    const transfer = this.transfers.get(msg.transferId);
    if (!transfer || transfer.direction !== 'receive') return;
    
    const payload = msg.payload as ChunkPayload;
    const assembler = this.assemblers.get(msg.transferId);
    if (!assembler) return;
    
    transfer.state = 'transferring';
    
    // Decode and add chunk
    const data = Buffer.from(payload.data, 'base64');
    const success = assembler.addChunk(payload.index, data, payload.hash);
    
    if (success) {
      transfer.receivedChunks.add(payload.index);
    }
    transfer.updatedAt = Date.now();
    
    // Send ack
    const ack = createMessage<AckPayload>('ack', msg.transferId, this.config.botId, msg.from, {
      index: payload.index,
      received: success,
      error: success ? undefined : 'Hash mismatch'
    });
    
    await this.send(msg.from, ack);
    
    this.emit('chunk-received', { transfer, index: payload.index, progress: assembler.getProgress() });
  }
  
  private async handleAck(msg: OCFTMessage): Promise<void> {
    const transfer = this.transfers.get(msg.transferId);
    if (!transfer || transfer.direction !== 'send') return;
    
    // Ignore acks after completing
    if (transfer.state === 'completed' || transfer.state === 'completing') {
      // Final ack from receiver
      if ((msg.payload as AckPayload).index === -1) {
        transfer.state = 'completed';
        transfer.completedAt = Date.now();
        this.emit('transfer-completed', transfer);
      }
      return;
    }
    
    const payload = msg.payload as AckPayload;
    
    if (!payload.received) {
      // Resend chunk on error
      await this.sendNextChunk(msg.transferId, payload.index);
      return;
    }
    
    transfer.receivedChunks.add(payload.index);
    transfer.updatedAt = Date.now();
    
    this.emit('ack-received', { transfer, index: payload.index });
    
    // Send next chunk or complete
    const nextIndex = payload.index + 1;
    if (nextIndex < transfer.totalChunks) {
      await this.sendNextChunk(msg.transferId, nextIndex);
    } else {
      // All chunks sent, send complete
      transfer.state = 'completing';
      const complete = createMessage<CompletePayload>('complete', msg.transferId, this.config.botId, transfer.peerId, {
        totalChunks: transfer.totalChunks,
        hash: transfer.hash
      });
      await this.send(transfer.peerId, complete);
    }
  }
  
  private async handleComplete(msg: OCFTMessage): Promise<void> {
    const transfer = this.transfers.get(msg.transferId);
    if (!transfer || transfer.direction !== 'receive') return;
    
    const assembler = this.assemblers.get(msg.transferId);
    if (!assembler) return;
    
    // Assemble file
    const result = await assembler.assemble();
    
    if (result.success) {
      transfer.state = 'completed';
      transfer.completedAt = Date.now();
      this.emit('transfer-completed', transfer);
    } else {
      transfer.state = 'failed';
      transfer.error = result.error;
      this.emit('transfer-failed', transfer);
    }
    
    transfer.updatedAt = Date.now();
    
    // Send final ack
    const ack = createMessage<AckPayload>('ack', msg.transferId, this.config.botId, msg.from, {
      index: -1, // Special: final ack
      received: result.success,
      error: result.error
    });
    await this.send(msg.from, ack);
  }
  
  private async handleError(msg: OCFTMessage): Promise<void> {
    const transfer = this.transfers.get(msg.transferId);
    if (!transfer) return;
    
    const payload = msg.payload as ErrorPayload;
    transfer.state = 'failed';
    transfer.error = payload.message;
    transfer.updatedAt = Date.now();
    
    this.emit('transfer-failed', transfer);
  }
  
  // ============ HELPERS ============
  
  private async sendNextChunk(transferId: string, index: number): Promise<void> {
    const transfer = this.transfers.get(transferId);
    const filePath = this.filePaths.get(transferId);
    if (!transfer || !filePath) return;
    
    const chunk = await readChunk(filePath, index, transfer.chunkSize);
    
    const chunkMsg = createMessage<ChunkPayload>('chunk', transferId, this.config.botId, transfer.peerId, {
      index: chunk.index,
      data: chunk.data.toString('base64'),
      hash: chunk.hash
    });
    
    await this.send(transfer.peerId, chunkMsg);
    this.emit('chunk-sent', { transfer, index });
  }
  
  private async send(to: string, msg: OCFTMessage): Promise<void> {
    const encoded = encodeForChat(msg);
    await this.sendMessage(to, encoded);
  }
  
  // Get peer's secret from trusted peers list
  private getPeerSecret(peerId: string): string | undefined {
    const peer = this.config.trustedPeers?.find(p => p.id === peerId);
    return peer?.secret;
  }
  
  // Check if incoming secret matches our secret (with TTL validation)
  private isValidSecret(secret: string | undefined, secretTTL?: number): boolean {
    if (!secret) return false;
    if (secret !== this.config.secret) return false;
    
    // Check TTL if provided
    if (secretTTL && Date.now() > secretTTL) {
      return false; // Secret has expired
    }
    
    return true;
  }
  
  // Check if a trusted peer's trust has expired
  private isPeerTrustValid(peer: TrustedPeer): boolean {
    if (!peer.expiresAt) return true; // No expiry set
    return Date.now() < peer.expiresAt;
  }
  
  // Resume an interrupted transfer
  async resumeTransfer(transferId: string): Promise<void> {
    const transfer = this.transfers.get(transferId);
    if (!transfer) {
      throw new Error('Transfer not found');
    }
    
    if (transfer.state === 'completed') {
      throw new Error('Transfer already completed');
    }
    
    if (transfer.direction === 'receive') {
      // For receiver: find the last received chunk and accept from there
      const lastChunk = Math.max(...Array.from(transfer.receivedChunks), -1);
      transfer.state = 'pending';
      await this.acceptTransfer(transferId, lastChunk + 1);
    } else {
      // For sender: find the last acknowledged chunk and resend offer
      const lastAcked = Math.max(...Array.from(transfer.receivedChunks), -1);
      const filePath = this.filePaths.get(transferId);
      if (!filePath) throw new Error('File path not found');
      
      const offer = createMessage<OfferPayload>('offer', transferId, this.config.botId, transfer.peerId, {
        filename: transfer.filename,
        size: transfer.size,
        mimeType: transfer.mimeType,
        hash: transfer.hash,
        chunkSize: transfer.chunkSize,
        totalChunks: transfer.totalChunks,
        secret: this.getPeerSecret(transfer.peerId),
        secretTTL: this.config.secretTTL ? Date.now() + this.config.secretTTL : undefined,
        resumeFrom: lastAcked + 1
      });
      
      transfer.state = 'pending';
      await this.send(transfer.peerId, offer);
      this.emit('transfer-resumed', transfer);
    }
  }
  
  // Get list of resumable transfers
  getResumableTransfers(): TransferInfo[] {
    return Array.from(this.transfers.values()).filter(t => 
      t.resumable && 
      t.state !== 'completed' && 
      t.state !== 'rejected' &&
      t.receivedChunks.size > 0
    );
  }
}
