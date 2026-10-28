#!/usr/bin/env bash
# 从环境变量推送,便于 CI 或本地临时使用。绝不把令牌写进仓库。
#   GITHUB_USER=xxx GITHUB_TOKEN=ghp_xxx ./scripts/push-to-github.sh
set -euo pipefail
: "${GITHUB_USER:?需要 GITHUB_USER}"
: "${GITHUB_TOKEN:?需要 GITHUB_TOKEN}"
REPO="${GITHUB_REPO:-cleartrace-lab}"
BRANCH="${GITHUB_BRANCH:-feat/model-integration}"
git push "https://${GITHUB_USER}:${GITHUB_TOKEN}@github.com/${GITHUB_USER}/${REPO}.git" "$BRANCH:$BRANCH"
echo "PR: https://github.com/${GITHUB_USER}/${REPO}/compare/main...${BRANCH}?expand=1"
