# 清源 ClearTrace · 功能与后端对应表

> 逐页核对：每个可点元素都走真实接口、都有落库或计算效果。没有"只在前端演一遍"的按钮。
> 核对方式：`scripts/audit-ui.py` 在本地实例逐个点击 **208** 个可点元素，全部有反应（0 无反应、0 点击失败、0 接口报错）；
> 原始结果与逐元素明细见 `docs/handoff/BUTTON_AUDIT.md`。
> 接口侧 `scripts/verify-model-integration.py` 93 项全过；登录限速另有 `scripts/verify-auth-throttle.py` 6 项。核对时间 2026-10-28。

## 0. 总览

| 页面 | 主要用途 | 后端接口 | 是否落库 |
| --- | --- | --- | --- |
| 总览工作台 | 看进度、进任务、看趋势 | `GET /bootstrap` | 只读 |
| 协同线索 | 803 条候选线索的浏览/复核/导出 | `GET /leads`、`/leads/{id}`、`POST /leads/{id}/review`、`GET /leads/export`、`GET /leads/account` | 复核与导出都写库 |
| 评论检测 | 单条/批量打分、评论库检索、抖音样本导入 | `POST /screening/comments`、`GET /screening/predictions`、`GET /comments`、`GET|POST /imports/douyin` | 评论、结果、导入批次都写库 |
| 事件扫描 | 新事件跑协同算法并入库 | `POST /coordination/scan`、`GET /events/{id}/graph` | 事件、线索、成员、相似边、图谱全写库 |
| 摸排任务 | 账号级规则任务 | `GET/POST /tasks`、`POST /tasks/{id}/run`、`/cancel`、`GET /tasks/{id}/export` | 任务与结果写库 |
| 数据集 | 三类批次的预览与下载 | `GET /datasets`、`GET /datasets/{id}`、`GET /exports/{table}` | 幂等导入写库 |
| 账号研判 | 账号明细、人工复核 | `GET /accounts`、`GET /accounts/{id}`、`POST /accounts/{id}/review` | 复核写库 |
| 传播图谱 | 账号关联图 | `GET /graph` | 只读 |
| 数据导出 | 12 表 CSV/JSON、整库备份、DDL | `GET /exports/*` | 导出记审计日志 |
| 模型接入 | 能力状态 + 自检 + 跳转 | `GET /models/status`、`GET /models/selfcheck` | 自检只算不落库 |
| 接口与协议 | 接口目录、令牌管理、外部模型开关 | `GET /openapi`、`/tokens`、`PUT /integrations` | 令牌与开关写库 |
| 操作日志 | 审计留痕 | `GET /logs` | 只读 |
| 项目协作 | 成员与权限 | `GET/POST /members`、`POST /members/{id}/password` | 写库 |

## 1. 总览工作台

| 可点 | 行为 | 后端 |
| --- | --- | --- |
| 四张指标卡 | 分别跳到 账号研判 / 摸排任务 / 账号研判 / 数据集 | 无需接口（导航） |
| 近 7 天 / 近 3 天 | 趋势图切换区间 | 前端筛选 `bootstrap.trend` |
| 查看全部 | 跳到任务页 | 导航 |
| 任务条目 / 查看任务 | 打开任务详情（结果清单、导出、取消、重跑） | `GET /tasks/{id}` |
| 查看接入文档 | 跳到「接口与协议」 | 导航 |

## 2. 协同线索

| 可点 | 行为 | 后端 | 落库 |
| --- | --- | --- | --- |
| 搜索框 | 按代表评论 / 线索 ID / 事件定位检索 | `GET /leads?q=` | 只读 |
| 来源 / 复核状态 / 账号数 / 排序 / 批次 | 组合筛选，批次可选「预计算(803)」与「在线扫描」 | `GET /leads?...` | 只读 |
| 导出明细 | 按当前筛选下载 CSV(带运行批次、来源行号、复核记录) | `GET /leads/export` | 写审计日志 |
| 行内「查看」 | 打开线索抽屉：图谱 + 原文 + 成员 + 复核 | `GET /leads/{id}`、`GET /events/{id}/graph` | 只读 |
| 图谱节点 | 右侧显示该评论的 UID / 时间 / 点赞 / 节点定位 | 同上（内存数据） | 只读 |
| 只看该群组 / 展开整个事件 | 切换图谱范围 | 同上 | 只读 |
| 成员「相关线索」 | 查这个来源账号还出现在哪些线索里，可直接打开 | `GET /leads/account?key=&namespace=` | 只读 |
| 复核依据 + 确认 / 保留 / 排除 | 写复核结论并记录复核人与结果版本 | `POST /leads/{id}/review` | ✅ 写库 |

## 3. 评论检测

| 可点 | 行为 | 后端 | 落库 |
| --- | --- | --- | --- |
| 单条检测 | 调 WB01 打一条分 | `POST /screening/comments` | ✅ 评论 + 结果 |
| 批量筛查 | 每行一条，最多 200 条；空/超长逐条报错 | 同上 | ✅ |
| 刷新（历史记录） | 拉最近 30 条结果 | `GET /screening/predictions` | 只读 |
| 评论库搜索/来源筛选/翻页 | 检索已入库的全部评论（协同 4519 + 抖音 231 + 手工） | `GET /comments` | 只读 |
| 评论库「检测这条」 | 把该条原文再走一次筛查 | `POST /screening/comments` | ✅ |
| 导入样本 / 重新校验导入 | 幂等导入抖音 5/231/215 | `POST /imports/douyin` | ✅ |

## 4. 事件扫描

