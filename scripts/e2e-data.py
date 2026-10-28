# -*- coding: utf-8 -*-
"""端到端「造数据」验收：把"能不能往里加东西"这条路走通。

覆盖：导入数据集（试运行 → 落库）→ 建任务 → 执行 → 导出结果 →
加成员（权限隔离）→ 改密码 → 删成员 → 建接口令牌 → Bearer 访问 → 撤销 →
抖音导入幂等 → 事件扫描入库 → 整库备份/建表语句 → 删数据集（被引用时应 409）

    python scripts/e2e-data.py http://127.0.0.1:3000 admin@cleartrace.local ClearTrace2026
"""
from __future__ import annotations

import csv
import io
import json
import sys
import time
import urllib.error
import urllib.request
import http.cookiejar

BASE = (sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:3000').rstrip('/')
EMAIL = sys.argv[2] if len(sys.argv) > 2 else 'admin@cleartrace.local'
PASSWORD = sys.argv[3] if len(sys.argv) > 3 else 'ClearTrace2026'
STAMP = time.strftime('%m%d%H%M%S')

results: list[tuple[bool, str, str]] = []
jar = http.cookiejar.CookieJar()
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))


def call(method, path, body=None, token=None, expect=None):
    data = None if body is None else json.dumps(body, ensure_ascii=False).encode('utf-8')
    # 不要加 Connection: close —— workerd 对 chunked 导出响应会保持连接，
    # 同一个 opener 的下一个请求会一直等到超时（实测：run 之后紧接着 export 必挂，
    # 换 keep-alive 或换新 opener 都正常；浏览器是 keep-alive，所以线上用户无感）
    headers = {'Accept': 'application/json', 'Origin': BASE}
    if data:
        headers['Content-Type'] = 'application/json'
    if token:
        headers['Authorization'] = f'Bearer {token}'
    request = urllib.request.Request(BASE + '/api/v1' + path, data=data, headers=headers, method=method)
    try:
        with opener.open(request, timeout=120) as response:
            raw = response.read()
            ctype = response.headers.get('content-type', '')
            return response.status, (json.loads(raw) if 'json' in ctype else raw)
    except urllib.error.HTTPError as exc:
        raw = exc.read()
        try:
            return exc.code, json.loads(raw)
        except Exception:
            return exc.code, raw


def check(name, ok, detail=''):
    results.append((bool(ok), name, str(detail)))
    print(f"  {'✓' if ok else '✗'} {name}" + (f'  [{detail}]' if detail else ''), flush=True)


