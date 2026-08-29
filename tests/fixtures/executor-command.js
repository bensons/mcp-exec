#!/usr/bin/env node

const { spawn } = require('child_process');
const path = require('path');

const [mode, value] = process.argv.slice(2);

switch (mode) {
  case 'timeout-tree': {
    const child = spawn(
      process.execPath,
      [path.join(__dirname, 'executor-timeout-descendant.js'), value],
      { stdio: 'ignore' }
    );
    child.once('error', error => {
      console.error(error.message);
      process.exit(1);
    });
    console.log(`started-${value}`);
    console.log(`child-pid:${child.pid}`);
    setInterval(() => {}, 1000);
    break;
  }
  case 'exit':
    process.exit(Number(value));
    break;
  case 'output':
    console.log(value);
    break;
  default:
    console.error(`unknown fixture mode: ${mode}`);
    process.exit(2);
}
