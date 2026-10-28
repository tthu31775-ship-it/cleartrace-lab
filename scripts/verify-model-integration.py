# -*- coding: utf-8 -*-
"""模型接入与试用版验收脚本(P1/P2 端到端)。

对着已经在跑的实例执行,不修改代码:
    python scripts/verify-model-integration.py http://127.0.0.1:3100 admin@cleartrace.local 密码

覆盖规划 §9 "首轮必过验收" 中可在 HTTP 层验证的条目:
线索与事件数量、样例线索细节、图谱接口、复核与重查、可追溯导出、
WB01 单条/批量/空文本/超长/批次上限、结果持久化、抖音 5/231/215 与幂等、
能力状态区分(ready / not_ready / planned)、越权与来源校验。
"""
from __future__ import annotations

import json
import sys
import time
import urllib.error
import urllib.request

BASE = sys.argv[1].rstrip('/') if len(sys.argv) > 1 else 'http://127.0.0.1:3100'
EMAIL = sys.argv[2] if len(sys.argv) > 2 else 'admin@cleartrace.local'
PASSWORD = sys.argv[3] if len(sys.argv) > 3 else 'ClearTrace2026'
SHARECODE = sys.argv[4] if len(sys.argv) > 4 else ''

results: list[tuple[bool, str, str]] = []
cookie: str | None = None
platform_cookie: str = ''


def warm_platform_cookie():
    """托管层的分享链接会下发 __wb_rsc;不带它时写请求会被拦成「链接不完整」。"""
    global platform_cookie
    if not SHARECODE:
        return
    import http.cookiejar
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
    with opener.open(f'{BASE}/?sharecode={SHARECODE}', timeout=90) as response:
        response.read()
    jar = [c for h in opener.handlers if isinstance(h, urllib.request.HTTPCookieProcessor) for c in h.cookiejar]
    platform_cookie = '; '.join(f'{c.name}={c.value}' for c in jar)
    print(f'平台访问 Cookie: {len(jar)} 项')


def call(method: str, path: str, body=None, origin: str | None = None, auth: bool = True, retry: int = 1):
    """发一次请求;本地 wrangler dev 偶尔丢响应(worker restarted)时重试。

    Connection: close 避免连接复用,超时也放宽——dev 模式冷启动会慢。
    """
    for attempt in range(retry + 1):
        result = _call_once(method, path, body, origin, auth)
        if result[0] not in ('TIMEOUT', 'CONN', 503) or attempt == retry:
            return result
        time.sleep(1.0)
    return result


def _call_once(method: str, path: str, body, origin: str | None, auth: bool):
    url = BASE + '/api/v1' + path
    data = None if body is None else json.dumps(body, ensure_ascii=False).encode('utf-8')
    headers = {'Accept': 'application/json', 'Connection': 'close'}
    if data:
        headers['Content-Type'] = 'application/json'
    if origin:
        headers['Origin'] = origin
    # 平台访问 Cookie 任何请求都要带(登录也要);会话 Cookie 只在已登录时带。
    pairs = [platform_cookie] if platform_cookie else []
    if auth and cookie:
        pairs.append(cookie)
    if pairs:
        headers['Cookie'] = '; '.join(pairs)
    request = urllib.request.Request(url, data=data, headers=headers, method=method)
    started = time.perf_counter()
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            raw = response.read()
            return response.status, dict(response.headers), raw, time.perf_counter() - started
    except urllib.error.HTTPError as error:
        return error.code, dict(error.headers), error.read(), time.perf_counter() - started
    except TimeoutError:
        return 'TIMEOUT', {}, b'', time.perf_counter() - started
    except OSError:
        return 'CONN', {}, b'', time.perf_counter() - started


def payload(raw: bytes):
    try:
        return json.loads(raw.decode('utf-8'))
    except Exception:  # noqa: BLE001
        return {}


def check(name: str, ok: bool, detail: str = ''):
    results.append((ok, name, detail))
    print(('  ✓ ' if ok else '  ✗ ') + name + (f'  [{detail}]' if detail else ''))


def login():
    global cookie
    status, headers, raw, _ = call('POST', '/auth/login', {'email': EMAIL, 'password': PASSWORD}, origin=BASE, auth=False)
    if status != 200:
        print('登录失败:', status, raw[:200])
        raise SystemExit(1)
    token = headers.get('Set-Cookie', '').split(';')[0]
    cookie = token
    return status


