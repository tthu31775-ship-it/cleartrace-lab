# -*- coding: utf-8 -*-
"""把 audit-ui.py 的 JSON 结果整理成给老师看的 Markdown 报告。

用法：
    python scripts/audit-report.py ui-audit-local.json docs/handoff/BUTTON_AUDIT.md --instance "本地 :3000（真实数据）"
"""
from __future__ import annotations

import argparse
import json
from collections import OrderedDict, defaultdict
from pathlib import Path

PAGE_LABELS = OrderedDict([
    ('overview', '总览工作台'),
    ('leads', '协同线索'),
    ('screening', '评论检测'),
    ('scan', '事件扫描'),
    ('tasks', '摸排任务'),
    ('datasets', '数据集'),
    ('accounts', '账号研判'),
    ('graph', '传播图谱'),
    ('exports', '数据导出'),
    ('models', '模型接入'),
    ('integrations', '接口与协议'),
    ('logs', '操作日志'),
    ('team', '项目协作'),
])

SIGNAL_LABELS = [
    ('hash', '切换页面'),
    ('modal', '打开弹层'),
    ('toast', '提示条'),
    ('request', '发出接口请求'),
    ('download', '触发下载'),
    ('dom', '页面文本变化'),
    ('svg', '图谱变换'),
    ('popup', '新开窗口'),
    ('clipboard', '写入剪贴板'),
    ('active', '选中态切换'),
    ('error', '接口报错'),
]

STATE_LABELS = {
    'ok': '有反应',
    'no-op': '**无反应**',
    'click-failed': '**点不到**',
    'http-error': '接口报错',
}


