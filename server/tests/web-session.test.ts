import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { createHmac, randomBytes } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';

async function unusedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as {port:number}).port;
  await new Promise<void>(resolve => server.close(() => resolve()));
  return port;
}

function startServer(port:number, extraEnv:Record<string,string> = {}): Promise<ChildProcess> {
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
    cwd:process.cwd(), env:{...process.env, PORT:String(port), HOST:'127.0.0.1', DEMO_PSK:'test-key', HOST_COUNTRY:'CA', HOST_REGION:'Montreal', ...extraEnv},
    stdio:['ignore', 'pipe', 'pipe'],
  });
  return new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(()=>{ child.kill(); reject(new Error(`server startup timed out: ${output}`)); }, 10000);
    child.stdout!.on('data', chunk=>{
      output += chunk.toString();
      if(output.includes('Listening on')) { clearTimeout(timer); resolve(child); }
    });
    child.stderr!.on('data', chunk=>{ output += chunk.toString(); });
    child.once('exit', code=>{ clearTimeout(timer); reject(new Error(`server exited ${code}: ${output}`)); });
  });
}

function connect(port:number, path:string, key='test-key'): Promise<WebSocket> {
  const ts = String(Date.now());
  const nonce = randomBytes(12).toString('hex');
  const signature = createHmac('sha256', key).update(`${ts}.${nonce}.${path}`).digest('hex');
  const url = `ws://127.0.0.1:${port}${path}?user=demo&auth=${ts}.${nonce}.${signature}`;
  return new Promise((resolve, reject)=>{
    const ws = new WebSocket(url);
    ws.once('open', ()=>resolve(ws));
    ws.once('error', reject);
  });
}

function request(ws:WebSocket, payload:object, op:string): Promise<any> {
  return new Promise((resolve, reject)=>{
    const timer = setTimeout(()=>{ ws.off('message', onMessage); reject(new Error(`timed out waiting for ${op}`)); }, 5000);
    const onMessage = (raw:Buffer)=>{
      try{
        const msg = JSON.parse(raw.toString());
        if(msg.op === op){ clearTimeout(timer); ws.off('message', onMessage); resolve(msg); }
      }catch{}
    };
    ws.on('message', onMessage);
    ws.send(JSON.stringify(payload));
  });
}

test('both WebSocket endpoints authenticate, echo ping timestamps and reject private fetches', async () => {
  const port = await unusedPort();
  const child = await startServer(port);
  try {
    const base = `http://127.0.0.1:${port}`;
    const info:any = await (await fetch(`${base}/api/info`)).json();
    assert.deepEqual(info.transports, ['websocket']);
    assert.match(info.modes.fast, /WebSocket/);
    const health:any = await (await fetch(`${base}/health`)).json();
    assert.equal(health.version, JSON.parse(await readFile('package.json', 'utf8')).version);
    const registration = await fetch(`${base}/api/hosts/register`, {
      method:'POST', headers:{'content-type':'application/json'},
      body:JSON.stringify({id:'us-1', name:'US server', host:'us.example', wssUrl:'wss://us.example/ops', country:'US', region:'New York'}),
    });
    assert.equal(registration.status, 200);
    const directory:any = await (await fetch(`${base}/api/hosts`)).json();
    assert.equal(directory.main.country, 'CA');
    assert.equal(directory.main.region, 'Montreal');
    assert.equal(directory.hosts[0].wssUrl, 'wss://us.example/ops');

    for(const path of ['/ops', '/fast']){
      const ws = await connect(port, path);
      try {
        const ping = await request(ws, {op:'ping', t:123456}, 'pong');
        assert.equal(ping.t, 123456);
        const result = await request(ws, {op:'fetch', id:'private-test', url:'http://127.0.0.1/health'}, 'fetch-res');
        assert.equal(result.id, 'private-test');
        assert.equal(result.status, 403);
        assert.match(Buffer.from(result.body, 'base64').toString(), /not allowed/);
        assert.equal(result.truncated, false);
      } finally { ws.close(); }
    }
    await assert.rejects(connect(port, '/ops', 'wrong-key'));
  } finally {
    child.kill('SIGTERM');
    if(child.exitCode === null) await once(child, 'exit');
  }
});

test('optional WEB_DIST serves a downloaded dashboard on the same origin as the API', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'openpath-release-web-'));
  await writeFile(path.join(dir, 'index.html'), '<h1>Release dashboard</h1>');
  const port = await unusedPort();
  const child = await startServer(port, {WEB_DIST:dir});
  try {
    const base = `http://127.0.0.1:${port}`;
    assert.match(await (await fetch(base)).text(), /Release dashboard/);
    const hosts:any = await (await fetch(`${base}/api/hosts`)).json();
    assert.equal(hosts.main.country, 'CA');
  } finally {
    child.kill('SIGTERM');
    if(child.exitCode === null) await once(child, 'exit');
    await rm(dir, {recursive:true, force:true});
  }
});