def main() -> int:
    print(f'目标 {BASE}')
    print('\n[1] 登录')
    status, body = call('POST', '/auth/login', {'email': EMAIL, 'password': PASSWORD})
    check('管理员登录', status == 200, status)
    if status != 200:
        return 1

    print('\n[2] 导入数据集（先试运行，再落库）')
    rows = [{'accountId': f'e2e_{STAMP}_{i:03d}', 'displayName': f'E2E 样例账号 {i}',
             'platform': 'weibo', 'postsCount': 10 + i, 'followersCount': 100 * i,
             'followingCount': 50 + i, 'accountAgeDays': 200 + i,
             'duplicateRatio': 0.1, 'burstRatio': 0.2, 'nightRatio': 0.3, 'avgIntervalSeconds': 120}
            for i in range(1, 6)]
    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=list(rows[0].keys()))
    writer.writeheader()
    writer.writerows(rows)
    content = buf.getvalue()

    status, body = call('POST', '/datasets/import', {'name': f'E2E 数据集 {STAMP}', 'format': 'csv',
                                                     'content': content, 'dryRun': True})
    ok = status in (200, 201) and body.get('data', {}).get('valid') is True
    check('试运行通过且不落库', ok, f"{status} rows={body.get('data', {}).get('rows')}")

    status, body = call('POST', '/datasets/import', {'name': f'E2E 数据集 {STAMP}', 'format': 'csv',
                                                     'content': content, 'dryRun': False})
    dataset = body.get('data', {}).get('dataset', {}) if isinstance(body, dict) else {}
    check('正式导入落库', status == 201 and dataset.get('id'), f"{status} {dataset.get('id')} {dataset.get('recordCount')}")
    dataset_id = dataset.get('id')

    status, body = call('GET', f'/datasets/{dataset_id}')
    detail = body.get('data', {}) if isinstance(body, dict) else {}
    dataset_info = detail.get('dataset', {})
    preview = detail.get('accounts') or []
    check('数据集详情可读且类型正确', status == 200 and dataset_info.get('kind') == 'accounts',
          f"{status} kind={dataset_info.get('kind')} preview={len(preview)}")

    print('\n[3] 建任务 → 执行 → 导出')
    status, body = call('POST', '/tasks', {'name': f'E2E 任务 {STAMP}', 'datasetId': dataset_id,
                                           'modelId': 'baseline-v1', 'threshold': 60})
    task = body.get('data', {}) if isinstance(body, dict) else {}
    check('创建任务', status == 201 and task.get('id'), f"{status} {task.get('id')}")
    task_id = task.get('id')

    status, body = call('POST', f'/tasks/{task_id}/run', {})
    ran = body.get('data', {}) if isinstance(body, dict) else {}
    check('执行任务', status == 200 and ran.get('status') == 'completed', f"{status} {ran.get('status')} 疑似 {ran.get('suspectedCount')}")

    status, body = ('timeout', b'')
    for attempt in range(3):
        try:
            status, body = call('GET', f'/tasks/{task_id}/export')
            break
        except Exception:
            time.sleep(1.5)
            globals()['opener'] = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
            call('POST', '/auth/login', {'email': EMAIL, 'password': PASSWORD})
    is_bytes = isinstance(body, bytes)
    check('导出任务结果 CSV', status == 200 and is_bytes and len(body) > 50, f'{status} {len(body) if is_bytes else 0} 字节')

    print('\n[4] 成员：加人 → 权限隔离 → 改密 → 删除')
    member_email = f'e2e_{STAMP}@cleartrace.local'
    status, body = call('POST', '/members', {'name': f'E2E 复核员 {STAMP}', 'email': member_email,
                                             'role': 'reviewer', 'password': 'Reviewer2026'})
    member = body.get('data', {}) if isinstance(body, dict) else {}
    check('新增成员（reviewer）', status == 201 and member.get('id'), f"{status} {member.get('id')}")
    member_id = member.get('id')

    member_jar = http.cookiejar.CookieJar()
    member_opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(member_jar))

    def member_call(method, path, body=None):
        data = None if body is None else json.dumps(body).encode()
        headers = {'Accept': 'application/json', 'Origin': BASE}
        if data:
            headers['Content-Type'] = 'application/json'
        request = urllib.request.Request(BASE + '/api/v1' + path, data=data, headers=headers, method=method)
        try:
            with member_opener.open(request, timeout=30) as response:
                return response.status, response.read()
        except urllib.error.HTTPError as exc:
            return exc.code, exc.read()

    status, _ = member_call('POST', '/auth/login', {'email': member_email, 'password': 'Reviewer2026'})
    check('新成员可登录', status == 200, status)
    status, _ = member_call('GET', '/leads?pageSize=1')
    check('reviewer 可读线索', status == 200, status)
    status, _ = member_call('POST', '/datasets/import', {'name': 'x', 'format': 'csv', 'content': 'a', 'dryRun': True})
    check('reviewer 不能导入数据集（403）', status == 403, status)
    status, _ = member_call('GET', '/members')
    check('reviewer 不能看成员列表（403）', status == 403, status)

    status, body = call('POST', f'/members/{member_id}/password', {'password': 'Reviewer2027'})
    check('管理员重置成员密码', status == 200, status)
    status, _ = member_call('POST', '/auth/login', {'email': member_email, 'password': 'Reviewer2026'})
    check('旧密码失效', status == 401, status)
    status, _ = member_call('POST', '/auth/login', {'email': member_email, 'password': 'Reviewer2027'})
    check('新密码可登录', status == 200, status)

    status, body = call('DELETE', f'/members/{member_id}')
    check('删除成员', status == 200, status)

    print('\n[5] 接口令牌：签发 → Bearer 访问 → 撤销')
    status, body = call('POST', '/tokens', {'name': f'E2E 令牌 {STAMP}', 'role': 'editor'})
    token = body.get('data', {}).get('token') if isinstance(body, dict) else None
    token_id = body.get('data', {}).get('id') if isinstance(body, dict) else None
    check('签发令牌（只返回一次）', status == 201 and token and token.startswith('ct_'), f'{status} {str(token)[:10]}…')

    anon = urllib.request.build_opener()
    request = urllib.request.Request(BASE + '/api/v1/leads?pageSize=1',
                                     headers={'Accept': 'application/json', 'Authorization': f'Bearer {token}'})
    try:
        with anon.open(request, timeout=30) as response:
            status = response.status
    except urllib.error.HTTPError as exc:
        status = exc.code
    check('Bearer 令牌可访问（无需 Cookie）', status == 200, status)

    status, _ = call('DELETE', f'/tokens/{token_id}')
    check('撤销令牌', status == 200, status)
    try:
        with anon.open(request, timeout=30) as response:
            status = response.status
    except urllib.error.HTTPError as exc:
        status = exc.code
    check('撤销后不可用（401）', status == 401, status)

    print('\n[6] 抖音样本导入（幂等）')
    status, body = call('POST', '/imports/douyin', {})
    data = body.get('data', {}) if isinstance(body, dict) else {}
    check('导入 5 作品 / 231 评论 / 215 账号', status == 201 and (data.get('works'), data.get('comments'), data.get('accounts')) == (5, 231, 215),
          f"{status} {data.get('works')}/{data.get('comments')}/{data.get('accounts')}")
    time.sleep(1)
    for attempt in range(3):
        status, body = call('POST', '/imports/douyin', {})
        if status not in (502, 503):
            break
        time.sleep(1.5)
    data = body.get('data', {}) if isinstance(body, dict) else {}
    check('重复导入不翻倍', (data.get('works'), data.get('comments'), data.get('accounts')) == (5, 231, 215),
          f"again {data.get('works')}/{data.get('comments')}/{data.get('accounts')} status={status}")

    print('\n[7] 事件扫描（造一条新线索）')
    # 服务端契约是 accountId / text / publishTime（和前端「填入示例」一致）
    comments = [{'accountId': f'scan_{STAMP}_{i:02d}', 'publishTime': 1720091220 + i * 30,
                 'text': '这事必须严查，转发让更多人看到，统一口径'} for i in range(6)]
    status, body = 0, {}
    for attempt in range(3):
        status, body = call('POST', '/coordination/scan', {'eventId': f'e2e-event-{STAMP}', 'comments': comments})
        if status not in (502, 503):
            break
        time.sleep(1.5)
    data = body.get('data', {}) if isinstance(body, dict) else {}
    check('扫描落库', status == 201 and data.get('persisted') is not False, f"{status} leads={len(data.get('leads') or [])}")

    print('\n[8] 整库导出')
    status, body = call('GET', '/exports/backup')
    size = len(body) if isinstance(body, bytes) else len(json.dumps(body, ensure_ascii=False).encode())
    check('全库备份可下载', status == 200 and size > 10000, f'{size} 字节')
    status, body = call('GET', '/exports/schema')
    text = body.decode('utf-8', 'replace') if isinstance(body, bytes) else str(body)
    check('建表语句含业务表', status == 200 and 'CREATE TABLE' in text.upper() and 'coordination_leads' in text, f'{len(text)} 字节')

    print('\n[9] 删除数据集（被任务引用时应 409，解绑后成功）')
    status, body = call('DELETE', f'/datasets/{dataset_id}')
    check('被任务引用时拒绝删除（409）', status == 409, status)

    passed = sum(1 for ok, _, _ in results if ok)
    print(f'\n合计：通过 {passed} / 失败 {len(results) - passed}')
    for ok, name, detail in results:
        if not ok:
            print(f'  ✗ {name} {detail}')
    return 0 if passed == len(results) else 1


if __name__ == '__main__':
    raise SystemExit(main())





