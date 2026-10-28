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

### 14.5 本轮发布

同一个网址（https://cleartrace-lab.app.workbuddy.host/?sharecode=OG2AYMRQZQ）已更新到本轮版本：
线上 `GET /api/v1/openapi` 返回 1.2.0 / 44 个路径，导航里能看到 事件扫描、数据导出。
发布前把本地测试产生的扫描批次与手工筛查记录清掉了，线上起始状态是干净的 803 / 173 / 7292 / 4750。

### 14.6 本轮验收

`scripts/verify-model-integration.py` 扩到 **10 组 81 项**，本地与线上均 **81/81 通过**；`scripts/test-core.mjs` 合并 WB01（51 项）与协同扫描（9 项）对账；`scripts/verify-ui.py` 现在会走 6 个页面（登录 → 线索 → 详情图谱 → 评论检测 → 事件扫描 → 数据导出 → 模型接入）并截图。

---

## 15. 数据集页面的类型区分(反馈修复)

**问题**:数据集页原来假设"每个数据集都是账号集合",于是抖音批次显示"231 账号记录 / 账号预览 0 条",协同批次显示"7355 账号记录",点开一片空白,还会给出"基于此数据集新建任务"——但里面根本没有账号。这是页面口径错,不是导入失败。

**修复**:

- 迁移 `0004_dataset_kind.sql` 给 `datasets` 加 `kind`(accounts / douyin / coordination),新旧数据都补齐;
- `GET /datasets/{id}` 按类型返回不同预览,不再统一叫"账号":
  - 账号型:高风险候选 / 已复核 / 待复核 + 账号预览 + CTA「新建任务」;
  - 评论型(抖音):作品 5 / 评论 231 / 来源账号 215 / 时间精度"近似" + 评论预览(原文、昵称、IP 属地、精度)+ CTA「去评论检测」;
  - 线索型:803 组 / 173 事件 / 7355 条线索评论 / 账号计数 7292 + 在线扫描批次单独一行 + 线索预览 + CTA「去协同线索」;
- 卡片角标从统一的"可用于识别"改成"账号型 / 评论型 / 线索型";页头统计改成"条记录(账号 / 评论 / 线索)"。

**口径提醒**:线索型里的"账号计数"是各群组账号数之和,同一账号可能出现在多组,不能当独立账号总数;评论型不产生账号行为画像。

验收脚本新增第 11 组 9 项,线上 **90/90 通过**。

## 16. 数据集直接下载

反馈"这些数据集下载不了"——**上一版确实没有入口**:导出中心只支持整表下载,数据集页面没有下载按钮,用户点开只看到预览。

**新增**:

- 数据集卡片右下角一个下载图标(⤓),点一下直接下该批次的 CSV,文件名带数据集名;
- 数据集详情顶部有独立的下载区:CSV(Excel 打开不乱码)/ JSON(保留原始字段);
- 后端 `GET /api/v1/exports/{table}` 支持过滤参数,按类型自动选表:
  - 账号型 → `accounts?datasetId=...`
  - 评论型 → `comments?datasetId=...`
  - 线索型 → `leads?runId=...`
- 实测行数:线索型 803 行 / 176 KB,评论型 231 行 / 97 KB,账号型 80 行 / 30 KB;JSON 版本评论型 195 KB。

验收补 3 项(按批次取线索 803 行、按数据集取评论 231 行、按数据集取账号 80 行),线上 **93/93 通过**。

---

## 17. 代码推送记录

| 项 | 值 |
| --- | --- |
| 仓库 | https://github.com/tthu31775-ship-it/cleartrace-lab |
| 分支 | `feat/model-integration` |
| 提交 | `08ccfb1` 主功能 → `b13c888` 验收修正 → `44512d4` 数据集类型 → `9a1ed83` 数据集下载 → `fcc506a` 推送文档 |
| PR | https://github.com/tthu31775-ship-it/cleartrace-lab/pull/1 |
| 规模 | 7 个提交、+8,092 / −51、59 个文件（含 6 张本地截图与 4 张线上截图） |
| 合并状态 | 可自动合并，未合并（等团队 review） |

**令牌不进仓库**：GitHub 的 PAT 只保存在本机 `ct/.push-credential`（仓库之外，`chmod 600`），
推送脚本 `scripts/push-to-github.sh` 从环境变量取用。原因与轮换步骤见 `docs/handoff/PUSH.md`。

---

# 追加：第三轮（本机全量复核 + 交接包拆成内部版/对外版）

## 18. 复核：把"上次说通过"重新跑一遍