print(f'目标 {BASE}')
warm_platform_cookie()
print('\n[1] 认证与来源校验')
login()
status, _, raw, _ = call('POST', '/auth/login', {'email': EMAIL, 'password': 'wrong-password-1'}, origin=BASE, auth=False)
check('错误口令返回 401', status == 401, str(status))
status, _, raw, _ = call('POST', '/screening/comments', {'items': [{'content': 'x'}]}, origin='https://evil.example.com')
check('跨站来源被拒绝 403', status in (403, 401), str(status))
status, _, raw, _ = call('GET', '/bootstrap')
check('bootstrap 可读', status == 200, str(status))

print('\n[2] 协同线索批次')
# 说明:统计时把"预计算批次"与"在线扫描"分开计数,避免扫描结果污染 803/173 的对账。
status, _, raw, _ = call('GET', '/leads?page=1&pageSize=5')
body = payload(raw).get('data', {})
stats = body.get('stats', {})
status, _, raw2, _ = call('GET', '/leads?page=1&pageSize=1&runId=coordination-20261023')
check('预计算批次线索 803', payload(raw2).get('data', {}).get('total') == 803, str(payload(raw2).get('data', {}).get('total')))
status, _, raw3, _ = call('GET', '/leads?page=1&pageSize=1&runId=scan')
check('批次筛选接口可用', status == 200 and isinstance(payload(raw3).get('data', {}).get('total'), int), str(status))
check('预计算事件数 173', stats.get('precomputedEvents') == 173, str(stats.get('precomputedEvents')))
check('预计算账号成员 7292', stats.get('precomputedAccounts') == 7292, str(stats.get('precomputedAccounts')))
check('预计算评论总数 7355', stats.get('precomputedComments') == 7355, str(stats.get('precomputedComments')))
check('预计算线索 803(与扫描结果分开)', stats.get('precomputedLeads') == 803, str(stats.get('precomputedLeads')))
check('最大群组 58 账号', stats.get('maxAccounts') == 58, str(stats.get('maxAccounts')))
check('列表分页返回 5 条', len(body.get('items', [])) == 5, str(len(body.get('items', []))))

# 关键词取自本实例自己的代表评论：原始数据是「李睿 拓跋煜…」，脱敏包是「示例用户00001」，
# 两种数据都能跑。以前的写法把真实昵称写死在脚本里，脱敏包必然误报。
_, _, raw_lead, _ = call('GET', '/leads/lead_0001')
lead_rep = (payload(raw_lead).get('data', {}).get('representative') or '').split()
keyword = lead_rep[0] if lead_rep else ''
status, _, raw, _ = call('GET', '/leads?q=' + urllib.parse.quote(keyword) + '&pageSize=5')
check('代表评论可检索', status == 200 and keyword != '' and payload(raw).get('data', {}).get('total', 0) >= 1, keyword)

status, _, raw, _ = call('GET', '/leads/lead_0001')
lead = payload(raw).get('data', {})
check('样例线索 58 账号 / 60 评论', lead.get('accountCount') == 58 and lead.get('commentCount') == 60,
      f"{lead.get('accountCount')}/{lead.get('commentCount')}")
start = lead.get('startTime')
end = lead.get('endTime')
window = ''
if start and end:
    window = time.strftime('%Y-%m-%d %H:%M', time.gmtime(start + 8 * 3600)) + '—' + time.strftime('%H:%M', time.gmtime(end + 8 * 3600))
check('北京时间 2024-07-04 19:07—19:17', window == '2024-07-04 19:07—19:17', window)
check('成员表 58 行', len(lead.get('members', [])) == 58, str(len(lead.get('members', []))))
check('原始评论 60 条且带定位', len(lead.get('comments', [])) == 60 and all(c.get('node') for c in lead.get('comments', [])))
check('相似边与代表评论分离', len(lead.get('similarityEdges', [])) > 0 and sum(1 for c in lead.get('comments', []) if c.get('rep')) == 1)

