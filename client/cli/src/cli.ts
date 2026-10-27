#!/usr/bin/env node
// Universal alias — delegates to Linux CLI implementation (platform-agnostic WS+TLS)
// For Windows/macOS native TUN see client/windows and client/macos; CLI works everywhere for quick test.
import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';

const linuxCli = path.join(__dirname, '../../linux/cli/dist/cli.js');
if (fs.existsSync(linuxCli)) {
  // delegate
  require(linuxCli);
} else {
  console.log('OpenPath CLI — build linux/cli first: cd client/linux/cli && npm install && npm run build');
  console.log('Or use the Linux GUI: cd client/linux && npm run dev');
  process.exit(1);
}
