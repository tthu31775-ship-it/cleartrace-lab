# 清源 ClearTrace：模型接入与试用版实测记录

> 按《ClearTrace 模型接入与试用版规划（第一轮）》执行的增量交付记录。所有数字来自真实执行，不是预期值。
> 执行日期：2026-10-27（北京时间）
> 基线：当前线上工作台（独立账号体系 + D1 + 单端口部署），未用旧 GitHub main 覆盖。

## 1. 一句话结论

三个首批用户动作已经可用：**浏览 803 条预计算协同线索并进入事件交互图 → 输入或批量导入评论调用 WB01 真实权重打分并落库 → 对线索和评论结果做人工复核并导出可追溯明细**。新事件在线扫描（`coordination_scan`）与账号 BERT（`account_bert`）按规划**明确标注未接入/未就绪**，不产生正式结果。

## 2. 交付物

| 类别 | 内容 |
| --- | --- |
| 数据准备 | `scripts/prepare-coordination-data.py`、`scripts/prepare-douyin-sample.py`、`scripts/prepare-wb01-model.py` |
| 生成数据 | `lib/data/coordination.json`（2.35 MB）、`lib/data/graphs.json`（1.36 MB）、`lib/data/douyin-sample.json`（122 KB）、`lib/core/wb01-weights.ts`（88 KB） |
| 模型推理 | `lib/core/wb01.ts`（纯 TS，与算法包 `app.py` 数值等价） |
| 服务层 | `lib/server/coordination.ts`、`lib/server/screening.ts` |
| 迁移 | `drizzle/0003_coordination_comments.sql`（六类业务表，不改写 0000/0001/0002） |
| 接口 | `app/api/v1/[...path]/route.ts` 新增 14 个路由；`docs/openapi.json` 升到 1.1.0 |
| 页面 | `components/cleartrace/model-ops.tsx`（协同线索 / 评论检测 / 模型接入） |
| 测试 | `tests/wb01-parity.test.cjs`、`scripts/test-wb01.mjs`、`scripts/verify-model-integration.py`、`scripts/verify-ui.py` |
| 截图 | `docs/handoff/shots/*.png` |

## 3. 数据对账（实测）

| 项 | 期望 | 实测 | 结论 |
| --- | --- | --- | --- |
| 协同线索 | 803 | 803 | ✓ |
| 事件 | 173 | 173 | ✓ |
| 线索评论 | 7,355 | 7,355 | ✓ |
| 群组成员（账号） | 7,292 | 7,292 | ✓ |
| 回复边（observed） | 6,633 | 6,633 | ✓ |
| 相似边（derived） | 6,552 | 6,552 | ✓ |
| 样例 lead 1 | 58 账号 / 60 评论 / 北京时间 19:07—19:17 | 58 / 60 / 2024-07-04 19:07—19:17 | ✓ |
| 抖音样本 | 5 作品 / 231 评论 / 215 账号 | 5 / 231 / 215 | ✓ |
| 重复导入 | 不翻倍 | 第二次仍 803 / 173 / 5·231·215 | ✓ |

事件计数口径说明：索引里 `trend_information.jsonl` 66 个 + `verified_information.jsonl` 107 个 = 173，其中两个来源都有第 2431 行，内部 ID 因此带来源命名空间（`event_trend_02431` / `event_verified_02431`），只用行号会少 1 个事件。

## 4. 六类业务表（迁移 0003）

| 表 | 关键设计 |
| --- | --- |
| `events` | 来源命名空间 + 源文件 + 行号 + 原生作品 ID（抖音作品即事件）；`graph_json` 存该事件的图谱，`graph_path` 只作说明 |
| `comments` | 幂等键 `(source_namespace, source_comment_key)`；时间保留原始值、ISO、精度、时区；点赞保留 `like_known` 区分「真实 0」与「未采集」 |
| `comment_predictions` | 幂等键 `(comment_id, model_version, run_id)`；失败写 `status='error'` 且分数为 NULL，不写 0 |
| `coordination_leads` | `review_status / review_note / reviewer_* / reviewed_run_id` 记录复核结论与**当时的结果版本**；`comments`、`similarity_edges` 保存交付包原样的快照（一条评论可属于多个群组，交付包本身就是按组给的） |
| `coordination_lead_members` | 唯一键 `(lead_id, member_key)`；`is_representative` 标记代表评论作者 |
| `graph_edges` | `edge_type=reply|similarity`、`origin=observed|derived`，唯一键含 `lead_id`（用空串而非 NULL，否则 SQLite 唯一索引不生效） |

