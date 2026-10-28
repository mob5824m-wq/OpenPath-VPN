import test from 'node:test'
import assert from 'node:assert/strict'
import { defaultServerUrl, directoryTargets, directoryUrl, modeUrl, parseServerUrl, selectProfileServer } from '../src/connection'
import type { HostDirectory } from '../src/connection'

const directory: HostDirectory = {
  main: { id:'main', name:'Main', wssUrl:'wss://localhost:4433/ops', country:'CA', region:'Toronto' },
  hosts: [
    { id:'us-a', name:'US A', host:'a.example', port:443, wssUrl:'wss://a.example/ops', country:'US', region:'New York', online:true, load:0.5, latencyMs:70 },
    { id:'us-b', name:'US B', host:'b.example', port:443, wssUrl:'wss://b.example/ops', country:'US', region:'New York', online:true, load:0.8, latencyMs:20 },
    { id:'off', name:'Offline', host:'c.example', port:443, wssUrl:'wss://c.example/ops', country:'US', online:false },
  ],
  online:2, total:3,
}

test('same-origin default and mode URLs use the preview proxy and fresh auth parameters', () => {
  assert.equal(defaultServerUrl({protocol:'https:', host:'5173-preview.example'} as Location), 'wss://5173-preview.example/ops')
  assert.equal(defaultServerUrl({protocol:'http:', host:'localhost:5173'} as Location), 'ws://localhost:5173/ops')
  assert.equal(directoryUrl('wss://vpn.example/ops?auth=old'), 'https://vpn.example/api/hosts')
  const fast = modeUrl('wss://vpn.example/ops?auth=old&user=old', 'fast')
  assert.equal(fast.pathname, '/fast')
  assert.equal(fast.searchParams.get('mode'), 'fast')
  assert.equal(fast.searchParams.has('auth'), false)
  const stealth = modeUrl('wss://vpn.example/fast?mode=fast&fast=1', 'stealth')
  assert.equal(stealth.pathname, '/ops')
  assert.equal(stealth.search, '')
  assert.throws(() => parseServerUrl('https://vpn.example/ops'))
  assert.throws(() => parseServerUrl('wss://user:secret@vpn.example/ops'))
  assert.throws(() => parseServerUrl('wss://vpn.example/ops?psk=secret'))
})

test('server selection uses actual online endpoints and honors country and region', () => {
  const targets = directoryTargets(directory, 'wss://dashboard.example/ops')
  assert.equal(targets.length, 3)
  assert.equal(targets[0].url, 'wss://dashboard.example/ops') // not the server's advertised localhost
  assert.equal(selectProfileServer(targets, 'wss://dashboard.example/ops', { countryCode:'AUTO', city:'Fastest' }).id, 'main')
  assert.equal(selectProfileServer(targets, 'wss://dashboard.example/ops', { countryCode:'US', city:'New York' }).id, 'us-b')
  assert.equal(selectProfileServer(targets, 'wss://dashboard.example/ops', { countryCode:'AUTO', city:'New York' }).id, 'us-b')
  assert.throws(() => selectProfileServer(targets, '', { countryCode:'JP', city:'Fastest' }), /No online server/)
  assert.throws(() => selectProfileServer([], '', { countryCode:'CA', city:'Fastest' }), /Refresh the server list/)
})
