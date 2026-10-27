const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const tools = path.join(process.env.USERPROFILE || process.env.HOME, '.codebuddy', 'gsd-core', 'bin', 'gsd-tools.cjs');
const args = process.argv.slice(2);
const r = spawnSync(process.execPath, [tools, ...args], { encoding: 'utf8', cwd: process.cwd() });
const out = (r.stdout || '') + (r.stderr || '');
fs.writeFileSync(path.join(__dirname, 'last-out.txt'), out, 'utf8');
process.stdout.write(out);
process.exitCode = r.status === null ? 1 : r.status;
