import test from 'node:test';
import assert from 'node:assert/strict';
import { ReleaseService } from '../src/releases.js';

const good = {
  id: 2, tag_name: 'v1.2', name: 'OpenPath v1.2', body: 'Release notes',
  published_at: '2026-10-28T02:36:13Z', html_url: 'https://github.com/mob5824m-wq/OpenPath-VPN/releases/tag/v1.2',
  assets: [
    { id: 1, name: 'OpenPath-win-x64.exe', size: 1234, state: 'uploaded', browser_download_url: 'https://github.com/mob5824m-wq/OpenPath-VPN/releases/download/v1.2/OpenPath-win-x64.exe' },
    { id: 2, name: 'bad.exe', state: 'uploaded', browser_download_url: 'javascript:alert(1)' },
  ],
};

test('release metadata is validated, cached, revalidated and stale results are explicit', async () => {
  let now = 10_000;
  let calls = 0;
  const headers: Record<string,string>[] = [];
  const request = (async (url: string | URL | Request, options?: RequestInit) => {
    calls++;
    assert.match(String(url), /^https:\/\/api\.github\.com\/repos\/mob5824m-wq\/OpenPath-VPN\/releases\?/);
    headers.push(options?.headers as Record<string,string>);
    if (calls === 1) return new Response(JSON.stringify([good, {...good, id:3, draft:true}]), {headers:{etag:'"etag-1"'}});
    if (calls === 2) return new Response(null, {status:304});
    return new Response('rate limit', {status:403});
  }) as typeof fetch;
  const service = new ReleaseService(request, () => now);
  const first = await service.get();
  assert.equal(first.stale, false);
  assert.equal(first.releases.length, 1);
  assert.deepEqual(first.releases[0].assets.map(a => a.name), ['OpenPath-win-x64.exe']);
  await service.get();
  assert.equal(calls, 1);
  now += 61_000;
  const unchanged = await service.get();
  assert.equal(unchanged.stale, false);
  assert.equal(headers[1]['if-none-match'], '"etag-1"');
  const stale = await service.get(true);
  assert.equal(stale.stale, true);
  assert.match(stale.warning!, /rate limit/);
  assert.equal(stale.releases[0].tag_name, 'v1.2');
});

test('release loading fails clearly without cache and enforces response limits', async () => {
  const unavailable = new ReleaseService((async () => new Response('', {status:503})) as typeof fetch);
  await assert.rejects(unavailable.get(), /HTTP 503/);
  const tooLarge = new ReleaseService((async () => new Response('[]', {headers:{'content-length':String(3 * 1024 * 1024)}})) as typeof fetch);
  await assert.rejects(tooLarge.get(), /too large/);
  const invalid = new ReleaseService((async () => new Response('{"not":"a list"}')) as typeof fetch);
  await assert.rejects(invalid.get(), /invalid release list/);
});

test('simultaneous clients share a single upstream request', async () => {
  let calls = 0;
  const service = new ReleaseService((async () => { calls++; return new Response(JSON.stringify([good])); }) as typeof fetch);
  const [one, two] = await Promise.all([service.get(), service.get()]);
  assert.equal(calls, 1);
  assert.equal(one.releases[0].tag_name, two.releases[0].tag_name);
});
