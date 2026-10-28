#!/usr/bin/env node
// 一条命令起演示站点：环境自检 → 需要时构建 → 迁移 → 启动 → 打印登录信息。
//
//   npm run demo                  # 缺构建就构建，然后起服务
//   npm run demo -- --rebuild     # 强制重新构建
//   PORT=3100 npm run demo        # 换端口（默认读 selfhost.env 的 PORT，否则 3000）
//
// 为什么要有它：老师/答辩现场只需要记一条命令，不用先 build 再 start。
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import net from 'node:net';

const root = process.cwd();
const rebuild = process.argv.includes('--rebuild');

function fail(message) {
  console.error(`\n[demo] ${message}\n`);
  process.exit(1);
}

// 1) Node 版本
const major = Number(process.versions.node.split('.')[0]);
if (!Number.isFinite(major) || major < 22) {
  fail(`需要 Node >= 22.13（当前 ${process.versions.node}）。装好 Node 后再跑。`);
}

// 2) 读运行期配置（selfhost.env 优先，其次 .env.selfhost）
const envFile = ['selfhost.env', '.env.selfhost'].map((name) => resolve(root, name)).find((path) => existsSync(path));
const settings = {};
if (envFile) {
  for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match && !line.trim().startsWith('#')) settings[match[1]] = match[2];
  }
}
const port = process.env.PORT || settings.PORT || '3000';
const email = process.env.ADMIN_EMAIL || settings.ADMIN_EMAIL || 'admin@cleartrace.local';
const password = process.env.ADMIN_PASSWORD || settings.ADMIN_PASSWORD || '(见 selfhost.env)';

// 3) 端口是否被占
function portBusy(target) {
  return new Promise((resolvePort) => {
    const socket = net.connect({ host: '127.0.0.1', port: Number(target) });
    socket.setTimeout(600);
    socket.once('connect', () => { socket.destroy(); resolvePort(true); });
    socket.once('timeout', () => { socket.destroy(); resolvePort(false); });
    socket.once('error', () => resolvePort(false));
  });
}

// 4) 是否需要构建：产物不存在，或源码比产物新
const artifact = resolve(root, 'dist/server/wrangler.json');
const sources = ['app/page.tsx', 'vite.config.ts', 'package.json', 'lib/server/db.ts'].map((name) => resolve(root, name));
const stale = !existsSync(artifact) || sources.some((file) => existsSync(file) && statSync(file).mtimeMs > statSync(artifact).mtimeMs);
const needsBuild = rebuild || stale;

console.log('[demo] 清源 ClearTrace');
console.log(`[demo] Node ${process.versions.node} · 端口 ${port}${needsBuild ? ' · 需要构建' : ' · 已有可用构建'}`);

if (needsBuild) {
  console.log('[demo] 第 1 步：构建（约 30–60 秒）');
  const build = spawnSync(process.execPath, [resolve(root, 'scripts/run-framework.mjs'), 'build'], { cwd: root, stdio: 'inherit' });
  if (build.status !== 0) fail('构建失败，先按上面的报错修，再跑 npm run demo。');
}

const start = async () => {
  if (await portBusy(port)) {
    fail(`端口 ${port} 已被占用。换个端口：PORT=3100 npm run demo，或先关掉占用它的进程。`);
  }
  console.log('[demo] 第 2 步：迁移 + 启动');
  console.log(`[demo] 打开 http://127.0.0.1:${port}`);
  console.log(`[demo] 管理员 ${email} / ${password}`);
  console.log('[demo] 演示脚本见 docs/handoff/DEMO_SCRIPT.md（5 分钟版）\n');
  const child = spawn(process.execPath, [resolve(root, 'scripts/selfhost.mjs')], {
    cwd: root, stdio: 'inherit', env: { ...process.env, PORT: String(port) },
  });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
  child.on('exit', (code) => process.exit(code ?? 0));
};

start();
