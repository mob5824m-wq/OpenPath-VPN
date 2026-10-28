import test, { afterEach, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { createHmac, webcrypto } from 'node:crypto'
import { JSDOM } from 'jsdom'
import React from 'react'

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url:'https://dashboard.example/' })
for (const name of ['window', 'document', 'navigator', 'location', 'localStorage', 'HTMLElement', 'Node', 'Event', 'MouseEvent', 'KeyboardEvent', 'MutationObserver', 'getComputedStyle']) {
  Object.defineProperty(globalThis, name, { configurable:true, writable:true, value:(dom.window as any)[name] })
}
Object.defineProperty(globalThis, 'crypto', { configurable:true, value:webcrypto })
Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable:true, writable:true, value:true })

const { render, screen, waitFor, cleanup, act } = await import('@testing-library/react')
const userEvent = (await import('@testing-library/user-event')).default
const { default:App } = await import('../src/App')

class FakeSocket {
  static OPEN = 1
  static instances:FakeSocket[] = []
  readonly url:string
  readyState = 0
  binaryType = ''
  closed = false
  sent:string[] = []
  onopen:((event:any)=>void)|null = null
  onmessage:((event:any)=>void)|null = null
  onerror:((event:any)=>void)|null = null
  onclose:((event:any)=>void)|null = null
  constructor(url:string) { this.url = url; FakeSocket.instances.push(this) }
  send(data:string) { if(this.readyState !== 1) throw new Error('not open'); this.sent.push(data) }
  close() { this.closed = true; this.readyState = 3 }
  open() { this.readyState = 1; this.onopen?.({}) }
  message(data:unknown) { this.onmessage?.({ data:JSON.stringify(data) }) }
  fail() { this.readyState = 3; this.onclose?.({code:1006}) }
}

const directory = {
  main:{ id:'main', name:'Main server', wssUrl:'wss://localhost/ops', country:'CA', region:'Montreal' },
  hosts:[
    { id:'us', name:'New York server', host:'us.example', port:443, wssUrl:'wss://us.example/ops', country:'US', region:'New York', online:true, flag:'🇺🇸', load:0.25 },
    { id:'offline', name:'Offline server', host:'off.example', port:443, wssUrl:'wss://off.example/ops', country:'GB', online:false },
  ], online:1, total:2,
}
let releaseStatus = 200
let releaseData:unknown = []
let requestedUrls:string[] = []
let openedUrls:string[] = []

beforeEach(() => {
  localStorage.clear()
  delete (window as any).openpath
  FakeSocket.instances = []
  requestedUrls = []
  openedUrls = []
  releaseStatus = 200
  releaseData = []
  Object.defineProperty(globalThis, 'WebSocket', { configurable:true, writable:true, value:FakeSocket })
  Object.defineProperty(globalThis, 'Notification', { configurable:true, writable:true, value:undefined })
  Object.defineProperty(window, 'open', { configurable:true, writable:true, value:(url:string)=>{ openedUrls.push(url); return null } })
  Object.defineProperty(navigator, 'clipboard', { configurable:true, value:{ writeText:async()=>{} } })
  Object.defineProperty(globalThis, 'fetch', { configurable:true, writable:true, value:async (input:string|URL)=>{
    const url = String(input)
    requestedUrls.push(url)
    if(url.includes('/api/hosts')) return new Response(JSON.stringify(directory), {status:200})
    if(url.includes('/api/client-ip')) return new Response(JSON.stringify({ip:'198.51.100.8'}), {status:200})
    if(url.includes('/api/releases')) return new Response(JSON.stringify({releases:releaseData, stale:false}), {status:releaseStatus})
    if(url.includes('api.github.com')) return new Response(JSON.stringify(releaseData), {status:releaseStatus})
    throw new Error(`Unexpected URL ${url}`)
  } })
})
afterEach(() => cleanup())

async function socketAt(index:number):Promise<FakeSocket> {
  await waitFor(()=>assert.ok(FakeSocket.instances[index]))
  return FakeSocket.instances[index]
}

