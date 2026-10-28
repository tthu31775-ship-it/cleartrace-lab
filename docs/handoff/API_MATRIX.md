# 接口矩阵（44 + 4 条，与代码逐条对照）

> 全部接口都在 `app/api/v1/[...path]/route.ts` 一个文件里。登录态用 Cookie `ct_session`，
> 脚本/算法组可用 `Authorization: Bearer ct_...`（`POST /tokens` 签发，只显示一次）。
> 写请求额外校验 `Origin`/`Host`（`APP_ORIGIN`），防止跨站提交。
> 最后核对：2026-10-28，对应 `v1.0.0`。

## 0. 权限口径

| 记号 | 含义 |
| --- | --- |
| 公开 | 不需要登录（`/health`、`/openapi`、`/auth/login`、`/auth/logout`） |
| 登录 | 任意已登录账号（admin / editor / reviewer / viewer） |
| 管理 | 仅 admin |
| 编辑 | admin 或 editor |
| 复核 | admin / editor / reviewer |

## 1. 认证与会话

| 方法 | 路径 | 权限 | 校验 | 落库/审计 | 页面入口 |
| --- | --- | --- | --- | --- | --- |
| POST | `/auth/login` | 公开 | email 格式、口令长度、来源校验；**失败 10 次/10 分钟 → 429** | 写 `login_attempts`、`audit_logs` | 登录页 |
| POST | `/auth/logout` | 公开 | 来源校验 | 撤销会话 | 顶栏退出 |
| POST | `/auth/password` | 登录 | 当前口令必须正确；新口令 10–200 位且含字母与数字 | 更新 `members`、撤销其他会话 | 项目协作 |
| GET | `/session` | 登录 | — | — | 前端启动时 |

## 2. 总览与统计

| 方法 | 路径 | 权限 | 校验 | 落库/审计 | 页面入口 |
| --- | --- | --- | --- | --- | --- |
| GET | `/bootstrap` | 登录 | — | 首次访问自动 seed（幂等） | 总览工作台 |
| GET | `/dashboard` | 登录 | — | — | （轻量版，给脚本用） |
| GET | `/health` | 公开 | 探活 + `SELECT 1` | — | 监控 |
| GET | `/openapi` | 公开 | — | — | 接口与协议 |

## 3. 协同线索与事件

| 方法 | 路径 | 权限 | 校验 | 落库/审计 | 页面入口 |
| --- | --- | --- | --- | --- | --- |
| GET | `/leads` | 登录 | 分页 1–100、关键词 ≤120 字、批次/来源/状态枚举 | — | 协同线索 |
| GET | `/leads/export` | 登录 | 同筛选条件，≤5000 行 | 写审计 | 协同线索「导出明细」 |
| GET | `/leads/account` | 登录 | key 必填、namespace 枚举 | — | 成员「相关线索」 |
| GET | `/leads/{id}` | 登录 | 线索必须存在 | — | 线索抽屉 |
| POST | `/leads/{id}/review` | 复核 | status ∈ pending/following/confirmed/dismissed | 写 `coordination_leads` + 审计 | 抽屉「确认/保留/排除」 |
| GET | `/events` | 登录 | 分页、批次、来源 | — | 协同线索批次筛选 |
| GET | `/events/{id}` | 登录 | 事件必须存在 | — | 事件详情 |
| GET | `/events/{id}/graph` | 登录 | 事件必须存在；**不放静态目录** | — | 图谱弹层 |
| POST | `/coordination/scan` | 复核 | comments 1–5000 条、参数范围 | 事件 + 线索 + 成员 + 相似边 + 图谱 + 审计 | 事件扫描 |

## 4. 评论与筛查

| 方法 | 路径 | 权限 | 校验 | 落库/审计 | 页面入口 |
| --- | --- | --- | --- | --- | --- |
| GET | `/comments` | 登录 | 分页、来源、关键词 | — | 评论库 |
| POST | `/screening/comments` | 复核 | 1–200 条、单条 ≤1000 字、空条目单独报错 | 写 `comments` + `comment_predictions` | 单条/批量检测、评论库「检测这条」 |
| GET | `/screening/predictions` | 登录 | 分页 | — | 历史记录 |
| POST | `/water-comment/predict` | 登录 | ≤1000 字；`{code,msg}` 信封 | —（不落库） | 算法组客户端 |
| POST | `/water-comment/predict_batch` | 登录 | ≤200 条，坏条目单独返回 error | — | 算法组客户端 |
| GET | `/water-comment/model_info` | 登录 | — | — | 算法组客户端 |
| GET | `/model/info` | 登录 | 同上（包内别名） | — | — |

## 5. 抖音样本

| 方法 | 路径 | 权限 | 校验 | 落库/审计 | 页面入口 |
| --- | --- | --- | --- | --- | --- |
| GET | `/imports/douyin` | 登录 | — | — | 评论检测「重新校验导入」 |
| POST | `/imports/douyin` | 编辑 | 幂等键 `(source_namespace, source_comment_key)` | 作品/评论/账号 + 审计 | 评论检测「导入样本」 |

## 6. 数据集