| 可点 | 行为 | 后端 | 落库 |
| --- | --- | --- | --- |
| 填入示例 | 填 6 条示例并提示下一步 | 无（本地） | — |
| 开始扫描并入库 | 跑协同算法：清洗 → 分组 → 排序 → 落库 | `POST /coordination/scan` | ✅ 事件 + 线索 + 成员 + 相似边 + 图谱 |
| 去复核 | 跳到协同线索（可按「在线扫描」批次筛选） | 导航 | — |

## 5. 摸排任务

| 可点 | 行为 | 后端 | 落库 |
| --- | --- | --- | --- |
| 状态筛选 / 搜索 | 过滤任务 | `GET /tasks`（数据在 bootstrap） | 只读 |
| 新建摸排任务 | 选数据集 + 阈值创建任务 | `POST /tasks` | ✅ |
| 任务详情：执行 / 取消 / 导出 | 跑规则基线、取消排队任务、导出结果 CSV | `POST /tasks/{id}/run`、`/cancel`、`GET /tasks/{id}/export` | ✅ |

## 6. 数据集

| 可点 | 行为 | 后端 | 落库 |
| --- | --- | --- | --- |
| 卡片下载图标 | 直接下载该批次 CSV | `GET /exports/{accounts|comments|leads}` + 过滤 | 写审计日志 |
| 卡片标题 / 查看数据 | 打开详情（按类型给不同预览） | `GET /datasets/{id}` | 只读 |
| 详情「CSV / JSON」 | 下载当前批次 | 同上 | 写审计日志 |
| 详情「去评论检测 / 去协同线索 / 新建任务」 | 按类型给出下一步 | 导航 | — |
| 导入新的数据集 | 上传 CSV/JSON 先校验再入库 | `POST /datasets/import` | ✅ |
| 查看字段规范 | 跳到「接口与协议」 | 导航 | — |

## 7. 账号研判 / 8. 传播图谱

| 可点 | 行为 | 后端 | 落库 |
| --- | --- | --- | --- |
| 搜索 / 风险筛选 / 复核状态 / 数据集 / 翻页 | 过滤账号 | `GET /accounts` | 只读 |
| 行内「研判」 | 打开账号详情（特征、信号、历史复核） | `GET /accounts/{id}` | 只读 |
| 详情里提交复核 | 写账号级复核结论 | `POST /accounts/{id}/review` | ✅ |
| 图谱 放大 / 缩小 / 重置 | 缩放与复位（初始视图时重置按钮禁用） | 无（前端变换） | — |
| 图谱节点点击 | 右侧显示该账号与关联 | `GET /graph` 数据 | 只读 |

## 9. 数据导出

| 可点 | 行为 | 后端 |
| --- | --- | --- |
| 刷新统计 | 重新统计各表行数 | `GET /exports/summary` |
| 每行 CSV / JSON | 导出该表（≤20 万行） | `GET /exports/{table}` |
| 下载全库备份 | 12 张表打成一份 JSON（仅管理员） | `GET /exports/backup` |
| 下载建表语句 | 从 sqlite_master 导出的真实 DDL | `GET /exports/schema` |

## 10. 模型接入

| 可点 | 行为 | 后端 | 落库 |
| --- | --- | --- | --- |
| 运行自检 | 真的跑：探针打分、查库、内存扫描、规则打分 | `GET /models/selfcheck` | 不落库 |
| 下载能力清单 | 把状态 + 自检结果存成 JSON | 无（用已取数据） | — |
| 能力卡「去…」 | 跳到对应页面 | 导航 | — |
| 去测一条评论 / 查看线索 / 跑一次扫描 / 去数据集 | 跳到对应页面 | 导航 | — |

## 11. 接口与协议

| 可点 | 行为 | 后端 | 落库 |
| --- | --- | --- | --- |
| 接口目录 / 数据接入 / 模型接入 / 权限与认证 | 切换说明分区 | 无（静态文档，内容与 openapi 一致） | — |
| OpenAPI 文档 | 打开 `/api/v1/openapi` 原始 JSON | `GET /openapi` | 只读 |
| 复制 /api/v1/... | 复制接口地址到剪贴板 | 无 | — |
| 创建 / 撤销令牌 | 生成 `ct_` 令牌（只显示一次）、撤销 | `POST/DELETE /tokens` | ✅ |
| 外部模型开关 | 控制是否允许创建 `external` 模型任务 | `PUT /integrations` | ✅ |

## 12. 操作日志 / 13. 项目协作

| 可点 | 行为 | 后端 | 落库 |
| --- | --- | --- | --- |
| 日志 状态筛选 / 搜索 | 过滤审计记录 | `GET /logs` | 只读 |
| 添加成员 | 建成员 + 可选初始密码 | `POST /members` | ✅ |
| 重置密码 | 给成员设置新密码并踢掉旧会话 | `POST /members/{id}/password` | ✅ |
| 移除成员 | 删除成员 | `DELETE /members/{id}` | ✅ |
| 打开项目仓库 / 阅读开发说明 | 外链 | — | — |

## 附：只给程序用的接口（页面无入口，但契约文档里有）

| 接口 | 用途 |
| --- | --- |
| `GET /api/v1/health` | 探活 |
| `GET /api/v1/session` | 取当前登录用户 |
| `GET /api/v1/dashboard` | 只要统计/趋势/分布（比 bootstrap 轻） |
| `POST /api/v1/water-comment/predict`、`/predict_batch`、`GET /water-comment/model_info` | WB01 交付包原始契约，给算法组脚本用 |
| `GET /api/v1/model/info` | 同上（包内路径别名） |
| `GET /api/v1/openapi` | 接口文档机器可读版 |
