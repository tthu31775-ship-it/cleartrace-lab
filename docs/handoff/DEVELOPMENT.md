# 清源项目开发说明与迁移任务

## 1. 基线与当前状态

业务基线为 GitHub 提交 `0b7de60df40ab4bb9a8d34641abb2927a45ce7da`。本轮交接只补充说明，不改变业务实现。

当前技术栈：React 19.2.6、TypeScript 5.9.3、Vinext 1.0.0-beta.5、Vite 8.0.13、Cloudflare Workers、D1、Drizzle ORM 0.45.2。具体依赖以 `package-lock.json` 为准；不要为迁移无依据地整体升级依赖。

网站已包含总览、摸排任务、数据集、账号研判、传播图谱、数据与模型接口、操作日志、项目协作。基线已有 11 项后端核心测试、8 项模型协议测试、14 项本地接口端到端检查及成功的 Sites 生产构建。**这些记录不等于未来 Node 版本已经通过验收。** 详见 [../VERIFICATION.md](../VERIFICATION.md)。

## 2. 源码地图

以下路径均相对项目根目录。

| 路径 | 实际职责 | 国内迁移处理 |
| --- | --- | --- |
| `app/page.tsx` | 应用外壳、八模块导航、全局搜索、页面状态、弹窗调度 | 保留；调整登录入口 |
| `app/globals.css` | 配色、中文字号、表格、弹窗、移动布局 | 保留 |
| `components/cleartrace/panels.tsx` | 看板、任务/数据/账号表、图谱、接口、协作页 | 保留；替换 Sites 专属说明 |
| `components/cleartrace/forms.tsx` | 数据预览与导入、任务、成员、详情和复核 | 保留；接上新成员激活机制 |
| `components/cleartrace/common.tsx` | 同源 API 调用、公共组件与弹窗 | 保持 `/api/v1`，新增会话失效处理 |
| `components/cleartrace/tokens.tsx` | 令牌签发、一次性展示、撤销 | 保留 |
| `lib/contracts.ts` | 前后端共享数据类型 | 保持兼容，新增认证类型时明确版本 |
| `lib/core/import.ts` | CSV/JSON 解析、校验、去重与限制 | 直接复用 |
| `lib/core/detection.ts` | 可复现规则评分、分级、导出保护 | 直接复用 |
| `app/api/v1/[...path]/route.ts` | 统一 API 路由、输入校验、鉴权、状态码 | 保留协议，接入新运行环境和会话 |
| `lib/server/service.ts` | 数据、任务、结果、图谱、统计、导出 | 保留业务语义，替换 D1 类型依赖 |
| `lib/server/db.ts` | Workers env、D1 连接、SQL 帮助与记录转换 | 主要适配点 |
| `lib/server/auth.ts` | API Token、Sites 身份、角色与来源校验 | 主要适配点 |
| `lib/server/model.ts` | 外部推理请求、超时与返回协议校验 | 保留；内部模型地址另作受控设计 |
| `lib/server/seed.ts` | 合成样例初始化 | 生产改为显式开关或独立命令 |
| `db/schema.ts`、`drizzle/` | 九张表与两份版本化 SQL 迁移 | 保留历史 SQL，新增认证迁移 |
| `db/index.ts` | Drizzle D1 包装，当前主业务未依赖此封装 | 只改此文件不能完成数据库迁移 |
| `vite.config.ts` | Vinext、Sites、Cloudflare 构建和绑定 | 新增 Node 构建分支 |
| `worker/index.ts` | Workers fetch 入口及连接器上下文 | 保留给 Sites；Node 不使用 |
| `scripts/team-migrate.mjs` | Wrangler 本地 D1 迁移台账 | 另加 Node SQLite 迁移工具 |
| `.github/workflows/ci.yml` | 当前 Sites 构建、测试和打包 | 增加 Node 生产模式检查与产物 |
| `examples/integrations/` | 数据模板、Python 上传及推理协议示例 | 保留并更新国内地址用法 |

