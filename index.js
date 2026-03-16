#!/usr/bin/env node

process.env.INFECTED_RUNTIME_MODE = 'production';

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

import(join(__dirname, 'dist', 'index.js')).catch((error) => {
  console.error('Failed to start infected:', error);
  process.exit(1);
});
