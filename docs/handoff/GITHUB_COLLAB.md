# GitHub 推送与团队协作手册

面向"系统搭建组"的实操说明：本次要推什么、用谁的账号推、组员怎么并行不打架、代码推上去之后怎么变成线上站点。

## 1. 先分清三样东西

| | 是什么 | 推送代码会改变它吗 |
| --- | --- | --- |
| GitHub 仓库 `tthu31775-ship-it/cleartrace-lab` | 源码、迁移、文档、CI | — |
| 线上站点 | 部署产物（当前跑在 WorkBuddy 应用沙箱） | **不会**。必须显式重新部署 |
| 本地开发环境 | `npm run dev` + 本地 D1 | 不会 |

**最容易误解的一点**：PR 合并 ≠ 上线。CI 只做检查与打包，从来不碰线上站点。

## 2. 本次要推的内容

- 分支：`feat/selfhost-auth-deploy`
- 基于：`4b00432`（当前 main 头，交接提交）
- 提交：`33cda25 feat(deploy): 增加独立账号登录与自建单端口部署入口`
- 规模：8 个文件修改（+195 / −34）、5 个新文件

改了什么（详细逐条见 [SELFHOST_RESULT.md](SELFHOST_RESULT.md)）：

| 类型 | 文件 |
| --- | --- |
| 新增 | `drizzle/0002_local_auth.sql`、`components/cleartrace/login.tsx`、`scripts/selfhost.mjs`、`selfhost.env.example`、`docs/handoff/SELFHOST_RESULT.md` |
| 修改 | `lib/server/auth.ts`、`lib/server/db.ts`、`app/api/v1/[...path]/route.ts`、`app/page.tsx`、`components/cleartrace/common.tsx`、`scripts/team-migrate.mjs`、`drizzle/meta/_journal.json`、`.gitignore` |

**为什么必须改**：原生产构建靠上游注入 `oai-authenticated-user-*` 身份头，离开 Sites 环境后所有人访问都是 401，登录按钮还指向只有 Sites 才有的 `/signin-with-chatgpt`。不改代码，公网部署出来是个谁都进不去的站点。

## 3. 推送方式（按你手头有什么选一种）

### 方式 A：在自己的电脑上推（最稳，推荐）

需要两个文件（本次已生成，在 `E:/buddy/2026-10-26-03-58-24/ct/`）：

- `cleartrace-selfhost.bundle` —— 含完整提交历史的 git bundle（358 KB）
- `0001-feat-deploy.patch` —— 单个补丁（66 KB）

```bash
# 路线 1：用 bundle（不需要连上游，自带历史）
git clone /path/to/cleartrace-selfhost.bundle cleartrace-lab
cd cleartrace-lab
git checkout feat/selfhost-auth-deploy

# 路线 2：从上游拉历史再打补丁
git clone https://github.com/tthu31775-ship-it/cleartrace-lab.git cleartrace-lab
cd cleartrace-lab
git checkout -b feat/selfhost-auth-deploy 4b00432
git am /path/to/0001-feat-deploy.patch

# 推到自己的账号（先 Fork 过就有这个仓库）
git remote add mine git@github.com:<你的GitHub账号>/cleartrace-lab.git
git push -u mine feat/selfhost-auth-deploy
```

推完在 GitHub 上点 **Compare & pull request**，base 选 `tthu31775-ship-it:main`，head 选 `<你的账号>:feat/selfhost-auth-deploy`。

### 方式 B：用 Personal Access Token 直接从这台机器推

前提：你在自己的 GitHub 上 Fork 了 `cleartrace-lab`，并生成一个有 `repo` 权限的 PAT（Fine-grained token 勾 `Contents: Read and write`）。

```bash
cd /e/buddy/2026-10-26-03-58-24/ct/upstream
git remote add mine https://github.com/<你的账号>/cleartrace-lab.git
git push https://<你的账号>:<PAT>@github.com/<你的账号>/cleartrace-lab.git feat/selfhost-auth-deploy
```

注意：不要把 PAT 写进 `.git/config` 或任何提交文件；命令行里的链接用完请从 shell 历史里清掉，token 用一次就轮换。

### 方式 C：WorkBuddy GitHub 连接器

连接器目前状态是 `bound: true / enabled: true / status: unavailable`，本次尝试恢复授权被取消，所以这次没能直接替你把仓库建好、把分支推上去。你重新授权后我可以直接完成：建仓库 → 推分支 → 开 PR，全程不用你敲命令。

## 4. 组内协作规则（防止互相踩）

### 目录边界（来自 TEAM_HANDOFF）

