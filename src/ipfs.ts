/**
 * OCFT - IPFS Integration
 * Fallback to IPFS for large files or when peer doesn't support OCFT
 * Supports: Pinata, Filebase, Kubo (local node)
 */

import { createReadStream, statSync, readFileSync } from 'fs';
import { basename } from 'path';

export type IPFSProvider = 'pinata' | 'filebase' | 'kubo';

export interface IPFSConfig {
  provider?: IPFSProvider;    // IPFS provider (default: pinata)
  apiKey?: string;            // API key (Pinata JWT or Filebase access key)
  apiSecret?: string;         // API secret (Filebase only)
  kuboUrl?: string;           // Kubo API URL (default: http://localhost:5001)
  publicGateway?: string;     // Public gateway for downloads
  threshold?: number;         // Size threshold to use IPFS (bytes, default: 50MB)
}

export interface IPFSUploadResult {
  cid: string;
  url: string;
  size: number;
  filename: string;
  provider: IPFSProvider;
}

const DEFAULT_THRESHOLD = 50 * 1024 * 1024;  // 50MB
const DEFAULT_PUBLIC_GATEWAY = 'https://ipfs.io/ipfs';

const PROVIDER_GATEWAYS: Record<IPFSProvider, string> = {
  pinata: 'https://gateway.pinata.cloud/ipfs',
  filebase: 'https://ipfs.filebase.io/ipfs',
  kubo: 'https://ipfs.io/ipfs',
};

/**
 * Check if file should use IPFS based on size
 */
export function shouldUseIPFS(fileSize: number, threshold?: number): boolean {
  const limit = threshold ?? DEFAULT_THRESHOLD;
  return fileSize > limit;
}

/**
 * Upload file to IPFS via configured provider
 */
export async function uploadToIPFS(
  filePath: string,
  config: IPFSConfig
): Promise<IPFSUploadResult> {
  const provider = config.provider || 'pinata';
  
  switch (provider) {
    case 'pinata':
      return uploadToPinata(filePath, config);
    case 'filebase':
      return uploadToFilebase(filePath, config);
    case 'kubo':
      return uploadToKubo(filePath, config);
    default:
      throw new Error(`Unknown IPFS provider: ${provider}`);
  }
}

/**
 * Upload to Pinata
 */
async function uploadToPinata(filePath: string, config: IPFSConfig): Promise<IPFSUploadResult> {
  const stats = statSync(filePath);
  const filename = basename(filePath);
  
  if (!config.apiKey) {
    throw new Error('Pinata API key required. Set with: ocft set-ipfs-key <jwt>');
  }
  
  const FormData = (await import('form-data')).default;
  const form = new FormData();
  form.append('file', createReadStream(filePath), { filename });
  
  const response = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${config.apiKey}`,
      ...form.getHeaders(),
    },
    body: form as any,
  });
  
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Pinata upload failed: ${error}`);
  }
  
  const result = await response.json() as { IpfsHash: string };
  const gateway = config.publicGateway || PROVIDER_GATEWAYS.pinata;
  
  return {
    cid: result.IpfsHash,
    url: `${gateway}/${result.IpfsHash}?filename=${encodeURIComponent(filename)}`,
    size: stats.size,
    filename,
    provider: 'pinata',
  };
}

/**
 * Upload to Filebase (S3-compatible)
 */
async function uploadToFilebase(filePath: string, config: IPFSConfig): Promise<IPFSUploadResult> {
  const stats = statSync(filePath);
  const filename = basename(filePath);
  
  if (!config.apiKey || !config.apiSecret) {
    throw new Error('Filebase credentials required. Set with: ocft set-ipfs-key <accessKey> --secret <secretKey>');
  }
  
  // Filebase uses S3-compatible API
  const bucket = 'ocft-uploads';
  const endpoint = 'https://s3.filebase.com';
  
  const fileContent = readFileSync(filePath);
  const date = new Date().toUTCString();
  
  // Simple S3 PUT request (for basic uploads)
  const response = await fetch(`${endpoint}/${bucket}/${encodeURIComponent(filename)}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/octet-stream',
      'x-amz-date': date,
      'Authorization': `AWS ${config.apiKey}:${config.apiSecret}`,
    },
    body: fileContent,
  });
  
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Filebase upload failed: ${error}`);
  }
  
  // Get CID from response header
  const cid = response.headers.get('x-amz-meta-cid') || '';
  const gateway = config.publicGateway || PROVIDER_GATEWAYS.filebase;
  
  return {
    cid,
    url: `${gateway}/${cid}?filename=${encodeURIComponent(filename)}`,
    size: stats.size,
    filename,
    provider: 'filebase',
  };
}

/**
 * Upload to local Kubo node
 */
async function uploadToKubo(filePath: string, config: IPFSConfig): Promise<IPFSUploadResult> {
  const stats = statSync(filePath);
  const filename = basename(filePath);
  
  const kuboUrl = config.kuboUrl || 'http://localhost:5001';
  
  const FormData = (await import('form-data')).default;
  const form = new FormData();
  form.append('file', createReadStream(filePath), { filename });
  
  const response = await fetch(`${kuboUrl}/api/v0/add?pin=true`, {
    method: 'POST',
    body: form as any,
  });
  
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Kubo upload failed: ${error}`);
  }
  
  const result = await response.json() as { Hash: string; Name: string; Size: string };
  const gateway = config.publicGateway || PROVIDER_GATEWAYS.kubo;
  
  return {
    cid: result.Hash,
    url: `${gateway}/${result.Hash}?filename=${encodeURIComponent(filename)}`,
    size: stats.size,
    filename,
    provider: 'kubo',
  };
}

/**
 * Generate IPFS download message
 */
export function formatIPFSMessage(result: IPFSUploadResult): string {
  return `📦 IPFS File Transfer\n\n` +
    `📄 ${result.filename}\n` +
    `📊 ${formatSize(result.size)}\n` +
    `🔗 ${result.url}\n\n` +
    `CID: ${result.cid}\n` +
    `Provider: ${result.provider}`;
}

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} bytes`;
}

export default {
  shouldUseIPFS,
  uploadToIPFS,
  formatIPFSMessage,
};
