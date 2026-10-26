# 清源 ClearTrace

网络水军候选行为研判工作台。项目提供数据导入、账号查询、摸排任务、规则推理、结果复核、传播关系图、权限和操作日志，并保留数据组与算法组的接入接口。

- 网站：[cleartrace-lab.orionkayaking.chatgpt.site](https://cleartrace-lab.orionkayaking.chatgpt.site)
- 公开代码：[tthu31775-ship-it/cleartrace-lab](https://github.com/tthu31775-ship-it/cleartrace-lab)
- 接口规范：[docs/openapi.json](docs/openapi.json)
- 项目分工与交接：[docs/TEAM_HANDOFF.md](docs/TEAM_HANDOFF.md)
- 部署和更新：[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)

## 当前交付

| 模块 | 已实现的行为 |
| --- | --- |
| 总览 | 从数据库汇总账号、任务、待复核数量及任务趋势 |
| 数据集 | CSV/JSON 校验预览、去重、正式导入、版本与记录数量 |
| 摸排任务 | 创建、显式执行、取消、失败重试、结果存储与 CSV 导出 |
| 账号研判 | 查询与筛选、风险分数、规则依据、人工确认或排除 |
| 传播图谱 | 从导入的关联字段构建节点与边，查看账号关系 |
| 算法接入 | 运行规则基线；接入符合约定的外部 HTTPS 推理服务 |
| 协作管理 | 管理员、编辑、复核员、只读成员；接口令牌与审计日志 |
| 交付工程 | TypeScript 前后端、D1 迁移、接口文档、接入示例、GitHub CI |

初始数据为可识别的合成样例。内置 `baseline-v1` 是可复现的行为规则，不是算法组已训练或评测的模型；界面分数用于筛选待复核对象。生产模型准确率、精确率、召回率、F1 和混淆矩阵由算法组使用独立标注数据报告，不能从演示看板推出。

## 技术结构

网站使用 React、TypeScript、Vinext 和 Cloudflare Workers；数据库使用 Sites 绑定的 D1，结构由 Drizzle 迁移管理。前后端部署在同一个站点，页面调用 `/api/v1`。这个技术组合对应 Sites 的服务端运行环境；算法训练仍可使用 Python，通过 HTTP 接口独立接入。

| 路径 | 用途 |
| --- | --- |
| `app/`、`components/` | 页面、组件与 API 路由 |
| `lib/contracts.ts` | 前后端共享类型 |
| `lib/core/`、`lib/server/` | 导入校验、规则评分、身份、数据库与业务服务 |
| `db/schema.ts`、`drizzle/` | 数据表定义与不可改写的版本化迁移 |
| `docs/` | API、部署与交接文档 |
| `examples/integrations/` | 数据样例及 Python 接入示例 |
| `scripts/team-migrate.mjs` | 本地数据库迁移 |
| `scripts/team-smoke.py` | 只读 HTTP 冒烟检查 |
| `.github/workflows/ci.yml` | PR / main 分支检查与打包 |
| `.openai/hosting.json` | 现有 Sites 项目标识与存储绑定 |

## 本地运行

要求 Node.js 24、npm、Git；运行 Python 示例时需要 Python 3.10 或以上版本。不需要安装 MySQL 或申请模型 API。

```bash
git clone https://github.com/tthu31775-ship-it/cleartrace-lab.git
cd cleartrace-lab
npm ci
npm run build
node scripts/team-migrate.mjs
npm run dev
```

访问开发服务器打印的地址，通常为 `http://localhost:5173`。本地开发构建使用固定开发管理员；部署构建不包含此身份。初次访问将初始化合成演示数据。`team-migrate.mjs` 只操作本机数据库，使用独立台账避免重复执行已应用的迁移。

如果更新了 `db/schema.ts`：

```bash
npm run db:generate
npm run build
node scripts/team-migrate.mjs
```

提交新增 SQL、Drizzle 元数据和源码。已经应用的迁移不要重写；修正使用新的迁移。

## 检查

```bash
npx tsc --noEmit
node scripts/test-backend.mjs
python -m unittest discover -s examples/integrations -p "test_*.py"
npm run build
```

发布后可执行只读接口检查：

```bash
python scripts/team-smoke.py --site https://cleartrace-lab.orionkayaking.chatgpt.site
```

站点保持访问控制时，命令需要相应的服务访问凭据。受保护 API 还需要应用接口令牌，详见 [API 文档](docs/API.md)。

## 数据组的第一个提交

复制 `examples/integrations/accounts.sample.csv` 或 `.json`，保持字段约定。在网站“数据集”中上传，先检查预览和错误，再正式导入。也可运行 `upload_dataset.py`，默认只校验，添加 `--commit` 才会导入。正式数据通过网站或授权接口交付，不要把数据文件和密钥提交到公开仓库。

## 算法组的第一个提交

运行 `examples/integrations/reference_model.py` 查看推理协议，用实际模型替换其中的评分部分。将服务部署到团队的 HTTPS 地址后，由站点管理员配置 `MODEL_SERVICE_URL` 和 `MODEL_API_KEY`；创建任务时选用 `external`。未配置外部服务时，平台会返回明确错误，不会替换成规则结果。

## 组员如何提交与发布

任何人都可以 Fork 公开仓库并提交 Pull Request。需要直接推送分支的组员，由仓库所有者在 GitHub 的 **Settings → Collaborators** 中按 GitHub 用户名邀请。合并后 GitHub Actions 会检查并打包；更新当前 Sites 网站还需要具有该站点编辑权限的发布者完成部署步骤。

**GitHub 推送不会自动更新当前 Sites 网站。** 两个平台的权限和发布记录分别管理，具体操作见 [CONTRIBUTING.md](CONTRIBUTING.md) 与 [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)。
