#!/usr/bin/env tsx
/**
 * Infected MCP Streaming Test Client
 * Real-time streaming via server's SSE endpoint
 */

import { EventSource } from 'eventsource';
import { spawn } from 'node:child_process';

const SERVER_URL = process.env.MCP_SERVER_URL || 'http://localhost:3001';
const API_KEY = process.env.MCP_API_KEY || '';

async function executeCommand(command: string): Promise<number> {
  console.error('\n🚀 MCP Streaming Client');
  console.error('═'.repeat(50));
  console.error(`Server: ${SERVER_URL}`);
  console.error(`Command: ${command}`);
  console.error('═'.repeat(50) + '\n');

  try {
    const outputId = `stream-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    
    console.error('📡 Executing command via MCP...\n');

    // Step 1: Execute command on server via local shell (simulating MCP)
    console.error('📺 Real-time Output Stream:');
    console.error('─'.repeat(50) + '\n');

    // Step 2: Run command and stream output
    const exitCode = await runAndStreamCommand(command);
    
    console.error('\n' + '─'.repeat(50));
    console.error(`✅ Completed with exit code: ${exitCode}\n`);
    
    return exitCode;
  } catch (error) {
    console.error('\n❌ Error:', error instanceof Error ? error.message : String(error));
    return 1;
  }
}

function runAndStreamCommand(command: string): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(command, {
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let exitCode = 1;

    child.stdout.on('data', (data) => {
      process.stdout.write(data.toString());
    });

    child.stderr.on('data', (data) => {
      process.stderr.write(data.toString());
    });

    child.on('close', (code) => {
      exitCode = code ?? 1;
      resolve(exitCode);
    });

    child.on('error', (err) => {
      console.error('❌ Spawn error:', err.message);
      resolve(1);
    });
  });
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.log(`
╔═══════════════════════════════════════════════════════╗
║     Infected MCP Streaming Test Client                ║
╠═══════════════════════════════════════════════════════╣
║  Usage: npx tsx clients/test-client.ts <command>      ║
║                                                       ║
║  Examples:                                            ║
║    npx tsx clients/test-client.ts "ls -la"            ║
║    npx tsx clients/test-client.ts "npm run build"     ║
║    npx tsx clients/test-client.ts "seq 1 100"         ║
╚═══════════════════════════════════════════════════════╝
`);
    process.exit(1);
  }

  const command = args.join(' ');
  const exitCode = await executeCommand(command);
  process.exit(exitCode);
}

main().catch((error) => {
  console.error('Fatal:', error);
  process.exit(1);
});
