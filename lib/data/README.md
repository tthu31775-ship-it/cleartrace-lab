# lib/data 说明

这个目录里的两个大文件**不进 Git**:

| 文件 | 内容 | 生成方式 |
| --- | --- | --- |
| `coordination.json` | 803 组协同线索 + 173 个事件元数据(2.35 MB) | `python scripts/prepare-coordination-data.py <算法包>/outputs .` |
| `graphs.json` | 每个事件只保留线索相关节点的图谱(1.36 MB) | 同上 |
| `douyin-sample.json` | 抖音公开评论区小样本 5/231/215(122 KB) | `python scripts/prepare-douyin-sample.py <抖音数据集目录> lib/data/douyin-sample.json` |

原因是这三个文件里含评论原文与账号键,属于原始批量数据;规划 §8.2 要求原始评论数据不进公开仓库。
需要完整数据时,把算法包与抖音数据包放进项目外部目录,跑上面的脚本即可。
拿到算法包 `cleartrace_algorithm_api_1.0.0` 的输出目录后重跑上面的命令即可,输出与交付版本一致
(脚本内有对账打印:803 / 173 / 7355 / 7292)。

缺少这两个文件时 `npm run build` 会失败,这是有意的:避免构建出一个空数据的站点。
