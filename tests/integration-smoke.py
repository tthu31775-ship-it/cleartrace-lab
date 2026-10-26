#!/usr/bin/env python3
"""Repeatable ClearTrace API regression against a running loopback preview only.
Creates an isolated QA dataset and tasks in the LOCAL preview database.
Run: python tests/integration-smoke.py --url http://127.0.0.1:4173
No production endpoints, credentials, or authentication bypasses are accepted.
"""
from __future__ import annotations
import argparse
import csv
import io
import json
from datetime import datetime, timezone
from pathlib import Path
from urllib import request, error, parse
import uuid

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--url', default='http://127.0.0.1:4173')
parser.add_argument('--report', default='.sites-runtime/integration-smoke.json')
args = parser.parse_args()
base = args.url.rstrip('/')
parts = parse.urlsplit(base)
if parts.scheme != 'http' or parts.hostname not in {'127.0.0.1', 'localhost', '::1'} or parts.path or parts.query or parts.fragment or parts.username:
    raise SystemExit('Refusing non-loopback URL; this test mutates only the local preview.')
opener = request.build_opener(request.ProxyHandler({}))
prefix = 'QA-' + datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S') + '-' + uuid.uuid4().hex[:6]
checks = []

def record(name: str, detail: str):
    checks.append({'name': name, 'status': 'passed', 'detail': detail})
    print('PASS ' + name + ': ' + detail, flush=True)

def api(path: str, method='GET', payload=None, expect=200, raw=False):
    data = None if payload is None else json.dumps(payload, ensure_ascii=False).encode()
    headers = {'Accept': 'application/json', 'Origin': base}
    if data is not None:
        headers['Content-Type'] = 'application/json'
    req = request.Request(base + '/api/v1/' + path, data=data, headers=headers, method=method)
    try:
        with opener.open(req, timeout=35) as response:
            status, body = response.status, response.read().decode('utf-8-sig')
    except error.HTTPError as exc:
        status, body = exc.code, exc.read().decode('utf-8-sig')
    if status != expect:
        raise AssertionError(f'{method} {path}: expected HTTP {expect}, got {status}: {body[:800]}')
    if raw:
        return body
    decoded = json.loads(body)
    return decoded.get('data', decoded)

def counts():
    data=api('bootstrap')
    return data['stats']['totalDatasets'],data['stats']['totalAccounts']

