# -*- coding: utf-8 -*-
"""登录失败限速的独立验收（不并入 93 项主验收，避免把计数搞乱）。

    python scripts/verify-auth-throttle.py http://127.0.0.1:3000 admin@cleartrace.local ClearTrace2026

验证四件事：
  1. 一次错误口令仍是 401（不是 429）
  2. 连续错误到阈值后返回 429，且带可读的 message
  3. 限速只针对错误口令——**正确口令照样 200**（演示时不会把自己锁在门外）
  4. 成功登录后失败计数被清空，后续错误重新从 401 开始
"""
from __future__ import annotations

import json
import sys
import urllib.error
import urllib.request

BASE = sys.argv[1].rstrip('/') if len(sys.argv) > 1 else 'http://127.0.0.1:3000'
EMAIL = sys.argv[2] if len(sys.argv) > 2 else 'admin@cleartrace.local'
PASSWORD = sys.argv[3] if len(sys.argv) > 3 else 'ClearTrace2026'
THRESHOLD = 10

results: list[tuple[bool, str, str]] = []


def call(password: str):
    request = urllib.request.Request(
        BASE + '/api/v1/auth/login',
        data=json.dumps({'email': EMAIL, 'password': password}).encode(),
        headers={'Content-Type': 'application/json', 'Origin': BASE, 'Connection': 'close'},
        method='POST')
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return response.status, response.read().decode('utf-8', 'replace')
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read().decode('utf-8', 'replace')


def check(name: str, ok: bool, detail: str = '') -> None:
    results.append((ok, name, detail))
    print(f"  {'✓' if ok else '✗'} {name}" + (f'  [{detail}]' if detail else ''))


print(f'目标 {BASE}  账号 {EMAIL}  阈值 {THRESHOLD} 次')

# 先确保干净：一次成功登录会清空失败计数
call(PASSWORD)

status, body = call('wrong-password-probe')
check('单次错误口令返回 401', status == 401, str(status))

# 先成功登录一次，把上面的失败计数清掉，从 0 开始数
call(PASSWORD)
statuses = []
last_body = ''
for index in range(THRESHOLD):
    status, last_body = call(f'wrong-password-{index}')
    statuses.append(status)

check('阈值内仍返回 401', all(code == 401 for code in statuses[:-1]), str(statuses))
check('达到阈值返回 429', statuses[-1] == 429, str(statuses[-1]))
try:
    message = json.loads(last_body).get('error', {}).get('message', '')
except Exception:
    message = ''
check('429 带可读提示', '失败次数' in message or '频繁' in message, message[:40])

status, _ = call(PASSWORD)
check('正确口令不受限速影响', status == 200, str(status))

status, _ = call('wrong-password-after-reset')
check('成功登录后失败计数被清空', status == 401, str(status))

passed = sum(1 for ok, _, _ in results if ok)
print(f'\n合计：通过 {passed} / 失败 {len(results) - passed}')
sys.exit(0 if passed == len(results) else 1)
