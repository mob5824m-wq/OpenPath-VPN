import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { createSocket } from 'node:dgram';
import WebSocket from 'ws';

process.env.OPSK = JSON.stringify({'legacy-user':'a-separate-legacy-credential'});
const { StealthRelayServer, isWireGuardPacket, parseRelayTarget, parseRelayPsks } = await import('../src/stealth/relay.js');
const target = createSocket('udp4');
await new Promise(resolve => target.bind(0, '127.0.0.1', resolve));
let seen = 0;
target.on('message', (data, peer) => { seen++; target.send(data, peer.port, peer.address); });
const relay = new StealthRelayServer(`127.0.0.1:${target.address().port}`, true, {'relay-user':'test-secret-for-stealth-relay-tests'});
const server = createServer();
server.on('upgrade', (req, socket, head) => relay.handleUpgrade(req, socket, head, new URL(req.url, 'http://localhost')));
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
after(() => { target.close(); server.close(); });
const base = `ws://127.0.0.1:${server.address().port}/stealth-wg`;
function signed(path='/stealth-wg', nonce=randomBytes(16).toString('hex')) {
  const ts = String(Date.now());
  const token = createHmac('sha256', 'test-secret-for-stealth-relay-tests').update(`${ts}.${nonce}.${path}`).digest('hex');
  return `${base}?user=relay-user&auth=${ts}.${nonce}.${token}`;
}
function open(url, secure=true) {
  return new WebSocket(url, {headers:secure ? {'x-forwarded-proto':'https'} : {}});
}
function rejected(ws) {
  return new Promise(resolve => { ws.on('unexpected-response', (_, res) => { res.resume(); resolve(res.statusCode); }); ws.on('error', () => resolve(0)); });
}
function next(ws) { return new Promise((resolve, reject) => { ws.once('message', resolve); ws.once('error', reject); }); }
const packet = () => { const b = Buffer.alloc(148); b[0] = 1; return b; };

test('strict packet and fixed numeric target validation', () => {
  assert.equal(isWireGuardPacket(packet()), true);
  assert.equal(isWireGuardPacket(Buffer.alloc(20)), false);
  assert.equal(isWireGuardPacket(Buffer.alloc(3000, 4)), false);
  assert.deepEqual(parseRelayTarget('[::1]:51820'), {address:'::1', port:51820, family:'udp6'});
  assert.throws(() => parseRelayTarget('localhost:51820'));
  assert.throws(() => parseRelayTarget('127.0.0.1:99999'));
  assert.throws(() => parseRelayPsks('', true));
  assert.throws(() => parseRelayPsks('{"user":"short"}', true));
  assert.deepEqual(parseRelayPsks(JSON.stringify({'user':'x'.repeat(32)}), true), {'user':'x'.repeat(32)});
});

test('rejects plaintext proxy requests and tokens signed for a different path', async () => {
  assert.equal(await rejected(open(signed(), false)), 404);
  assert.equal(await rejected(open(signed('/ops'))), 404);
});

test('authenticated binary WireGuard packets reach only the configured UDP target and return', async () => {
  const url = signed();
  const ws = open(url);
  assert.deepEqual(JSON.parse(String(await next(ws))), {type:'ready', protocol:'wireguard-ws', version:1});
  assert.equal(await rejected(open(url)), 404, 'nonce cannot be replayed');
  const reply = next(ws); ws.send(packet());
  assert.deepEqual(await reply, packet());
  assert.equal(seen, 1);
  const closed = new Promise(resolve => ws.once('close', resolve));
  ws.send('not a WireGuard packet');
  await closed;
  assert.equal(seen, 1);
});

test('relay-only server disables legacy provisioning and rejects reused session secrets', async () => {
  const { spawn } = await import('node:child_process');
  const { createServer: createTcpServer } = await import('node:net');
  const probe = createTcpServer();
  await new Promise<void>(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = (probe.address() as import('node:net').AddressInfo).port;
  await new Promise<void>(resolve => probe.close(() => resolve()));
  const env = {...process.env, PORT:String(port), HOST:'127.0.0.1', STEALTH_RELAY_ONLY:'1',
    STEALTH_WG_TARGET:'127.0.0.1:51820', STEALTH_TRUST_PROXY:'1',
    STEALTH_PSKS:JSON.stringify({'relay-user':'a-distinct-relay-secret-at-least-32-bytes'})};
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {cwd:process.cwd(), env, stdio:['ignore', 'pipe', 'pipe']});
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('server startup timed out')), 10000);
      child.stdout.on('data', chunk => { if (String(chunk).includes('Listening on')) { clearTimeout(timer); resolve(); } });
      child.once('exit', code => { clearTimeout(timer); reject(new Error(`server exited early: ${code}`)); });
    });
    const base = `http://127.0.0.1:${port}`;
    assert.equal((await fetch(`${base}/health`)).status, 200);
    assert.equal((await fetch(`${base}/api/provision`, {method:'POST'})).status, 404);
    assert.equal((await fetch(`${base}/api/hosts`)).status, 404);
    assert.equal(await rejected(new WebSocket(`ws://127.0.0.1:${port}/ops`)), 404);
  } finally {
    child.kill();
    await new Promise(resolve => child.once('exit', resolve));
  }
  const reused = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
    cwd:process.cwd(), env:{...env, OPSK:env.STEALTH_PSKS}, stdio:['ignore', 'ignore', 'pipe'],
  });
  const output:Buffer[] = [];
  reused.stderr.on('data', chunk => output.push(chunk));
  const code = await new Promise<number | null>(resolve => reused.once('exit', resolve));
  assert.notEqual(code, 0);
  assert.match(Buffer.concat(output).toString(), /must not reuse/);
});
