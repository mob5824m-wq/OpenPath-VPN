// Test-only TCP forwarding tap. It records TLS metadata, never raw packets.
// Never put this fixture in a deployment: the CI certificates/keys are public.
import { createServer, createConnection } from 'node:net';
import { renameSync, writeFileSync } from 'node:fs';

const listenPort = Number(process.env.TEST_TAP_PORT || 18443);
const targetPort = Number(process.env.TEST_TAP_TARGET_PORT || 18444);
const output = process.env.TEST_TAP_OUTPUT;
if (!output) throw new Error('TEST_TAP_OUTPUT is required');
const sessions = [];
const limit = 4 * 1024 * 1024;

function records(data, helloType) {
  let offset = 0;
  let applicationData = false;
  let validRecords = true;
  while (offset + 5 <= data.length) {
    const type = data[offset];
    const major = data[offset + 1];
    const length = data.readUInt16BE(offset + 3);
    if (![20, 21, 22, 23].includes(type) || major !== 3 || length > 18432) {
      validRecords = false;
      break;
    }
    if (offset + 5 + length > data.length) break; // the last record may still be arriving
    if (type === 23) applicationData = true;
    offset += 5 + length;
  }
  return {
    hello: data.length >= 6 && data[0] === 22 && data[1] === 3 && data[5] === helloType,
    validRecords,
    applicationData,
  };
}
function summary(session) {
  const outbound = Buffer.concat(session.outbound.chunks);
  const inbound = Buffer.concat(session.inbound.chunks);
  return {
    client: records(outbound, 1),
    server: records(inbound, 2),
    plaintextHttp: outbound.includes(Buffer.from('GET /stealth-wg')) ||
      outbound.includes(Buffer.from('user=ci-test')) || inbound.includes(Buffer.from('HTTP/1.1 101')) ||
      inbound.includes(Buffer.from('"protocol":"wireguard-ws"')),
    truncated: session.outbound.truncated || session.inbound.truncated,
  };
}
function flush() {
  const temp = `${output}.tmp`;
  writeFileSync(temp, JSON.stringify(sessions.map(summary)));
  renameSync(temp, output);
}
function capture(direction, chunk) {
  direction.bytes += chunk.length;
  if (direction.bytes <= limit) direction.chunks.push(chunk);
  else direction.truncated = true;
  flush();
}

const server = createServer(client => {
  const stream = () => ({chunks: [], bytes: 0, truncated: false});
  const session = {outbound: stream(), inbound: stream()};
  sessions.push(session);
  const upstream = createConnection({host: '127.0.0.1', port: targetPort});
  client.on('data', chunk => capture(session.outbound, chunk));
  upstream.on('data', chunk => capture(session.inbound, chunk));
  client.on('error', () => upstream.destroy());
  upstream.on('error', () => client.destroy());
  client.pipe(upstream).pipe(client);
  client.on('close', flush);
  flush();
});
server.listen(listenPort, '0.0.0.0', () => console.log('TEST TLS TAP READY'));
