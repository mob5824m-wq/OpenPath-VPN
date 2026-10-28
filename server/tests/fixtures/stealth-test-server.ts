// Disposable integration-test TLS terminator and real relay; never deploy this.
import { createServer } from 'node:https';
import { appendFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

process.env.OPSK = JSON.stringify({'ci-test':'only-for-disposable-ci-tests-not-production-123'});
const { StealthRelayServer } = await import('../../src/stealth/relay.js');
const relay = new StealthRelayServer(process.env.TEST_WG_TARGET || '127.0.0.1:51820', true, JSON.parse(process.env.OPSK));
const key = readFileSync(process.env.TEST_TLS_KEY_FILE || fileURLToPath(new URL('./stealth-test-key.pem', import.meta.url)));
const cert = readFileSync(process.env.TEST_TLS_CERT_FILE || fileURLToPath(new URL('./stealth-test-cert.pem', import.meta.url)));
const server = createServer({key, cert, minVersion:'TLSv1.2'}, (_req, res) => { res.writeHead(404); res.end(); });
if (process.env.TEST_TLS_ERRORS_FILE) {
  const errors = process.env.TEST_TLS_ERRORS_FILE;
  server.on('tlsClientError', () => appendFileSync(errors, 'TLS client rejected or aborted handshake\n'));
}
server.on('upgrade', (req, socket, head) => {
  // In production an isolated reverse proxy must set this header, not clients.
  req.headers['x-forwarded-proto'] = 'https';
  relay.handleUpgrade(req, socket, head, new URL(req.url || '/', 'https://localhost'));
});
server.listen(Number(process.env.TEST_TLS_PORT || 18443), '0.0.0.0', () => console.log('TEST RELAY READY'));
