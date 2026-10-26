import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const root=process.cwd();const out=resolve(root,'.sites-runtime/core-tests');mkdirSync(out,{recursive:true});
const compile=spawnSync(process.execPath,[resolve(root,'node_modules/typescript/bin/tsc'),'lib/core/import.ts','lib/core/detection.ts','lib/contracts.ts','--module','commonjs','--target','ES2022','--skipLibCheck','--outDir',out],{stdio:'inherit'});if(compile.status!==0)process.exit(compile.status||1);
writeFileSync(resolve(out,'package.json'),JSON.stringify({type:'commonjs'}));
const result=spawnSync(process.execPath,['tests/backend-core.test.cjs'],{stdio:'inherit'});process.exit(result.status||0);
