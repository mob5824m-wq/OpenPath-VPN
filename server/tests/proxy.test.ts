import test from 'node:test';
import assert from 'node:assert/strict';
import { forwardHttpRequest, isPublicAddress } from '../src/proxy/forwarder.js';

test('server fetch blocks private, loopback, metadata, mapped and reserved IP addresses', async () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.1.2', '172.16.0.1', '169.254.169.254', '100.64.0.1', '::1', 'fc00::1', '::ffff:127.0.0.1']) {
    assert.equal(isPublicAddress(ip), false, ip);
  }
  assert.equal(isPublicAddress('8.8.8.8'), true);
  assert.equal(isPublicAddress('2606:4700:4700::1111'), true);
  for (const url of ['http://127.0.0.1:4433/health', 'http://169.254.169.254/latest/meta-data/', 'http://[::1]/']) {
    const result = await forwardHttpRequest({url});
    assert.equal(result.status, 403, url);
  }
  assert.equal((await forwardHttpRequest({url:'file:///etc/passwd'})).status, 400);
  assert.equal((await forwardHttpRequest({url:'https://user:secret@example.com/'})).status, 400);
  assert.equal((await forwardHttpRequest({url:'https://example.com/', method:'POST'})).status, 405);
});
