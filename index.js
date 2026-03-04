#!/usr/bin/env node

import('./dist/index.js').catch((error) => {
  console.error('Failed to start infected:', error);
  process.exit(1);
});
