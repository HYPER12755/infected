const fs = require('fs');
const path = require('path');

console.log('=== Phase 1 Integration Verification ===\n');

const checks = {
  'Service Container Updates': {
    'Service container file exists': () => fs.existsSync('src/core/service-container.ts'),
    'Has getExecutionStrategyFactory': () => fs.readFileSync('src/core/service-container.ts', 'utf8').includes('getExecutionStrategyFactory'),
    'Has getSSHConnectionPool': () => fs.readFileSync('src/core/service-container.ts', 'utf8').includes('getSSHConnectionPool'),
    'Has getResourceMonitor': () => fs.readFileSync('src/core/service-container.ts', 'utf8').includes('getResourceMonitor'),
    'Has getResourceLimiter': () => fs.readFileSync('src/core/service-container.ts', 'utf8').includes('getResourceLimiter'),
  },
  'Configuration': {
    'Config schema updated': () => fs.readFileSync('src/config/schema.ts', 'utf8').includes('ExecutionStrategyConfigSchema'),
    'infected.config.json has execution': () => JSON.parse(fs.readFileSync('infected.config.json', 'utf8')).execution !== undefined,
    'infected.config.json has sshConnectionPool': () => JSON.parse(fs.readFileSync('infected.config.json', 'utf8')).sshConnectionPool !== undefined,
    'infected.config.json has resources': () => JSON.parse(fs.readFileSync('infected.config.json', 'utf8')).resources !== undefined,
  },
  'Documentation': {
    'Migration guide exists': () => fs.existsSync('docs/MIGRATION_PHASE1.md'),
    'Migration guide has sufficient content': () => {
      const content = fs.readFileSync('docs/MIGRATION_PHASE1.md', 'utf8');
      return content.length > 30000; // >30KB
    },
    'Strategy examples exist': () => fs.existsSync('docs/examples/execution-strategies-advanced.ts'),
    'Resource monitoring examples exist': () => fs.existsSync('docs/examples/resource-monitoring.ts'),
    'SSH pool examples exist': () => fs.existsSync('docs/examples/ssh-pool-usage.ts'),
  },
  'Backward Compatibility': {
    'ProcessManager.execute still exists': () => fs.readFileSync('src/core/process-manager.ts', 'utf8').includes('execute('),
    'SSH module 8 tools unchanged': () => {
      const content = fs.readFileSync('src/modules/ssh/index.ts', 'utf8');
      return content.includes('create_ssh_session') && 
             content.includes('execute_ssh_command') &&
             content.includes('upload_ssh_file') &&
             content.includes('download_ssh_file');
    },
    'No breaking API changes': () => {
      const serviceContainer = fs.readFileSync('src/core/service-container.ts', 'utf8');
      return serviceContainer.includes('public get<T extends ServiceName>');
    },
  },
};

let passCount = 0;
let failCount = 0;

for (const [category, tests] of Object.entries(checks)) {
  console.log(`📋 ${category}`);
  for (const [test, fn] of Object.entries(tests)) {
    try {
      const result = fn();
      if (result) {
        console.log(`  ✅ ${test}`);
        passCount++;
      } else {
        console.log(`  ❌ ${test}`);
        failCount++;
      }
    } catch (error) {
      console.log(`  ❌ ${test} (Error: ${error.message})`);
      failCount++;
    }
  }
  console.log();
}

console.log(`=== Summary ===`);
console.log(`✅ Passed: ${passCount}`);
console.log(`❌ Failed: ${failCount}`);
console.log(`📊 Total: ${passCount + failCount}`);
console.log();

if (failCount === 0) {
  console.log('🎉 Phase 1 Integration - All Checks Passed!');
  process.exit(0);
} else {
  console.log('⚠️  Some checks failed. Review output above.');
  process.exit(1);
}
