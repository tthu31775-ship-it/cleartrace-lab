#!/usr/bin/env node
// 自建部署启动器:把平台环境变量合并进 wrangler 配置,执行迁移,再以单端口启动生产构建。
// 用法:node scripts/selfhost.mjs            (默认先迁移)
//      SKIP_MIGRATE=1 node scripts/selfhost.mjs
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.cwd();

// 可选:从项目根目录的 selfhost.env 或 .env.selfhost 读取运行期配置(不进 Git)。
// 平台提供的环境变量优先级更高,不会被文件覆盖。
for (const candidate of ['selfhost.env', '.env.selfhost']) {
  const envFile = resolve(root, candidate);
  if (!existsSync(envFile)) continue;
  console.log(`[selfhost] 读取运行期配置: ${candidate}`);
  for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    const value = match[2].replace(/^["']|["']$/g, '');
    if (process.env[match[1]] === undefined) process.env[match[1]] = value;
  }
}

const baseConfig = resolve(root, 'dist/server/wrangler.json');
if (!existsSync(baseConfig)) {
  console.error('[selfhost] 缺少 dist/server/wrangler.json,请先执行 npm run build。');
  process.exit(1);
}

const PORT = process.env.PORT || '3000';
const HOST = process.env.HOST || '0.0.0.0';
const DATA_DIR = process.env.DATA_DIR || '.wrangler/state';
mkdirSync(resolve(root, DATA_DIR), { recursive: true });

const config = JSON.parse(readFileSync(baseConfig, 'utf8'));
// 运行期配置项从进程环境注入,保证秘密不进入源码与镜像。
const VAR_KEYS = [
  'APP_ORIGIN', 'ADMIN_EMAIL', 'ADMIN_PASSWORD', 'SESSION_TTL_SECONDS',
  'SEED_DEMO_DATA', 'INTEGRATION_API_TOKEN', 'MODEL_SERVICE_URL', 'MODEL_API_KEY',
  'TRUST_IDENTITY_HEADERS', 'OWNER_EMAIL',
];
config.vars = { ...(config.vars || {}) };
for (const key of VAR_KEYS) {
  const value = process.env[key];
  if (typeof value === 'string' && value.length > 0) config.vars[key] = value;
}
config.dev = { ...(config.dev || {}), ip: HOST, port: Number(PORT) || 3000 };

const outConfig = resolve(root, 'dist/server/wrangler.selfhost.json');
writeFileSync(outConfig, JSON.stringify(config));
console.log(`[selfhost] 配置已生成: ${outConfig} (port=${PORT}, data=${DATA_DIR})`);

const wranglerCli = resolve(root, 'node_modules/wrangler/bin/wrangler.js');
const env = {
  ...process.env,
  WRANGLER_SEND_METRICS: 'false',
  CLEARTRACE_CONFIG: outConfig,
  CLEARTRACE_PERSIST_TO: DATA_DIR,
};

function migrate() {
  return spawnSync(process.execPath, [resolve(root, 'scripts/team-migrate.mjs')], {
    cwd: root, encoding: 'utf8', env,
  });
}

/** D1 状态文件损坏(SQLITE_CORRUPT)时归档旧目录后重建,避免整站起不来。 */
function recoverCorruptState(output) {
  if (!/SQLITE_CORRUPT|malformed/i.test(output || '')) return false;
  const d1Dir = resolve(root, DATA_DIR, 'v3', 'd1');
  if (!existsSync(d1Dir)) return false;
  const backup = `${d1Dir}.broken-${Date.now()}`;
  renameSync(d1Dir, backup);
  console.warn(`[selfhost] 检测到本地 D1 状态损坏,已归档到 ${backup},将重建空库后重新迁移。`);
  return true;
}

if (process.env.SKIP_MIGRATE !== '1') {
  let migrated = migrate();
  if (migrated.error) throw migrated.error;
  if (migrated.status !== 0) {
    const output = `${migrated.stdout || ''}${migrated.stderr || ''}`;
    if (!recoverCorruptState(output)) {
      console.error(output.trim().split('\n').slice(-12).join('\n'));
      console.error('[selfhost] 数据库迁移失败,已停止启动。');
      process.exit(migrated.status || 1);
    }
    migrated = migrate();
    if (migrated.error) throw migrated.error;
    if (migrated.status !== 0) {
      console.error(`${migrated.stdout || ''}${migrated.stderr || ''}`.trim().split('\n').slice(-12).join('\n'));
      console.error('[selfhost] 重建后迁移仍失败,已停止启动。');
      process.exit(migrated.status || 1);
    }
  }
  else {
    process.stdout.write(migrated.stdout || '');
  }
}

const args = ['--import', pathToFileURL(resolve(root, 'scripts/sites-env.mjs')).href,
  wranglerCli, 'dev', '--config', outConfig, '--local',
  '--persist-to', DATA_DIR, '--ip', HOST, '--port', String(PORT), '--inspector-port', '0'];
const child = spawn(process.execPath, args, { cwd: root, stdio: 'inherit', env });
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => { child.kill(signal); });
}
child.on('exit', (code) => process.exit(code ?? 0));
