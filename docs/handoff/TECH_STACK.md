# 技术栈说明（老师问起来照这个回答）

## 1. 一句话

**前端 Next.js 16（App Router）+ React 19；后端是一个函数式路由文件；数据层 SQLite（本地用 Cloudflare D1 的 SQL 方言）；
构建产物是单端口 Node 服务；本地用 wrangler 把 Cloudflare workerd 运行时起在你电脑上。**

## 2. 一次请求怎么走

```
浏览器（React 19 客户端组件）
   │  fetch('/api/v1/leads?...')，带 Cookie 会话
   ▼
app/api/v1/[...path]/route.ts        一个入口，按 path 分发 48 条路由
   │  鉴权（Cookie / Bearer）→ 来源校验（Origin）→ zod 校验入参
   ▼
lib/server/*.ts                      业务层：线索、筛查、扫描、导出、审计
   │  SQL
   ▼
D1（SQLite）                          events / comments / leads / members / graph_edges …
   ▲
   └─ 本地由 wrangler 起的 workerd 提供（生产环境是托管平台）
```

目录对应：

| 层 | 位置 | 规模 |
| --- | --- | --- |
| 页面与壳 | `app/page.tsx` + `components/cleartrace/*.tsx` | 13 个页面 |
| 接口 | `app/api/v1/[...path]/route.ts` | 1 个文件 / 48 条路由 |
| 业务 | `lib/server/*.ts` | 11 个模块 |
| 算法 | `lib/core/wb01.ts`（文本模型）、`lib/core/coordination-scan.ts`（协同扫描） | 纯 TS，与算法组 Python 逐位对账 |
| 数据 | `drizzle/*.sql` + `lib/data/*.json` | 5 个迁移 + 3 个数据文件 |
| 验收 | `scripts/*.py`、`scripts/*.mjs` | 93 项接口 + 逐按钮审计 + 60 项数值对账 |

## 3. 为什么选这套

| 需求 | 这套方案怎么满足 |
| --- | --- |
| 不想让老师/学校装 MySQL、Redis | SQLite 单文件，零外部服务；备份就是拷一个 `.sqlite` |
| 要能演示"真实模型推理" | WB01 权重导出成 base64 float32 编进 TS，服务端直接算，不依赖 Python 进程 |
| 要能解释每一步 | 一个路由文件 + 11 个业务模块，没有框架魔法；每个接口在 `API_MATRIX.md` 有行 |
| 要能离线交付 | 交接包里带数据库快照，解压即跑；另有脱敏版可对外发 |
| 要能对账 | 同一批样例同时跑 Python 算法包与 TS 实现，概率逐位一致（最大偏差 0.0） |

## 4. 这套的代价（要主动说，别等老师问）

| 代价 | 具体表现 | 我们的处理 |
| --- | --- | --- |
| workerd 是运行时模拟器 | 开发模式下偶发 `worker restarted mid-request` | 验收脚本对幂等请求重试一次；启动器带预检 |
| WAL 未落盘会坏库 | 强杀进程后 `SQLITE_CORRUPT` | `selfhost.mjs` 自动把坏库归档成 `d1.broken-<时间>` 并重建（会丢数据，日志里写清楚） |
| vinext 小众 | 构建层资料少 | 已把 `npm run build` 的行为固定下来，CI 里跑通 |
| 密码 KDF 只能用 WebCrypto | 目前 PBKDF2-SHA256(210k)，不是 Argon2id | 换到普通 Node 服务器后只需替换 `lib/server/auth.ts` 的 `pbkdf2()` |
| 没有队列 | 任务是请求内同步执行，样本大就慢 | 已限制单批规模并在页面标注；异步化列入后续（需要独立设计） |

## 5. 为什么不用 Spring Boot / MySQL / Django

| 对比项 | 本方案 | Spring Boot + MySQL |
| --- | --- | --- |
| 部署 | 一条 `npm start`，单端口 | 要 JDK + MySQL + 连接池 + 配置 |
| 交付 | 一个 zip，含数据 | 要 dump/restore，版本要对齐 |
| 演示风险 | 前端即全部 | 后端起不来就全黑 |
| 本项目工作量 | 已有 48 个接口、93 项验收 | 同一批功能要重写一遍，旧对账全部作废 |

不是"Java 不好"，是**这个交付形态（单机演示 + 可离线复制 + 算法对账）用单进程 + SQLite 最省事**。

## 6. 如果老师要求上服务器 / Docker（可选升级路径）

已有设计，不必重写：

1. `vite.config.ts` 加 `CLEARTRACE_RUNTIME=node` 分支，跳过 Cloudflare 插件，输出 standalone；
2. `lib/server/db.ts` 抽出 `D1Like` 接口（`prepare/bind/all/first/run/batch`），现有实现不动；
3. 新增 `lib/server/db-node.ts`，用 Node 24 内置 `node:sqlite`（零原生编译）实现同一接口；
4. `cloudflare:workers` 用 vite alias 换成读 `process.env` 的 shim；
5. 同一套 `verify-model-integration.py` 在 Node 通道再跑 93 项。

工作量约 0.5–1 天，不动业务代码。

## 7. 版本清单（可背下来）

| 组件 | 版本 |
| --- | --- |
| Node | 24（要求 ≥22.13） |
| Next.js / React | 16.3.4 / 19.2.6 |
| 构建 | vinext 1.0.0-beta.5（Vite 8） |
| 运行时 | wrangler 4.92.0 → workerd |
| 数据库 | D1（SQLite），迁移由 drizzle 生成、`scripts/team-migrate.mjs` 应用 |
| 校验 | zod 3 |
| 验收 | Playwright（chromium）+ 纯 stdlib 的 Python 脚本 |
