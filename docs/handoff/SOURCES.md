# 交接依据与核实记录

核实日期：2026-10-26。本文件区分“当前项目实际代码”“官方能力说明”和“下一阶段工程方案”。官方支持某种部署，不代表本项目已完成该部署。

## 1. 当前项目

- GitHub基线：`0b7de60df40ab4bb9a8d34641abb2927a45ce7da`。
- 当前基线CI：https://github.com/tthu31775-ship-it/cleartrace-lab/actions/runs/40301573565
- 现有验收：[../VERIFICATION.md](../VERIFICATION.md)
- 现有接口：[../API.md](../API.md)、[../openapi.json](../openapi.json)

直接读取了 package.json、锁文件、Vite配置、Worker入口、前端组件、API路由、db/auth/service/model/seed、表结构、迁移、测试与CI。

确认：后端主业务直接使用D1 SQL接口；当前npm start是Wrangler本地运行；Sites身份头在原网关后才具备可信语义；Node版尚未实现。

## 2. 锁定 Vinext 依赖的本地依据

安装版本：`vinext@1.0.0-beta.5`。这些 node_modules 文件不放入源码交付包，执行锁文件安装后可复核。

| 依赖文件 | 核实内容 |
| --- | --- |
| `vinext/README.md` | standalone输出与Node启动方式 |
| `vinext/dist/cli-args.js` | build支持--mode，不支持交接中排除的几种错误参数 |
| `vinext/dist/cli.js` | 读取插件nextConfig并触发standalone |
| `vinext/dist/index.d.ts` | 插件接受内联nextConfig |
| `vinext/dist/build/standalone.js` | 生成server.js，使用PORT/HOST，包含运行时依赖 |
| `vinext/dist/server/prod-server.js` | Node App Router与API处理 |
| `vinext/dist/server/proxy-trust.js` | 可信代理和允许Host的设置 |

只读执行了 CLI help 与参数解析验证，没有生成或部署 Node 迁移版。上游当前文档与锁定包若有差异，以锁定包和实测为准。

官方仓库：https://github.com/cloudflare/vinext

## 3. WorkBuddy 官方资料

- 创建任务与选择工作空间：https://www.workbuddy.cn/docs/workbuddy/Create-Task
- 默认Agent/Plan/Ask模式：https://www.workbuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Task-Bar
- Git分支和Worktree：https://www.workbuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Worktree-Task
- 网站应用开发与发布：https://www.workbuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/App-Publishing/Web-App
- 云服务、认证、数据与额度：https://www.workbuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/App-Publishing/Cloud-Services

核实：WorkBuddy可指定已有本地目录并以Agent修改文件，Git功能需要仓库上下文；它也支持托管网站与云服务。是否适配本项目现有API/SQL、实际地域和完整导出能力，仍须在目标环境核实。

## 4. 国内服务器与域名

- 腾讯云Docker CE模板：https://cloud.tencent.com/document/product/1207/60423
- 阿里云Docker/Compose：https://help.aliyun.com/zh/ecs/user-guide/install-and-use-docker
- 腾讯云是否需要备案：https://cloud.tencent.com/document/faq/243/19630
- 阿里云ICP备案流程：https://help.aliyun.com/zh/icp-filing/basic-icp-service/user-guide/icp-filing-application-overview

核实：腾讯云当前Docker模板说明使用Ubuntu24.04；两家接入商说明大陆与香港节点的备案区别。实际资源规格、主体材料、地域和价格在部署时按控制台核对。2核4GiB是本项目起步建议，不是云厂商容量承诺。

## 5. 持久化、代理和身份

- Docker Ubuntu安装与端口防火墙说明：https://docs.docker.com/engine/install/ubuntu/
- Docker数据卷：https://docs.docker.com/engine/storage/volumes/
- Caddy自动HTTPS：https://caddyserver.com/docs/automatic-https
- SQLite适用场景：https://sqlite.org/whentouse.html
- SQLite备份：https://sqlite.org/backup.html
- SQLite WAL与本机存储：https://www.sqlite.org/wal.html
- better-sqlite3事务API：https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md
- D1导入导出：https://developers.cloudflare.com/d1/best-practices/import-export-data/
- OWASP密码存储：https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html
- OWASP会话管理：https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html

工程选择：单机、低写并发、小组协作先使用持久SQLite；多实例或高写入需求出现后再评估PostgreSQL。Docker卷、数据库快照与服务端会话都要用本项目的真实流程验收，不能仅引用文档作为“已经运行”的证据。

## 6. 本轮实际完成与未完成

已完成：源码与依赖只读核对、官方资料核实、开发说明、迁移计划、WorkBuddy执行指令、配置契约、验收表、部署输入模板和完整源码交接包。

未执行：Node代码迁移、新认证实现、生产D1导出、国内服务器购买/部署、DNS修改、国内数据库导入。它们是本交接中交给WorkBuddy执行的下一阶段任务。