`accounts` 表**没有**被塞入抖音 215 个账号：该样本只有昵称、属地与简介级字段，补零会造出「测得的画像」。抖音账号只作为评论的来源账号键出现。

## 5. 接口（全部走应用后端，浏览器不接触模型权重）

| 方法 | 路径 | 权限 | 说明 |
| --- | --- | --- | --- |
| GET | `/api/v1/leads` | 登录 | 分页 + 关键词/来源/状态/最少账号数/排序，返回 stats |
| GET | `/api/v1/leads/export` | 登录 | CSV 导出（≤5000 条），含运行批次、来源定位、复核记录、排序分口径 |
| GET | `/api/v1/leads/{id}` | 登录 | 成员表 + 原始评论 + 相似边 + 图谱路径 |
| POST | `/api/v1/leads/{id}/review` | admin/editor/reviewer | 复核（pending/following/confirmed/dismissed） |
| GET | `/api/v1/leads/account` | 登录 | 按来源账号键查相关线索（不跨来源合并） |
| GET | `/api/v1/events` | 登录 | 事件/作品列表，支持 `batch` |
| GET | `/api/v1/events/{id}` | 登录 | 事件元数据 + 线索 + 边 |
| GET | `/api/v1/events/{id}/graph` | 登录 | 图谱 JSON（**不放 public 静态目录**，避免绕过登录读原文） |
| GET | `/api/v1/comments` | 登录 | 评论检索 |
| POST | `/api/v1/screening/comments` | admin/editor/reviewer | WB01 单条/批量打分并落库（≤200 条、单条 ≤1000 字） |
| GET | `/api/v1/screening/predictions` | 登录 | 已落库结果 |
| GET | `/api/v1/models/status` | 登录 | 五种能力状态与版本 |
| GET/POST | `/api/v1/imports/douyin` | POST 需 admin/editor | 抖音样本状态 / 幂等导入 |

## 6. 能力边界（页面与接口一致声明）

| 能力 | 状态 | 依据 |
| --- | --- | --- |
| `comment_classification` | 已就绪 | WB01 真实权重（`wb01-textonly-v1.0`，D=8192）内置服务端推理 |
| `coordination_lookup` | 已就绪 | 803 组 / 173 事件的预计算批次 |
| `coordination_scan` | 未接入 | 缺完整 341 项短句词典与图谱输出契约（规划 §4.1、§4.2），不提供入口 |
| `account_bert` | 未就绪 | 算法包只有模板，正式接口 503；mock 分数不入库 |
| `behavior_baseline` | 已就绪 | 原有账号八项行为规则，标注为规则参考 |

分数口径三条硬约束已落到文案与字段上：WB01 `probability` 叫「文本筛查分数」；`confidence` 只由文本长度生成并如实标注；协同线索排序分 `scoreType=heuristic`、`calibrated=false`。**两种分数不合并成一个「总水军概率」。**

## 7. WB01 数值对账

- 导出方式：`npz → base64 float32 → TS`，`lib/core/wb01.ts` 复刻 `clean_text`、字符 1/2/3-gram、`crc32(g)%8192`、`log1p`、乘 IDF、点积 + bias、sigmoid。
- 对账夹具：`tests/fixtures/wb01-samples.json`，由 `scripts/make-wb01-fixtures.py` **直接调用算法包 `app.py` 的 `predict_one`** 生成（20 条手写 + 24 条抖音真实评论）。
- 结果：44 条样例概率**逐位一致**，`label / risk_level / confidence / threshold / evidence` 全部相同；最大偏差 0.00e+0。另含 CRC32 已知向量与 `clean_text` 行为用例，合计 51 项通过。

