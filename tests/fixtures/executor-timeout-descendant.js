#!/usr/bin/env node

if (process.platform !== 'win32') {
  process.on('SIGTERM', () => {});
}

setInterval(() => {}, 1000);
