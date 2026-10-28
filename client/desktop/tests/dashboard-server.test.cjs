const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const net = require('node:net');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const { startDashboardServer } = require('../electron/dashboard-server');

test('packaged dashboard serves assets and proxies API and WebSocket requests on the same origin', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'openpath-web-'));
  await fs.writeFile(path.join(root, 'index.html'), '<h1>OpenPath</h1>');
  await fs.writeFile(path.join(root, 'app.js'), 'window.loaded = true;');
  const backend = http.createServer((_request, response)=>{
    response.setHeader('access-control-allow-origin', '*');
    response.setHeader('content-type', 'application/json');
    response.end('{"hosts":[]}');
  });
  const upgraded = new Set();
  backend.on('upgrade', (_request, socket)=>{
    upgraded.add(socket);
    socket.on('close', ()=>upgraded.delete(socket));
    socket.write('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\nfrom-backend');
    socket.on('error', ()=>{});
  });
  backend.listen(0, '127.0.0.1');
  await once(backend, 'listening');
  const backendPort = backend.address().port;
  const {server, url} = await startDashboardServer({root, backendUrl:`http://127.0.0.1:${backendPort}`, port:0});
  try {
    assert.match(await (await fetch(url)).text(), /OpenPath/);
    assert.match((await fetch(`${url}/app.js`)).headers.get('content-type'), /javascript/);
    const directory = await fetch(`${url}/api/hosts`);
    assert.deepEqual(await directory.json(), {hosts:[]});
    assert.equal(directory.headers.get('access-control-allow-origin'), null);
    assert.equal((await fetch(`${url}/api/hosts`, {headers:{origin:'https://untrusted.example'}})).status, 403);
    const reboundStatus = await new Promise((resolve, reject)=>{
      http.get(`${url}/api/hosts`, {headers:{host:'rebound.example'}}, response=>{ response.resume(); resolve(response.statusCode); }).on('error', reject);
    });
    assert.equal(reboundStatus, 403);
    assert.equal((await fetch(`${url}/..%2fsecret`)).status, 403);
    assert.equal((await fetch(`${url}/invalid%00path`)).status, 400);

    const port = new URL(url).port;
    const client = net.connect(Number(port), '127.0.0.1');
    const response = new Promise((resolve, reject)=>{
      let data = '';
      const timer = setTimeout(()=>reject(new Error('upgrade timed out')), 3000);
      client.on('data', chunk=>{ data += chunk.toString(); if(data.includes('from-backend')){ clearTimeout(timer); resolve(data); } });
      client.on('error', reject);
    });
    client.write(`GET /ops?auth=test HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nOrigin: ${url}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n`);
    assert.match(await response, /101 Switching Protocols/);
    client.destroy();
  } finally {
    for(const socket of upgraded) socket.destroy();
    server.closeAllConnections();
    backend.closeAllConnections();
    await Promise.all([new Promise(resolve=>server.close(resolve)), new Promise(resolve=>backend.close(resolve))]);
    await fs.rm(root, {recursive:true, force:true});
  }
});
