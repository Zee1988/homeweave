import { readFileSync } from 'node:fs';
import yaml from 'js-yaml';

const read = (p) => yaml.load(readFileSync(p, 'utf8'));
const r = read('.github/workflows/release.yml');
const c = read('.github/workflows/ci.yml');

console.log('--- release ---');
console.log('on:', JSON.stringify(r.on));
console.log('inputs:', JSON.stringify(r.on.workflow_dispatch?.inputs));
console.log('top perms:', JSON.stringify(r.permissions));
console.log('jobs:', Object.keys(r.jobs).join(','));
for (const name of Object.keys(r.jobs)) {
  const job = r.jobs[name];
  console.log(
    `  ${name} needs=${JSON.stringify(job.needs)} if=${JSON.stringify(job.if)} perms=${JSON.stringify(job.permissions)} first=${JSON.stringify(job.steps?.[0]?.uses ?? null)}`,
  );
}
const push = r.jobs.publish.steps.find((s) => String(s.uses ?? '').startsWith('docker/build-push-action@'));
console.log('build-push with:', JSON.stringify(push?.with, null, 1));
console.log(
  'types: push=' + typeof push?.with?.push,
  'provenance=' + typeof push?.with?.provenance,
  'sbom=' + typeof push?.with?.sbom,
);
console.log('tag checkout with:', JSON.stringify(r.jobs.tag.steps[0].with));
console.log('tag run:', JSON.stringify(r.jobs.tag.steps[1]?.run));
console.log('verify-image if:', JSON.stringify(r.jobs['verify-image'].if));
console.log('publish if:', JSON.stringify(r.jobs.publish.if));

console.log('--- ci ---');
console.log('on:', JSON.stringify(c.on));
console.log('jobs:', Object.keys(c.jobs).join(','));
const runs = (c.jobs[Object.keys(c.jobs)[0]].steps ?? [])
  .map((s) => s.run)
  .filter(Boolean)
  .join(' | ');
console.log('runs:', runs);
console.log('docker build in ci:', /docker build/.test(JSON.stringify(c)));
console.log('usable actions:', [
  ...new Set(
    [...Object.values(r.jobs), ...Object.values(c.jobs)].flatMap((j) =>
      (j.steps ?? []).map((s) => s.uses).filter(Boolean),
    ),
  ),
].join(', '));
