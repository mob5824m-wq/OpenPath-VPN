// Serves the packaged dashboard on a stable loopback origin and forwards its
// API/WebSocket requests to the separately running OpenPath server.
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const MIME = {
  '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8', '.json':'application/json; charset=utf-8',
  '.png':'image/png', '.svg':'image/svg+xml', '.ico':'image/x-icon', '.woff2':'font/woff2',
};

function startDashboardServer({root, backendUrl, port=34567}) {
  const backend = new URL(backendUrl);
  if(!['http:', 'https:'].includes(backend.protocol) || backend.username || backend.password){
    throw new Error('OPENPATH_BACKEND_URL must be an HTTP(S) URL without credentials');
  }
  const transport = backend.protocol === 'https:' ? https : http;
  const webRoot = path.resolve(root);
  let allowedOrigin = '';
  let allowedHost = '';
  const matchesBackendPath = pathname => pathname === '/health' || pathname === '/api' || pathname.startsWith('/api/') || pathname === '/ops' || pathname.startsWith('/ops/') || pathname === '/fast' || pathname.startsWith('/fast/');
  // A DNS-rebound website can send same-origin requests without an Origin
  // header. Require the exact loopback Host as well as checking Origin.
  const permitted = request => request.headers.host === allowedHost && (!request.headers.origin || request.headers.origin === allowedOrigin);
  const requestOptions = request => ({
    protocol:backend.protocol, hostname:backend.hostname, port:backend.port || undefined,
    method:request.method, path:request.url,
    headers:{...request.headers, host:backend.host, 'x-forwarded-for':request.socket.remoteAddress || ''},
  });

  const server = http.createServer((request, response) => {
    if(!permitted(request)){ response.writeHead(403); response.end('Forbidden'); return; }
    let pathname;
    try { pathname = decodeURIComponent(new URL(request.url || '/', 'http://localhost').pathname); }
    catch { response.writeHead(400); response.end('Invalid path'); return; }
    if(pathname.includes('\0')){ response.writeHead(400); response.end('Invalid path'); return; }
    if(matchesBackendPath(pathname)){
      const upstream = transport.request(requestOptions(request), upstreamResponse => {
        const headers = {...upstreamResponse.headers};
        // The local proxy should not let unrelated websites read local API responses.
        delete headers['access-control-allow-origin'];
        delete headers['access-control-allow-credentials'];
        response.writeHead(upstreamResponse.statusCode || 502, headers);
        upstreamResponse.on('error', ()=>response.destroy());
        upstreamResponse.pipe(response);
      });
      upstream.setTimeout(10000, ()=>upstream.destroy());
      upstream.on('error', () => { if(!response.headersSent) response.writeHead(502, {'content-type':'application/json'}); response.end('{"error":"Backend unavailable"}'); });
      request.on('aborted', ()=>upstream.destroy());
      request.pipe(upstream);
      return;
    }
    if(request.method !== 'GET' && request.method !== 'HEAD'){ response.writeHead(405); response.end(); return; }
    const filename = path.resolve(webRoot, `.${pathname === '/' ? '/index.html' : pathname}`);
    if(!filename.startsWith(`${webRoot}${path.sep}`)){ response.writeHead(403); response.end('Forbidden'); return; }
    fs.stat(filename, (error, stat) => {
      if(error || !stat.isFile()){ response.writeHead(404); response.end('Not found'); return; }
      response.writeHead(200, {'content-type':MIME[path.extname(filename).toLowerCase()] || 'application/octet-stream', 'content-length':stat.size});
      if(request.method === 'HEAD'){ response.end(); return; }
      fs.createReadStream(filename).on('error', ()=>response.destroy()).pipe(response);
    });
  });

  server.on('upgrade', (request, socket, head) => {
    socket.on('error', ()=>socket.destroy());
    let pathname;
    try { pathname = new URL(request.url || '/', 'http://localhost').pathname; }
    catch { socket.destroy(); return; }
    if(!permitted(request) || !(pathname === '/ops' || pathname.startsWith('/ops/') || pathname === '/fast' || pathname.startsWith('/fast/'))){
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return;
    }
    const upstreamRequest = transport.request(requestOptions(request));
    upstreamRequest.on('upgrade', (upstreamResponse, upstreamSocket, upstreamHead) => {
      let headers = `HTTP/${upstreamResponse.httpVersion} ${upstreamResponse.statusCode} ${upstreamResponse.statusMessage}\r\n`;
      for(let i=0; i<upstreamResponse.rawHeaders.length; i+=2) headers += `${upstreamResponse.rawHeaders[i]}: ${upstreamResponse.rawHeaders[i+1]}\r\n`;
      socket.write(`${headers}\r\n`);
      if(upstreamHead.length) socket.write(upstreamHead);
      if(head.length) upstreamSocket.write(head);
      socket.on('error', ()=>upstreamSocket.destroy());
      upstreamSocket.on('error', ()=>socket.destroy());
      socket.on('close', ()=>upstreamSocket.destroy());
      upstreamSocket.on('close', ()=>socket.destroy());
      socket.pipe(upstreamSocket).pipe(socket);
    });
    upstreamRequest.on('response', upstreamResponse => {
      upstreamResponse.resume();
      socket.end(`HTTP/1.1 ${upstreamResponse.statusCode || 502} Bad Gateway\r\nConnection: close\r\n\r\n`);
    });
    upstreamRequest.on('error', ()=>socket.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n'));
    upstreamRequest.end();
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.off('error', reject);
      allowedHost = `127.0.0.1:${server.address().port}`;
      allowedOrigin = `http://${allowedHost}`;
      resolve({server, url:allowedOrigin});
    });
  });
}

module.exports = {startDashboardServer};