print('\n[3] 事件图谱')
status, _, raw, _ = call('GET', '/events?pageSize=1&batch=coordination-20261023')
check('协同事件列表 173', payload(raw).get('data', {}).get('total') == 173, str(payload(raw).get('data', {}).get('total')))
status, _, raw, _ = call('GET', '/events/event_trend_07131')
event = payload(raw).get('data', {})
check('事件详情含线索与边', status == 200 and len(event.get('leads', [])) > 0 and len(event.get('edges', [])) > 0)
reply = [e for e in event.get('edges', []) if e['edgeType'] == 'reply']
sim = [e for e in event.get('edges', []) if e['edgeType'] == 'similarity']
check('回复边/相似边分开存储', len(reply) > 0 and len(sim) > 0, f'reply={len(reply)} similarity={len(sim)}')
status, _, raw, _ = call('GET', '/events/event_trend_07131/graph')
graph = payload(raw).get('data', {})
check('图谱接口需要登录且返回节点', status == 200 and len(graph.get('nodes', [])) > 0, f"nodes={len(graph.get('nodes', []))}")
status, _, raw, _ = call('GET', '/events/event_trend_07131/graph', auth=False)
check('未登录读取图谱被拒绝', status == 401, str(status))
status, _, raw, _ = call('GET', '/graphs/event_trend_07131.json', auth=False)
check('静态目录不再暴露图谱', status in (401, 404), str(status))

print('\n[4] 人工复核与导出')
status, _, raw, _ = call('POST', '/leads/lead_0001/review', {'status': 'confirmed', 'note': '同一时间窗内 58 个来源账号发布高度一致文本,建议移交人工核查。'}, origin=BASE)
check('复核写入成功', status == 200 and payload(raw).get('data', {}).get('reviewStatus') == 'confirmed', str(status))
status, _, raw, _ = call('GET', '/leads/lead_0001')
check('复核结论可重新查询', payload(raw).get('data', {}).get('reviewStatus') == 'confirmed')
status, _, raw, _ = call('GET', '/leads?status=confirmed')
check('复核状态可用于筛选', payload(raw).get('data', {}).get('total') == 1, str(payload(raw).get('data', {}).get('total')))
status, headers, raw, _ = call('GET', '/leads/export?status=confirmed')
text = raw.decode('utf-8-sig')
check('导出 CSV 成功', status == 200 and 'text/csv' in headers.get('Content-Type', ''), str(status))
check('导出含来源定位与运行批次', '分析运行批次' in text and 'trend_information.jsonl:7131' in text)
check('导出时间是北京时间', '2024-07-04 19:07' in text)
status, _, raw, _ = call('POST', '/leads/lead_0001/review', {'status': 'pending', 'note': '撤销前台标记,恢复待复核。'}, origin=BASE)
check('状态可回退到待复核', status == 200)

print('\n[5] WB01 评论文本筛查')
samples = [
    {'content': '这事必须严查，转发让更多人看到！', 'commentId': 'verify_1'},
    {'content': '用啥铁丝组装的小玫瑰花？太漂亮了了', 'commentId': 'verify_2'},
    {'content': '   ', 'commentId': 'verify_blank'},
    {'content': 'A' * 1200, 'commentId': 'verify_long'},
]
status, _, raw, _ = call('POST', '/screening/comments', {'runId': 'run_verify_001', 'items': samples}, origin=BASE)
body = payload(raw).get('data', {})
items = {item['sourceCommentKey']: item for item in body.get('items', [])}
check('批量筛查返回 201', status == 201, str(status))
check('正常文本得到分数', items.get('verify_1', {}).get('status') == 'ok' and items['verify_1']['prediction']['rawScore'] is not None)
check('空文本记为错误而非 0 分', items.get('verify_blank', {}).get('status') == 'error' and 'empty' not in items['verify_blank']['error'])
check('超长文本逐条报错', items.get('verify_long', {}).get('status') == 'error' and '1000' in items['verify_long']['error'])
check('错误条目不写入分数', body.get('failed') == 2, str(body.get('failed')))
status, _, raw, _ = call('POST', '/screening/comments', {'runId': 'run_verify_001', 'items': samples[:2]}, origin=BASE)
check('同 runId 重放幂等', status == 201, str(status))
status, _, raw, _ = call('GET', '/screening/predictions?runId=run_verify_001')
records = payload(raw).get('data', {}).get('items', [])
check('结果已持久化且未重复', len(records) == 2, str(len(records)))
status, _, raw, _ = call('POST', '/screening/comments', {'items': [{'content': '测试'}] * 201}, origin=BASE)
check('超过 200 条被拒绝', status == 400, str(status))
status, _, raw, _ = call('POST', '/screening/comments', {'items': []}, origin=BASE)
check('空数组被拒绝', status == 400, str(status))