async function openSocket(socket:FakeSocket) {
  await act(async()=>socket.open())
  await screen.findByText(/Session connected/)
}

test('real server selection, mode switching, fetch, disconnect and recent reconnect', async () => {
  const user = userEvent.setup({ document })
  render(<App />)
  await user.click(screen.getByRole('button', {name:'Countries'}))
  await screen.findByRole('button', {name:'Connect to New York server'})
  assert.equal(screen.queryByRole('button', {name:'Connect to Offline server'}), null)
  await user.click(screen.getByRole('button', {name:'Connect to New York server'}))
  const first = await socketAt(0)
  const firstUrl = new URL(first.url)
  assert.equal(firstUrl.host, 'us.example')
  assert.equal(firstUrl.pathname, '/ops')
  const [ts, nonce, signature] = firstUrl.searchParams.get('auth')!.split('.')
  assert.equal(signature, createHmac('sha256', 'demo-student-key-do-not-use-prod').update(`${ts}.${nonce}./ops`).digest('hex'))
  await openSocket(first)
  assert.ok(screen.getByText(/Device and other browser traffic are not protected/))
  assert.equal(JSON.parse(first.sent[0]).op, 'ping')
  await user.click(screen.getByRole('button', {name:'Fetch', exact:true}))
  const request = JSON.parse(first.sent.at(-1)!)
  assert.equal(request.op, 'fetch')
  await act(async()=>first.message({op:'fetch-res', id:request.id, status:200, body:Buffer.from('from the selected server').toString('base64'), truncated:false}))
  assert.match(screen.getByRole('region', {name:'Server fetch result'}).textContent!, /HTTP 200.*from the selected server/s)
  await user.click(screen.getByRole('button', {name:'Fetch', exact:true}))
  const malformedRequest = JSON.parse(first.sent.at(-1)!)
  await act(async()=>first.message({op:'fetch-res', id:malformedRequest.id, status:200, body:'not-base64%%%'}))
  assert.match(screen.getByRole('status').textContent!, /invalid fetch response/)
  assert.equal((screen.getByRole('button', {name:'Fetch', exact:true}) as HTMLButtonElement).disabled, false)

  await user.click(screen.getByRole('button', {name:'Turbo', exact:true}))
  const second = await socketAt(1)
  assert.equal(first.closed, true)
  assert.equal(new URL(second.url).host, 'us.example')
  assert.equal(new URL(second.url).pathname, '/fast')
  await openSocket(second)
  await user.click(screen.getByRole('button', {name:'Disconnect', exact:true}))
  assert.equal(second.closed, true)
  await user.click(screen.getAllByText('Reconnect')[0])
  const third = await socketAt(2)
  assert.equal(new URL(third.url).host, 'us.example')
  assert.equal(new URL(third.url).pathname, '/fast')
  await openSocket(third)
})

