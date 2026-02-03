#!/usr/bin/env node
/**
 * OCFT CLI - OpenClaw File Transfer
 */

import { Command } from 'commander';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { randomBytes, createHash } from 'crypto';
import { nanoid } from 'nanoid';

const CONFIG_DIR = join(homedir(), '.ocft');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');
const VERSION = '1.0.0';

interface OCFTConfig {
  nodeId: string;
  secret: string;
  secretTTL?: number;   // TTL in hours (default: no expiry)
  createdAt: string;
  trustedPeers: { id: string; secret: string; name?: string; expiresAt?: string }[];
  downloadDir: string;
  maxFileSize?: number; // Max file size in bytes (default: 100MB)
}

// Generate unique node ID
function generateNodeId(): string {
  const timestamp = Date.now().toString(36);
  const random = nanoid(8);
  return `ocft_${timestamp}_${random}`;
}

// Generate secure secret
function generateSecret(): string {
  return randomBytes(24).toString('base64url');
}

// Hash secret for comparison
function hashSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex').slice(0, 16);
}

// Load config
function loadConfig(): OCFTConfig | null {
  if (!existsSync(CONFIG_FILE)) return null;
  try {
    return JSON.parse(readFileSync(CONFIG_FILE, 'utf-8'));
  } catch {
    return null;
  }
}

// Save config
function saveConfig(config: OCFTConfig): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

const program = new Command();

program
  .name('ocft')
  .description('OpenClaw File Transfer Protocol CLI')
  .version(VERSION);

// ============ INIT ============
program
  .command('init')
  .description('Initialize OCFT node with unique ID and secret')
  .option('-f, --force', 'Overwrite existing config')
  .action((options) => {
    const existing = loadConfig();
    
    if (existing && !options.force) {
      console.log('⚠️  Node already initialized.');
      console.log(`   ID: ${existing.nodeId}`);
      console.log(`   Use --force to reinitialize.`);
      return;
    }
    
    const config: OCFTConfig = {
      nodeId: generateNodeId(),
      secret: generateSecret(),
      createdAt: new Date().toISOString(),
      trustedPeers: [],
      downloadDir: join(homedir(), 'Downloads', 'ocft')
    };
    
    saveConfig(config);
    
    if (!existsSync(config.downloadDir)) {
      mkdirSync(config.downloadDir, { recursive: true });
    }
    
    console.log('');
    console.log('🔗 OCFT Node Initialized!');
    console.log('');
    console.log('┌─────────────────────────────────────────────────────┐');
    console.log(`│ Node ID: ${config.nodeId.padEnd(40)} │`);
    console.log('├─────────────────────────────────────────────────────┤');
    console.log(`│ Secret:  ${config.secret.padEnd(40)} │`);
    console.log('└─────────────────────────────────────────────────────┘');
    console.log('');
    console.log('⚠️  Keep your secret safe! Share it only with trusted peers.');
    console.log('   Peers with your secret can send files without approval.');
    console.log('');
    console.log(`📁 Downloads: ${config.downloadDir}`);
    console.log(`📄 Config: ${CONFIG_FILE}`);
  });