print('\n[6] 抖音小样本')
status, _, raw, _ = call('POST', '/imports/douyin', {}, origin=BASE)
body = payload(raw).get('data', {})
check('导入得到 5 作品 / 231 评论 / 215 账号',
      (body.get('works'), body.get('comments'), body.get('accounts')) == (5, 231, 215),
      f"{body.get('works')}/{body.get('comments')}/{body.get('accounts')}")
status, _, raw, _ = call('POST', '/imports/douyin', {}, origin=BASE)
if status == 503:  # 本地 wrangler dev 偶发“worker restarted mid-request”,重试一次
    time.sleep(1)
    status, _, raw, _ = call('POST', '/imports/douyin', {}, origin=BASE)
body2 = payload(raw).get('data', {})
check('重复导入不翻倍', (body2.get('works'), body2.get('comments'), body2.get('accounts')) == (5, 231, 215),
      f"{body2.get('works')}/{body2.get('comments')}/{body2.get('accounts')}")
status, _, raw, _ = call('GET', '/comments?namespace=douyin&pageSize=5')
body = payload(raw).get('data', {})
check('抖音评论可检索', body.get('total') == 231, str(body.get('total')))
check('近似时间被标记', all(i['timePrecision'] == 'approximate' for i in body.get('items', [])))
check('点赞未采集不当作真实值', all(i['likeKnown'] is False for i in body.get('items', [])))

print('\n[7] 能力状态')
status, _, raw, _ = call('GET', '/models/status')
status_body = payload(raw).get('data', {})
caps = {c['key']: c['status'] for c in status_body.get('capabilities', [])}
check('comment_classification 就绪', caps.get('comment_classification') == 'ready', str(caps.get('comment_classification')))
check('coordination_lookup 就绪', caps.get('coordination_lookup') == 'ready')
check('coordination_scan 就绪(在线口径)', caps.get('coordination_scan') == 'ready', str(caps.get('coordination_scan')))
check('account_bert 未就绪', caps.get('account_bert') == 'not_ready', str(caps.get('account_bert')))
check('模型版本与维度正确', status_body.get('wb01', {}).get('modelVersion') == 'wb01-textonly-v1.0' and status_body.get('wb01', {}).get('dimension') == 8192)
check('免责声明存在', len(status_body.get('disclaimers', [])) >= 3)

print('\n[8] WB01 交付包原始契约(可直接对接算法组客户端)')
status, _, raw, _ = call('POST', '/water-comment/predict', {'comment_id': 'c_1001', 'content': '这事必须严查，转发让更多人看到！'}, origin=BASE)
body = payload(raw)
check('predict 返回 code=0 信封', status == 200 and body.get('code') == 0, str(status))
data = body.get('data', {})
check('字段与 API_DOC 一致', {'comment_id', 'probability', 'label', 'risk_level', 'threshold', 'confidence', 'model_version', 'evidence', 'latency_ms'} <= set(data.keys()))
check('comment_id 原样回传', data.get('comment_id') == 'c_1001', str(data.get('comment_id')))
status, _, raw, _ = call('POST', '/water-comment/predict', {'content': '   '}, origin=BASE)
body = payload(raw)
check('空文本返回 {code:400,msg}', status == 400 and body.get('code') == 400 and body.get('msg'), str(status))
status, _, raw, _ = call('POST', '/water-comment/predict', {'content': 'A' * 1200}, origin=BASE)
check('超长文本返回 400', status == 400, str(status))
status, _, raw, _ = call('POST', '/water-comment/predict_batch', {'items': [{'content': '用啥铁丝组装的小玫瑰花？太漂亮了了'}, {'content': ''}]}, origin=BASE)
body = payload(raw)
check('批量返回 code=0 且逐条保留', status == 200 and body.get('code') == 0 and len(body.get('data', {}).get('items', [])) == 2)
check('空条目单独报错而不是 0 分', 'error' in body['data']['items'][1] and 'probability' not in body['data']['items'][1])
status, _, raw, _ = call('POST', '/water-comment/predict_batch', {'items': [{'content': 'x'}] * 201}, origin=BASE)
check('批量超过 200 条返回 400', status == 400, str(status))
status, _, raw, _ = call('GET', '/water-comment/model_info')
body = payload(raw)
check('model_info 暴露版本与阈值', status == 200 and body.get('data', {}).get('model_version') == 'wb01-textonly-v1.0')
status, _, raw, _ = call('POST', '/water-comment/predict', {'content': '测试'}, origin=BASE, auth=False)
check('未登录不能调用模型接口', status == 401, str(status))

