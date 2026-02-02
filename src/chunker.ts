/**
 * OCFT - File Chunker
 * Split files into chunks for transfer, reassemble on receive
 */

import { createHash } from 'crypto';
import { readFile, writeFile, stat } from 'fs/promises';

export const DEFAULT_CHUNK_SIZE = 48 * 1024; // 48KB (safe for base64 in messages)

export interface FileInfo {
  filename: string;
  size: number;
  mimeType: string;
  hash: string;
  chunkSize: number;
  totalChunks: number;
}

export interface Chunk {
  index: number;
  data: Buffer;
  hash: string;
}

// Calculate SHA-256 hash
export function sha256(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex');
}

// Get file info without loading entire file
export async function getFileInfo(
  filePath: string,
  chunkSize = DEFAULT_CHUNK_SIZE
): Promise<FileInfo> {
  const stats = await stat(filePath);
  const data = await readFile(filePath);
  const hash = sha256(data);
  const totalChunks = Math.ceil(stats.size / chunkSize);
  
  // Guess mime type from extension
  const ext = filePath.split('.').pop()?.toLowerCase() || '';
  const mimeTypes: Record<string, string> = {
    'txt': 'text/plain',
    'json': 'application/json',
    'js': 'text/javascript',
    'ts': 'text/typescript',
    'html': 'text/html',
    'css': 'text/css',
    'md': 'text/markdown',
    'png': 'image/png',
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'gif': 'image/gif',
    'webp': 'image/webp',
    'pdf': 'application/pdf',
    'zip': 'application/zip',
    'tar': 'application/x-tar',
    'gz': 'application/gzip',
  };
  
  return {
    filename: filePath.split('/').pop() || 'file',
    size: stats.size,
    mimeType: mimeTypes[ext] || 'application/octet-stream',
    hash,
    chunkSize,
    totalChunks
  };
}

// Read a specific chunk from file
export async function readChunk(
  filePath: string,
  index: number,
  chunkSize = DEFAULT_CHUNK_SIZE
): Promise<Chunk> {
  const data = await readFile(filePath);
  const start = index * chunkSize;
  const end = Math.min(start + chunkSize, data.length);
  const chunkData = data.subarray(start, end);
  
  return {
    index,
    data: chunkData,
    hash: sha256(chunkData)
  };
}

// Read all chunks from file
export async function* readAllChunks(
  filePath: string,
  chunkSize = DEFAULT_CHUNK_SIZE
): AsyncGenerator<Chunk> {
  const data = await readFile(filePath);
  const totalChunks = Math.ceil(data.length / chunkSize);
  
  for (let i = 0; i < totalChunks; i++) {
    const start = i * chunkSize;
    const end = Math.min(start + chunkSize, data.length);
    const chunkData = data.subarray(start, end);
    
    yield {
      index: i,
      data: chunkData,
      hash: sha256(chunkData)
    };
  }
}

// Chunk assembler for receiving
export class ChunkAssembler {
  private chunks: Map<number, Buffer> = new Map();
  private expectedHash: string;
  private totalChunks: number;
  private outputPath: string;
  
  constructor(outputPath: string, expectedHash: string, totalChunks: number) {
    this.outputPath = outputPath;
    this.expectedHash = expectedHash;
    this.totalChunks = totalChunks;
  }
  
  // Add a chunk
  addChunk(index: number, data: Buffer, expectedChunkHash: string): boolean {
    const actualHash = sha256(data);
    if (actualHash !== expectedChunkHash) {
      console.error(`Chunk ${index} hash mismatch: expected ${expectedChunkHash}, got ${actualHash}`);
      return false;
    }
    this.chunks.set(index, data);
    return true;
  }
  
  // Check if all chunks received
  isComplete(): boolean {
    return this.chunks.size === this.totalChunks;
  }
  
  // Get missing chunk indices
  getMissingChunks(): number[] {
    const missing: number[] = [];
    for (let i = 0; i < this.totalChunks; i++) {
      if (!this.chunks.has(i)) {
        missing.push(i);
      }
    }
    return missing;
  }
  
  // Progress (0-100)
  getProgress(): number {
    return Math.round((this.chunks.size / this.totalChunks) * 100);
  }
  
  // Assemble and save file
  async assemble(): Promise<{ success: boolean; error?: string }> {
    if (!this.isComplete()) {
      return { success: false, error: `Missing chunks: ${this.getMissingChunks().join(', ')}` };
    }
    
    // Combine chunks in order
    const buffers: Buffer[] = [];
    for (let i = 0; i < this.totalChunks; i++) {
      const chunk = this.chunks.get(i);
      if (!chunk) {
        return { success: false, error: `Missing chunk ${i}` };
      }
      buffers.push(chunk);
    }
    
    const combined = Buffer.concat(buffers);
    const actualHash = sha256(combined);
    
    if (actualHash !== this.expectedHash) {
      return { 
        success: false, 
        error: `File hash mismatch: expected ${this.expectedHash}, got ${actualHash}` 
      };
    }
    
    await writeFile(this.outputPath, combined);
    return { success: true };
  }
}
