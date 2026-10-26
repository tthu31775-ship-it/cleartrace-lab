# 团队协作流程

本仓库公开供组员查看、下载和 Fork。公开访问不包含直接推送权限，GitHub 仓库权限也不自动授予网站的发布权限。

## 加入仓库

1. 将 GitHub 用户名交给仓库所有者 `tthu31775-ship-it`。
2. 所有者进入仓库 **Settings → Collaborators → Add people**，按用户名邀请。
3. 组员接受邀请后推送自己的功能分支；尚未获得写权限的组员可先 Fork 并提交 PR。
4. 只有需要更新线上网站的成员再申请 Sites 编辑权限。数据录入或结果复核成员只需要网站访问权限及对应应用角色。

## 每次开发

```bash
git switch main
git pull --ff-only
git switch -c feature/describe-your-change
```

完成修改与检查：

```bash
npx tsc --noEmit
node scripts/test-backend.mjs
python -m unittest discover -s examples/integrations -p "test_*.py"
npm run build
git add app components lib db drizzle docs examples scripts .github
git commit -m "Describe the behavior change"
git push -u origin feature/describe-your-change
```

按实际修改选择 `git add` 的路径，检查 `git diff --cached` 后再提交。在 GitHub 打开 PR，说明操作步骤、实测结果、接口兼容性和是否新增数据库迁移。`CODEOWNERS` 当前只指定仓库所有者；邀请组员后，可按模块添加真实 GitHub 用户名。

## 各组提交内容

| 小组 | 推荐提交范围 | 验收重点 |
| --- | --- | --- |
| 数据组 | 导入适配器、字段说明、脱敏小样、标注规范和数据版本说明 | 校验通过、ID 稳定、比例和时间单位一致、重复与缺失可解释 |
| 算法组 | 推理服务、依赖锁定、模型版本说明、评测脚本与汇总结果 | 请求响应与 `docs/openapi.json` 一致；每个账号恰好返回一个结果；失败能定位 |
| 系统组 | 页面、API、数据库迁移、集成测试、发布记录 | 权限有效、任务状态可恢复、数据落库、前后端接口兼容 |

模型权重或大型数据集放在团队管理的模型/数据存储中，在仓库记录版本和校验值。不要在 GitHub 提交 API Key、生产数据库导出、原始账号数据或个人文档。

## 合并和发布

PR 检查通过后由维护者合并。默认建议保留 PR 审核；仓库分支保护和审核要求需要仓库所有者在 GitHub 设置中启用，`CODEOWNERS` 文件本身不会强制保护 `main`。

main 分支的 CI 会产出 `cleartrace-<commit SHA>` 构建文件；发布者随后按 [部署文档](docs/DEPLOYMENT.md) 更新当前站点并记录发布的 GitHub SHA、Sites 版本及验证结果。提交源码、合并 PR、构建完成、发布成功是不同状态，交接时分别写明。