## 8. 验收结果

`scripts/verify-model-integration.py`（HTTP 层，48 项）——**通过 48 / 失败 0**，覆盖：认证与来源校验、线索与事件数量、样例线索细节、图谱鉴权与静态目录不可读、复核写入与重查、导出含来源与批次、WB01 空文本/超长/200 条上限/幂等、抖音导入与幂等、五种能力状态。

`scripts/verify-ui.py`（Playwright，真实浏览器）——登录成功，线索列表 20 行、指标卡 803/803/58/批次号，图谱 61 个节点，能力卡 5 张；除登录前 `bootstrap` 的预期 401 外无控制台错误、无失败请求。截图见 `docs/handoff/shots/`。

## 9. 已知限制（不藏）

1. **新事件在线扫描未接入**：`coordination_scan` 仍是 planned。要做需要算法组补完整短句词典（现只交付 30 项示例）、`coordination_visualize.py` 或新的图谱契约，并按规划 §4.1 用**新版预处理版本号**上线，不能声称复现 803 条旧口径。
2. **图谱只保留线索相关节点**：173 个事件原图共 51,309 个节点，入库/下发的是 4,519 个「有线索归属」的节点与 6,633 条回复边，避免把 19 MB 原始文本放到可被未授权访问的位置。节点总数 `nodeCount` 仍在事件元数据里如实保留。
3. **线索评论以 JSON 快照存于 `coordination_leads.comments`**：交付包按「组」给评论，同一评论可属于多组，因此不做成 `comments` 表的外键关系，避免伪造唯一归属。
4. **抖音时间精度**：CSV 的时间由「1周前」等相对时间推算，入库标记 `time_precision='approximate'`，不参与严格 10 分钟时间窗筛查；报告页眉的 91,286/9,958 未被采用。
5. **训练集指标不可外宣**：包内 `train_metrics_sanity` 是训练集自评（acc 0.951），5 折文本-only 宏 F1 约 0.724 无明细。页面只用来说明「不能当准确率」。
6. **本地 dev 噪音**：`wrangler dev` 偶发「worker restarted mid-request」，验收脚本已对幂等请求做一次重试；正式运行需按 `docs/handoff/CHINA_DEPLOYMENT.md` 用常驻进程方式托管。

## 10. 运维

```bash
# 重新生成数据文件(算法包更新后)
python scripts/prepare-coordination-data.py <算法包>/outputs .
python scripts/prepare-douyin-sample.py <抖音数据集目录> lib/data/douyin-sample.json
python scripts/prepare-wb01-model.py <wb01包> lib/core/wb01-weights.ts

# 数值对账 + 后端单测
node scripts/test-wb01.mjs
node scripts/test-backend.mjs

# 构建 → 迁移 → 启动
npm run build && node scripts/team-migrate.mjs
node scripts/selfhost.mjs

# 端到端验收
python scripts/verify-model-integration.py http://127.0.0.1:3000
python scripts/verify-ui.py http://127.0.0.1:3000
```

复算协同线索（幂等）：删除 `settings` 里 `coordination_seed_version` 这一行后重新请求任意业务接口即可重跑；因为全部使用 `INSERT OR IGNORE` + 唯一键，重复执行不会翻倍。

## 11. 线上发布记录

| 项 | 值 |
| --- | --- |
| 地址 | https://cleartrace-lab.app.workbuddy.host/?sharecode=OG2AYMRQZQ |
| 发布方式 | WorkBuddy 应用托管（HTTP 服务，单端口） |
| 启动命令 | `npm run build && node scripts/selfhost.mjs`（`package.json` 另有 `prestart` 兜底） |
| 证据 | 本文档 §8 的 48 项与浏览器 4 页均在**线上地址**复跑通过；线上 `GET /api/v1/openapi` 返回 1.1.0 / 36 个路径 |

发布过程中真实踩到并修掉的两个坑，记录备查：

