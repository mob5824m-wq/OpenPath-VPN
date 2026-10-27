import { genPsk } from './crypto.js';
const psk = genPsk();
console.log(`Generated PSK (store securely, share via openpath:// URI):\n${psk}\n\nOpenPath URI:\nopenpath://your-server.com:443/ops?psk=${psk}#DemoUser\n`);
