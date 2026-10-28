# Git 一页命令（给自己看的，忘的时候照抄）

仓库在 `E:\buddy\2026-10-26-03-58-24\ct\upstream`。
`ct\handoff\source` 只是打包快照，**不要在它里面做 Git 操作**。

## 1. 五条最常用的

```powershell
cd E:\buddy\2026-10-26-03-58-24\ct\upstream

git status                 # 现在改了什么（红=没跟踪，绿=已暂存）
git diff                   # 具体改了哪几行
git add -A                 # 把改动放进"待提交"
git commit -m "说明"        # 存成一个版本
git log --oneline -10      # 看最近 10 个版本
```

## 2. 推送到 GitHub

```powershell
git push origin main       # 推 main 分支
git push origin --tags     # 推标签（v1.0.0）
```

第一次会弹窗要账号密码：用户名 `tthu31775-ship-it`，密码粘贴 **PAT**（不是登录密码）。
PAT 在 <https://github.com/settings/tokens> 生成，勾 `repo`（或 fine-grained 选这个仓库的 Contents: Read and write）。

## 3. 想回到上一个版本

```powershell
git switch -- .            # 丢弃所有未提交改动（想过再执行！）
git revert <提交号>         # 撤销某个已提交的版本（安全，会留记录）
git switch feat/model-integration   # 切回工作分支
```

## 4. 四个坑（每个都踩过）

| 坑 | 现象 | 处理 |
| --- | --- | --- |
| 换行符 CRLF | `git status` 里一堆文件显示改动，但 `git diff` 是空的 | 正常现象，`git add -A` 之后就干净了；不要为此改文件 |
| 中文路径 / 方括号 | `app/api/v1/[...path]/` 用 `git add` 单文件加不进去 | 加整个目录：`git add -- app/api/v1` |
| PAT 过期 | `remote: Invalid username or password` | 重新生成 PAT，更新凭据；不要把令牌写进任何被提交的文件 |
| 想撤销远端 | 有人会教你 `git push --force` | **永远不要**。用 `git revert` 生成新提交来撤销 |

## 5. 提交信息怎么写

格式：`类型(范围): 一句话`

| 类型 | 用在哪 |
| --- | --- |
| `feat` | 新功能 |
| `fix` | 修 bug |
| `docs` | 只改文档 |
| `chore` | 数据、依赖、配置 |
| `ci` | 流水线 |
| `refactor` | 不改行为的整理 |

例：`fix(verify): 登录前 401 不再算控制台错误`

## 6. 现在的状态（2026-10-28）

```
* 9a587c5 merge: 模型接入与工作台增强
* f5d062f ci(docs): 增加算法对账步骤并更新推送状态
* d7c566f docs(report): 第三轮复核记录、功能地图与验收日志
* 9e2617c fix(verify): 区分登录前预期噪音与非预期错误
* 71a8f5b feat(tooling): 脱敏数据生成器与逐元素按钮审计
* 5fc6758 chore(data): 仓库内置脱敏示例数据，clone 后即可构建
* f8f196a feat(console): 模型自检、评论库与账号相关线索
```

`main` 比 `origin/main` 多 15 个提交，标签 `v1.0.0` 已打在本地。**还没推送**，原因是 `ct/.push-credential` 里的令牌是空的。
