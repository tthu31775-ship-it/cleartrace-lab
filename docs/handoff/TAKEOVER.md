# 接管指南（WorkBuddy 应用托管版）

> 适用：把 `ct\handoff\source` 注册成 WorkBuddy 应用（locator `wbapp_uXX1fJC2zb28RqiPlwy2RO`，显示名「清源摸排工作台」，
> 域名 `https://cleartrace-lab.app.workbuddy.host`，前面套 `?sharecode=` 网关）。
> 本文每条都对着当前代码与本地库核过：`package.json`、`scripts/selfhost.mjs`、`selfhost.env`、`drizzle/0000~0005`、`docs/openapi.json`。
> 核实时间：2026-10-28。

## 0. 一分钟版

| 问题 | 答案 |
| --- | --- |
| 线上地址 | `https://cleartrace-lab.app.workbuddy.host/?sharecode=OG2AYMRQZQ` |
| 用什么发上去的 | WorkBuddy 内置「应用/网站托管」：把一个本地目录当成单端口 HTTP 服务跑起来 |
| 被发布的目录 | `E:\buddy\2026-10-26-03-58-24\ct\handoff\source` |
| 启动命令 | `npm run build && node scripts/selfhost.mjs` |
| 端口 | 平台注入 `PORT`；本地不注入时默认 3000 |
| 数据库 | **不是云数据库**，是跟着目录一起上传的本地 SQLite（D1/wrangler 本地态） |
| 数据库文件 | `.wrangler\state\v3\d1\miniflare-D1DatabaseObject\faaf2b04…c2b05fb.sqlite`（约 11.4 MB） |
| 换机器能重建吗 | 能。`lib/data/*.json` 已进仓库，首启自动 seed 出 803 线索 / 173 事件 / 7292 成员 / 4750 评论 |
| 最快自测 | `npm ci && npm run build && node scripts/selfhost.mjs` → http://127.0.0.1:3000 |

## 1. 这套托管到底是什么

平台把整个项目目录当作一个**单端口 HTTP 服务**跑：

```
平台容器
 └─ cwd = E:\buddy\2026-10-26-03-58-24\ct\handoff\source（发布时上传的目录）
     └─ startCmd = npm run build && node scripts/selfhost.mjs
         ├─ 读 selfhost.env（平台注入的 PORT 优先，文件不覆盖平台变量）
         ├─ 生成 dist/server/wrangler.selfhost.json（把 APP_ORIGIN / ADMIN_* / MODEL_* 注入 vars）
         ├─ team-migrate.mjs 跑 drizzle/0000~0005（台账：cleartrace_local_migrations）
         └─ wrangler dev --local --persist-to .wrangler/state --ip 0.0.0.0 --port $PORT
```

请求链路：

```
浏览器 → 托管网关（校验 ?sharecode=，下发 __wb_rsc cookie）→ 容器 $PORT → workerd → Next.js + D1
```

两个直接后果：

1. **sharecode 是访问凭据**。换链接、收范围都在这里。
2. **API 写请求必须带网关 cookie**。用 curl 直连时先 `GET /?sharecode=…` 拿 cookie 再带 `-b`，否则一律 403。

> 注意：`.openai/hosting.json` 里的 `appgprj_6adf1a49…` 与 `docs/DEPLOYMENT.md` 描述的是**更早一版交接的旧 Sites 项目**
> （`cleartrace-lab.orionkayaking.chatgpt.site`），和现在的线上地址无关，别照那份文档操作。

### 数据库不是云数据库

站点状态 = **本地这份 .sqlite 在发布那一刻的副本**：

- 线上写入（登录、复核、筛查、扫描批次）只落在容器里，**不会回流本机**；
- **重新发布 = 用本地快照覆盖线上**，线上新增的数据会没；
- 所以"发布前 60 秒"里第一件事是导备份。

这是本方案最大的坑。

## 2. 三处唯一真相

| 东西 | 路径 | 丢了会怎样 |
| --- | --- | --- |
| 源码 | `E:\buddy\2026-10-26-03-58-24\ct\handoff\source` | 要从 GitHub 重新 clone，或从 `ct\upstream` / `ct\*.bundle` 恢复 |
| 数据库 | 同上 `.wrangler\state\v3\d1\miniflare-D1DatabaseObject\faaf2b04….sqlite` | 803 条线索等**预置数据可重新 seed**；线上产生的登录/复核/筛查/扫描记录不可重建 |
| 运行配置 | 同上 `selfhost.env` | 管理员口令、`APP_ORIGIN`、外部模型密钥全丢，站点起不来或写请求 403 |

补充：`selfhost.env` 与 `.wrangler/` 都在 `.gitignore` 里，所以 **GitHub 上既没有数据库也没有密钥**——数据只能靠备份文件传，不能靠 clone。

⚠️ 隐私提醒：`lib/data/coordination.json` 里含真实账号昵称与评论片段，而 `origin` 指向的是**公开仓库** `tthu31775-ship-it/cleartrace-lab`。如果不想公开，二选一：把仓库改私有，或把该文件替换成脱敏样本（首启仍能 seed，只是内容为样例）。

