import test from 'node:test'
import assert from 'node:assert/strict'
import { directoryTargets, selectProfileServer, type HostDirectory } from '../src/connection'

test('region preferences never silently fall back to an unrelated configured server', () => {
  const directory:HostDirectory = {
    main:{id:'main', name:'Main', wssUrl:'wss://main/ops', country:'CA', region:'Toronto'},
    hosts:[{id:'us', name:'US', host:'us', port:443, wssUrl:'wss://us/ops', country:'US', region:'New York', online:true}],
    online:1, total:1,
  }
  const targets = directoryTargets(directory, 'wss://main.example/ops')
  assert.equal(selectProfileServer(targets, 'wss://main.example/ops', {countryCode:'AUTO', city:'New York'}).id, 'us')
  assert.throws(()=>selectProfileServer(targets, 'wss://main.example/ops', {countryCode:'AUTO', city:'Tokyo'}), /No online server/)
  assert.throws(()=>selectProfileServer(targets, 'wss://main.example/ops', {countryCode:'JP', city:'Fastest'}), /Japan/)
})