1. **原始 `npm start` 不监听 `PORT`**：原脚本把 `wrangler dev` 固定在 8787，托管层等的是 3000，第一次发布会「服务没有在指定端口上响应」。改为 `node scripts/selfhost.mjs`（内部 `--ip 0.0.0.0 --port $PORT`）。
2. **托管层不会自动重新构建**：第二次发布虽然进程起来了，但仍是旧构建（`openapi` 还是 1.0.0，新页面 404）。把构建并入启动命令后正常。另外在 Windows 侧关闭服务时若有 WAL 未落盘，上传的 `.wrangler/state` 会 `SQLITE_CORRUPT`；`selfhost.mjs` 现在会在迁移报错包含 `SQLITE_CORRUPT` 时把旧目录归档为 `.wrangler/state/v3/d1.broken-<ts>` 并重建空库重试，避免整站起不来。

## 12. 回滚

1. 应用层：`git checkout` 回上一个提交并重新 `npm run build`。
2. 数据层：0003 只新增表，不回改旧表；如需彻底回退，`DROP TABLE graph_edges, coordination_lead_members, coordination_leads, comment_predictions, comments, events` 即可恢复原状，账号/数据集/任务/复核数据不受影响。
3. 恢复备份：`.wrangler/state/v3/d1/*.sqlite` 直接替换回滚前副本。

## 13. 待推送 GitHub 的文件清单

本轮 GitHub 连接器不可用，改动没有推送。恢复后按此清单提交到 `feat/model-integration` 分支（原始评论批量数据与 `selfhost.env` 不要进公开仓库）：

```
新增：
  lib/core/wb01.ts
  lib/core/wb01-weights.ts                       # 88 KB,由 npz 导出的权重
  lib/server/coordination.ts
  lib/server/screening.ts
  lib/data/coordination.json                     # 2.35 MB,交付包线索快照
  lib/data/graphs.json                           # 1.36 MB,事件图谱
  lib/data/douyin-sample.json                    # 122 KB,公开评论小样本
  drizzle/0003_coordination_comments.sql
  components/cleartrace/model-ops.tsx
  scripts/prepare-coordination-data.py
  scripts/prepare-douyin-sample.py
  scripts/prepare-wb01-model.py
  scripts/test-wb01.mjs
  scripts/verify-model-integration.py
  scripts/verify-ui.py
  tests/wb01-parity.test.cjs
  tests/fixtures/wb01-samples.json
  docs/handoff/MODEL_INTEGRATION_RESULT.md
  docs/handoff/shots/                            # 本地 + 线上截图

修改：
  lib/contracts.ts                               # 新增线索/事件/评论/筛查/能力类型
  app/api/v1/[...path]/route.ts                  # +14 条路由;提前拒绝时排空请求体
  app/page.tsx                                   # 三个新页面接入导航与路由
  components/cleartrace/panels.tsx                # Page 联合类型
  drizzle/meta/_journal.json                     # 登记 0003
  docs/openapi.json                              # 1.0.0 → 1.1.0,23 → 36 个路径
  package.json                                   # start 改为 selfhost.mjs,新增 prestart / test:wb01
  scripts/selfhost.mjs                           # D1 状态损坏自愈 + 迁移日志
```

提交前自检：`npm run check`（0 错误）→ `node scripts/test-wb01.mjs`（51 项）→ `node scripts/test-backend.mjs`（11 项）→ `npm run build`。

---

# 追加：第二轮（把剩下的能力补齐 + 数据库可下载）

## 14. 本轮新增

### 14.1 WB01 交付包原始契约（可直接对接算法组的前端/脚本）

