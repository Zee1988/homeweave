const { spawnSync } = require('child_process');
const path = require('path');

const tools = path.join(process.env.USERPROFILE, '.codebuddy', 'gsd-core', 'bin', 'gsd-tools.cjs');
const r = spawnSync(process.execPath, [tools, 'check', 'verify-failure-directions', '01', '--raw'], { encoding: 'utf8' });
const j = JSON.parse(r.stdout);
console.log('status=' + j.status, 'counts=' + JSON.stringify(j.counts), 'readError=' + j.readError);
const bad = (j.commands || []).filter((c) => c.severity !== 'none');
console.log('non-none=' + bad.length);
for (const c of bad.slice(0, 15)) {
  console.log('-', c.severity, '|', c.plan, '|', String(c.reason || '').slice(0, 140), '|', String(c.command || '').slice(0, 90));
}