## 3. 发布前 60 秒（照做，别跳）

1. **停本地服务**（如果正在跑）：关掉那个 `node scripts/selfhost.mjs` 窗口，或
   ```powershell
   Get-NetTCPConnection -LocalPort 3000 -State Listen | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
   ```
2. **把 WAL 落盘并体检**（目录里若还有 `*.sqlite-wal` / `*.sqlite-shm`，说明上次没干净关闭）：
   ```powershell
   python -c "import sqlite3;p=r'.wrangler/state/v3/d1/miniflare-D1DatabaseObject/faaf2b04…c2b05fb.sqlite';c=sqlite3.connect(p);print(c.execute('pragma wal_checkpoint(TRUNCATE)').fetchone());print(c.execute('pragma integrity_check').fetchone())"
   ```
   **只拷主文件、不管 WAL，会丢最近写入甚至 `SQLITE_CORRUPT`。**
3. **本地冒烟**：`node scripts/selfhost.mjs` 起来后访问 `http://127.0.0.1:3000/api/v1/health`，
   返回 `{"data":{"status":"ok","database":"connected",…}}` 再发布。
4. **线上有要留的数据？先导备份**（管理员登录后）：
   ```
   GET /api/v1/exports/backup      → 全库 JSON
   GET /api/v1/exports/schema      → 建表语句
   ```
   带 Cookie 或 `Authorization: Bearer ct_...` 都行。备份存本地一份，日期命名。
5. **发布**：启动命令必须是 `npm run build && node scripts/selfhost.mjs`。
   只写 `node scripts/selfhost.mjs` 会拿旧的 `dist/` 直接跑 → "发布了但没变化"（第二次发布就白跑过一次）。
6. **发完核对 30 秒**：
   - `你的域名/api/v1/openapi` → `"version": "1.3.0"`、45 条路径；
   - `你的域名/api/v1/health` → `status: ok`；
   - 首页登录页是整页居中卡片（背后没有侧边栏），按钮绿色占满一行；
   - 登录后左侧导航能滚到「项目协作」。
7. **记录版本**：`git rev-parse HEAD` + 上面 openapi 的 version，出事能对上号。

## 4. 三条接管路线

### 路线 A：继续用现在的托管（答辩期最省事）

- **发**：在本机、用同一个 WorkBuddy 账号开一个会话，说「把 `E:\buddy\2026-10-26-03-58-24\ct\handoff\source` 重新发布」；界面上也能在左侧「应用」里找到「清源摸排工作台」重新发布 / 调整分享范围。
- **限制**：域名与分享链接绑在这个账号上；换账号、换电脑就发不了；这台机器的目录删了，下次发布就是发空。
- **适合**：两周内要答辩、不想折腾服务器。

### 路线 B：自己在本机跑（推荐，完全掌控）

```powershell
cd E:\buddy\2026-10-26-03-58-24\ct\handoff\source
node -v                      # 需要 >= 22.13（本机实测 v22.22.2）
npm ci                       # 首次或依赖变更后
$env:PORT=3000; node scripts/selfhost.mjs
```

- 打开 `http://127.0.0.1:3000`，管理员 `admin@cleartrace.local` / 口令见 `selfhost.env`。
- 管理员**首次登录时创建**：密码需 ≥10 位且同时含字母与数字，否则静默跳过（日志会 warn）；之后改 `selfhost.env` 不覆盖已有密码，要用站内「修改密码」。
- 给同 WiFi 的同事看：`HOST=0.0.0.0`（默认就是），访问 `http://<内网IP>:3000`。
  **注意**：`0.0.0.0` + 默认口令 = 同局域网谁都能登，自己用建议临时改 `HOST=127.0.0.1`。
- 对外（隧道/反代）**必须**把 `APP_ORIGIN` 改成对外域名（含 `https://`），否则所有写请求 403 `origin_rejected`。
- 停止：Ctrl+C，别强杀（WAL 没落盘 → 见 §6）。

### 路线 C：搬到自己的服务器（长期）

最短路径（不改代码）：装 Node 22+，拷源码（不含 `node_modules`/`dist`）+ 可选 `.wrangler/state`，
`npm ci && npm run build && node scripts/selfhost.mjs`，用 systemd（Linux）/ nssm（Windows）常驻，前面挂 nginx/caddy 并设 `APP_ORIGIN`。

systemd 示例（`/etc/systemd/system/cleartrace.service`）：

```ini
[Unit]
Description=ClearTrace
After=network.target

[Service]
WorkingDirectory=/srv/cleartrace
EnvironmentFile=/srv/cleartrace/selfhost.env
Environment=PORT=3000
ExecStart=/usr/bin/node scripts/selfhost.mjs
Restart=always
RestartSec=3
KillSignal=SIGINT
TimeoutStopSec=20

[Install]
WantedBy=multi-user.target
```