环境：Windows 10（本机），Node v24.14.1，npm 11.11.0，Windows PowerShell 5.1，Playwright chromium 148。
不是引用旧记录，下面每条都是本轮重新执行的。

| 项 | 命令 | 结果 |
| --- | --- | --- |
| 类型检查 | `tsc --noEmit` | 0 错误 |
| WB01 + 协同扫描对账 | `node scripts/test-core.mjs` | 通过 51 + 9，最大概率偏差 0.00e+0 |
| 后端单测 | `node scripts/test-backend.mjs` | 11 / 11 |
| 生产构建 | `node scripts/run-framework.mjs build` | 成功，61.3 秒（36 个模块，4.5 MB） |
| 迁移 + 启动 | `node scripts/selfhost.mjs` | 0 个待应用迁移，监听 0.0.0.0:3000 |
| 接口验收（真实数据） | `python scripts/verify-model-integration.py` | **93 / 93** |
| 浏览器验收 | `python scripts/verify-ui.py` | 登录成功、线索 20 行、图谱 61 节点、能力卡 5 张、导出 12 行 |

数据库在复核前后都用同一份快照还原，复核产生的扫描批次与打分记录没有留在交付库里：
`coordination_leads=803`、`coordination_lead_members=7292`、`comments=4750`、扫描批次 0、打分记录 0。

浏览器验收这一轮暴露了脚本自身的两个毛病，已修：

1. **登录前 401 被判成控制台错误**：页面首屏会请求 `/api/v1/bootstrap` 拿会话，未登录必然 401。
   脚本把它计入 `console_errors`，于是"全部正常"也退出码 1。现在按登录时点切分，登录前的噪音单独计数。
2. **代表评论关键词写死**：验收脚本里直接搜`李睿 拓跋煜`，换成脱敏数据后必然误报。改成先取本实例
   `lead_0001` 的 `representative`，再用它自己的关键词回搜，原始数据与脱敏包都能跑。

## 19. 打包：旧脚本会把凭据发给对方

旧版 `make-handoff-package.ps1` 有两个真问题，不是风格问题：

| 问题 | 后果 | 现在 |
| --- | --- | --- |
| 把 `.wrangler/state`（成员密码散列、审计日志）和 `selfhost.env`（管理员口令）打进 zip | 收件人拿到就能登录、能看全部业务数据 | 拆成内部版/对外版，对外版强制剔除 |
| `.ps1` 存成无 BOM 的 UTF-8，Windows PowerShell 5.1 按 ANSI 解析 | 中文全变乱码、直接语法报错，双击 `打包给我.bat` 根本跑不起来 | 写文件时带 UTF-8 BOM，`Parser::ParseFile` 先自检 |

顺带修掉的三个坑：

- `Get-FileHash -Path` 与 `Compress-Archive -Path` 会把 `app/api/v1/[...path]/route.ts` 的方括号当通配符，
  结果是哈希算不出来、压缩静默漏文件。改用 `-LiteralPath` 与 `System.IO.Compression.ZipFile` 直接压目录，
  压完再比对"zip 内文件条目数 = 暂存文件数 + 2"。
- `robocopy` 退出码 0–7 都是成功，只有 ≥8 才是失败；旧写法按 `$LASTEXITCODE -ne 0` 判断会误报。
- 打包暂存目录里混进过 `__pycache__`、`*.pyc`、`*.tsbuildinfo` 和一次误跑生成的截图目录，已列入排除。

## 20. 对外脱敏版怎么来的

新增 `scripts/make-public-demo-data.py`：读 `lib/data/*.json`，按字段脱敏后写出，**结构、计数、时间戳、相似度全部不动**。

| 字段 | 脱敏后 |
| --- | --- |
| `text` / `content`（评论正文） | `［示例评论］示例文本NNNNN` |
| `uid` / `accountId` | `demo_account_NNNNN` |
| `nickname` / `representative`（昵称串） | `示例用户NNNNN`（图谱里的 `g38n0` 这类节点 ID 不动） |
| `ipRegion` | `示例属地` |
| `workId` / 抖音链接 | `7000000000000000001…5`（**同一个作品用同一个假 ID**） |

第一版把 `workId` 逐个编号，5 个作品和 231 条评论的引用关系当场断掉，导入直接
`D1_ERROR: FOREIGN KEY constraint failed`（HTTP 500）。改成稳定映射后引用完整，
脚本自带引用自检：`抖音评论->作品：231 条对得上，孤儿 0 条`。

## 21. 两个包（本轮产物）

