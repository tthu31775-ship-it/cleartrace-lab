# 数据与模型接口

基础路径为 `/api/v1`。机器可读协议位于本目录 `openapi.json`，网站也提供 `GET /api/v1/openapi`。前后端共享类型在 `lib/contracts.ts`。

## 身份与返回格式

浏览器用户通过 Sites 登录，再由应用成员表确定角色。应用不保存登录密码。机器调用使用 `Authorization: Bearer <应用令牌>`；令牌只能执行其角色允许的操作。

受访问控制的 Sites 入口还可能要求 `OAI-Sites-Authorization: Bearer <站点服务凭据>`。这个凭据由 Sites 平台提供，不能替代应用令牌。调用脚本通过环境变量读取两者：

| 环境变量 | 用途 |
| --- | --- |
| `CLEARTRACE_URL` | 站点 origin，例如 `https://cleartrace-lab.orionkayaking.chatgpt.site` |
| `CLEARTRACE_API_TOKEN` | 应用接口令牌 |
| `CLEARTRACE_SITE_TOKEN` | 需要时提供 Sites 服务访问凭据 |

脚本也接受 `SITES_AUTH_TOKEN` 作为 `CLEARTRACE_SITE_TOKEN` 的别名。两个脚本拒绝 HTTP 重定向，避免把凭据转发到其他网站。

成功响应一般为 `{"data": ...}`，错误为 `{"error":{"code":"...","message":"...","details":...}}`。CSV 导出和 OpenAPI 文档直接返回文件内容，不包装 `data`。

`health` 与 `openapi` 在应用层不要求成员身份，但网站入口仍服从 Sites 访问配置。其他接口需要已登记成员或有效应用令牌。

## 角色

| 操作 | 管理员 | 编辑 | 复核员 | 只读 |
| --- | --- | --- | --- | --- |
| 读取任务、账号、数据集、图谱、日志 | 是 | 是 | 是 | 是 |
| 导入数据、修改数据集元数据、执行任务 | 是 | 是 | 否 | 否 |
| 人工复核 | 是 | 是 | 是 | 否 |
| 删除未被任务引用的数据集 | 是 | 否 | 否 | 否 |
| 管理成员、接口令牌和模型开关 | 是 | 否 | 否 | 否 |

成员接口不能修改或删除管理员。添加成员不会自动发邮件，也不会自动授予 Sites 入口访问权。

## 数据导入

`POST /api/v1/datasets/import`：

```json
{
  "name": "评论样本第一批",
  "source": "数据组",
  "format": "json",
  "content": "[{\"accountId\":\"sample-001\",\"duplicateRatio\":0.2}]",
  "dryRun": true,
  "description": "本批次字段与来源说明"
}
```

`content` 是原文件文本；JSON 数据本体可以是数组，也可以是带 `records` 或 `accounts` 数组的对象。`dryRun` 默认 `true`。格式正确但记录有错误时，预览返回 `valid:false` 和行号；只有全部记录通过校验后，再提交 `dryRun:false`。正式导入成功返回 201；正式导入校验失败返回 400，不入库。

一次最多 1,000 条记录；整个 HTTP 请求体不超过 5 MiB，`content` 不超过 5,000,000 字符。同一批次重复账号 ID 会去重，并报告 `duplicateCount`。同名数据集再次导入建立下一个版本，不覆盖已导入记录。

| CSV 字段 | JSON 字段 | 单位与含义 |
| --- | --- | --- |
| `account_id` | `accountId` | 必填，稳定账号标识，最长 128 字符 |
| `display_name` | `displayName` | 显示名，最长 100 字符；默认账号标识 |
| `platform` | `platform` | 数据来源平台，最长 64 字符 |
| `posts_count` | `postsCount` | 帖文计数，非负数，最大 100,000,000 |
| `followers_count` | `followersCount` | 关注者计数，最大 1,000,000,000 |
| `following_count` | `followingCount` | 关注计数，最大 100,000,000 |
| `account_age_days` | `accountAgeDays` | 注册天数，0–50,000 |
| `duplicate_ratio` | `duplicateRatio` | 重复内容比例，0–1 |
| `burst_ratio` | `burstRatio` | 集中发布比例，0–1 |
| `night_ratio` | `nightRatio` | 所定义夜间窗口的发布比例，0–1 |
| `avg_interval_seconds` | `avgIntervalSeconds` | 平均发布间隔，秒，0–1,000,000,000 |
| `related_ids` | `relatedIds` | CSV 用分号分隔，JSON 用字符串数组；最多 100 个 |
| `text_samples` | `textSamples` | 可选文本样例；JSON 字符串数组，最多 20 条，每条最长 1,000 字符；CSV 单元格写入转义后的 JSON 数组 |

数值字段缺省时目前使用接口默认值：`accountAgeDays=1`，其余数值为 0。为了保证模型输入有意义，数据组应交付真实提取后的完整特征；不要用默认值代替未测量特征而不记录缺失情况。`relatedIds` 只匹配同一个数据集内的账号。关联 ID 和可选文本样例会保存并传给外部模型，供文本模型和图模型使用。

直接使用项目示例：

```bash
python examples/integrations/upload_dataset.py examples/integrations/accounts.sample.csv --name "接口联调样本"
python examples/integrations/upload_dataset.py examples/integrations/accounts.sample.csv --name "接口联调样本" --commit
```

