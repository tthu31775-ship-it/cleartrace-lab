#!/usr/bin/env node
// Apply immutable Drizzle migrations only to the developer's LOCAL D1 database.
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

if (process.argv.includes('--help')) {
  console.log('Usage: node scripts/team-migrate.mjs\nBuild first: npm run build\nApplies pending drizzle migrations to local D1 only; never uses --remote.');
  process.exit(0);
}
const root = process.cwd();
const config = resolve(root, 'dist/server/wrangler.json');
if (!existsSync(config)) throw new Error('Run npm run build before local migrations.');
const manifest = JSON.parse(readFileSync(resolve(root, '.openai/hosting.json'), 'utf8'));
if (manifest.d1 !== 'DB') throw new Error('Expected the documented DB binding; inspect .openai/hosting.json.');
const journal = JSON.parse(readFileSync(resolve(root, 'drizzle/meta/_journal.json'), 'utf8'));
const common = ['--import', resolve(root, 'scripts/sites-env.mjs'),
  resolve(root, 'node_modules/wrangler/bin/wrangler.js'), 'd1', 'execute', 'DB',
  '--local', '--config', config, '--persist-to', '.wrangler/state', '--json'];
function run(extra) {
  const result = spawnSync(process.execPath, [...common, ...extra], {
    cwd: root, encoding: 'utf8', env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    console.error(result.stdout, result.stderr);
    throw new Error('Local D1 migration failed; no hosted database was touched.');
  }
  try { return JSON.parse(result.stdout); }
  catch { throw new Error('Wrangler did not return expected JSON. Inspect local Wrangler logs.'); }
}
run(['--command', 'CREATE TABLE IF NOT EXISTS cleartrace_local_migrations (name TEXT PRIMARY KEY, sha256 TEXT NOT NULL, applied_at TEXT NOT NULL)']);
const query = run(['--command', 'SELECT name, sha256 FROM cleartrace_local_migrations']);
const applied = new Map(query.flatMap(item => item.results ?? []).map(row => [row.name, row.sha256]));
let count = 0;
for (const entry of journal.entries) {
  if (!/^[A-Za-z0-9_-]+$/.test(entry.tag)) throw new Error('Invalid migration tag.');
  const path = resolve(root, 'drizzle', entry.tag + '.sql');
  const digest = createHash('sha256').update(readFileSync(path)).digest('hex');
  if (applied.has(entry.tag)) {
    if (applied.get(entry.tag) !== digest) throw new Error(`Applied migration was modified: ${entry.tag}`);
    continue;
  }
  run(['--file', path]);
  run(['--command', `INSERT INTO cleartrace_local_migrations (name,sha256,applied_at) VALUES ('${entry.tag}','${digest}','${new Date().toISOString()}')`]);
  console.log(`Applied locally: ${entry.tag}`);
  count++;
}
console.log(`Local D1 ready; ${count} pending migration(s) applied. Hosted D1 is separate.`);
