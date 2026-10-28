# 清源 ClearTrace：自建部署实测记录

> 本次实际执行的部署结果与验收证据。数字和命令都来自真实执行，不是预期值。
> 部署日期：2026-10-26（PDT）/ 2026-10-27（北京时间）

## 1. 交付形态

| 项 | 值 |
| --- | --- |
| 访问地址 | https://cleartrace-lab.app.workbuddy.host/?sharecode=OG2AYMRQZQ |
| 运行形态 | WorkBuddy 应用托管沙箱内的单端口 Node 服务（vinext 生产构建 + Wrangler/workerd 本地 D1） |
| 数据库 | 沙箱内 SQLite 文件（`.wrangler/state/v3/d1`），持久化数据目录 |
| 进程入口 | `node scripts/selfhost.mjs`（注入配置 → 跑迁移 → 单端口启动） |
| 端口 | 由平台 `PORT` 注入，绑定 `0.0.0.0` |
| 初始管理员 | `admin@cleartrace.local` / 首次部署口令见交付私信（已满足 ≥10 位、含字母与数字的策略） |

分享链接首次打开会下发访问 Cookie，之后站内地址可正常使用；直接访问裸域名会被平台拦为「链接不完整」，这是托管层的访问控制，不是应用故障。

## 2. 为什么要改代码：原站无法直接对外

原交接源码是 Sites / Cloudflare Workers 版，生产构建里 `authenticate()` 依赖上游注入的 `oai-authenticated-user-id/email` 身份头，`import.meta.env.DEV` 为假时任何人访问都会得到 401「请使用 ChatGPT 账号登录工作空间」，且登录链接指向只有 Sites 才有的 `/signin-with-chatgpt`。也就是说：**不改代码，公网部署出来是一个谁都无法登录的站点。**

因此本次新增了独立账号体系（任务书第四节第 4、5 条的最小可用实现）。

## 3. 本次实际改动的文件

| 文件 | 改动 |
| --- | --- |
| `drizzle/0002_local_auth.sql` | 新增迁移：`members` 增加 `password_hash/password_salt/password_iterations/activated_at`；新增 `sessions` 表（token 只存 SHA-256 散列）；不改写 0000/0001 |
| `drizzle/meta/_journal.json` | 登记 0002 |
| `lib/server/auth.ts` | PBKDF2-SHA256(210k) 密码散列、服务端会话（HttpOnly + SameSite=Lax + 生产 Secure）、登录/登出/改密、`ensureAdminAccount()` 首启管理员初始化、`verifyOrigin()` 支持可信代理（`X-Forwarded-Host`、`APP_ORIGIN`）；身份头改为仅在 `TRUST_IDENTITY_HEADERS=true` 时生效 |
| `lib/server/db.ts` | `RuntimeEnv` 增补自建部署变量；成员 `status` 改为按密码凭证判定（不再用旧 Sites `user_id` 冒充已激活） |
| `app/api/v1/[...path]/route.ts` | 新增 `POST /auth/login`、`POST /auth/logout`、`POST /auth/password`、`POST /members/:id/password`；建成员支持可选初始密码；`SEED_DEMO_DATA` 控制样例填充 |
| `components/cleartrace/login.tsx` | 新的登录界面（替换 ChatGPT 登录入口） |
| `components/cleartrace/common.tsx` | `api()` 抛错携带 HTTP 状态码，便于区分 401 与业务错误 |
| `app/page.tsx` | 401 时渲染登录页；顶栏新增「退出登录」 |
| `scripts/team-migrate.mjs` | 支持 `CLEARTRACE_CONFIG` / `CLEARTRACE_PERSIST_TO`；修 Windows 下 `--import` 路径需 `file://` 的缺陷 |
| `scripts/selfhost.mjs` | 新增：读取 `selfhost.env` → 合并 Worker 变量 → 生成 `wrangler.selfhost.json` → 迁移 → 单端口启动 |
| `selfhost.env` / `.env.selfhost` | 运行期配置（已被 `.gitignore` 忽略，不进 Git） |
| `.gitignore` | 忽略 `selfhost.env` |

未改动：九张业务表的既有结构（除新增认证列/会话表）、`/api/v1` 业务路径与返回结构、八个业务模块的前端与样式、规则基线算法。

## 4. 环境变量清单（不含秘密值）

| 变量 | 作用 | 本次取值 |
| --- | --- | --- |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | 首启创建管理员（仅当库内无已激活管理员时执行一次） | 见交付私信 |
| `APP_ORIGIN` | 反向代理后的对外 origin，写请求来源校验 | `https://cleartrace-lab.app.workbuddy.host` |
| `SESSION_TTL_SECONDS` | 会话有效期 | `28800`（8 小时） |
| `SEED_DEMO_DATA` | 是否填充合成样例 | `true`（演示站；正式建库改 `false`） |
| `DATA_DIR` | SQLite 持久目录 | `.wrangler/state` |
| `MODEL_SERVICE_URL` / `MODEL_API_KEY` | 外部算法模型（可选，保留 20 秒超时与协议） | 空（只用规则基线） |
| `INTEGRATION_API_TOKEN` | 数据接入服务令牌（可选） | 空 |
| `TRUST_IDENTITY_HEADERS` | 是否信任上游身份头 | 未开启 |

## 5. 运维命令