nginx 反代要点：`proxy_pass http://127.0.0.1:3000;` + `Host` / `X-Forwarded-Host` / `X-Forwarded-Proto` / `X-Real-IP` 四个头，`client_max_body_size 20m`，`proxy_read_timeout 120s`。

要正经上生产（Cloudflare Workers + 远程 D1）需改绑定、`wrangler deploy`、迁移策略，工作量另算，**答辩前不建议动**。

## 5. 数据往返

| 方向 | 怎么做 |
| --- | --- |
| 线上 → 本地 | 线上导 `/exports/backup`，落地 `backup-YYYYMMDD-HHMM.json`；要"以线上为准"时把本地 `.sqlite` 挪走，起服务重建，再灌回备份 |
| 本地 → 线上 | 就是发布本身：本地 `.sqlite` 随目录上传 |
| 只想要 803 条线索 | 不用传库：删掉 `.wrangler/state`，`SEED_DEMO_DATA=true`，首启从 `lib/data/*.json` 自动 seed |
| 只要某张表 | `/exports/{表名}?format=csv`（12 张表，CSV 可直接用 Excel 打开） |

## 6. 常见故障对照

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| 发布了但页面没变 / 新页 404 | 启动命令里没有 `npm run build` | 改回 `npm run build && node scripts/selfhost.mjs` |
| 「服务没有在指定端口上响应」 | 旧版把 `wrangler dev` 写死 8787 | 用 `node scripts/selfhost.mjs`（内部 `--ip 0.0.0.0 --port $PORT`） |
| 所有写操作 403 `origin_rejected` | `APP_ORIGIN` 与访问域名不一致 | 改成实际域名（含 https）；或 curl 忘带网关 cookie |
| 起不来，日志 `SQLITE_CORRUPT` | 上传了带 `-wal` 的库 / 上次被杀进程 | `selfhost.mjs` 自动把坏库归档成 `d1.broken-<时间>` 并重建；重建后需重新 seed/导入 |
| 数据库空的（803 变 0） | `.wrangler/state` 没传且首启没触发 seed | 请求任意业务接口触发 seed；或灌回备份 |
| 端口被占 | 本地还挂着旧服务 | `Get-NetTCPConnection -LocalPort 3000` 找 pid 结束 |
| 线上数据和本地对不上 | 线上写入本来就不回流 | 按 §5 先导备份再决定以哪边为准 |

## 7. 回滚

- **应用层**：`git checkout <上一个可用提交>` → `npm run build` → 重新发布。基线：GitHub `feat/model-integration`（PR #1）、`ct\upstream`、`ct\*.bundle`、`ct\000*.patch`。
- **数据层**：迁移 0003/0004/0005 只新增表与列，不回改旧表；彻底回退执行
  `DROP TABLE graph_edges, coordination_lead_members, coordination_leads, comment_predictions, comments, events;`
  账号 / 数据集 / 任务 / 复核不受影响。
- **恢复备份**：把 `.wrangler/state/v3/d1` 整个目录换回发布前副本（`-wal`/`-shm` 要一起换或一起删）。
- **不要手改** `cleartrace_local_migrations`：迁移脚本改了而校验值没更新，后续启动会直接拒绝。

## 8. 权限与凭据

| 项 | 在哪 | 换人接手要注意 |
| --- | --- | --- |
| 应用 locator / 域名 / sharecode | WorkBuddy 账号 | 换账号就要重新注册应用，域名会变 |
| 管理员口令 | `selfhost.env` 的 `ADMIN_PASSWORD` | 只影响首启创建；改它不覆盖已有账号，要用站内「修改密码」 |
| 接口令牌 | 站内「接口与协议」签发（`ct_...`，库里只存 hash） | 只显示一次，丢了就 `DELETE /api/v1/tokens/{id}` 撤销重发 |
| GitHub PAT | `ct\.push-credential`（仓库外） | **本轮用过的 `ghp_…` 请去 GitHub 撤销**；换新 token 改这个文件，别写进任何提交 |
| 模型密钥 | `selfhost.env` 的 `MODEL_API_KEY` | 只在服务端用，永不进前端 |

## 9. 交给第三方（另一个 agent / 团队）时说什么

> 代码在 `E:\buddy\2026-10-26-03-58-24\ct\handoff\source`（或 GitHub `feat/model-integration`），
> `npm ci && npm run build && node scripts/selfhost.mjs` 就能跑；数据库是本地 SQLite，首启从 `lib/data/*.json` 自动灌种子；
> 要发布只能走 WorkBuddy 应用托管（cwd 指向上面的目录，启动命令必须带构建）。
> 细节见 `docs/handoff/TAKEOVER.md`。

配套材料：`MODEL_INTEGRATION_RESULT.md`（全部验收证据）、`FUNCTION_MAP.md`（按钮→接口→落库）、`API_MATRIX.md`（48 条接口）、`docs/openapi.json`（45 条路径）。

---

*本地库现状：803 线索 / 178 事件（173 协同 + 5 演示）/ 7292 成员 / 4750 评论 / 5 数据集 / 240 账号，`integrity_check = ok`，无遗留扫描批次。*