| 成员 | 负责 | 允许直接改的目录 |
| --- | --- | --- |
| 赵玉骢 | 后端接口、任务、存储、日志、权限、算法对接 | `app/api`、`lib/server`、`lib/core`、`db`、`drizzle`、`scripts` |
| 李梦瑶 | 前端交互、图谱、部署联调、使用说明 | `app/page.tsx`、`components`、`docs` |
| 数据组 | 数据采集清洗标注、版本管理 | 只提交规范、适配器与脱敏样例；不要往业务代码里塞数据 |
| 算法组 | 特征、训练、评测、推理服务 | `examples/integrations` 的协议适配 + 独立模型服务 |

### 分支与 PR

```bash
git checkout main && git pull            # 或从 upstream/main 同步
git checkout -b feat/短描述               # feat/ fix/ docs/ 前缀
# 改代码 → 本地跑下面四条 → 提交 → push → 开 PR
```

提交前本地自检（和 CI 完全一致）：

```bash
npx tsc --noEmit
node scripts/test-backend.mjs
python3 -m unittest discover -s examples/integrations -p 'test_*.py'
npm run build
```

本次改动在这四项上的实测：**tsc 0 错误、后端 11/11 通过、协议 8/8 通过、构建成功**。PR 打开后 CI 会自动再跑一遍并打包。

### 三条硬规则

1. **已应用的迁移不许改**。`drizzle/0000`、`0001` 是历史，只能新增 `0003_...` 并登记 `_journal.json`；`team-migrate.mjs` 发现旧迁移被改会直接拒绝执行。
2. **不进仓库的东西**：`selfhost.env`（含口令）、`.wrangler/`（本地库）、`dist/`、`node_modules/`。前两项已在 `.gitignore`，模板看 `selfhost.env.example`。
3. **共享文件先打招呼**：`app/api/v1/[...path]/route.ts`、`lib/contracts.ts`、`db/schema.ts` 是多人热点，改前在 PR 描述里写清楚动了哪几个分支，避免合并冲突互相覆盖。

## 5. 代码合并后怎么变成线上站点

当前托管路线（本次实际使用）：

```bash
npm ci --include=dev --include=optional --no-audit --no-fund && npm run build
node scripts/selfhost.mjs     # 读 selfhost.env → 迁移 → 单端口启动
```

在 WorkBuddy 里对同一个项目目录重新发布即可，链接和数据库都保持不变。

域名换了或者搬到自己的服务器时，**必须同步改 `APP_ORIGIN`**，否则所有写请求会被来源校验拦成 403（本次上线就踩过这个坑）。

## 6. 后续开发待办（按优先级）

**P0 —— 让这套东西能长期对外用**

1. 数据持久化与备份：现在数据在托管沙箱的单个 SQLite 文件里，没有自动备份，沙箱回收就没了。最低要求是搬到有持久磁盘的服务器 + 每日 `VACUUM INTO` 快照 + 演练一次恢复。
2. 登录失败限速（现在只靠密码强度和会话有效期）。
3. 密码 KDF 换成 Argon2id 或 scrypt：现在用 PBKDF2-SHA256(210k)，因为 workerd 只有 WebCrypto，没有原生模块。上普通 Node 服务器后替换 `lib/server/auth.ts` 的 `pbkdf2()` 即可。

**P1 —— 把部署正规化**

4. `vite.config.ts` 增加 `mode === "node"` 分支（`vinext({ nextConfig: { output: "standalone" } })`），配合 `node dist/standalone/server.js`，摆脱 workerd 依赖。
5. 补 `deploy/cn/`：Dockerfile、compose.yaml、Caddyfile、备份恢复脚本、`.dockerignore`。交接文档第四节有完整清单。
6. CI 增加 Node 生产构建与回归 job，产出版本化镜像/发布包。

**P2 —— 各组交付**

7. 算法组：按 `examples/integrations` 协议交付 HTTPS 推理服务，输出 `modelVersion` 与逐账号唯一结果；配上准确率/精确率/召回率/F1/混淆矩阵。
8. 数据组：按字段规范交付 CSV/JSON（单批 ≤1000 条），用数据集模块正式导入，保留版本台账。
9. 任务异步化：现在执行是请求内同步完成的，样本一大就顶到网关超时；需要队列 + 状态轮询，这是独立设计，不能只在前端改。

## 7. 交付与回退

- 每次上线记录：GitHub SHA、站点版本、数据库迁移编号、验收项目与结果。
- 回退代码可以，回退数据库不行：已执行的迁移要单独写向前兼容的修复迁移。
- 旧站 `cleartrace-lab.orionkayaking.chatgpt.site` 保持不动，作为独立回退入口；切换后它应停止业务写入。
