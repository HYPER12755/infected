#!/usr/bin/env node

process.env.INFECTED_RUNTIME_MODE = 'production';

import('./dist/index.js').catch((error) => {
  console.error('Failed to start infected:', error);
  process.exit(1);
});
