import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { WebSocketServer } from 'ws';
import { WebSocketSession } from '../src/session';

const key = 'test-key';

async function makeServer() {
  const server = new WebSocketServer({
    port:0, host:'127.0.0.1',
    verifyClient: ({req}) => {
      const url = new URL(req.url || '/', 'http://127.0.0.1');
      const [ts, nonce, signature] = (url.searchParams.get('auth') || '').split('.');
      return url.searchParams.get('user') === 'student' && signature === createHmac('sha256', key).update(`${ts}.${nonce}.${url.pathname}`).digest('hex');
    },
  });
  await once(server, 'listening');
  server.on('connection', socket => {
    socket.send(JSON.stringify({t:'hello'}));
    socket.on('message', raw => {
      const msg = JSON.parse(raw.toString());
      if(msg.op === 'ping') socket.send(JSON.stringify({op:'pong', t:msg.t}));
    });
  });
  return { server, port:(server.address() as {port:number}).port };
}

test('Linux connect waits for an authenticated WebSocket and disconnect closes it', async () => {
  const {server, port} = await makeServer();
  const states:any[] = [];
  const logs:string[] = [];
  const session = new WebSocketSession(state=>states.push(state), message=>logs.push(message));
  try {
    const result = await session.connect({serverUrl:`ws://127.0.0.1:${port}/ops`, user:'student', psk:key});
    assert.equal(result.connected, true);
    assert.equal(result.connecting, false);
    assert.equal(result.mode, 'websocket');
    assert.equal(result.secure, false);
    assert.ok(states.some(s=>s.connecting));
    assert.ok(result.tx > 0);
    assert.ok(logs.some(line=>line.includes('Device traffic is not routed')));
    await assert.rejects(session.connect({serverUrl:'https://invalid.example/', user:'student', psk:key}), /ws:\/\//);
    assert.equal(session.status().connected, true, 'invalid settings do not discard an existing session');
    session.disconnect();
    assert.equal(session.status().connected, false);
    assert.equal(session.status().rx, 0);
  } finally {
    session.disconnect();
    for(const client of server.clients) client.terminate();
    await new Promise<void>(resolve=>server.close(()=>resolve()));
  }
});

test('bad credentials and cancellation never report a successful connection', async () => {
  const {server, port} = await makeServer();
  const session = new WebSocketSession();
  try {
    await assert.rejects(session.connect({serverUrl:`ws://127.0.0.1:${port}/ops`, user:'student', psk:'wrong'}));
    assert.equal(session.status().connected, false);
    assert.equal(session.status().connecting, false);
  } finally { session.disconnect(); await new Promise<void>(resolve=>server.close(()=>resolve())); }

  const hanging = createServer();
  hanging.on('upgrade', (_req, socket)=>{ socket.on('error', ()=>{}); });
  hanging.listen(0, '127.0.0.1');
  await once(hanging, 'listening');
  const hangingPort = (hanging.address() as {port:number}).port;
  const pending = session.connect({serverUrl:`ws://127.0.0.1:${hangingPort}/ops`, user:'student', psk:key});
  const cancelled = assert.rejects(pending, /cancelled/);
  session.disconnect();
  await cancelled;
  assert.equal(session.status().connected, false);
  assert.equal(session.status().connecting, false);
  await new Promise<void>(resolve=>hanging.close(()=>resolve()));
});
