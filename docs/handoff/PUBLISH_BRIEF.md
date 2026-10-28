# 发布指令（可直接转给执行发布的人 / Agent）

> 目标：把本地目录发布成线上应用，并证明「发上去的就是这一版」。
> 全过程 3 步，约 2 分钟；只有第 2 步需要 WorkBuddy 客户端。

## 0. 这个应用是什么

| 项 | 值 |
| --- | --- |
| 平台 | WorkBuddy「应用 / 网站托管」 |
| 应用 | 「清源摸排工作台」，locator `wbapp_uXX1fJC2zb28RqiPlwy2RO` |
| 线上地址 | `https://cleartrace-lab.app.workbuddy.host/?sharecode=OG2AYMRQZQ` |
| 被发布目录（cwd） | `E:\buddy\2026-10-26-03-58-24\ct\handoff\source` |
| 启动命令 | `npm run build && node scripts/selfhost.mjs` |
| 端口 | 平台注入 `PORT`，脚本绑 `0.0.0.0:$PORT` |
| 数据库 | 本地 SQLite（`.wrangler/state/.../faaf2b04….sqlite`），**随目录上传** |

三条硬约束：

1. **启动命令里必须有 `npm run build`**，否则平台会拿旧的 `dist/` 直接跑 → "发布了但没变化"。
2. **重新发布 = 用本地这份 .sqlite 覆盖线上**。线上新增的登录/复核/筛查记录会没，发布前先导备份。
3. 发布目录里必须有 `selfhost.env`（`APP_ORIGIN` / `ADMIN_*`），缺了站点起不来或写请求 403。

## 1. 发布前：跑自检（约 10 秒）

```powershell
E:\buddy\2026-10-26-03-58-24\ct\publish-check.ps1
```

必须看到最后一行是 **`结论：可以发布`**，且这几项为 ✓：

| 检查 | 期望 |
| --- | --- |
| `dist 产物` | 存在 |
| `源码是否新于 dist` | 否（是的话也没关系，startCmd 会重建） |
| `残留 WAL` | 无（有就先正常起停一次服务做 checkpoint，否则可能 `SQLITE_CORRUPT`） |
| `APP_ORIGIN` | `https://cleartrace-lab.app.workbuddy.host` |
| `openapi 版本` | `1.3.0 / 45 条路径` |

线上若有要保留的数据，先导备份（管理员登录后）：

```
GET /api/v1/exports/backup     → 全库 JSON
GET /api/v1/exports/schema     → 建表语句
```

## 2. 发布动作（WorkBuddy 里点）

1. 打开 WorkBuddy，左侧「应用」→ 找到 **「清源摸排工作台」**（locator 以 `wbapp_uXX1fJC2…` 开头）。
2. 确认工作目录 = `E:\buddy\2026-10-26-03-58-24\ct\handoff\source`，启动命令 = `npm run build && node scripts/selfhost.mjs`。
3. 点 **重新发布 / 发布新版本**，等构建结束（首次约 1–3 分钟，日志里能看到 `Build complete` 与 `Ready on http://0.0.0.0:$PORT`）。

## 3. 发布后：核对（30 秒）

```powershell
E:\buddy\2026-10-26-03-58-24\ct\publish-check.ps1 -Verify "https://cleartrace-lab.app.workbuddy.host/?sharecode=OG2AYMRQZQ"
```

如果命令行访问不了这个域名（本机会把它解析成 `198.18.0.x` 的代理 fake-ip），改用浏览器看三条：

| # | 动作 | 通过标准 |
| --- | --- | --- |
| 1 | 打开 `你的域名/api/v1/openapi` | `"version": "1.3.0"`，路径 45 条 |
| 2 | 打开首页 | 登录页是**整页居中卡片**（背后没有侧边栏），按钮绿色占满一行 |
| 3 | 登录后把鼠标放左侧导航上滚动 | 能看到并点开「项目协作」 |

三条都对 = 线上已经是 `v1.1.2`。

## 4. 失败对照

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| 发布成功但页面没变 | 启动命令少了 `npm run build` | 改回完整命令再发一次 |
| 所有写操作 403 `origin_rejected` | `APP_ORIGIN` 与实际域名不一致 | 改 `selfhost.env` 里的 `APP_ORIGIN`（含 `https://`） |
| 启动日志 `SQLITE_CORRUPT` | 上传了带 `-wal` 的库 / 上次被强杀 | `selfhost.mjs` 会自动把坏库归档成 `d1.broken-<时间>` 并重建；重建后需重新 seed 或导回备份 |
| 端口占用 / 起不来 | 本地还挂着一个旧服务 | `Get-NetTCPConnection -LocalPort 3000` 找 pid 结束 |
| 登录后数据是 803 但复核记录没了 | 正常：发布用的就是本地快照 | 用第 1 步的 backup 灌回去 |

## 5. 回滚

- **代码**：`git -C ct\upstream log --oneline -5` 找到上一个 tag（`v1.1.1` / `v1.1.0`），
  `git switch --detach <tag>` 后按原样再发一次；或直接 `git revert <提交>` 再发。
- **数据**：把发布前导出的 `backup-*.json` 通过导入接口灌回；或直接用本地 `.sqlite` 的上一份副本替换后再发。

## 6. 换人 / 换机器发布需要什么

| 方案 | 需要的东西 |
| --- | --- |
| 同一台机器 | 什么都不用给，目录已经在那儿 |
| 另一台机器 + 自己起服务 | `cleartrace-handoff-internal-20261028.zip`（20.7 MB，含真实库与算法包），解压后 `cd 01-source && npm ci && npm run build && node scripts/selfhost.mjs` |
| 只要代码 | `https://github.com/tthu31775-ship-it/cleartrace-lab`（公开），clone 后 `npm ci && npm run build`；数据会从 `lib/data/*.json` 自动 seed（**脱敏示例**） |
| 要接管这个线上应用 | 必须有 WorkBuddy 该账号的权限；域名与 sharecode 绑账号，不在代码里 |

## 7. 给执行 Agent 的最小步骤序列

```
1. run: E:\buddy\2026-10-26-03-58-24\ct\publish-check.ps1        # 期望末行"结论：可以发布"
2. sites.publish(cwd="E:\buddy\2026-10-26-03-58-24\ct\handoff\source",
                 startCmd="npm run build && node scripts/selfhost.mjs")
3. GET https://cleartrace-lab.app.workbuddy.host/api/v1/openapi   # 断言 info.version == "1.3.0"
4. GET /api/v1/health                                             # 断言 status == "ok"
5. 打开首页截图：登录页应无侧边栏、按钮宽度 > 200px
```

失败就停在第 1 步或第 3 步，把 `publish-check.ps1` 的输出与平台构建日志原文发回来。