test('profile creation, editing, duplication and deletion survive a reload', async () => {
  const user = userEvent.setup({ document })
  const view = render(<App />)
  await user.click(screen.getByRole('button', {name:'Profiles'}))
  await user.click(screen.getByRole('button', {name:'Create profile'}))
  await user.click(screen.getByRole('button', {name:'Next'}))
  assert.ok(screen.getByText('Give your profile a name'))
  await user.type(screen.getByLabelText('Name'), 'Test profile')
  await user.click(screen.getByRole('button', {name:'Colour #3b82f6'}))
  await user.click(screen.getByRole('button', {name:'Gaming'}))
  await user.click(screen.getByRole('button', {name:'Next'}))
  await screen.findByRole('button', {name:/Country:/})
  await user.click(screen.getByRole('button', {name:/Country:/}))
  await user.click(screen.getByRole('button', {name:/United States/}))
  await user.click(screen.getByRole('button', {name:/Region:/}))
  await user.click(screen.getByRole('button', {name:/New York/}))
  await user.click(screen.getByRole('button', {name:'Next'}))
  await user.click(screen.getByRole('button', {name:/Transport:/}))
  await user.click(screen.getByRole('button', {name:'Turbo', exact:true}))
  await user.click(screen.getByRole('button', {name:'Save'}))
  assert.ok(screen.getByText('Test profile'))
  let stored = JSON.parse(localStorage.getItem('openpath:editable-profiles')!)
  const created = stored.find((p:any)=>p.name === 'Test profile')
  assert.equal(created.countryCode, 'US')
  assert.equal(created.city, 'New York')
  assert.equal(created.protocol, 'Turbo')
  assert.equal(created.color, '#3b82f6')
  assert.equal(created.icon, '🎮')
  await user.click(screen.getByRole('button', {name:'Test profile options'}))
  await user.click(screen.getByRole('button', {name:/Duplicate/}))
  assert.ok(screen.getByText('Test profile copy'))
  await user.click(screen.getByRole('button', {name:'School options'}))
  await user.click(screen.getByRole('button', {name:/Delete/}))
  await user.click(screen.getByRole('button', {name:/Tap again to delete/}))
  view.unmount()
  render(<App />)
  await user.click(screen.getByRole('button', {name:'Profiles'}))
  assert.equal(screen.queryByRole('button', {name:'School options'}), null)
  assert.ok(screen.getByText('Test profile'))
  assert.ok(screen.getByText('Test profile copy'))
  stored = JSON.parse(localStorage.getItem('openpath:editable-profiles')!)
  assert.equal(stored.some((p:any)=>p.id === 'school'), false)
  await user.click(screen.getByRole('button', {name:'Test profile options'}))
  await user.click(screen.getByRole('button', {name:'Connect', exact:true}))
  const selected = await socketAt(0)
  assert.equal(new URL(selected.url).host, 'us.example')
  assert.equal(new URL(selected.url).pathname, '/fast')
  await openSocket(selected)
  await user.click(screen.getByRole('button', {name:'Disconnect', exact:true}))
  await user.click(screen.getAllByRole('button', {name:'Quick Connect'})[0])
  const quick = await socketAt(1)
  assert.equal(new URL(quick.url).host, 'dashboard.example')
  assert.equal(new URL(quick.url).pathname, '/fast')
})

test('cancelling an in-flight connection prevents stale callbacks and failure is visible', async () => {
  const user = userEvent.setup({ document })
  render(<App />)
  await user.click(screen.getAllByRole('button', {name:'Quick Connect'})[0])
  const first = await socketAt(0)
  const staleOpen = first.onopen!
  await user.click(screen.getByRole('button', {name:'Cancel connection'}))
  assert.equal(first.closed, true)
  await act(async()=>staleOpen({}))
  assert.equal(screen.queryByText(/Session connected/), null)
  await user.click(screen.getAllByRole('button', {name:'Quick Connect'})[0])
  const second = await socketAt(1)
  await act(async()=>second.fail())
  assert.match(screen.getByRole('status').textContent!, /Connection failed/)
})

