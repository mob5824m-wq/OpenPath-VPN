#!/usr/bin/env node
import { Command } from 'commander';
import chalk from 'chalk';
import { connectCmd } from './commands/connect';
import { disconnectCmd } from './commands/disconnect';
import { statusCmd } from './commands/status';
import { configCmd } from './commands/config';
import fs from 'fs';
import path from 'path';

const pkg = (()=>{ try{ return JSON.parse(fs.readFileSync(path.join(__dirname,'../package.json'),'utf-8')); }catch{return {version:'1.0.0'}}})();

const program = new Command();
program
  .name('openpath')
  .description(chalk.cyan('OpenPath VPN — stealth TLS over TCP :443 • HTTPS mimic • GhostPath v1'))
  .version(pkg.version)
  .addHelpText('after', `
Examples:
  $ openpath connect --server wss://cdn.openpath.example.com/ops --psk <PSK>
  $ openpath connect --profile safari17 --jitter --padding
  $ openpath status
  $ openpath disconnect
  $ openpath config set stealthProfile firefox128

TLS obfuscation: all traffic inside TLS 1.3 (SNI=your domain, ALPN h2). DPI sees Chrome124 HTTPS.
HTTPS mimicry: packet sizes/timing shaped like real browsing + decoy site on probe.
`);

program.command('connect').description('Connect stealth tunnel (use --fortinet for FortiGate schools)').option('--server <url>','wss URL').option('--psk <psk>','pre-shared key').option('--user <user>','username (default demo)').option('--profile <p>','chrome124|safari17|firefox128|meet|fortinet').option('--fortinet','Fortinet FortiGate optimized: Chrome124, QUIC off, SNI Cloudflare/Google, DoH dns.google, proxy CONNECT').option('--sni <sni>','override SNI (e.g. ajax.googleapis.com for FortiGate allowlist)').option('--pin','pin Cloudflare cert to detect FortiGate deep-inspection CA').option('--no-jitter','disable timing jitter').option('--no-padding','disable size mimicry').action(connectCmd);
program.command('disconnect').alias('off').description('Disconnect').action(disconnectCmd);
program.command('status').alias('st').description('Show tunnel status, RTT, TUN mode, TLS fingerprint').action(statusCmd);
program.command('config').description('Manage config ~/.config/openpath/config.json').argument('<action>','get|set|path').argument('[key]').argument('[value]').action(configCmd);

program.parseAsync(process.argv).catch(e=>{ console.error(chalk.red(e.message)); process.exit(1); });