| 包 | 大小 | 内容 | 给谁 |
| --- | --- | --- | --- |
| `cleartrace-handoff-internal-20261027.zip` | 20.6 MB / 466 文件 | 源码 + **含 803 条线索的数据库快照** + 真实数据 + 算法包 + Git bundle/patch + 验收日志与截图 | 自己人 / 自己机器 |
| `cleartrace-demo-share-20261027.zip` | 9.4 MB / 248 文件 | 源码 + **脱敏数据** + 占位口令 `admin@example.com / ChangeMe2026` + 验收日志与截图；不含数据库、算法原件、Git 历史 | 外部评审 / 演示 |

两个包都带 `SHA256SUMS.txt`、`PACKAGE-MANIFEST.json`、`00-START-HERE.md`（末尾自动追加本包模式说明），
`03-reports/` 里有一份 `FILE-LOCATIONS.md`，收件人拿到就能按路径找文件。

## 22. 干净机器实测（对外脱敏版）

把 `cleartrace-demo-share-20261027.zip` 解到一台空目录 `D:\ct-cleanroom`，完全当作收件人来做：

```bash
npm ci --include=dev --include=optional   # 686 个包，3 分钟
node scripts/run-framework.mjs build      # 8.7 秒
node scripts/selfhost.mjs                 # 空库，5 个迁移全部应用，监听 :3100
python scripts/verify-model-integration.py http://127.0.0.1:3100 admin@example.com ChangeMe2026
```

结果：**93 / 93 通过**。即"没有数据库、没有算法包、数据全脱敏"的包，照样能从空库把 803 条线索重建出来，
接口与页面行为与内部版一致（803 / 173 / 7292 / 7355 的计数是在空库上重新 seed 出来的，不是拷库）。

本轮第一次跑这个实测是失败的：外键断裂 + 代表评论关键词写死，两类问题各占 8 项与 1 项。修复后重跑才是 93/93。

## 23. 这轮没做的事

1. **没有提交 Git**：本次改动全在 `ct\handoff\source`（打包源）。`ct\upstream` 仓库仍是 `845cd11`，
   要进仓库需要把 `scripts/make-public-demo-data.py`、`scripts/verify-ui.py`、`scripts/verify-model-integration.py`、
   `make-handoff-package.ps1`、`docs/handoff/evidence/` 这几处补提交。
2. **PR #1 仍未合并**（团队 review 中），合并前线上不跟着变。
3. **逐元素点击审计 `audit-ui.py` 本轮没跑出结果**：它在多页循环里长时间无输出（无浏览器进程、无 JSON 落盘），
   已中止。下次要么加 `-u` 看卡在哪一页，要么给每页加超时。其余验收不受影响。
4. 前一轮列出的 P0（341 项短句词典、独立测试集）与 P1（账号 BERT 权重、全量事件图谱）依旧未动。

---

# 追加：第四轮（Git 入库 + 按钮全覆盖 + 能力口径修正）

## 24. 仓库定型

`ct\upstream` 是唯一仓库。本轮把打包快照里的改动同步回去，拆成 5 个主题提交，合并到 `main`，打 `v1.0.0`：

```
f8f196a feat(console): 模型自检、评论库与账号相关线索
5fc6758 chore(data): 仓库内置脱敏示例数据，clone 后即可构建
71a8f5b feat(tooling): 脱敏数据生成器与逐元素按钮审计
9e2617c fix(verify): 区分登录前预期噪音与非预期错误
d7c566f docs(report): 第三轮复核记录、功能地图与验收日志
```

两处仓库级修复：

1. **`.gitignore` 被旧快照覆盖**：打包目录里那一份比仓库旧，少了 `lib/data/*.json` 与 `push-credential` 的忽略规则。已恢复仓库版本，并改成语义更清楚的注释（示例数据入库、真实数据不入库）。
2. **仓库原本构建不起来**：`lib/server/coordination.ts` 静态 import 三个 `lib/data/*.json`，而这些文件被 ignore，CI 里 `npm run build` 必然失败。现在把**脱敏示例**入库（803/173/4519/5·231·215，正文与账号键已替换），clone 后不接算法包也能构建、能演示。

实测：`tsc --noEmit` 0 错、`test-core` 51+9、`test-backend` 11/11、`npm run build` 25.4 秒。

## 25. 按钮审计：工具自身有四个坑

第一次跑 `audit-ui.py` 时它"卡死"，实际是脚本输出被 Python 缓冲 + 每个元素整页重载，185 个元素要一个多小时。修完四个坑才拿到可信结果：