test('settings, feedback, release filters and reset perform their labeled actions', async () => {
  const user = userEvent.setup({ document })
  releaseData = [{ id:1, tag_name:'v2', name:'Latest', html_url:'https://github.com/mob5824m-wq/OpenPath-VPN/releases/tag/v2', assets:[
    { id:1, name:'app-linux.deb', browser_download_url:'https://github.com/mob5824m-wq/OpenPath-VPN/releases/download/v2/linux.deb' },
    { id:2, name:'app-win.exe', browser_download_url:'https://github.com/mob5824m-wq/OpenPath-VPN/releases/download/v2/win.exe' },
  ] }]
  render(<App />)
  await user.click(screen.getByRole('button', {name:'Good connection'}))
  assert.equal(JSON.parse(localStorage.getItem('openpath:feedback')!), 'up')
  await user.click(screen.getByRole('button', {name:'Learn about NetShield availability'}))
  assert.ok(screen.getByText(/A browser session cannot change device DNS/))
  await user.click(screen.getByRole('button', {name:'Got it'}))
  await user.click(screen.getByRole('button', {name:'Settings'}))
  const username = screen.getByLabelText('Username')
  await user.clear(username); await user.type(username, 'student')
  const psk = screen.getByLabelText('Pre-shared key (PSK)')
  await user.clear(psk); await user.type(psk, 'new-key')
  assert.equal(JSON.parse(localStorage.getItem('openpath:user')!), 'student')
  assert.equal([...Array(localStorage.length)].some((_,i)=>localStorage.key(i)?.includes('psk')), false)
  await user.click(screen.getByRole('button', {name:/Connection log/}))
  assert.ok(screen.getByRole('button', {name:'Copy log'}))
  await user.click(screen.getByRole('button', {name:'Copy log'}))
  assert.match(screen.getByRole('status').textContent!, /Log copied/)
  await user.click(screen.getByRole('button', {name:/Releases/}))
  await screen.findByText('app-linux.deb ⬇')
  await user.click(screen.getByRole('button', {name:'Linux', exact:true}))
  assert.ok(screen.getByText('app-linux.deb ⬇'))
  assert.equal(screen.queryByText('app-win.exe ⬇'), null)
  await user.click(screen.getByRole('button', {name:/Open on GitHub/}))
  assert.deepEqual(openedUrls, ['https://github.com/mob5824m-wq/OpenPath-VPN/releases/tag/v2'])
  await user.click(screen.getByRole('button', {name:'Settings'}))
  await user.click(screen.getByRole('button', {name:/Reset local data/}))
  await user.click(screen.getByRole('button', {name:/Tap again to confirm reset/}))
  assert.equal(JSON.parse(localStorage.getItem('openpath:user')!), 'demo')
  assert.equal((screen.getByLabelText('Pre-shared key (PSK)') as HTMLInputElement).value, 'demo-student-key-do-not-use-prod')
})

test('a failed release request is reported instead of showing a fake empty list', async () => {
  const user = userEvent.setup({ document })
  releaseStatus = 503
  render(<App />)
  await user.click(screen.getByRole('button', {name:/View all/}))
  assert.match((await screen.findByRole('alert')).textContent!, /Could not load releases.*503/)
  assert.equal(screen.queryByText(/No releases have been published/), null)
  releaseStatus = 200
  await user.click(screen.getByRole('button', {name:/Refresh from GitHub/}))
  await screen.findByText('No releases have been published yet.')
})

test('custom address and credentials are used for signing without persisting the key', async () => {
  const user = userEvent.setup({ document })
  render(<App />)
  await user.click(screen.getByRole('button', {name:'Settings'}))
  const username = screen.getByLabelText('Username')
  const psk = screen.getByLabelText('Pre-shared key (PSK)')
  await user.clear(username); await user.type(username, 'student')
  await user.clear(psk); await user.type(psk, 'my-private-key')
  await user.click(screen.getByRole('button', {name:'Countries'}))
  const address = screen.getByLabelText('Server address')
  await user.clear(address); await user.type(address, 'wss://custom.example/ops')
  await user.click(screen.getByRole('button', {name:'Refresh server list'}))
  await waitFor(()=>assert.ok(requestedUrls.includes('https://custom.example/api/hosts')))
  assert.equal(JSON.parse(localStorage.getItem('openpath:serverUrl')!), 'wss://custom.example/ops')
  await user.click(await screen.findByRole('button', {name:'Connect to Main server'}))
  const socket = await socketAt(0)
  const url = new URL(socket.url)
  assert.equal(url.host, 'custom.example')
  assert.equal(url.searchParams.get('user'), 'student')
  const [ts, nonce, signature] = url.searchParams.get('auth')!.split('.')
  assert.equal(signature, createHmac('sha256', 'my-private-key').update(`${ts}.${nonce}./ops`).digest('hex'))
  assert.equal(JSON.stringify(localStorage).includes('my-private-key'), false)
})