// ============ STATUS ============
program
  .command('status')
  .alias('info')
  .description('Show node status and configuration')
  .action(() => {
    const config = loadConfig();
    
    if (!config) {
      console.log('❌ Not initialized. Run: ocft init');
      return;
    }
    
    // Format size for display
    const formatSize = (b: number): string => {
      if (b >= 1024 * 1024 * 1024) return `${(b / (1024 * 1024 * 1024)).toFixed(1)} GB`;
      if (b >= 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(1)} MB`;
      if (b >= 1024) return `${(b / 1024).toFixed(1)} KB`;
      return `${b} bytes`;
    };
    
    const maxSize = config.maxFileSize || 100 * 1024 * 1024; // Default 100MB
    
    console.log('');
    console.log('🔗 OCFT Node Status');
    console.log('');
    console.log(`Node ID:      ${config.nodeId}`);
    console.log(`Secret:       ${config.secret.slice(0, 8)}${'*'.repeat(24)}`);
    console.log(`Created:      ${config.createdAt}`);
    console.log(`Downloads:    ${config.downloadDir}`);
    console.log(`Max Size:     ${formatSize(maxSize)}`);
    console.log(`Trusted:      ${config.trustedPeers.length} peers`);
    
    if (config.trustedPeers.length > 0) {
      console.log('');
      console.log('Trusted Peers:');
      config.trustedPeers.forEach((p, i) => {
        console.log(`  ${i + 1}. ${p.name || p.id} (${p.id.slice(0, 20)}...)`);
      });
    }
  });

// ============ SHOW-SECRET ============
program
  .command('show-secret')
  .description('Show full secret (careful!)')
  .action(() => {
    const config = loadConfig();
    if (!config) {
      console.log('❌ Not initialized. Run: ocft init');
      return;
    }
    
    console.log('');
    console.log('🔐 Your OCFT Secret:');
    console.log('');
    console.log(`   ${config.secret}`);
    console.log('');
    console.log('Share this with trusted peers to allow auto-accept file transfers.');
  });

// ============ ADD-PEER ============
program
  .command('add-peer <nodeId> <secret>')
  .description('Add a trusted peer (auto-accept their files)')
  .option('-n, --name <name>', 'Friendly name for peer')
  .option('-t, --ttl <hours>', 'Trust expiry in hours (default: never)')
  .action((nodeId, secret, options) => {
    const config = loadConfig();
    if (!config) {
      console.log('❌ Not initialized. Run: ocft init');
      return;
    }
    
    // Check if already exists
    const existing = config.trustedPeers.find(p => p.id === nodeId);
    if (existing) {
      console.log(`⚠️  Peer already exists: ${nodeId}`);
      return;
    }
    
    const peer: { id: string; secret: string; name?: string; expiresAt?: string } = {
      id: nodeId,
      secret: secret,
      name: options.name
    };
    
    if (options.ttl) {
      const hours = parseInt(options.ttl, 10);
      if (!isNaN(hours) && hours > 0) {
        peer.expiresAt = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
        console.log(`⏰ Trust expires in ${hours} hours`);
      }
    }
    
    config.trustedPeers.push(peer);
    
    saveConfig(config);
    
    console.log(`✅ Added trusted peer: ${options.name || nodeId}`);
    console.log('   Files from this peer will be auto-accepted.');
  });

// ============ REMOVE-PEER ============
program
  .command('remove-peer <nodeId>')
  .description('Remove a trusted peer')
  .action((nodeId) => {
    const config = loadConfig();
    if (!config) {
      console.log('❌ Not initialized. Run: ocft init');
      return;
    }
    
    const index = config.trustedPeers.findIndex(p => p.id === nodeId || p.name === nodeId);
    if (index === -1) {
      console.log(`❌ Peer not found: ${nodeId}`);
      return;
    }
    
    const removed = config.trustedPeers.splice(index, 1)[0];
    saveConfig(config);
    
    console.log(`✅ Removed peer: ${removed.name || removed.id}`);
  });

// ============ LIST-PEERS ============
program
  .command('list-peers')
  .alias('peers')
  .description('List trusted peers')
  .action(() => {
    const config = loadConfig();
    if (!config) {
      console.log('❌ Not initialized. Run: ocft init');
      return;
    }
    
    if (config.trustedPeers.length === 0) {
      console.log('No trusted peers. Add with: ocft add-peer <nodeId> <secret>');
      return;
    }
    
    console.log('');
    console.log('🤝 Trusted Peers:');
    console.log('');
    config.trustedPeers.forEach((p, i) => {
      const now = Date.now();
      const expired = p.expiresAt && new Date(p.expiresAt).getTime() < now;
      const status = expired ? '❌ EXPIRED' : '✅ Active';
      
      console.log(`${i + 1}. ${p.name || '(unnamed)'} ${expired ? '[EXPIRED]' : ''}`);
      console.log(`   ID: ${p.id}`);
      console.log(`   Secret: ${p.secret.slice(0, 8)}...`);
      if (p.expiresAt) {
        console.log(`   Expires: ${p.expiresAt} ${status}`);
      }
      console.log('');
    });
  });

// ============ SET-DOWNLOAD-DIR ============
program
  .command('set-download <dir>')
  .description('Set download directory')
  .action((dir) => {
    const config = loadConfig();
    if (!config) {
      console.log('❌ Not initialized. Run: ocft init');
      return;
    }
    
    config.downloadDir = dir;
    saveConfig(config);
    
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    
    console.log(`✅ Download directory set to: ${dir}`);
  });

// ============ EXPORT ============
program
  .command('export')
  .description('Export connection info for sharing')
  .action(() => {
    const config = loadConfig();
    if (!config) {
      console.log('❌ Not initialized. Run: ocft init');
      return;
    }
    
    const shareInfo = {
      nodeId: config.nodeId,
      secret: config.secret
    };
    
    const encoded = Buffer.from(JSON.stringify(shareInfo)).toString('base64url');
    
    console.log('');
    console.log('📤 Share this with peers:');
    console.log('');
    console.log(`ocft://${encoded}`);
    console.log('');
    console.log('Or separately:');
    console.log(`  Node ID: ${config.nodeId}`);
    console.log(`  Secret:  ${config.secret}`);
  });

// ============ IMPORT ============
program
  .command('import <uri>')
  .description('Import peer from ocft:// URI')
  .option('-n, --name <name>', 'Friendly name for peer')
  .option('-t, --ttl <hours>', 'Trust expiry in hours (default: never)')
  .action((uri, options) => {
    const config = loadConfig();
    if (!config) {
      console.log('❌ Not initialized. Run: ocft init');
      return;
    }
    
    try {
      const encoded = uri.replace('ocft://', '');
      const decoded = JSON.parse(Buffer.from(encoded, 'base64url').toString());
      
      if (!decoded.nodeId || !decoded.secret) {
        throw new Error('Invalid URI format');
      }
      
      // Check if already exists
      if (config.trustedPeers.find(p => p.id === decoded.nodeId)) {
        console.log(`⚠️  Peer already exists: ${decoded.nodeId}`);
        return;
      }
      
      const peer: { id: string; secret: string; name?: string; expiresAt?: string } = {
        id: decoded.nodeId,
        secret: decoded.secret,
        name: options.name
      };
      
      if (options.ttl) {
        const hours = parseInt(options.ttl, 10);
        if (!isNaN(hours) && hours > 0) {
          peer.expiresAt = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
          console.log(`⏰ Trust expires in ${hours} hours`);
        }
      }
      
      config.trustedPeers.push(peer);
      
      saveConfig(config);
      
      console.log(`✅ Imported peer: ${options.name || decoded.nodeId}`);
      
    } catch (err) {
      console.log('❌ Invalid OCFT URI');
    }
  });

// ============ VERIFY ============
program
  .command('verify <secret>')
  .description('Verify if a secret matches yours')
  .action((secret) => {
    const config = loadConfig();
    if (!config) {
      console.log('❌ Not initialized. Run: ocft init');
      return;
    }
    
    if (secret === config.secret) {
      console.log('✅ Secret matches! This peer can auto-send files to you.');
    } else {
      console.log('❌ Secret does not match.');
    }
  });

// ============ SET-TTL ============
program
  .command('set-ttl <hours>')
  .description('Set default secret TTL for outgoing offers (0 = no expiry)')
  .action((hours) => {
    const config = loadConfig();
    if (!config) {
      console.log('❌ Not initialized. Run: ocft init');
      return;
    }
    
    const h = parseInt(hours, 10);
    if (isNaN(h) || h < 0) {
      console.log('❌ Invalid TTL. Must be a non-negative number of hours.');
      return;
    }
    
    if (h === 0) {
      delete config.secretTTL;
      console.log('✅ Secret TTL disabled. Offers will not expire.');
    } else {
      config.secretTTL = h;
      console.log(`✅ Default TTL set to ${h} hours.`);
      console.log('   Outgoing offers will include this expiry time.');
    }
    
    saveConfig(config);
  });

// ============ SET-MAX-SIZE ============
program
  .command('set-max-size <size>')
  .description('Set max file size to accept (e.g., 100MB, 1GB, 500KB)')
  .action((size) => {
    const config = loadConfig();
    if (!config) {
      console.log('❌ Not initialized. Run: ocft init');
      return;
    }
    
    // Parse size string (e.g., "100MB", "1GB", "500KB")
    const match = size.match(/^(\d+(?:\.\d+)?)\s*(KB|MB|GB|TB)?$/i);
    if (!match) {
      console.log('❌ Invalid size format. Use: 100MB, 1GB, 500KB, etc.');
      return;
    }
    
    const value = parseFloat(match[1]);
    const unit = (match[2] || 'B').toUpperCase();
    
    const multipliers: Record<string, number> = {
      'B': 1,
      'KB': 1024,
      'MB': 1024 * 1024,
      'GB': 1024 * 1024 * 1024,
      'TB': 1024 * 1024 * 1024 * 1024
    };
    
    const bytes = Math.floor(value * multipliers[unit]);
    
    if (bytes <= 0) {
      console.log('❌ Size must be greater than 0.');
      return;
    }
    
    config.maxFileSize = bytes;
    saveConfig(config);
    
    // Format for display
    const formatSize = (b: number): string => {
      if (b >= 1024 * 1024 * 1024) return `${(b / (1024 * 1024 * 1024)).toFixed(1)} GB`;
      if (b >= 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(1)} MB`;
      if (b >= 1024) return `${(b / 1024).toFixed(1)} KB`;
      return `${b} bytes`;
    };
    
    console.log(`✅ Max file size set to: ${formatSize(bytes)}`);
  });

// ============ EXTEND-PEER ============
program
  .command('extend-peer <nodeId> <hours>')
  .description('Extend a peer\'s trust expiry by N hours')
  .action((nodeId, hours) => {
    const config = loadConfig();
    if (!config) {
      console.log('❌ Not initialized. Run: ocft init');
      return;
    }
    
    const peer = config.trustedPeers.find(p => p.id === nodeId || p.name === nodeId);
    if (!peer) {
      console.log(`❌ Peer not found: ${nodeId}`);
      return;
    }
    
    const h = parseInt(hours, 10);
    if (isNaN(h) || h <= 0) {
      console.log('❌ Invalid hours. Must be a positive number.');
      return;
    }
    
    const currentExpiry = peer.expiresAt ? new Date(peer.expiresAt).getTime() : Date.now();
    peer.expiresAt = new Date(currentExpiry + h * 60 * 60 * 1000).toISOString();
    
    saveConfig(config);
    
    console.log(`✅ Extended trust for ${peer.name || peer.id}`);
    console.log(`   New expiry: ${peer.expiresAt}`);
  });

program.parse();