wb01_api.zip 里的 `API_DOC.md` 定义的是 `{code:0,data:...}` 信封。这份契约现在已经**原样**挂在工作台上，算法组的 Vue 示例把 `127.0.0.1:8000` 换成本站地址即可跑通：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/v1/water-comment/predict` | 单条，≤1000 字，返回 `latency_ms`；只打分不落库 |
| POST | `/api/v1/water-comment/predict_batch` | 批量 ≤200 条；空条目返回 `{comment_id,error}`，不写 0 分 |
| GET | `/api/v1/water-comment/model_info` | 版本、阈值、维度、训练集自评说明 |

错误也按包里的约定：`{code:400,msg:"..."}`。**区别**：这里加了鉴权（登录 Cookie 或 `Authorization: Bearer ct_...`），符合包内“正式环境要加后台代理和 API Key”的建议。需要落库时改用 `/api/v1/screening/comments`（同一套权重、同一套字段，额外写 `comment_predictions`）。

数值一致性：`lib/core/wb01.ts` 与包内 `app.py` 在 44 条样例上概率逐位相同（脚本 `scripts/test-core.mjs`）。

### 14.2 新事件协同在线扫描（coordination_scan 从 planned 变 ready）

`lib/core/coordination-scan.ts` 是 `coordination_scan.py` + `coordination.py:scan_event` 的等价 TS 实现：NFKC 归一化、字符 2/3-gram Jaccard、10 分钟滑动窗口、最少 5 个不同账号、锚点去重、重叠 ≥0.8 的滑动窗口抑制、以及 `0.65×最小相似度 + 0.15×账号规模 + 0.10×评论规模 + 0.10×时间集中度` 的启发式排序分。

- 对账：`scripts/make-scan-fixtures.py` 直接调用参考实现生成 4 组用例（命中 / 账号不足 / 近似文本 / 跨时间窗），TS 结果与 Python **完全一致**。
- 落库：每次扫描 = 一个新 `runId` + 一条 `events` 行 + N 条 `coordination_leads` + 成员 + 相似边 + `graph_json`；同一 `eventId` 重复扫描不会覆盖历史。
- 口径：**在线清洗版本 `online-1.0`**（10 条通用短句）。离线 803 条用的是 341 项跨事件词典，包内未交付，所以我们**不声称**复现旧口径，也不覆盖旧批次；`/leads?runId=` 可分别查看两批。
- 诚实的边界：在线输入没有节点级回复关系，图谱里**不生成回复边**（`replyEdges: []`），只画相似边。

页面：`事件扫描`，支持 JSON 或「账号键<TAB>Unix秒<TAB>原文」两种输入，参数与跳过原因一并展示。

### 14.3 数据导出中心（能下载）

页面：`数据导出`。12 个对象，逐表 CSV（中文表头、UTF-8 BOM、北京时间）与 JSON（原始字段名）：

leads / comments / predictions / events / lead_members / graph_edges / accounts / datasets / tasks / reviews / audit_logs / scans

另外两个整库级出口：

- `GET /api/v1/exports/backup`（仅管理员）：全部业务表打成一份 JSON，7.8 MB 量级；
- `GET /api/v1/exports/schema`：从 `sqlite_master` 导出的真实建表语句（`cleartrace-schema.sql`）。

所有下载要登录，且写入 `audit_logs`；脚本化备份可用接口令牌：

```bash
curl -H "Authorization: Bearer ct_xxx" \
  "https://cleartrace-lab.app.workbuddy.host/api/v1/exports/backup" -o backup.json
```

### 14.4 数据库补齐

- `comments` 表现在真的装下了交付包的线索评论：7,355 条线索评论去重后 **4,519** 条（同一条评论可以同时属于多个群组，按 `来源文件:行号:节点` 唯一化），加上抖音 231 条 = **4,750** 条可检索、可导出的评论。
- 新增 `dataset-coordination-20261023` 数据集记录，`数据集` 页面能看到这个批次。
- 统计口径拆开：`precomputedLeads / precomputedEvents / precomputedAccounts / precomputedComments` 与 `scannedLeads / scannedRuns` 分开返回，页面也分开显示——扫描结果不会污染 803/173 的对账。

### 14.5 本轮验收

`scripts/verify-model-integration.py` 扩到 **10 组 79 项**，本地与线上均 **79/79 通过**；`scripts/test-core.mjs` 合并 WB01（51 项）与协同扫描（9 项）对账；`scripts/verify-ui.py` 现在会走 6 个页面（登录 → 线索 → 详情图谱 → 评论检测 → 事件扫描 → 数据导出 → 模型接入）并截图。

