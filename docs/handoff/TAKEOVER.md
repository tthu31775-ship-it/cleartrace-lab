# 接管指南（WorkBuddy 应用托管版）

> 适用：把 `ct\handoff\source` 注册成 WorkBuddy 应用（locator `wbapp_uXX1fJC2zb28RqiPlwy2RO`，显示名「清源摸排工作台」，
> 域名 `https://cleartrace-lab.app.workbuddy.host`，前面套 `?sharecode=` 网关）。
> 下面每条都对着代码核过：`package.json`、`scripts/selfhost.mjs`、`selfhost.env`、`dist/server/wrangler.json`。

## 1. 这套托管到底是什么

平台把整个项目目录当作一个**单端口 HTTP 服务**跑：

```
平台容器
 └─ cwd = E:\buddy\2026-10-26-03-58-24\ct\handoff\source（发布时上传的目录）
     └─ startCmd = npm run build && node scripts/selfhost.mjs
         ├─ 读 selfhost.env（PORT 由平台注入）
         ├─ 生成 dist/server/wrangler.selfhost.json
         ├─ team-migrate.mjs 跑 drizzle/0000~0005
         └─ wrangler dev --local --persist-to .wrangler/state --ip 0.0.0.0 --port $PORT
```

**数据库不是云数据库**，是 `.wrangler/state/v3/d1/miniflare-D1DatabaseObject/*.sqlite` 这个本地文件，
跟着目录一起上传。所以：

- 站点状态的唯一真相 = **本地这份 .sqlite**（发布那一刻的副本）；
- 线上写入（登录、复核、筛查）只落在容器里，**不会回流本机**；
- **重新发布 = 用本地快照覆盖线上**，线上新增的数据会没。

这是本方案最大的坑，也是下面"发布前 60 秒"存在的理由。

## 2. 三处唯一真相

| 东西 | 路径 | 丢了会怎样 |
| --- | --- | --- |
| 源码 | `E:\buddy\2026-10-26-03-58-24\ct\handoff\source` | 要从 GitHub 重新 clone + 重新配置 |
| 数据库 | 同上 `.wrangler\state\v3\d1\miniflare-D1DatabaseObject\faaf2b04….sqlite` | 803 条线索与全部复核记录消失（可从 `lib/data/*.json` 重新 seed，但复核记录找不回） |
| 运行配置 | 同上 `selfhost.env` | 管理员口令、`APP_ORIGIN`、端口全丢，站点起不来或写请求 403 |

## 3. 发布前 60 秒（照做，别跳）

1. **停本地服务**（如果正在跑）：关掉那个 `node scripts/selfhost.mjs` 窗口，或
   ```powershell
   Get-NetTCPConnection -LocalPort 3000 -State Listen | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
   ```
2. **确认没有残留 WAL**：目录里如果还有 `*.sqlite-wal` / `*.sqlite-shm`，说明上次没干净关闭。
   ```powershell
   Get-ChildItem "E:\buddy\2026-10-26-03-58-24\ct\handoff\source\.wrangler\state\v3\d1\miniflare-D1DatabaseObject" |
     Select-Object Name,Length,LastWriteTime
   ```
   正常应只有 `faaf….sqlite` 与 `metadata.sqlite`；有 `-wal` 就先起一次服务再正常停掉（会 checkpoint），
   或者直接 `sqlite3 db "PRAGMA wal_checkpoint(TRUNCATE);"`。**只拷主文件、不管 WAL，会丢最近写入甚至 `SQLITE_CORRUPT`。**
3. **本地冒烟**：`node scripts/selfhost.mjs` 起来后访问 `http://127.0.0.1:3000/api/v1/health`，
   返回 `{"status":"ok","database":"connected"}` 再发布。
4. **线上有要留的数据？先导备份**（管理员登录后）：
   ```
   GET /api/v1/exports/backup      → 全库 JSON（约 7–8 MB）
   GET /api/v1/exports/schema      → 建表语句
   ```
   带 Cookie 或 `Authorization: Bearer ct_...` 都行。备份存本地一份，日期命名。
