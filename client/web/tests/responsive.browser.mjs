// Real-browser layout regression test. Set CHROME_BIN to an installed Chromium/Chrome.
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { chromium } from 'playwright-core'

const chrome = process.env.CHROME_BIN
if (!chrome) throw new Error('Set CHROME_BIN to an installed Chromium or Chrome binary')
const root = fileURLToPath(new URL('..', import.meta.url))
const server = await createServer({ root, server:{ host:'127.0.0.1', port:0, strictPort:false } })
let browser
try {
  await server.listen()
  const address = server.httpServer.address()
  const url = `http://127.0.0.1:${address.port}/`
  const extra = (process.env.OPENPATH_CHROME_ARGS || '').split(' ').filter(Boolean)
  browser = await chromium.launch({ executablePath:chrome, headless:true, args:['--no-sandbox', '--disable-dev-shm-usage', ...extra] })
  const page = await browser.newPage()
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname
    const json = path.endsWith('/hosts') ? {main:null, hosts:[], online:0, total:0} : path.endsWith('/client-ip') ? {ip:'198.51.100.10'} : {releases:[], stale:false}
    return route.fulfill({status:200, contentType:'application/json', body:JSON.stringify(json)})
  })
  for (const [name,width,height,wide] of [['desktop',1440,900,true], ['tablet',800,900,true], ['phone',390,844,false], ['small phone',320,700,false]]) {
    await page.setViewportSize({width,height})
    await page.goto(url, {waitUntil:'networkidle'})
    const nav = await page.getByRole('navigation', {name:'Main navigation'}).boundingBox()
    const home = page.getByRole('button', {name:'Home', exact:true})
    const settings = page.getByRole('button', {name:'Settings', exact:true})
    const first = await home.boundingBox()
    const last = await settings.boundingBox()
    assert.ok(nav && first && last, `${name}: navigation visible`)
    if (wide) {
      assert.equal(nav.width, 210, `${name}: sidebar width`)
      assert.ok(nav.height >= height && last.y > first.y, `${name}: vertical sidebar`)
    } else {
      assert.equal(nav.width, width, `${name}: bottom bar fills viewport`)
      assert.ok(nav.height < 100 && last.x > first.x, `${name}: horizontal bottom bar`)
    }
    if (name === 'desktop') {
      const summary = await page.locator('.home-summary').boundingBox()
      const map = await page.locator('.home-map').boundingBox()
      assert.ok(map.x > summary.x && map.y === summary.y, 'desktop: side-by-side overview')
    }
    for (const label of ['Countries', 'Profiles', 'Settings', 'Home']) {
      await page.getByRole('button', {name:label, exact:true}).click()
      assert.equal(await page.getByRole('button', {name:label, exact:true}).getAttribute('aria-current'), 'page', `${name}: ${label} navigation`)
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${name}: no horizontal page overflow`)
    }
    console.log(`${name}: responsive navigation, page controls and overflow OK`)
  }
} finally {
  if (browser) await browser.close()
  await server.close()
}