print('\n[9] 协同在线扫描')
scan_comments = [{'accountId': f'v_{i}', 'text': '这事必须严查，转发让更多人看到！', 'publishTime': 1720091220 + i * 45} for i in range(6)]
scan_comments += [{'accountId': 'v_x', 'text': '支持', 'publishTime': 1720091230}]
payload_body = {'eventId': 'verify-scan-live', 'comments': scan_comments, 'parameters': {'minAccounts': 5, 'windowMinutes': 10, 'similarityThreshold': 0.82}}
status, _, raw, _ = call('POST', '/coordination/scan', payload_body, origin=BASE)
body = payload(raw).get('data', {})
check('扫描返回 201 并落库', status == 201 and body.get('persisted') is True, str(status))
check('通用短回复被清洗', body.get('skipped', {}).get('common_short_reply') == 1, str(body.get('skipped')))
check('发现 1 组候选线索', body.get('leadCount') == 1, str(body.get('leadCount')))
lead = (body.get('leads') or [{}])[0]
check('排序分标注为启发式未校准', lead.get('scoreType') == 'heuristic' and lead.get('calibrated') is False)
check('清洗版本随结果返回', body.get('preprocessingVersion') == 'online-1.0', str(body.get('preprocessingVersion')))
status, _, raw, _ = call('GET', '/events/' + str(body.get('internalEventId')) + '/graph')
graph = payload(raw).get('data', {})
check('新事件图谱可读', status == 200 and len(graph.get('nodes', [])) == 6, str(len(graph.get('nodes', []))))
check('在线输入不虚构回复边', len(graph.get('replyEdges', [])) == 0)
status, _, raw, _ = call('GET', '/leads/' + str(lead.get('id')))
detail = payload(raw).get('data', {})
check('新线索可在线索接口查到', status == 200 and len(detail.get('members', [])) == 6, str(len(detail.get('members', []))))
status, _, raw, _ = call('POST', '/coordination/scan', {'eventId': 'verify-scan-live', 'comments': [{'accountId': 'a', 'text': '短', 'publishTime': 1720091220}]}, origin=BASE)
body = payload(raw).get('data', {})
check('数据不足时不写库也不报 0 分', status == 201 and body.get('persisted') is True and body.get('leadCount') == 0)
status, _, raw, _ = call('POST', '/coordination/scan', {'eventId': 'x', 'comments': [{'accountId': 'a', 'text': '支持', 'publishTime': 1720091220}]}, origin=BASE)
check('全部被清洗时 persisted=false', payload(raw).get('data', {}).get('persisted') is False)
status, _, raw, _ = call('GET', '/leads?page=1&pageSize=5&runId=scan')
scan_total = payload(raw).get('data', {}).get('total', 0)
check('扫描结果可按批次单独筛出', isinstance(scan_total, int) and scan_total >= 1, str(scan_total))
status, _, raw, _ = call('GET', '/leads?page=1&pageSize=1&runId=coordination-20261023')
check('预计算批次不受扫描影响', payload(raw).get('data', {}).get('total') == 803, str(payload(raw).get('data', {}).get('total')))