5. **发布**：启动命令必须是 `npm run build && node scripts/selfhost.mjs`。
   只写 `node scripts/selfhost.mjs` 会拿旧的 `dist/` 直接跑 → "发布了但没变化"。
6. **发完核对 30 秒**：
   - `你的域名/api/v1/openapi` → `"version": "1.3.0"`、45 条路径；
   - 首页登录页是整页居中卡片（背后没有侧边栏），按钮绿色占满一行；
   - 登录后左侧导航能滚到「项目协作」。

## 4. 数据往返

| 方向 | 怎么做 |
| --- | --- |
| 线上 → 本地 | 线上导 `/exports/backup`，落地成 `backup-YYYYMMDD-HHMM.json`；本地需要"以线上为准"时，把本地 `.sqlite` 挪走，起服务让它重建，再用导入接口灌回去（或直接替换容器里的库后再发一次） |
| 本地 → 线上 | 就是发布本身：本地 `.sqlite` 随目录上传 |
| 只想要 803 条线索 | 不用传库：`.wrangler/state` 删掉，`SEED_DEMO_DATA=true`，首启会从 `lib/data/*.json` 自动 seed（仓库里那份是**脱敏示例**，真实数据在本机） |

## 5. 本地跑（不依赖托管）

```powershell
cd E:\buddy\2026-10-26-03-58-24\ct\handoff\source
node -v                      # 需要 >= 22.13，本机是 v24.14.1
npm ci                       # 会删掉 node_modules 重装，约 3 分钟
$env:PORT=3000; node scripts/selfhost.mjs
```

- 打开 `http://127.0.0.1:3000`，管理员 `admin@cleartrace.local` / 口令见 `selfhost.env`。
- 想给同 WiFi 的同事看：`selfhost.env` 里 `HOST=0.0.0.0`（默认就是），访问 `http://<内网IP>:3000`。
- **注意**：`HOST=0.0.0.0` + 默认口令 = 同一局域网谁都能登。自己用建议临时改 `HOST=127.0.0.1`。
- 对外（隧道/反代）必须把 `APP_ORIGIN` 改成对外域名，否则所有写请求 403 `origin_rejected`。

## 6. 迁到自己的服务器（长期方案）

最短路径（不改代码）：Windows/Linux 服务器装 Node 22+，拷源码（不含 `node_modules`/`dist`）+ `.wrangler/state`，
`npm ci && npm run build && node scripts/selfhost.mjs`，用 nssm（Windows）或 systemd（Linux）常驻，
前面挂 nginx/caddy 反代并设 `APP_ORIGIN`。

要正经上生产（Cloudflare Workers + 远程 D1）则需要改绑定、`wrangler deploy`、迁移策略，工作量另算，答辩前不建议动。

## 7. 权限与凭据

| 项 | 在哪 | 换人接手要注意 |
| --- | --- | --- |
| 应用 locator / 域名 / sharecode | WorkBuddy 账号 | 换账号就要重新注册应用，域名会变 |
| 管理员口令 | `selfhost.env` 的 `ADMIN_PASSWORD` | 只影响首启创建；改它不会覆盖已有账号，要用站内「修改密码」 |
| 接口令牌 | 站内「接口与协议」签发（`ct_...`） | 只显示一次，丢了就撤销重发 |
| GitHub PAT | `ct/.push-credential` 或系统凭据 | 推完可撤销；不要提交进仓库 |

## 8. 常见故障对照

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| 发布了但页面没变 | 启动命令里没有 `npm run build` | 改回 `npm run build && node scripts/selfhost.mjs` |
| 所有写操作 403 `origin_rejected` | `APP_ORIGIN` 与访问域名不一致 | 改成实际域名（含 https） |
| 起不来，日志 `SQLITE_CORRUPT` | 上传了带 `-wal` 的库 / 上次被杀进程 | `selfhost.mjs` 会自动把坏库归档成 `d1.broken-<时间>` 并重建；重建后需重新 seed/导入 |
| 端口被占 | 本地还挂着一个旧服务 | `Get-NetTCPConnection -LocalPort 3000` 找到 pid 结束 |
| 线上数据和本地对不上 | 线上写入本来就不回流 | 按第 4 节先导备份再决定以哪边为准 |
