import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const out = resolve(root, '.sites-runtime/core-tests');
mkdirSync(out, { recursive: true });

const compile = spawnSync(
  process.execPath,
  [
    resolve(root, 'node_modules/typescript/bin/tsc'),
    'lib/core/wb01.ts',
    'lib/core/coordination-scan.ts',
    '--module',
    'commonjs',
    '--target',
    'ES2022',
    '--skipLibCheck',
    '--outDir',
    out,
  ],
  { stdio: 'inherit' },
);
if (compile.status !== 0) process.exit(compile.status || 1);

writeFileSync(resolve(out, 'package.json'), JSON.stringify({ type: 'commonjs' }));

let failed = 0;
for (const file of ['tests/wb01-parity.test.cjs', 'tests/scan-parity.test.cjs']) {
  const result = spawnSync(process.execPath, [file], { stdio: 'inherit' });
  if (result.status !== 0) failed += 1;
}
process.exit(failed ? 1 : 0);