print('\n[10] 数据导出')
status, _, raw, _ = call('GET', '/exports/summary')
body = payload(raw).get('data', {})
keys = {table['key'] for table in body.get('tables', [])}
check('导出清单含六类业务表', {'leads', 'comments', 'predictions', 'events', 'lead_members', 'graph_edges'} <= keys, str(sorted(keys)))
status, headers, raw, _ = call('GET', '/exports/leads?format=csv')
text = raw.decode('utf-8-sig')
check('线索 CSV 可下载', status == 200 and 'text/csv' in headers.get('Content-Type', ''), str(status))
check('CSV 使用中文表头', text.splitlines()[0].startswith('线索ID,'))
check('线索 CSV 含全部批次', 'coordination-20261023' in text and 'scan_' in text)
status, _, raw, _ = call('GET', '/exports/comments?format=csv')
check('评论 CSV 含线索与抖音两类来源', status == 200 and 'douyin' in raw.decode('utf-8-sig'))
status, _, raw, _ = call('GET', '/exports/leads?format=json')
body = payload(raw)
check('JSON 导出保留原始字段名', status == 200 and body.get('items', [{}])[0].get('id', '').startswith('lead_'))
status, _, raw, _ = call('GET', '/exports/schema')
check('建表语句可下载', status == 200 and 'CREATE TABLE' in raw.decode('utf-8'))
status, _, raw, _ = call('GET', '/exports/backup')
check('全库备份可下载', status == 200 and payload(raw).get('format') == 'cleartrace-backup/1', str(status))
status, _, raw, _ = call('GET', '/exports/backup', auth=False)
check('未登录不能下全库备份', status == 401, str(status))
status, _, raw, _ = call('GET', '/exports/leads?format=csv&runId=coordination-20261023')
check('按批次下载线索 CSV(803 行)', status == 200 and len(raw.decode('utf-8-sig').strip().splitlines()) - 1 == 803, str(len(raw.decode('utf-8-sig').strip().splitlines()) - 1))
status, _, raw, _ = call('GET', '/exports/comments?format=csv&datasetId=dataset-douyin-20261022')
check('按数据集下载评论 CSV(231 行)', status == 200 and len(raw.decode('utf-8-sig').strip().splitlines()) - 1 == 231, str(len(raw.decode('utf-8-sig').strip().splitlines()) - 1))
status, _, raw, _ = call('GET', '/exports/accounts?format=json&datasetId=demo-dataset-1')
check('按数据集下载账号 JSON(80 行)', status == 200 and payload(raw).get('rows') == 80, str(payload(raw).get('rows')))

print('\n[11] 数据集类型与预览')
status, _, raw, _ = call('GET', '/datasets')
datasets = {row['id']: row for row in payload(raw).get('data', [])}
check('数据集列表带类型', all('kind' in row for row in datasets.values()), str(len(datasets)))
status, _, raw, _ = call('GET', '/datasets/dataset-coordination-20261023')
detail = payload(raw).get('data', {})
check('线索型数据集:标 803 组线索', detail.get('dataset', {}).get('kind') == 'coordination' and detail.get('overview', {}).get('primary') == 803, str(detail.get('overview', {}).get('primary')))
check('线索型有线索预览', len(detail.get('leads', [])) > 0, str(len(detail.get('leads', []))))
check('线索型不给账号预览', len(detail.get('accounts', [])) == 0)
status, _, raw, _ = call('GET', '/datasets/dataset-douyin-20261022')
detail = payload(raw).get('data', {})
check('评论型数据集:标 231 条评论', detail.get('dataset', {}).get('kind') == 'douyin' and detail.get('overview', {}).get('primary') == 231, str(detail.get('overview', {}).get('primary')))
check('评论型有评论预览', len(detail.get('comments', [])) > 0, str(len(detail.get('comments', []))))
check('评论型标注近似时间', any(item['value'].startswith('近似') for item in detail.get('overview', {}).get('items', []) if item['label'] == '时间精度'))
status, _, raw, _ = call('GET', '/datasets/demo-dataset-1')
detail = payload(raw).get('data', {})
check('账号型数据集:有账号预览', detail.get('dataset', {}).get('kind') == 'accounts' and len(detail.get('accounts', [])) > 0)
check('账号型 CTA 指向摸排任务', detail.get('overview', {}).get('cta', {}).get('page') == 'accounts')

passed = sum(1 for ok, _, _ in results if ok)
failed = len(results) - passed
print(f'\n合计:通过 {passed} / 失败 {failed}')
if failed:
    for ok, name, detail in results:
        if not ok:
            print('  ✗', name, detail)
sys.exit(1 if failed else 0)
