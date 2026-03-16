#!/usr/bin/env node

/**
 * Comprehensive Test Runner for Phase 1 Refactored Components
 * 
 * This script executes all unit tests and generates a comprehensive report
 * Uses Node.js built-in test framework (no external dependencies)
 */

import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const __dirname = new URL('.', import.meta.url).pathname;

interface TestResult {
  file: string;
  passed: number;
  failed: number;
  duration: number;
  status: 'PASS' | 'FAIL';
}

interface TestStats {
  totalFiles: number;
  totalTests: number;
  totalPassed: number;
  totalFailed: number;
  totalDuration: number;
  results: TestResult[];
}

async function runTests(): Promise<void> {
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║         Phase 1 Component Unit Tests - Test Runner             ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  const testDir = path.join(__dirname, '../tests/unit');
  const stats: TestStats = {
    totalFiles: 0,
    totalTests: 0,
    totalPassed: 0,
    totalFailed: 0,
    totalDuration: 0,
    results: [],
  };

  try {
    // Get all test files
    const files = await fs.readdir(testDir);
    const testFiles = files.filter(f => f.endsWith('.test.ts'));

    console.log(`Found ${testFiles.length} test files\n`);
    console.log('┌─ Running Tests ─────────────────────────────────────────────────┐');

    for (const file of testFiles) {
      const testFile = path.join(testDir, file);
      const startTime = Date.now();

      console.log(`\n│ Testing: ${file}`);
      console.log('│ Status: Running...');

      const result = await runTestFile(testFile);
      const duration = Date.now() - startTime;

      stats.totalFiles++;
      stats.totalDuration += duration;

      const status = result.exitCode === 0 ? 'PASS' : 'FAIL';
      stats.results.push({
        file,
        passed: extractTestCount(result.stdout, 'passed'),
        failed: extractTestCount(result.stdout, 'failed'),
        duration,
        status,
      });

      const statusSymbol = status === 'PASS' ? '✓' : '✗';
      console.log(`│ ${statusSymbol} Status: ${status} (${duration}ms)`);
    }

    console.log('\n└─────────────────────────────────────────────────────────────────┘');

    // Print summary
    printSummary(stats);

  } catch (error) {
    console.error('Error running tests:', error);
    process.exit(1);
  }
}

async function runTestFile(
  filePath: string
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const testProcess = spawn('node', ['--test', '--loader=tsx', filePath], {
      stdio: ['inherit', 'pipe', 'pipe'],
      env: { ...process.env, NODE_OPTIONS: '--enable-source-maps' },
    });

    let stdout = '';
    let stderr = '';

    testProcess.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    testProcess.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    testProcess.on('close', (code) => {
      resolve({
        exitCode: code ?? 1,
        stdout,
        stderr,
      });
    });

    testProcess.on('error', () => {
      resolve({
        exitCode: 1,
        stdout,
        stderr,
      });
    });
  });
}

function extractTestCount(output: string, type: 'passed' | 'failed'): number {
  const regex = type === 'passed'
    ? /(\d+) passed/
    : /(\d+) failed/;
  
  const match = output.match(regex);
  return match ? parseInt(match[1], 10) : 0;
}

function printSummary(stats: TestStats): void {
  console.log('\n╔════════════════════════════════════════════════════════════════╗');
  console.log('║                       Test Summary                              ║');
  console.log('╠════════════════════════════════════════════════════════════════╣');

  let totalPassed = 0;
  let totalFailed = 0;

  stats.results.forEach((result) => {
    totalPassed += result.passed;
    totalFailed += result.failed;

    const statusIcon = result.status === 'PASS' ? '✓' : '✗';
    const statusText = result.status === 'PASS'
      ? `${result.passed} tests`
      : `${result.failed} failed`;

    console.log(`║ ${statusIcon} ${result.file.padEnd(45)} ${statusText.padStart(15)} │`);
  });

  console.log('╠════════════════════════════════════════════════════════════════╣');
  console.log(`║ Total Test Files:        ${String(stats.totalFiles).padEnd(40)} │`);
  console.log(`║ Total Tests Passed:      ${String(totalPassed).padEnd(40)} │`);
  console.log(`║ Total Tests Failed:      ${String(totalFailed).padEnd(40)} │`);
  console.log(`║ Total Duration:          ${String(`${stats.totalDuration}ms`).padEnd(40)} │`);
  
  const allPassed = stats.results.every(r => r.status === 'PASS');
  const resultText = allPassed ? '✓ ALL TESTS PASSED' : '✗ SOME TESTS FAILED';
  
  console.log('╠════════════════════════════════════════════════════════════════╣');
  console.log(`║ Result: ${resultText.padEnd(56)} │`);
  console.log('╚════════════════════════════════════════════════════════════════╝');

  process.exit(allPassed ? 0 : 1);
}

runTests().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
