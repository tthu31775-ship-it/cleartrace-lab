# 清源项目协作约定

## 当前项目

- 源码仓库：https://github.com/tthu31775-ship-it/cleartrace-lab
- 网站：https://cleartrace-lab.orionkayaking.chatgpt.site
- Sites 项目标识以 `.openai/hosting.json` 为准。继续这个项目，不重复注册网站。
- 负责人：赵玉骢。应用采用 React、TypeScript、Vinext、Cloudflare Workers 和 D1。

## 开发前阅读

先读取 `README.md`、`lib/contracts.ts`、`docs/API.md` 和对应模块的实际源码。接口定义以 `docs/openapi.json` 与后端路由的共同验证结果为准；改变请求或响应时同步两者及前端。

## 模块边界

- `components/cleartrace/`、`app/page.tsx`：产品界面与交互。
- `app/api/v1/[...path]/route.ts`：版本化 HTTP API、输入校验与权限。
- `lib/server/`：任务、持久化、身份、模型适配。
- `lib/core/`：可复现的规则基线与数据解析。
- `db/schema.ts`、`drizzle/`：数据库结构及迁移。
- `examples/integrations/`：数据组和算法组的接入示例。

## 修改要求

1. 保留数据导入、任务执行、结果复核、导出的完整链路。业务记录保存到 D1。
2. 外部算法未配置或调用失败时返回明确错误，不静默替换成规则结果。规则基线、合成样例与真实模型输出必须有明确来源。
3. 修改风险分级、模型版本或证据后，核对既有人工复核是否需要重新确认。
4. 权限必须由服务端执行；本地开发身份仅可存在于开发构建。
5. 不提交运行密钥、用户上传数据、数据库状态、缓存或构建目录。公开源码只保留合成样例。
6. 已发布的迁移保持不变；新增结构使用后续迁移。
7. 运行类型检查、核心测试、协议示例测试与生产构建。影响用户流程时检查对应页面。

## 发布

GitHub 推送触发检查与打包。Sites 发布按 `docs/DEPLOYMENT.md` 执行，并验证实际部署结果。GitHub 仓库权限、Sites 编辑权限、网站访问权限与应用角色分别管理。不要把 GitHub CI 通过描述为网站已经发布。

## WorkBuddy 国内部署迁移

用户已要求把当前项目交给 WorkBuddy，继续适配国内站点。先读取 `docs/handoff/README.md`、`DEVELOPMENT.md`、`CHINA_DEPLOYMENT.md` 与 `ACCEPTANCE.md`，在 `deploy/cn-node` 功能分支保留现有业务与界面，新增 Node/SQLite/独立登录和容器部署能力。

这项迁移允许新增普通 Linux 服务器部署目标；前述保留 Sites 项目的要求用于保护旧站身份，不表示禁止国内自托管。默认 Sites 构建路径与 `.openai/hosting.json` 保留，迁移验证期间不覆盖或删除旧站。没有服务器信息时先完成本地迁移与容器交付；已有授权服务器时继续部署并记录真实结果。

当前交接只新增文档，Node 目标、登录与 Docker 配置尚未实现。不能把拟新增脚本当作现有命令，也不能把 Sites 验收记录复制成国内版本已通过。后续以实际源码和实测更新状态。
