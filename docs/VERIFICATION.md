# 验收记录

## 后端自动验证

执行完成时间：2026-10-26T09:26:59.470583+00:00（UTC）。

验证目标为本地预览 `http://127.0.0.1:4173`，使用独立合成测试数据与开发环境身份。未在生产数据库运行写入测试，也未把本地身份验证当成生产权限验证。

### 已通过的检查

| 检查 | 实测结果 |
| --- | --- |
| Database health | Preview API confirms D1 connection. |
| Dry-run isolation | 3 input rows, 2 unique accounts, 1 duplicate; no database count changes. |
| Invalid formal import | HTTP 400 with no inserted dataset or account. |
| Malformed text validation | Non-string text sample rejected before persistence. |
| Import persistence | 2 unique accounts persisted with relatedIds and original textSamples. |
| Task execution and stored results | Queued task completed; processed 2 accounts; candidate score 86. |
| Review and idempotent repeat | Review persisted; repeated completed task did not rerun or duplicate results. |
| CSV export | Two stored results exported; formula-like name safely prefixed; review visible. |
| Review invalidation | Same model/threshold preserves review; changed risk bucket reopens review without changing raw score. |
| Unconfigured external model | HTTP 503; no fabricated fallback results. |
| Cancelled task enforcement | Cancelled task cannot execute or export incomplete results. |
| Graph consistency | Only imported relation appears; both edge endpoints are existing nodes. |
| Audit coverage | Import, task creation/execution/cancellation and human review all recorded. |
| Exact action routes | Unexpected trailing action path returns HTTP 404. |

本次端到端回归：14 项通过。

### 发现并修复的问题

- 未完成任务导出原先因路由未等待异步函数，抛出的业务错误绕过统一处理器并变成 HTTP 500。已加上 `await`，取消任务和未完成任务导出现在正确返回 HTTP 409。
- 历史任务详情现在明确读取结果表保存的模型版本，避免显示账号最新一次结果的模型版本。

### 复现命令

先启动开发预览并应用两份数据库迁移，然后执行：

```bash
python tests/integration-smoke.py --url http://127.0.0.1:4173
node scripts/test-backend.mjs
node node_modules/typescript/bin/tsc --noEmit
```

回归脚本拒绝非回环地址，运行时创建一个 QA 前缀的本地数据集和四个任务，不接受生产凭据。详细机器结果写入被忽略的 `.sites-runtime/integration-smoke.json`。核心单元测试共 11 项，通过了 CSV 解析、数值和文本校验、去重、输入上限、基线阈值及导出公式防护检查。

### 验证边界

- 生产 Sites 发布、生产权限校验、GitHub 推送与网页交互由主交付流程补充记录。
- 外部算法实际训练模型尚未提供；本次验证了其未配置失败路径，没有声称已经验证真实外部模型质量。
- 本次是功能和故障路径验证，没有进行大规模压测。

## 浏览器流程验收

2026 年 10 月 26 日，在已连接本地 D1 的实际开发站点完成以下操作：

- 首页成功读取数据集、账号、任务和复核统计。
- 在导入窗口粘贴两条合成账号，预校验显示两条有效记录，确认导入后数据集持久化。
- 创建“界面完整流程验收”任务并立即执行，两个账号分别得到 91 和 5 的规则分数，结果详情显示已完成。
- 从任务结果打开账号研判，核对原始文本、关联账号和四项规则解释。
- 保存排除异常的人工复核说明，待复核数量减少，复核记录显示作者与时间。
- 图谱选择该数据集后显示两个节点和一条关联；点击节点显示邻接数和解释，账号入口可用。
- 视觉检查了首页和导入窗口，完成中文字号、次要文字对比度和弹窗滚动的调整。

测试记录仅存在本地数据库，不包含在部署包或公开源码中。生产站点使用独立数据库。GitHub 与生产发布状态以实际平台记录为准。