test('unavailable profile locations fail visibly instead of connecting to a different country', async () => {
  localStorage.setItem('openpath:editable-profiles', JSON.stringify([{id:'jp-profile', name:'Japan', countryCode:'JP', countryName:'Japan', city:'Fastest', protocol:'Stealth'}]))
  const user = userEvent.setup({ document })
  render(<App />)
  await user.click(screen.getByRole('button', {name:'Profiles'}))
  await user.click(screen.getByRole('button', {name:'Japan options'}))
  await user.click(screen.getByRole('button', {name:'Connect', exact:true}))
  await waitFor(()=>assert.match(screen.getByRole('status').textContent!, /No online server available for Japan/))
  assert.equal(FakeSocket.instances.length, 0)
})

test('the notification toggle requests permission when it is not yet granted', async () => {
  let requests = 0
  class DeniedNotification {
    static permission = 'default'
    static async requestPermission(){ requests++; return 'denied' }
  }
  Object.defineProperty(globalThis, 'Notification', {configurable:true, writable:true, value:DeniedNotification})
  const user = userEvent.setup({ document })
  render(<App />)
  await user.click(screen.getByRole('button', {name:'Settings'}))
  await user.click(screen.getByRole('button', {name:/System notifications: Off/}))
  assert.equal(requests, 1)
  assert.match(screen.getByRole('status').textContent!, /Permission not granted/)
})

test('reset disconnects the active socket and restores the default profile set', async () => {
  const user = userEvent.setup({ document })
  render(<App />)
  await user.click(screen.getAllByRole('button', {name:'Quick Connect'})[0])
  const socket = await socketAt(0)
  await openSocket(socket)
  await user.click(screen.getByRole('button', {name:'Settings'}))
  await user.click(screen.getByRole('button', {name:/Reset local data/}))
  await user.click(screen.getByRole('button', {name:/Tap again to confirm reset/}))
  assert.equal(socket.closed, true)
  await user.click(screen.getByRole('button', {name:'Home'}))
  assert.equal(screen.queryByText(/Session connected/), null)
  assert.equal(JSON.parse(localStorage.getItem('openpath:recents') || '[]').length, 0)
  assert.ok(JSON.parse(localStorage.getItem('openpath:editable-profiles')!).some((p:any)=>p.id === 'school'))
})


test('desktop device VPN imports, applies the chosen DNS filter, connects and disconnects', async () => {
  const calls:string[] = []
  let state:any = {state:'inactive', configured:false, owned:false, installed:true, interface:'opvpn0'}
  const bridge = {
    status:async()=>({...state}),
    importProfile:async()=>{ calls.push('import'); state={...state, configured:true}; return {configured:true, endpoint:'vpn.example:51820', hasIPv6Address:true} },
    removeProfile:async()=>{ calls.push('remove'); state={...state, configured:false} },
    connect:async(options:any)=>{ calls.push(`connect:${options.dnsMode}`); state={...state, state:'active', owned:true, message:'Interface active; peer connectivity is not yet verified.'}; return {...state} },
    disconnect:async()=>{ calls.push('disconnect'); state={...state, state:'inactive', owned:false, message:undefined}; return {...state} },
  }
  Object.defineProperty(window, 'openpath', {configurable:true, writable:true, value:{deviceVpn:bridge}})
  const user = userEvent.setup({document})
  render(<App />)
  await screen.findByText('Device VPN disconnected')
  await user.click(screen.getByRole('button', {name:'Import WireGuard profile'}))
  await screen.findByText(/Profile imported for vpn.example:51820/)
  await user.selectOptions(screen.getByLabelText('NetShield / DNS on next connection'), 'malware')
  await user.click(screen.getByRole('button', {name:'Connect device VPN'}))
  await screen.findByText('WireGuard interface active')
  assert.match(screen.getByLabelText('Device VPN status').textContent!, /interface active/)
  assert.ok(screen.getByText(/peer connectivity is not yet verified/))
  await user.click(screen.getByRole('button', {name:'Disconnect device VPN'}))
  await waitFor(()=>assert.match(screen.getByLabelText('Device VPN status').textContent!, /disconnected/))
  await user.click(screen.getByRole('button', {name:'Remove profile'}))
  assert.deepEqual(calls, ['import','connect:malware','disconnect','remove'])
})
