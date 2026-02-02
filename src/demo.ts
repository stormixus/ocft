/**
 * OCFT - Demo / Test
 * Simulates two bots exchanging files
 */

import { TransferManager } from './transfer.js';
import { mkdir, writeFile, readFile } from 'fs/promises';
import { existsSync } from 'fs';

async function demo() {
  console.log('🔗 OCFT Demo - Bot-to-Bot File Transfer\n');
  
  // Setup directories
  const testDir = '/tmp/ocft-demo';
  const botADir = `${testDir}/bot-a`;
  const botBDir = `${testDir}/bot-b`;
  
  await mkdir(botADir, { recursive: true });
  await mkdir(botBDir, { recursive: true });
  
  // Create test file
  const testContent = 'Hello from Bot A! This is a test file.\n'.repeat(100);
  const testFile = `${botADir}/test.txt`;
  await writeFile(testFile, testContent);
  console.log(`📄 Created test file: ${testFile} (${testContent.length} bytes)\n`);
  
  // Secrets for auto-accept
  const botASecret = 'secret-a-12345';
  const botBSecret = 'secret-b-67890';
  
  // Message queue (simulates network)
  const messageQueues: Map<string, string[]> = new Map([
    ['bot-a', []],
    ['bot-b', []]
  ]);
  
  // Create Bot A (sender) - knows Bot B's secret
  const botA = new TransferManager(
    {
      botId: 'bot-a',
      secret: botASecret,
      downloadDir: botADir,
      chunkSize: 1024, // Small chunks for demo
      trustedPeers: [{ id: 'bot-b', secret: botBSecret }]
    },
    async (to, message) => {
      console.log(`📤 [bot-a → ${to}] Message sent (${message.length} chars)`);
      messageQueues.get(to)?.push(message);
    }
  );
  
  // Create Bot B (receiver) - has its own secret
  const botB = new TransferManager(
    {
      botId: 'bot-b',
      secret: botBSecret, // Bot A knows this, so auto-accept!
      downloadDir: botBDir,
      chunkSize: 1024
    },
    async (to, message) => {
      console.log(`📤 [bot-b → ${to}] Message sent (${message.length} chars)`);
      messageQueues.get(to)?.push(message);
    }
  );
  
  // Event handlers
  botA.on('offer-sent', (t) => console.log(`🅰️ Offer sent: ${t.filename}`));
  botA.on('transfer-started', (t) => console.log(`🅰️ Transfer started`));
  botA.on('chunk-sent', ({ index }) => process.stdout.write('.'));
  botA.on('transfer-rejected', (t) => console.log(`🅰️ ❌ Rejected: ${t.error}`));
  
  botB.on('offer-received', (t) => console.log(`🅱️ Offer received: ${t.filename} (${t.size} bytes)`));
  botB.on('transfer-accepted', (t) => console.log(`🅱️ Transfer accepted`));
  botB.on('chunk-received', ({ index, progress }) => {
    if (progress % 20 === 0) console.log(`  ${progress}%`);
  });
  botB.on('transfer-completed', (t) => console.log(`\n🅱️ ✅ Transfer completed! Saved to: ${t.localPath}`));
  botB.on('transfer-failed', (t) => console.log(`\n🅱️ ❌ Transfer failed: ${t.error}`));
  
  // Start transfer
  console.log('🚀 Starting transfer...\n');
  const transferId = await botA.sendFile('bot-b', testFile);
  
  // Process message queue (simulate network)
  let iterations = 0;
  const maxIterations = 100;
  let doneCount = 0;
  
  while (iterations < maxIterations) {
    let processed = false;
    
    // Process Bot A's queue
    const msgA = messageQueues.get('bot-a')?.shift();
    if (msgA) {
      await botA.handleMessage('bot-b', msgA);
      processed = true;
    }
    
    // Process Bot B's queue
    const msgB = messageQueues.get('bot-b')?.shift();
    if (msgB) {
      await botB.handleMessage('bot-a', msgB);
      processed = true;
    }
    
    // Check if done
    const transferA = botA.getTransfer(transferId);
    const transferB = botB.listTransfers().find(t => t.id === transferId);
    
    if (transferB?.state === 'completed' || transferB?.state === 'failed') {
      doneCount++;
      if (doneCount >= 3) break; // Wait a bit after completion
    }
    
    if (!processed && messageQueues.get('bot-a')?.length === 0 && messageQueues.get('bot-b')?.length === 0) {
      if (doneCount > 0) break;
    }
    
    // Small delay
    await new Promise(r => setTimeout(r, 10));
    iterations++;
  }
  
  // Verify
  console.log('\n📊 Verification:');
  const receivedFile = `${botBDir}/test.txt`;
  if (existsSync(receivedFile)) {
    const receivedContent = await readFile(receivedFile, 'utf-8');
    const match = receivedContent === testContent;
    console.log(`  Original size: ${testContent.length}`);
    console.log(`  Received size: ${receivedContent.length}`);
    console.log(`  Content match: ${match ? '✅ YES' : '❌ NO'}`);
  } else {
    console.log('  ❌ File not received');
  }
  
  console.log('\n✨ Demo complete!');
}

demo().catch(console.error);