`examples/` 下还有脚手架示例；不要把它们误当成当前业务入口。当前业务后端主要是直接执行参数化 SQLite SQL，并非通过 Drizzle 查询构建器调用。

## 3. 业务链路与不可改变的结果

1. CSV/JSON 进入 `importDataset()`，先 dry-run 校验；正式导入在事务中创建数据集和账号。
2. `createTask()` 建立 queued 记录；用户的显式执行请求调用 `runTask()`。
3. 任务先进行条件更新以领取执行权，再运行规则基线或调用外部推理。
4. 推理结果、账号最新风险、任务完成状态在同一批事务里保存。
5. 人工复核写入历史并更新账号状态；风险分级、证据或模型版本变化时按原规则让旧复核失效。
6. 任务导出使用该任务保存的结果与模型版本；图谱仅来自输入的关联字段。

关键约束：

- 单次导入最多 1,000 条；请求体上限 5 MiB，内容字段另有限长校验。
- 同名数据集递增版本，已有数据集保留独立快照。
- 外部推理超时为 20 秒；失败返回明确错误，不静默改用规则结果。
- 已完成任务重复执行保持幂等；运行超时五分钟可按现有逻辑恢复，最多五次尝试。
- 当前没有后台 cron 或长期队列消费者。若以后加入异步队列，需单独设计，不能在迁移说明里声称已有。
- 原始文本 `textSamples`、关系 `relatedIds`、规则解释、结果模型版本均应保留。
- CSV 导出保留公式注入防护。
- 不把统计接口或页面中的有界列表当作全量数据。

## 4. 数据结构

| 表 | 保存内容 |
| --- | --- |
| `datasets` | 数据集版本、来源、条数、创建者 |
| `accounts` | 账号标识、特征 JSON、关系、最新分数、复核状态、模型版本 |
| `tasks` | 数据集、模型、阈值、状态、进度、尝试次数和错误 |
| `results` | 每次任务的账号结果、依据与模型版本 |
| `reviews` | 人工复核的状态、说明、人员与时间 |
| `audit_logs` | 操作人、操作、对象、结果及说明 |
| `members` | 成员、邮箱、当前认证系统用户 ID 和角色 |
| `settings` | 工作空间设置及样例初始化标记 |
| `api_tokens` | 接口令牌散列、角色、创建与撤销记录 |

现有迁移为 `0000_tricky_the_fallen.sql` 和 `0001_living_imperial_guard.sql`。第二份增加账号模型版本字段。不要重写已应用的历史迁移。

Node 独立认证可新增 `auth_credentials`、`auth_sessions` 等表，并通过成员主键关联；具体表名由实现统一，需补充 SQL 迁移和文档。不要覆盖历史审计中的人员 ID，也不要把新的本地登录 ID 直接塞进原 Sites 用户 ID 语义中。

当前 `lib/server/db.ts::member()` 根据 `members.user_id` 是否存在来显示 active/invited。保留旧 Sites ID 后，这个判断不能代表新本地账号已经激活：Node 版本应从新凭证/激活状态映射成员状态，业务角色仍关联原 `members.id`。

## 5. 最小迁移方案

### M1：保留 Vinext，新增 Node 构建目标

本地锁定依赖已核实：

- Vinext 支持 Node 生产服务器和 `output: "standalone"`。
- CLI 的 `build` 支持 `--mode`。
- 当前版本的 `build --config`、`build --standalone`、`build --platform=node` 不是可用的目标切换方式。
- 当前仓库没有 Node mode 分支，直接附加 `--mode node` 不会自动完成迁移。

拟修改 `vite.config.ts`，在 `mode === "node"` 时使用 Vinext 的 Node 配置，不加载 `sites()`、`connectorPreview()`、`cloudflare()`，并配置 `vinext({ nextConfig: { output: "standalone" } })`。这只是构建分支骨架，还必须加入下一节运行环境/数据库适配所需的别名或模块选择。