| 方法 | 路径 | 权限 | 校验 | 落库/审计 | 页面入口 |
| --- | --- | --- | --- | --- | --- |
| GET | `/datasets` | 登录 | — | — | 数据集 |
| POST | `/datasets`、`/datasets/import` | 编辑 | 行数、字段范围、重复账号、CSV/JSON 解析 | 写 `datasets` + `accounts` + 审计 | 数据集「导入新的数据集」 |
| GET | `/datasets/{id}` | 登录 | 存在性；按 kind 返回不同预览 | — | 数据集详情 |
| PATCH | `/datasets/{id}` | 编辑 | name ≤ 长度、description ≤1000 | 更新 + 审计 | （接口侧） |
| DELETE | `/datasets/{id}` | 管理 | 被任务引用时 409 | 删除 + 审计 | （接口侧） |

## 7. 摸排任务

| 方法 | 路径 | 权限 | 校验 | 落库/审计 | 页面入口 |
| --- | --- | --- | --- | --- | --- |
| GET | `/tasks` | 登录 | — | — | 摸排任务 |
| POST | `/tasks` | 编辑 | 阈值 30–95、模型枚举、数据集存在 | 写 `tasks` + 审计 | 新建任务 |
| GET | `/tasks/{id}` | 登录 | 存在性 | — | 任务详情 |
| POST | `/tasks/{id}/run` | 编辑 | 状态机（queued/failed/cancelled 可跑，最多 5 次） | 写 `results` + 审计 | 执行 |
| POST | `/tasks/{id}/cancel` | 编辑 | 只有 queued/failed 可取消 | 更新 + 审计 | 取消 |
| GET | `/tasks/{id}/export` | 登录 | 未完成时 409 | 写审计 | 导出结果 |

## 8. 账号与图谱

| 方法 | 路径 | 权限 | 校验 | 落库/审计 | 页面入口 |
| --- | --- | --- | --- | --- | --- |
| GET | `/accounts` | 登录 | 分页、风险等级、复核状态、数据集 | — | 账号研判 |
| GET | `/accounts/{id}` | 登录 | 存在性 | — | 研判抽屉 |
| POST | `/accounts/{id}/review` | 复核 | status 枚举、note 长度 | 写 `reviews` + 更新账号 + 审计 | 提交复核 |
| GET | `/graph` | 登录 | 节点上限 5000，默认 60 | — | 传播图谱 |

## 9. 导出

| 方法 | 路径 | 权限 | 校验 | 落库/审计 | 页面入口 |
| --- | --- | --- | --- | --- | --- |
| GET | `/exports/summary` | 登录 | — | — | 数据导出 |
| GET | `/exports/{table}` | 登录 | 表名白名单、≤20 万行、`format=json\|csv` | 写审计 | 每行 CSV/JSON、数据集卡片下载 |
| GET | `/exports/backup` | 管理 | — | 写审计 | 下载全库备份 |
| GET | `/exports/schema` | 登录 | 从 `sqlite_master` 生成 | 写审计 | 下载建表语句 |

## 10. 模型能力

| 方法 | 路径 | 权限 | 校验 | 落库/审计 | 页面入口 |
| --- | --- | --- | --- | --- | --- |
| GET | `/models/status` | 登录 | — | — | 模型接入（5 张能力卡） |
| GET | `/models/selfcheck` | 登录 | 探针打分 + 查库 + 内存扫描 | **写审计**（本轮补） | 运行自检 |

## 11. 接入、令牌、成员、日志

| 方法 | 路径 | 权限 | 校验 | 落库/审计 | 页面入口 |
| --- | --- | --- | --- | --- | --- |
| GET | `/integrations` | 登录 | — | — | 接口与协议 |
| PUT | `/integrations` | 管理 | `externalEnabled` 布尔 | 写 `settings` + 审计 | 外部模型开关 |
| GET | `/tokens` | 管理 | — | — | 令牌列表 |
| POST | `/tokens` | 管理 | name、role 枚举；令牌只返回一次 | 写 `api_tokens` + 审计 | 创建令牌 |
| DELETE | `/tokens/{id}` | 管理 | 未撤销才可撤销 | 更新 + 审计 | 撤销令牌 |
| GET | `/members` | 管理 | — | — | 项目协作 |
| POST | `/members` | 管理 | email、role；不能改管理员角色 | 写 `members`（可带初始密码）+ 审计 | 添加成员 |
| POST | `/members/{id}/password` | 管理 | 口令策略；踢掉旧会话 | 更新 + 审计 | 重置密码 |
| DELETE | `/members/{id}` | 管理 | 管理员不可删 | 删除 + 审计 | 移除成员 |
| GET | `/logs` | 登录 | — | — | 操作日志 |

## 12. 与 `docs/openapi.json` 的关系

- `openapi.json` 是给外部看的最小契约（34 条路径 / 1.3.0），本表是内部实现清单（48 条）。
- 差集：`/auth/*`（登录跳转不走 OpenAPI 客户端）、`/model/info`（算法包别名）、`/models/selfcheck`（本轮新增，已补进 openapi）。
- 改动任一接口时，两处都要更新；`scripts/verify-model-integration.py` 的 93 项是行为层的第三方校验。