运行前注入上述环境变量。第一条只校验；第二条先校验，通过后导入。脚本不打印令牌。

## 任务与人工复核

创建任务：`POST /tasks`，请求为：

```json
{
  "name": "联调规则任务",
  "datasetId": "使用导入返回的真实数据集 id",
  "modelId": "baseline-v1",
  "threshold": 65
}
```

阈值是 30–95 的整数，默认 65。模型选择 `baseline-v1` 或 `external`。任务先以 `queued` 状态落库，随后 `POST /tasks/{id}/run` 执行。执行完成后保存结果并返回任务；失败则保存错误。已完成任务重复执行返回现有结果，不重复运行。失败任务或超过五分钟未完成的运行中任务可通过同一接口重试，最多五次尝试。这里没有自动 cron。

`POST /tasks/{id}/cancel` 仅取消排队或失败任务。`GET /tasks/{id}` 返回 `{task,results}`，`GET /tasks/{id}/export` 下载完成任务的 CSV。

`GET /accounts` 支持 `q`、`datasetId`、`riskLevel`、`reviewStatus` 和 `limit`。默认最多 1,000 条，上限 5,000；结果按分数和创建时间排序，不提供 offset 分页。`{id}` 指系统内部 `id`，与数据中的外部 `accountId` 不同。

`POST /accounts/{id}/review` 请求：

```json
{"status":"dismissed","note":"复核后确认这是已记录的正常自动发布行为。"}
```

允许状态为 `confirmed`、`dismissed`、`pending`；意见须为 1–1,000 字符。每次复核新增历史。新任务的分数、风险分类、依据或模型版本变化时，原复核状态会重新进入判断流程，避免旧结论被当作新结果的复核结论。

## 外部算法服务

算法服务地址通过服务端 `MODEL_SERVICE_URL` 设置，必须为有效公开 HTTPS 地址；`MODEL_API_KEY` 作为 Bearer 发送。浏览器或任务请求不能传入任意服务地址。服务端单次超时 20 秒。

平台向模型发送：

```json
{
  "schemaVersion": "1.0",
  "taskId": "任务内部 id",
  "modelId": "external",
  "accounts": [{
    "accountId": "sample-001",
    "relatedIds": ["sample-002"],
    "textSamples": ["用于协议联调的合成文本"],
    "features": {
      "postsCount": 180,
      "followersCount": 25,
      "followingCount": 90,
      "accountAgeDays": 12,
      "duplicateRatio": 0.82,
      "burstRatio": 0.76,
      "nightRatio": 0.42,
      "avgIntervalSeconds": 28
    }
  }]
}
```

模型返回的顶层不带 `data`：

```json
{
  "modelVersion": "your-model-v1",
  "results": [{
    "accountId": "sample-001",
    "score": 78.5,
    "reasons": ["依据一", "依据二"]
  }]
}
```

分数范围 0–100。每个输入账号必须恰好对应一个结果，不能遗漏、重复或新增账号；单个账号最多 20 条理由，每条最多 300 字符。模型版本是 1–100 字符非空字符串。`relatedIds` 和 `textSamples` 与 `features` 并列；参考服务接受它们，但示例规则只计算数值特征。接口校验通过不代表模型效果已经验证。

本地运行协议服务：

```bash
python examples/integrations/reference_model.py --port 8788
curl -X POST http://127.0.0.1:8788/predict -H "Content-Type: application/json" --data-binary @examples/integrations/inference.sample.json
```

可配置 `REFERENCE_MODEL_API_KEY` 要求本地示例服务鉴权。线上 Sites 不会连接本机 HTTP 示例地址；算法组应自行把实际推理服务部署到团队 HTTPS 网关，再配置站点环境变量。

## 成员和接口令牌

管理员 `POST /members`，发送 `{name,email,role}`；相同邮箱更新现有成员角色。`role` 只能是 `editor`、`reviewer`、`viewer`。删除使用 `DELETE /members/{id}`。

管理员 `POST /tokens`，发送 `{name,role}`；返回一次性的 `token` 明文。后台只存储摘要；`GET /tokens` 只列元数据，`DELETE /tokens/{id}` 立即撤销。环境变量 `INTEGRATION_API_TOKEN` 若配置，则为固定编辑角色服务令牌。

## 错误与调试

| HTTP 状态 | 典型原因 | 处理 |
| --- | --- | --- |
| 400 | 字段无效、正式导入校验未通过 | 按 `error.details` 或预览行号修正 |
| 401 | 未登录、令牌无效或已撤销 | 检查 Site 入口访问和应用身份 |
| 403 | 角色不足、不是成员、来源不符 | 由管理员开通正确权限 |
| 404 | 内部资源 ID 不存在 | 使用接口返回的真实 ID |
| 409 | 任务锁定、重试上限、数据集被引用 | 查看当前任务状态并按错误提示操作 |
| 413 | 请求体过大 | 拆分导入批次 |
| 502 | 模型错误、连接失败、响应协议不符 | 检查模型服务日志和响应结构 |
| 503 | 模型地址或服务未配置 | 管理员配置服务端环境变量 |
| 504 | 外部模型超过 20 秒 | 分批或优化推理；保留失败记录 |

读取接口健康状态可用 `python scripts/team-smoke.py --site <站点 origin>`；添加 `--authenticated` 会同时验证受保护的 bootstrap，不修改数据。所有实际失败和重试保留在任务/日志中；不要删除失败记录来计算模型表现。
