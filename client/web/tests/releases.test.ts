import test, { afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { loadReleaseFeed, normalizeReleases, PLATFORM_FILTERS } from '../src/releases'

const originalFetch = globalThis.fetch
afterEach(()=>{ globalThis.fetch = originalFetch })
const release = {id:1, tag_name:'v1.2', html_url:'https://github.com/mob5824m-wq/OpenPath-VPN/releases/tag/v1.2', assets:[
  {id:1, name:'OpenPath-v1.2-win-x64.zip', browser_download_url:'https://github.com/mob5824m-wq/OpenPath-VPN/releases/download/v1.2/win.zip'},
  {id:2, name:'OpenPath-v1.2-darwin-arm64.zip', browser_download_url:'https://github.com/mob5824m-wq/OpenPath-VPN/releases/download/v1.2/mac.zip'},
  {id:3, name:'openpath-web-v1.2.tar.gz', browser_download_url:'https://github.com/mob5824m-wq/OpenPath-VPN/releases/download/v1.2/web.tar.gz'},
  {id:4, name:'unsafe', browser_download_url:'javascript:alert(1)'},
]}

test('release categories distinguish darwin from windows and include web bundles', () => {
  const windows = PLATFORM_FILTERS.find(f=>f.id==='windows')!
  const mac = PLATFORM_FILTERS.find(f=>f.id==='macos')!
  const web = PLATFORM_FILTERS.find(f=>f.id==='web')!
  assert.equal(windows.match('OpenPath-v1.2-win-x64.zip'), true)
  assert.equal(windows.match('OpenPath-v1.2-darwin-arm64.zip'), false)
  assert.equal(mac.match('OpenPath-v1.2-darwin-arm64.zip'), true)
  assert.equal(web.match('openpath-web-v1.2.tar.gz'), true)
  assert.equal(normalizeReleases([release, {...release,id:2,draft:true}])[0].assets.length, 3)
})

test('release service cache is preferred; direct GitHub is a fallback', async () => {
  const seen:string[] = []
  globalThis.fetch = (async (input:any)=>{
    const url=String(input);seen.push(url)
    if(url.startsWith('/api/releases')) return new Response(JSON.stringify({releases:[release],stale:true,warning:'rate limit'}))
    throw new Error('unexpected')
  }) as typeof fetch
  const cached=await loadReleaseFeed(true, new AbortController().signal)
  assert.equal(cached.source,'server'); assert.equal(cached.stale,true); assert.match(cached.warning!,/rate limit/)
  assert.deepEqual(seen,['/api/releases?refresh=1'])

  seen.length=0
  globalThis.fetch = (async (input:any)=>{
    const url=String(input);seen.push(url)
    if(url.startsWith('/api/releases')) return new Response('',{status:404})
    return new Response(JSON.stringify([release]))
  }) as typeof fetch
  const fallback=await loadReleaseFeed(false, new AbortController().signal)
  assert.equal(fallback.source,'github'); assert.equal(fallback.releases[0].tag_name,'v1.2')
  assert.equal(seen.length,2)
})