| 坑 | 现象 | 修法 |
| --- | --- | --- |
| 只改 hash 的 `goto` | 同文档导航，浏览器不重载，筛选后列表长度变了还按下标点 → 串位 | 需要重置时带变化的 query（`?reload=<page>-<n>`）真正重载 |
| 整页重载过慢 | 15–20 秒/元素 | 只在"切页 / 列表长度变化 / 弹层关不掉"时重载，其余原地继续 |
| 指纹采集太贵 | `inner_text('body')` 3 秒超时 + 全 DOM 遍历 | 改成页面内取 `innerText` 前 2000 字，一次 round-trip |
| 判定维度不够 | 复制按钮、筛选按钮被误判"无反应" | 增加"写入剪贴板"与"选中态切换"两个信号 |

另外加了一步**单独复核**：一路点下来没反应的元素，重新开一页只点它一次再判定，用来区分"按钮是死的"和"顺序点击的副作用"。

结果（`docs/handoff/BUTTON_AUDIT.md`，本机真实数据）：

- 可点元素 **208** 个，有反应 **208** 个，点击失败 0，接口报错 0；
- 其中 **4** 个是"顺序点击时未触发、单独点击有反应"的导航按钮，报告里带标注。

## 26. 能力口径修正（老师一眼能看出的矛盾）

`GET /models/status` 里 `coordination_scan` 一直写着 `planned` / "当前不提供在线扫描入口"，但第二轮就把在线扫描做完了、页面上也有"事件扫描"。
同一个页面上"未接入"和能跑的按钮并存，属于自相矛盾。已改为：

| 字段 | 改前 | 改后 |
| --- | --- | --- |
| status | planned | **ready** |
| version | — | online-1.0 |
| detail | "缺 341 项词典，不提供入口" | 在线清洗 10 条短句 + 2/3-gram Jaccard + 10 分钟窗口 + 最少 5 账号，按独立 runId 落库，不生成回复边 |
| contract | `POST /events/:id/scan(未启用)` | `POST /api/v1/coordination/scan` |

`account_bert` 保持 `not_ready`（确实没有权重），接口 503、页面禁用态，不用 mock 分数充数。

## 27. 登录失败限速（他们自己列的 P0）

- 迁移 `0005_login_throttle.sql` + `login_attempts` 表；
- 规则：同一「账号 + 来源地址」10 分钟内失败 10 次后，后续**错误**口令返回 429；
- **正确口令永远放行**（只在口令错误时计数并在成功后清空），避免演示时连续输错把自己锁在门外；
- 限速表缺失时（迁移未应用）降级为不限速，不把登录打成 500。

验收脚本 `scripts/verify-auth-throttle.py`：6 项全过（单次 401 → 阈值内 401 → 达标 429 → 提示可读 → 正确口令 200 → 成功后计数清零）。

## 28. 一条命令起站点

`npm run demo`（`scripts/demo.mjs`）：Node 版本检查 → 端口占用检查 → 需要时构建（`--rebuild` 强制）→ 迁移 → 启动 → 打印地址与账号。
实测：`PORT=3200 npm run demo` 起服务后 `/api/v1/health` 返回 `{"status":"ok","database":"connected"}`。

## 29. 本轮文档

| 文档 | 作用 |
| --- | --- |
| `docs/handoff/API_MATRIX.md` | 48 条接口 × 权限 / 校验 / 落库 / 审计 / 页面入口 |
| `docs/handoff/BUTTON_AUDIT.md` | 逐按钮审计报告（自动生成） |
| `docs/handoff/DEMO_SCRIPT.md` | 5 分钟答辩演示脚本 |
| `docs/handoff/TECH_STACK.md` | 技术栈说明（含"为什么不用 Spring Boot/MySQL"） |
| `docs/handoff/GIT_CHEATSHEET.md` | Git 一页命令与四个坑 |
| `docs/openapi.json` | 1.2.0 → **1.3.0**，补 `/models/selfcheck`（45 条路径） |

## 30. 线上地址

`https://cleartrace-lab.app.workbuddy.host/?sharecode=OG2AYMRQZQ` 由使用者在 2026-10-28 确认**仍可访问**。
本机解析该域名得到的是内网地址，所以本轮的 93 项验收、按钮审计都是在本地实例上做的；线上版本比本地落后两个提交，
下次发布需要重新执行 `npm run build && node scripts/selfhost.mjs`（托管层不会自动构建）。

---

# 追加：第五轮（全量完整性核查：库、数据、造数据、功能）

## 31. 数据库体检（2026-10-28，`PRAGMA integrity_check`）

