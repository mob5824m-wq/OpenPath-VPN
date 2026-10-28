import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { createSocket } from 'node:dgram';
import WebSocket from 'ws';

process.env.OPSK = JSON.stringify({'relay-user':'test-secret-for-stealth-relay-tests'});
const { StealthRelayServer, isWireGuardPacket, parseRelayTarget } = await import('../src/stealth/relay.js');
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