把 Node 分支放在 Sites 专用环境配置和 Cloudflare 动态导入之前。保留原默认 Sites 分支及 `.openai/hosting.json` 身份。

**只有上述改动和数据库/认证适配完成后**，使用以下生产构建与启动方式：

```bash
node node_modules/vinext/dist/cli.js build --mode node
node dist/standalone/server.js
```

standalone 使用 `PORT` 和 `HOST`，不是 Next.js 常见的 `HOSTNAME`。它不会自动读取随意命名的 env 文件，需由 Compose、systemd 或显式 env-file 注入环境变量。

建议新增 `build:node`、`start:node`、`db:migrate:node`、`test:node`。这些脚本目前不存在，必须在实现后再宣称可运行。

### M2：把平台能力集中到运行环境适配层

建议提取公共数据库接口与配置类型，建立 Sites 和 Node 两个实现。业务代码继续消费公共接口。

- Sites 实现读取 `cloudflare:workers` 和 D1 绑定。
- Node 实现从 `process.env` 读取配置并连接持久 SQLite。
- 使用明确的构建期模块选择，使 Node 产物不需要解析 `cloudflare:workers`。
- 不要在服务端业务文件中到处加入目标判断，也不要把平台环境对象暴露给浏览器。
- 更新 `db.ts`、`service.ts`、`auth.ts`、`seed.ts` 的 D1 专用类型，统一成项目接口。

第一版可选维护良好的 SQLite 驱动（例如 better-sqlite3），锁定版本并验证 Linux 目标架构下的原生依赖打包。驱动选型与版本应写入迁移记录；不是把宿主机 Windows 的 node_modules 复制到 Linux。

### M3：完整复现数据库接口语义

当前代码真实依赖：

| 接口行为 | Node 适配要求 |
| --- | --- |
| `prepare(sql).bind(...args).first()` | 未找到返回 null；支持参数化 SQL |
| `all()` | 返回包含 `results` 的结构 |
| `run()` | 返回 `meta.changes`，数值含义与实际受影响行数一致 |
| `batch(statements)` | 同一连接上的一个原子事务，任一语句失败则回滚全部 |
| JSON/日期/数值转换 | 保留原字段类型，不把有限数值、空值和 JSON 文本混淆 |

`runTask()` 使用 `claim.meta.changes` 判定是否抢到任务；令牌撤销同样依赖此值。只“让 SQL 能执行”不够。`batch` 不得实现成 `Promise.all` 或逐条自动提交。

开启外键约束，按实际使用设置 WAL、busy timeout；应用单实例运行，SQLite 文件位于本机持久磁盘。外部模型请求必须在数据库写事务之外进行，不持锁等待网络。

如果使用 better-sqlite3，其事务回调必须完成同步 SQL 操作，不可传入 async 回调后期待驱动等待网络 Promise。

迁移工具应记录迁移名与校验值；每份迁移的 SQL 和台账写入在同一事务提交，重复运行安全，历史迁移被改写则拒绝。镜像中包含迁移与运行工具，不能只打包页面输出。

### M4：独立登录与原角色体系

浏览器认证替换为邮箱/用户名加密码的服务端会话；保留 `admin/editor/reviewer/viewer` 和原有 `authorize()`。首版使用管理员创建账号或一次性激活流程，不增加未经需要的短信服务。

必须完成：

- 登录、退出、会话有效期、密码修改或管理员重置、禁用成员后会话失效。
- 管理员通过本机管理命令首次创建，密码从隐藏交互或标准输入读取，不放命令参数、Git 或默认源码。
- 密码使用适合密码存储的 Argon2id 或 scrypt；现有 API Token 的 SHA-256 函数不能直接用于密码。
- 会话使用 HttpOnly Cookie，正式 HTTPS 设置 Secure，设置 SameSite 与明确的过期策略；会话撤销由服务端执行。
- Cookie 写请求具备 CSRF 防护，并校验外部应用 origin；保留服务 Token 的独立授权。
- Node 模式拒绝把 `oai-authenticated-user-*` 等用户自带头当作身份。
- 生产模式不包含固定开发管理员；新增用户不能因填写某个邮箱自动获得管理员权限。
- API Token 仍保存散列，撤销后立即失效；浏览器不要持久保存全能管理员 Bearer Token。
- 旧成员迁移要建立明确的成员与新凭证映射，不仅凭请求中填入的邮箱自动认领历史账号。

