# 更新现有网站

本项目使用 Sites 发布前端、服务端与 D1 数据库。GitHub 是公开协作仓库；Sites 自己的受控源码仓库用于生成与发布网站版本。两个仓库并不自动同步。

## 固定项目

| 配置 | 值 |
| --- | --- |
| GitHub | `https://github.com/tthu31775-ship-it/cleartrace-lab` |
| GitHub 主分支 | `main` |
| Sites 项目 ID | `appgprj_6adf1a492d6c8191806448cff3ea0cea` |
| 网站 | `https://cleartrace-lab.orionkayaking.chatgpt.site` |
| 数据库绑定 | `DB` |
| 托管清单 | `.openai/hosting.json` |

继续开发时保留项目 ID，不创建新站、不替换成另一个账号的项目。项目 ID 是标识符，不是发布凭据。发布者还需要此 Site 的编辑权限。

## GitHub 检查与构建

推送 `main`、打开 PR 或在 Actions 手动运行 **Check and package** 后，工作流将安装锁定依赖、运行 TypeScript 检查、后端规则与导入测试、推理协议示例测试并构建。main/手动构建还会上传源码 ZIP 与 `dist` 目录，供发布者检查。

这些产物是构建交接文件，不会自行更新 Sites。CI 也没有存放站点发布令牌。请以 GitHub Actions 实际运行记录为准，不把工作流文件存在当作远程检查已经通过。

## 在有权限的 Sites 会话中发布

将以下任务交给已获得本网站编辑权限、安装 Sites 能力的开发会话：

> 继续现有清源网站，项目 ID 为 appgprj_6adf1a492d6c8191806448cff3ea0cea。先读取该 Site 的访问配置和托管源码，再读取 GitHub tthu31775-ship-it/cleartrace-lab 的 main 最新已验收提交。把这个提交中的项目源码同步到现有托管源码检出目录；保留 Sites 项目 ID、存储绑定、站点受控 Git remote、部署环境变量及当前访问范围。运行检查与构建，通过 Sites source helper 提交推送并打包，用返回的 commit_sha 和 archive 保存部署。确认部署成功后记录 GitHub SHA、Sites 源码 SHA、版本 ID 和网址。不要创建新站，不要将 GitHub 推送误报为已部署。

具体发布顺序如下：

1. 调用 `get_site`，读取现有访问范围与项目状态；调用 `create_source_repository_write_credential` 获取本次受控源码权限。
2. 使用 Sites 插件的 `scripts/site-workflow.mjs` 打开现有源码检出目录。凭据只通过隐藏 stdin 传入，不写进文件、提交记录或日志。
3. 核对待发布的 GitHub SHA，将已验收源码同步到现有检出目录，保留 Sites 控制文件的正确身份和 Git 配置。
4. 安装依赖；执行 `npx tsc --noEmit` 和相关检查。使用 Sites 插件的 `scripts/build-site.mjs` 构建。
5. 使用 source helper 提交、推送并打包，保留返回的 `project_id`、`commit_sha` 和 `archive`。
6. 已确认仅所有者可访问时使用 `save_version_and_deploy_private`；共享范围不同则按当前 Sites 的保存与部署接口处理。不要为完成部署而改变访问范围。
7. 等待部署达到 `succeeded`，用实际返回的网址交付。部署处于 `pending`、`building` 或 `publishing` 时不宣称已经上线。

Sites 在部署过程中应用已提交的数据库迁移。不要在生产请求中建表，也不要重新写过往迁移。

## 服务端配置

通过 Sites 的环境变量管理设置，变量值不提交到 GitHub：

| 变量名 | 用途 | 是否必需 |
| --- | --- | --- |
| `OWNER_EMAIL` | 与站点所有者实际 ChatGPT 登录邮箱一致，用于建立管理员身份 | 生产管理必需 |
| `MODEL_SERVICE_URL` | 外部模型的完整 HTTPS 推理接口地址 | 接入外部模型时需要 |
| `MODEL_API_KEY` | 调用模型的 Bearer 密钥 | 按模型服务要求 |
| `INTEGRATION_API_TOKEN` | 为数据导入脚本提供编辑角色的服务令牌 | 自动导入时可选 |

应用还可由管理员签发或撤销分角色接口令牌；它与 Sites 网关的服务访问凭据是两回事。前者控制业务操作，后者允许机器请求通过受访问控制的网站入口。两者都不能放进前端或分享给无关成员。

## 本地数据库

```bash
npm run build
node scripts/team-migrate.mjs
npm run dev
```

脚本使用 `.wrangler/state`，并把本地迁移名和内容校验值写入本地台账。已经记录的迁移被修改时会拒绝继续。所有命令固定使用 `--local`；它不会向线上数据库执行命令。线上数据库迁移由 Sites 部署流程管理。

## 发布验证与恢复

发布后验证一次导入、任务执行、复核及刷新后的数据保持；同时确认受限角色的写请求被拒绝。记录本次版本与上一个可用版本。

应用版本需要回退时，使用 Sites 版本管理选择已经保存的可用版本。数据库迁移可能已经应用，即使应用发布失败也可能如此；不要依靠回退网页来撤销数据结构变化。先确认数据库状态，必要时使用新的向前兼容迁移修复。
