# 清源 ClearTrace：WorkBuddy 开发与国内部署交接

交接日期：2026-10-26。业务基线：`0b7de60df40ab4bb9a8d34641abb2927a45ce7da`。

## 这份交接解决什么

继续现有完整前后端项目，把它适配到国内云服务器，保留已经完成的界面、数据接口、模型接口与协作仓库。WorkBuddy 负责下一阶段的代码修改、验证与部署。

**当前已交付的是 Sites 版本和这套迁移说明；普通 Node / Docker 国内部署版本尚未实现。** 本轮没有购买服务器、导出生产数据库或修改现有网站访问范围。

- 源码：https://github.com/tthu31775-ship-it/cleartrace-lab
- 当前网站：https://cleartrace-lab.orionkayaking.chatgpt.site
- 已验证基线：https://github.com/tthu31775-ship-it/cleartrace-lab/actions/runs/40301573565

## 推荐目标

腾讯云大陆轻量应用服务器或已有的阿里云 Linux 服务器，Ubuntu 24.04 LTS，Docker Compose，Vinext Node standalone，单机 SQLite，Caddy HTTPS，独立账号登录。

这是针对当前小组协作规模的工程选择。2 vCPU、4 GiB 内存、40–60 GiB 持久磁盘可作为初始配置估算，不是压测结论。先完成本地迁移，再确定资源；无需为了读这份交接先购买服务器。

## 在 WorkBuddy 中开始

### 路径 A：从 GitHub 接手，适合继续多人开发

在 Windows PowerShell 的合适目录执行：

```powershell
git clone https://github.com/tthu31775-ship-it/cleartrace-lab.git
Set-Location cleartrace-lab
git switch -c deploy/cn-node
```

如果分支已经存在，先检查其内容，再切换到它，保留已有工作。然后：

1. 打开 WorkBuddy，新建任务。
2. 在“选择工作空间”选择这个 `cleartrace-lab` 目录。
3. 使用默认 Agent 模式。
4. 将 [WORKBUDDY_TASK.txt](WORKBUDDY_TASK.txt) 全文粘贴给它，或引用该文件并要求执行。
5. 已有服务器信息填写在私有的部署输入副本中；不要把密码、私钥放进提示词或公开仓库。

WorkBuddy 不会自动继承这次 ChatGPT 会话；本地源码、文档和任务指令就是交接上下文。[官方使用依据](SOURCES.md)

### 路径 B：使用交付 ZIP，适合暂时无法克隆仓库

完整交接包包含 `source/`、根目录开始说明、任务指令和文件校验清单。解压后，把 **`source` 目录**选为 WorkBuddy 工作空间；该目录里应直接能看到 `package.json`、`app`、`lib` 和 `docs`。

ZIP 不包含 Git 历史、生产数据库、依赖目录或运行密钥。没有 `.git` 时可以先完成本地迁移。需要推送时，从公开仓库另行克隆正常历史，将已审阅的文件改动应用到功能分支；不要用强制推送覆盖仓库，也不要直接推送 ZIP 初始化出的无关历史。

## 文件阅读顺序

| 文件 | 用途 |
| --- | --- |
| [DEVELOPMENT.md](DEVELOPMENT.md) | 当前架构、源码位置、业务流程、数据库及最小迁移任务 |
| [CHINA_DEPLOYMENT.md](CHINA_DEPLOYMENT.md) | 国内服务器路线、域名、Docker、持久化、发布、备份恢复 |
| [WORKBUDDY_TASK.txt](WORKBUDDY_TASK.txt) | 可直接交给 WorkBuddy 的完整执行指令 |
| [ACCEPTANCE.md](ACCEPTANCE.md) | 迁移后必须实测的验收项目与报告格式 |
| [PROJECT_INPUTS.template.md](PROJECT_INPUTS.template.md) | 服务器、域名、数据迁移选择等输入清单 |
| [env.node.example](env.node.example) | 拟新增 Node 版本的配置契约，当前源码尚不读取全部字段 |
| [SOURCES.md](SOURCES.md) | 锁定源码依据与官方资料 |
| [../API.md](../API.md)、[../openapi.json](../openapi.json) | 现有接口及数据/模型协议 |

## 完成的判定

WorkBuddy 应交付可复现的 Node 运行版本、数据库迁移、独立登录、Docker 发布文件、真实验收记录及代码提交；服务器已提供并可访问时再完成上线和域名验收。

只有本地迁移完成时，应写“本地迁移完成，待服务器部署”。容器健康但未检查业务写入时不能写“全部通过”。没有真实外部模型时应继续标注规则基线，不把协议样例当作算法训练成果。