当前真正的身份入口是 `lib/server/auth.ts`；只删除 `app/chatgpt-auth.ts` 或改登录按钮不能完成迁移。

### M5：登录界面与网络适配

改 `app/page.tsx` 的 `/signin-with-chatgpt` 链接、`Integrations()` 中的 Sites 身份说明、`MemberModal()` 中的 Sites 共享授权提示。新增登录页、退出按钮、会话过期后的回到登录行为。保持八模块、配色、字号、表格、图谱及移动端布局。

同域部署页面与 `/api/v1`，保留当前相对地址调用。前端必要字体、图标和图表资源已本地打包，不需要引入国外 CDN。GitHub 链接是协作入口，不应成为使用网站的前提。

反向代理终止 HTTPS 时，正确配置原始 Host 与协议。锁定 Vinext 已支持 `VINEXT_TRUST_PROXY` 和 `VINEXT_TRUSTED_HOSTS`；只在 Node 仅能由可信代理访问时启用，并列出准确对外域名。不能通过删除来源校验解决 HTTPS POST 被拒绝的问题。

### M6：模型接口保持独立

`MODEL_SERVICE_URL` 当前只接受公开 HTTPS，拒绝常见内网地址。默认保留此要求，算法组使用独立 HTTPS 服务即可。

如果明确选择同一 Docker 网络内的 Python 模型，`http://model:8000` 当前会被拒绝，必须单独实现“受控内部服务配置”：由部署者配置固定允许的服务名/地址、禁止请求参数决定目标、保留超时与拒绝重定向，并增加拒绝非法地址的检查。不要直接删除所有地址校验。

协议仍包含 `schemaVersion`、`taskId`、`modelId`、账号特征、`relatedIds`、`textSamples`；输出保持 `modelVersion` 和每个输入账号唯一结果。

## 6. 开发顺序与验收门槛

| 阶段 | 产物 | 继续下一阶段的依据 |
| --- | --- | --- |
| A：基线复现 | 依赖、测试与当前源码状态记录 | 当前功能和环境已核对 |
| B：运行适配 | Node 构建、SQLite 适配、迁移命令 | 生产模式 health 与真实 SQL 读写 |
| C：独立认证 | 账号、会话、角色、登录页 | 未登录 401，越权 403，伪造身份无效 |
| D：业务回归 | 导入、任务、复核、导出、图谱 | 与基线同输入同结果，重启后数据存在 |
| E：容器交付 | Dockerfile、Compose、代理、备份恢复 | 新容器复用数据，恢复到干净目录成功 |
| F：服务器发布 | 域名、HTTPS、发布版本、恢复记录 | 实际服务器地址与完整业务验收 |

如果没有服务器或域名，完成 A–E 后明确列出 F 缺少的输入，不能在 A 之前停止。若已有授权服务器，继续完成 F，不另造云账号或购买资源。

## 7. 后续成员如何开发

数据组维护导入规范和脱敏样例，真实数据走网站或授权接口；算法组维护模型与协议测试；系统组维护运行适配、会话、部署和业务回归；前端组继续现有组件。

迁移工作在 `deploy/cn-node` 分支进行。PR 中说明改了哪些运行依赖、API 是否兼容、数据如何保存、认证如何迁移、实际运行结果和剩余限制。源码主分支检查通过不等于已部署；发布记录还应包含镜像/发布包标识、服务器版本、迁移版本和验收时间。

