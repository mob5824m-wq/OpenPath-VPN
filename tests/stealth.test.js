import assert from 'assert';

// Unit tests for obfuscation helpers (run with node --test)
import { NonceCache, randomPaddingLen } from '../server/dist/utils/crypto.js';

const cache = new NonceCache(3);
cache.add('a'); cache.add('b'); cache.add('c');
assert.equal(cache.has('a'), true);
cache.add('d'); // evicts 'a'
assert.equal(cache.has('a'), false);
console.log('✓ NonceCache LRU works');

for(let i=0;i<10;i++){
  const len = randomPaddingLen(i,'seed');
  assert(len>=0 && len<=512, 'padding bounds');
}
console.log('✓ Padding distribution OK');
console.log('✓ Stealth tests passed');