```bash
# 首次/更新部署（平台侧等价命令）
npm ci --include=dev --include=optional --no-audit --no-fund && npm run build
node scripts/selfhost.mjs           # 迁移 + 启动（SKIP_MIGRATE=1 可跳过迁移）

# 单独执行数据库迁移（幂等，已应用且校验值一致的迁移会跳过）
node scripts/team-migrate.mjs

# 一致性备份（WAL 安全）
sqlite3 .wrangler/state/v3/d1/<uuid>.sqlite "VACUUM INTO '/backup/cleartrace-$(date +%F).sqlite'"

# 恢复：停服 → 覆盖数据文件 → 校验
sqlite3 /backup/cleartrace-2026-10-26.sqlite "PRAGMA integrity_check; PRAGMA foreign_key_check;"
```

## 6. 线上验收实测结果（2026-10-26 11:35 PDT）

| 项 | 命令/方法 | 结果 |
| --- | --- | --- |
| 首页可达 | `GET /?sharecode=…` | 200 |
| 健康检查 | `GET /api/v1/health` | 200，`database: connected` |
| 未登录拦截 | `GET /api/v1/bootstrap` 无 Cookie | 401 `sign_in_required` |
| 管理员登录 | `POST /api/v1/auth/login` | 200，下发 `ct_session`（HttpOnly/SameSite=Lax） |
| 工作台数据 | `GET /api/v1/bootstrap` | 200，240 账号 / 3 数据集 / 6 历史任务 / 81 待复核 |
| 创建任务 | `POST /api/v1/tasks`（demo-dataset-2） | 201，`queued` |
| 执行任务 | `POST /api/v1/tasks/{id}/run` | 200，`completed`，处理 80 个账号 |
| 导出结果 | `GET /api/v1/tasks/{id}/export` | 200，返回 UTF-8 CSV（含 BOM） |
| 人工复核 | `POST /api/v1/accounts/{id}/review` | 200，状态与复核记录写入 |
| 越权拦截 | 编辑角色 `POST /api/v1/members` | 403 `forbidden` |
| 跨站写请求 | `Origin: https://evil.example.com` | 403 `origin_rejected` |
| 错误口令 | 错误密码登录 | 401 `invalid_credentials` |
| 登出失效 | `POST /api/v1/auth/logout` 后再取 bootstrap | 401 |
| 数据持久化 | 重新部署后再次登录/取数 | 数据保留（同一沙箱数据目录） |
| 类型检查 | `tsc --noEmit` | 通过，0 错误 |
| 生产构建 | `node scripts/run-framework.mjs build` | 通过（36 个模块 723 KiB） |

验收产生的测试数据：任务「线上验收任务」保留为可见记录（接口无任务删除，属设计如此）；验收用的临时编辑账号 `qa-editor@cleartrace.local` 已删除；样例账号上的 1 条复核记录保留。

## 7. 已知限制（务必让组员知道）

1. **数据落在这台托管沙箱上，不是独立数据库服务器。** 单个 SQLite 文件 + 无自动备份、无备份导出口，删除应用或平台回收沙箱会一起丢数据。正式给老师/评委长期使用前，应迁移到有磁盘持久化和备份的云服务器（交接文档里的 Docker Compose 路线）。
2. **单实例、无并发容量承诺。** 任务执行是请求内同步完成的，大样本会顶到网关超时（前端 90 秒）。
3. **登录无失败次数限速**，仅靠密码强度与会话有效期防护——对外网开放时需要补限速。
4. **示例数据是合成的**（`demo=1` 标记），不代表真实账号；正式建库请把 `SEED_DEMO_DATA` 设为 `false`。
5. 域名由平台分配；若换域名，`APP_ORIGIN` 必须同步更新，否则所有写请求会被来源校验拒绝。
6. 尚未接通外部算法模型（`MODEL_SERVICE_URL` 为空），当前只跑 `baseline-v1` 行为规则基线。
7. **密码 KDF 用 PBKDF2-SHA256(210000 次) 而非交接文档建议的 Argon2id/scrypt**：当前运行在 workerd 上，只有 WebCrypto 可用，引入 Argon2/scrypt 需要原生模块，会破坏单产物部署。这是有意取舍，已记录在案；迁移到普通 Node 服务器（可用 `node:crypto` 的 scrypt 或 argon2 原生包）时应替换 `lib/server/auth.ts` 的 `pbkdf2()`/`setMemberPassword()`，`password_iterations` 列可保留或改为算法标识。
8. 管理员首次初始化依赖 `ADMIN_EMAIL`/`ADMIN_PASSWORD` 环境变量；密码必须满足「≥10 位且含字母与数字」，否则会被静默跳过（日志有警告），表现为登录始终 401。

## 8. 组员如何加入（对应分工方案的协同要求）

1. 管理员登录 → 左侧「项目协作」→ 添加成员，填姓名、邮箱、角色（开发/复核/只读）。
2. 需要给成员开登录权限时，调用一次（管理员令牌）：
   `POST /api/v1/members/{memberId}/password`，body `{"password":"至少10位含字母数字"}`。
3. 成员用该邮箱 + 密码在登录页登录；改密走 `POST /api/v1/auth/password`（需旧密码）。
4. 角色权限：`admin` 全部；`editor` 可导入数据、建任务、复核；`reviewer` 只能复核；`viewer` 只读。
5. 数据接入脚本仍走 `Authorization: Bearer <INTEGRATION_API_TOKEN>` 或站内签发的接口令牌，不要用浏览器会话。