def signals(row: dict) -> str:
    reacted = row.get('reacted') or {}
    if reacted.get('disabled'):
        return '按设计禁用'
    hits = [label for key, label in SIGNAL_LABELS if reacted.get(key)]
    return ' / '.join(hits) if hits else '—'


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('source')
    parser.add_argument('output')
    parser.add_argument('--instance', default='本地实例')
    args = parser.parse_args()

    payload = json.loads(Path(args.source).read_text(encoding='utf-8'))
    report = payload.get('report', [])

    # 同一元素可能既有主判定又有 http-error 记录，按 (page,index) 合并
    merged: dict[tuple, dict] = {}
    for row in report:
        key = (row.get('page'), row.get('index'))
        if key not in merged or row['state'] == 'http-error':
            merged[key] = row

    by_page: dict[str, list[dict]] = defaultdict(list)
    for row in merged.values():
        by_page[row.get('page')].append(row)

    total = len(merged)
    ok = sum(1 for row in merged.values() if row['state'] == 'ok')
    dead = [row for row in merged.values() if row['state'] == 'no-op']
    failed = [row for row in merged.values() if row['state'] == 'click-failed']
    http_errors = [row for row in merged.values() if row['state'] == 'http-error']
    disabled = sum(1 for row in merged.values() if (row.get('reacted') or {}).get('disabled'))

    lines: list[str] = []
    lines.append('# 按钮审计报告')
    lines.append('')
    lines.append(f'> 实例：{args.instance}')
    lines.append(f'> 采集时间：{payload.get("finishedAt", "—")}')
    lines.append(f'> 生成方式：`python scripts/audit-ui.py <地址> ui-audit.json` → '
                 f'`python scripts/audit-report.py ui-audit.json docs/handoff/BUTTON_AUDIT.md`')
    lines.append('')
    lines.append('## 0. 结论')
    lines.append('')
    lines.append('| 指标 | 数量 |')
    lines.append('| --- | --- |')
    lines.append(f'| 可点元素合计 | {total} |')
    lines.append(f'| 有反应 | {ok} |')
    lines.append(f'| 按设计禁用（带说明） | {disabled} |')
    lines.append(f'| **无反应** | {len(dead)} |')
    lines.append(f'| **点不到** | {len(failed)} |')
    lines.append(f'| 接口报错 | {len(http_errors)} |')
    lines.append('')
    if not dead and not failed:
        lines.append('**判定：全部可点元素都有反应，没有"只在前端演一遍"的死按钮。**')
    else:
        lines.append('**判定：存在需要处理的元素，清单见第 3 节。**')
    lines.append('')
    lines.append('判定标准（任一成立即算有反应）：切换页面 / 打开弹层 / 提示条 / 发出接口请求 / '
                 '触发下载 / 页面文本变化 / 图谱变换 / 新开窗口。')
    lines.append('')

    lines.append('## 1. 分页汇总')
    lines.append('')
    lines.append('| 页面 | 元素数 | 有反应 | 禁用 | 无反应 | 点不到 |')
    lines.append('| --- | --- | --- | --- | --- | --- |')
    for page_id, label in PAGE_LABELS.items():
        rows = by_page.get(page_id, [])
        if not rows:
            continue
        page_ok = sum(1 for row in rows if row['state'] == 'ok')
        page_disabled = sum(1 for row in rows if (row.get('reacted') or {}).get('disabled'))
        page_dead = sum(1 for row in rows if row['state'] == 'no-op')
        page_failed = sum(1 for row in rows if row['state'] == 'click-failed')
        lines.append(f'| {label} | {len(rows)} | {page_ok} | {page_disabled} | {page_dead} | {page_failed} |')
    lines.append('')

    lines.append('## 2. 逐元素明细')
    lines.append('')
    for page_id, label in PAGE_LABELS.items():
        rows = sorted(by_page.get(page_id, []), key=lambda row: row.get('index', 0))
        if not rows:
            continue
        lines.append(f'### {label}')
        lines.append('')
        lines.append('| # | 元素 | 判定 | 触发到的信号 |')
        lines.append('| --- | --- | --- | --- |')
        for row in rows:
            name = (row.get('name') or '').replace('|', '\\|')[:40] or '(无文字)'
            state = STATE_LABELS.get(row['state'], row['state'])
            if row.get('isolated'):
                state += '（单独复核）'
            lines.append(f"| {row.get('index', '')} | {name} | {state} | {signals(row)} |")
        lines.append('')

    if dead or failed or http_errors:
        lines.append('## 3. 需要处理的元素')
        lines.append('')
        for row in dead:
            lines.append(f"- [无反应] {row.get('page')} 第 {row.get('index')} 个：{row.get('name')}")
        for row in failed:
            lines.append(f"- [点不到] {row.get('page')} 第 {row.get('index')} 个：{row.get('name')} —— {row.get('detail','')}")
        for row in http_errors:
            lines.append(f"- [接口报错] {row.get('page')} 第 {row.get('index')} 个：{row.get('name')} —— {row.get('detail','')}")
        lines.append('')

    lines.append('## 4. 判定口径的说明')
    lines.append('')
    lines.append('| 元素类型 | 为什么算"有反应" |')
    lines.append('| --- | --- |')
    lines.append('| 导航类（指标卡、去复核、查看接入文档） | URL hash 变化 |')
    lines.append('| 弹层类（查看、研判、新建任务） | 出现 `.modal/.drawer` |')
    lines.append('| 写库类（复核、创建令牌、导入） | 发出 `/api/v1` 请求且出现提示条 |')
    lines.append('| 下载类（导出、CSV/JSON） | Playwright 的 `download` 事件 |')
    lines.append('| 纯前端（图谱缩放、重置、区间切换） | 页面文本或 SVG 变换 |')
    lines.append('| 按设计禁用（图谱重置在初始视图、未就绪能力） | `disabled` 为真即算通过，但要求有 tooltip 说明 |')
    lines.append('')

    out = Path(args.output)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text('\n'.join(lines), encoding='utf-8')
    print(f'报告写入 {out}：{total} 个元素，无反应 {len(dead)}，点不到 {len(failed)}')
    return 0 if not dead and not failed else 1


if __name__ == '__main__':
    raise SystemExit(main())
