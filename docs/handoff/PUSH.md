# 推送与凭据管理

## 1. 为什么仓库里没有令牌

`cleartrace-lab` 是公开仓库。把 PAT 写进任何被提交的文件,等于把"以你身份向本仓库写代码"的权限公开:
GitHub 的 Secret Scanning 会直接判定为泄露并吊销,克隆过的人也能随手拿到。

所以令牌只存在三个地方之一:

| 位置 | 说明 |
| --- | --- |
| 系统凭据管理器(Git Credential Manager) | 最推荐,`git push` 自动取用 |
| 本地文件 `ct/.push-credential` | 本项目实际采用;在仓库**之外**,含用户/仓库/令牌,`chmod 600` |
| 环境变量 `GITHUB_TOKEN` | CI 或一次性命令用 |

## 2. 日常推送

```bash
# 方式 A:环境变量(最常见)
GITHUB_USER=tthu31775-ship-it GITHUB_TOKEN=ghp_xxx ./scripts/push-to-github.sh

# 方式 B:先让 GCM 记住,之后直接 git push
printf "protocol=https\nhost=github.com\nusername=tthu31775-ship-it\npassword=ghp_xxx\n\n" | git credential approve
git push origin feat/model-integration
```

## 3. 建 PR

推送完成后 GitHub 会在输出里给出 compare 链接:

```
https://github.com/tthu31775-ship-it/cleartrace-lab/compare/main...feat/model-integration?expand=1
```

## 4. 令牌轮换/吊销

1. 打开 <https://github.com/settings/tokens>,删掉旧令牌;
2. 新建一个:勾 `repo`(经典)或 fine-grained 里选该仓库的 **Contents: Read and write**;
3. 更新 `ct/.push-credential` 里的 `GITHUB_TOKEN`,或重新走第 2 节的命令。

**任何一次把令牌贴到聊天/工单/文档里,都当成已泄露处理:立刻吊销再新建。**

## 5. 数据文件为什么不进仓库

`lib/data/coordination.json`、`graphs.json`、`douyin-sample.json` 含评论原文与平台账号键,
按规划 §8.2 不进公开仓库;克隆后跑 `scripts/prepare-coordination-data.py` 与
`scripts/prepare-douyin-sample.py` 重新生成即可(详见 `lib/data/README.md`)。

## 6. 当前推送状态（2026-10-28）

| 项 | 值 |
| --- | --- |
| 仓库 | https://github.com/tthu31775-ship-it/cleartrace-lab |
| 本地分支 | `main`（已合并）、`feat/model-integration`（工作分支） |
| 本地 tag | `v1.0.0` |
| PR | https://github.com/tthu31775-ship-it/cleartrace-lab/pull/1（open，尚未合并） |
| 推送状态 | **未推送**：`ct/.push-credential` 里 `GITHUB_TOKEN` 为空，现在推不上去 |

本地已有的提交（相对上次推送的 `845cd11`）：

```
f8f196a feat(console): 模型自检、评论库与账号相关线索
5fc6758 chore(data): 仓库内置脱敏示例数据，clone 后即可构建
71a8f5b feat(tooling): 脱敏数据生成器与逐元素按钮审计
9e2617c fix(verify): 区分登录前预期噪音与非预期错误
d7c566f docs(report): 第三轮复核记录、功能地图与验收日志
```

推送步骤（自己在本机执行，令牌不用发给任何人）：

```powershell
cd E:\buddy\2026-10-26-03-58-24\ct\upstream
git push origin main
git push origin --tags
```

首次会弹 GitHub 凭据窗口：用户名 `tthu31775-ship-it`，密码粘贴 PAT（勾 `repo`，或 fine-grained 的 Contents: Read and write）。
不想配凭据也可以把令牌临时写进 `ct/.push-credential`（`GITHUB_TOKEN=ghp_xxx`），推完立刻删掉。