report = {'startedAt': datetime.now(timezone.utc).isoformat(), 'target': base, 'scope': 'Local preview only; synthetic test records; development identity. No production auth assertions.', 'prefix': prefix, 'checks': checks}
try:
    health=api('health')
    assert health['status']=='ok' and health['database']=='connected'
    record('Database health', 'Preview API confirms D1 connection.')
    before=counts()
    aid=prefix+'-A'; bid=prefix+'-B'
    source=[
        {'account_id':aid,'display_name':prefix+' candidate','platform':'local-synthetic','posts_count':2000,'followers_count':10,'following_count':1200,'account_age_days':50,'duplicate_ratio':.85,'burst_ratio':.85,'night_ratio':.5,'avg_interval_seconds':20,'related_ids':[bid],'textSamples':['纯合成测试文本 A','重复文本示例']},
        {'account_id':bid,'display_name':'=1+1','platform':'local-synthetic','posts_count':50,'followers_count':200,'following_count':100,'account_age_days':300,'duplicate_ratio':.03,'burst_ratio':.05,'night_ratio':.1,'avg_interval_seconds':500,'related_ids':[aid],'text_samples':['纯合成测试文本 B']},
    ]
    body={'name':prefix,'source':'local integration regression','format':'json','content':json.dumps(source+[source[0]],ensure_ascii=False),'dryRun':True}
    result=api('datasets/import','POST',body)
    assert result['valid'] and result['accepted']==2 and result['duplicateCount']==1
    assert counts()==before
    record('Dry-run isolation', '3 input rows, 2 unique accounts, 1 duplicate; no database count changes.')
    invalid={**body,'dryRun':False,'content':json.dumps([{'account_id':'invalid','duplicate_ratio':2.5}])}
    failure=api('datasets/import','POST',invalid,expect=400)
    assert failure['error']['code']=='import_validation_failed'
    assert counts()==before
    record('Invalid formal import', 'HTTP 400 with no inserted dataset or account.')
    badtext={**body,'content':json.dumps([{'account_id':'invalid','textSamples':[7]}])}
    result=api('datasets/import','POST',badtext)
    assert result['valid'] is False and len(result['errors'])==1
    assert counts()==before
    record('Malformed text validation', 'Non-string text sample rejected before persistence.')
    result=api('datasets/import','POST',{**body,'dryRun':False},expect=201)
    dataset_id=result['dataset']['id']; report['datasetId']=dataset_id
    assert counts()==(before[0]+1,before[1]+2)
    imported=api('datasets/'+dataset_id)
    by_id={a['accountId']:a for a in imported['accounts']}
    assert len(by_id)==2 and by_id[aid]['textSamples']==source[0]['textSamples']
    assert by_id[aid]['relatedIds']==[bid]
    account_id=by_id[aid]['id']; report['accountId']=account_id
    record('Import persistence', '2 unique accounts persisted with relatedIds and original textSamples.')

    def create_task(suffix,threshold=65):
        return api('tasks','POST',{'name':prefix+' '+suffix,'datasetId':dataset_id,'modelId':'baseline-v1','threshold':threshold},expect=201)

    task=create_task('baseline');task_id=task['id'];report['taskId']=task_id
    assert task['status']=='queued' and task['processed']==0
    complete=api('tasks/'+task_id+'/run','POST',{})
    assert complete['status']=='completed' and complete['processed']==2 and complete['progress']==100
    detail=api('tasks/'+task_id)
    results={a['accountId']:a for a in detail['results']}
    assert len(results)==2 and results[aid]['riskLevel']=='high' and results[bid]['riskLevel']=='low'
    assert results[aid]['modelVersion']=='rules-1.0.0'
    record('Task execution and stored results', f"Queued task completed; processed 2 accounts; candidate score {results[aid]['riskScore']}.")
    reviewed=api('accounts/'+account_id+'/review','POST',{'status':'dismissed','note':'Local synthetic regression: deliberate review disposition.'})
    assert reviewed['reviewStatus']=='dismissed'
    detail=api('accounts/'+account_id)
    assert detail['reviews'][0]['status']=='dismissed' and detail['reviews'][0]['note'].startswith('Local synthetic')
    again=api('tasks/'+task_id+'/run','POST',{})
    assert again['attempt']==complete['attempt']
    assert api('accounts/'+account_id)['account']['reviewStatus']=='dismissed'
    assert len(api('tasks/'+task_id)['results'])==2
    record('Review and idempotent repeat', 'Review persisted; repeated completed task did not rerun or duplicate results.')
    exported=api('tasks/'+task_id+'/export',raw=True)
    exported_rows=list(csv.DictReader(io.StringIO(exported)))
    assert len(exported_rows)==2
    export_by_id={a['account_id']:a for a in exported_rows}
    assert export_by_id[bid]['display_name']=="'=1+1"
    assert export_by_id[aid]['risk_level']=='high' and export_by_id[aid]['review_status']=='dismissed'
    record('CSV export', 'Two stored results exported; formula-like name safely prefixed; review visible.')
    same=create_task('same threshold')
    api('tasks/'+same['id']+'/run','POST',{})
    assert api('accounts/'+account_id)['account']['reviewStatus']=='dismissed'
    changed=create_task('new threshold',95)
    api('tasks/'+changed['id']+'/run','POST',{})
    changed_account=api('accounts/'+account_id)['account']
    assert changed_account['riskLevel']=='medium' and changed_account['reviewStatus']=='pending'
    assert changed_account['riskScore']==results[aid]['riskScore']
    record('Review invalidation', 'Same model/threshold preserves review; changed risk bucket reopens review without changing raw score.')
    failure=api('tasks','POST',{'name':prefix+' external','datasetId':dataset_id,'modelId':'external','threshold':65},expect=503)
    assert failure['error']['code']=='model_not_configured'
    record('Unconfigured external model', 'HTTP 503; no fabricated fallback results.')
    cancelled=create_task('cancelled')
    assert api('tasks/'+cancelled['id']+'/cancel','POST',{})['status']=='cancelled'
    assert api('tasks/'+cancelled['id']+'/run','POST',{},expect=409)['error']['code']=='task_locked'
    api('tasks/'+cancelled['id']+'/export',expect=409)
    record('Cancelled task enforcement', 'Cancelled task cannot execute or export incomplete results.')
    graph=api('graph?'+parse.urlencode({'datasetId':dataset_id,'limit':60}))
    node_ids={n['id'] for n in graph['nodes']}
    assert len(node_ids)==2 and len(graph['edges'])==1
    assert all(e['source'] in node_ids and e['target'] in node_ids for e in graph['edges'])
    assert graph['totalNodes']==2 and graph['truncated'] is False
    record('Graph consistency', 'Only imported relation appears; both edge endpoints are existing nodes.')
    logs=api('logs');actions={r['action'] for r in logs if prefix in r['target']}
    assert {'导入数据集','创建摸排任务','执行摸排任务','账号人工复核','取消摸排任务'}<=actions
    record('Audit coverage', 'Import, task creation/execution/cancellation and human review all recorded.')
    api('tasks/'+task_id+'/run/extra','POST',{},expect=404)
    record('Exact action routes', 'Unexpected trailing action path returns HTTP 404.')
    report['status']='passed'
except Exception as exc:
    report['status']='failed';report['failure']=str(exc)
    raise
finally:
    report['completedAt']=datetime.now(timezone.utc).isoformat()
    out=Path(args.report);out.parent.mkdir(parents=True,exist_ok=True);out.write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    print('Report: '+str(out),flush=True)
