# lib/data 说明

这个目录里三个数据文件决定站点能不能构建、有没有东西可看。

## 仓库里内置的是脱敏示例

| 文件 | 内容 | 来源 |
| --- | --- | --- |
| `coordination.json` | 803 组协同线索 + 173 个事件元数据 | `scripts/make-public-demo-data.py` 生成的**脱敏示例** |
| `graphs.json` | 每个事件只保留线索相关节点的图谱（173 个事件 / 4,519 个节点） | 同上 |
| `douyin-sample.json` | 抖音小样本 5 作品 / 231 评论 / 215 账号 | 同上 |

脱敏怎么做：评论正文 → `［示例评论］示例文本NNNNN`；账号键 → `demo_account_NNNNN`；昵称 → `示例用户NNNNN`；
IP 属地 → `示例属地`；抖音作品 ID / 链接 → `7000000000000000001…5`。
**计数、时间戳、相似度、图谱结构一律不变**，所以页面上的 803 / 173 / 7,292 / 7,355 都是真的结构，只是文本是人造的。

这样做的好处：`git clone` → `npm ci` → `npm run build` → `npm start` 就能看到完整界面，
不需要先拿到算法包，也不会把真实评论与账号键推到公开仓库。

## 换成真实数据

把算法组交付包放到项目外部目录，重跑：

```bash
python scripts/prepare-coordination-data.py <cleartrace_algorithm_api>/outputs .
python scripts/prepare-douyin-sample.py <抖音数据集目录> lib/data/douyin-sample.json
```

脚本会打印对账（803 / 173 / 7,355 / 7,292）。**换完不要提交**：真实数据只留在本机，
要对外分发就用 `scripts/make-public-demo-data.py` 重新脱敏，或直接用交接包里的对外版。

## 注意

- 三个文件缺失时 `npm run build` 会失败，这是有意的：避免构建出一个空数据的站点。
- 已入库的是脱敏示例，所以 `.gitignore` 里不再忽略这三个路径；真正的原始数据请改文件名或放仓库外。
