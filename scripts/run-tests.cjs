// Expand test files ourselves so npm test works in Windows cmd.exe as well as
// Unix shells. Node 20 does not reliably expand shell globs on every platform.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const typescript = process.argv.includes('--tsx');
const extensions = typescript ? /\.test\.(?:ts|tsx)$/ : /\.test\.(?:js|cjs|mjs)$/;
const files = fs.readdirSync('tests').filter(name => extensions.test(name)).sort().map(name => path.join('tests', name));
if (!files.length) throw new Error('No test files found');
const args = [...(typescript ? ['--import', 'tsx'] : []), '--test', '--test-concurrency=1', ...files];
const result = spawnSync(process.execPath, args, {stdio:'inherit'});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