| 项 | 结果 |
| --- | --- |
| `integrity_check` | **ok** |
| `foreign_key_check` | **0 条违规** |
| 迁移台账 | 6 条（`0000`–`0005`，含登录限流） |
| 索引 | 33 个 |
| 主库文件 | 11,399,168 字节，WAL 已 checkpoint（发布前目录里只剩 `.sqlite`） |

表行数（发布用的干净快照）：

| 表 | 行数 | 说明 |
| --- | --- | --- |
| `coordination_leads` | 803 | 预计算批次，`run_id=coordination-20261023` |
| `coordination_lead_members` | 7,292 | 唯一键 `(lead_id, member_key)` |
| `comments` | 4,750 | 4519 协同 + 231 抖音 |
| `graph_edges` | 6,596 | 6,558 带 `lead_id`，38 条 `lead_id=''` 是事件级 reply 边（按设计） |
| `events` | 178 | 173 协同 + 5 抖音演示 |
| `accounts` / `datasets` | 240 / 5 | 账号型 3 / 评论型 1 / 线索型 1 |
| `tasks` / `results` / `reviews` | 6 / 480 / 39 | 演示任务全部 `completed` |
| `comment_predictions` | 0 | 交付前是干净状态 |

一致性抽查（全部 0）：线索无主事件、成员无主线、账号/任务缺数据集、复核缺复核人、数据集缺 `kind`。

## 32. "能不能往里加数据"：端到端造数验收（新增脚本）

新增 `scripts/e2e-data.py`，把"加数据"这条路整条走通，**26 项全过**：

| 组 | 覆盖 |
| --- | --- |
| 导入数据集 | CSV 5 行 → `dryRun:true` 只校验不落库 → `dryRun:false` 落库 → 详情按 `kind=accounts` 出预览 |
| 任务 | 建任务 → `run` → `completed` → 导出 CSV（748 字节，带 BOM 与公式转义） |
| 成员 | 加 reviewer → 可登录、可读线索、**不能**导入数据集（403）、**不能**看成员列表（403） → 改密 → 旧密码 401 / 新密码 200 → 删除 |
| 令牌 | 签发（只返回一次 `ct_…`）→ Bearer 直连 200 → 撤销 → 再调 401 |
| 抖音 | 导入 5/231/215 → 重复导入仍 5/231/215（幂等） |
| 扫描 | 6 条同质评论 → `201` 落库，`leads=1` |
| 导出 | 全库备份 8.3 MB、建表语句 10.6 KB |
| 保护 | 数据集被任务引用时删除返回 409 |

## 33. 本轮修掉的一个真问题：扫描只认一种字段名

`prepareOnlineComments` 原来只认 `accountId + text + publishTime`（前端/文档格式）。
算法包与内部脚本习惯写 `uid + text + time`，用这种 JSON 去扫描会被整批判成 `invalid_field`，
表现就是"点扫描没反应/0 组"，很像功能坏了。

现在两种写法都认（`accountId|uid`、`publishTime|time`、`text|content`），并在 `test-core` 的 9 项扫描对账上复跑无回归。

## 34. 全量验收汇总（本轮重跑，全绿）

| 层 | 命令 | 结果 |
| --- | --- | --- |
| 类型 | `tsc --noEmit` | 0 错 |
| 算法对账 | `node scripts/test-core.mjs` | 51 + 9 |
| 后端单测 | `node scripts/test-backend.mjs` | 11 |
| 接口 | `python scripts/verify-model-integration.py` | **93 / 93** |
| 按钮 | `python scripts/audit-ui.py` + `audit-report.py` | **208 / 208**（禁用 4，无反应 0） |
| 全流程 | `python scripts/walkthrough.py` | **9 / 9**（含登录页布局回归断言） |
| 造数据 | `python scripts/e2e-data.py` | **26 / 26** |
| 登录取证 | `python scripts/verify-auth-throttle.py` | 6 / 6 |

## 35. 明确没做的（不是漏，是有边界）

1. **账号 BERT**：算法组只给模板无权重，`/models/status` 标 `not_ready`，接口 503，不用 mock 分数。
2. **离线 341 项短句词典**：未交付；在线扫描用 `online-1.0`（10 条），两批用 `runId` 分开，不声称等价。
3. **任务异步化**：任务在请求内同步执行，样本大时受网关超时限制；队列是独立设计。
4. **数据集删除没有页面入口**：API 有 `DELETE /datasets/{id}`（被引用返回 409），界面只提供下载与预览。
5. **全量事件图谱**：只保留"有线索归属"的 4,519 个节点，原图 51,309 个。

