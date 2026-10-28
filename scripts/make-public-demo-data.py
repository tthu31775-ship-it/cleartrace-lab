# -*- coding: utf-8 -*-
"""把交付数据脱敏成可对外分发的示例包。

保留：线索数(803) / 事件数(173) / 图谱节点与边 / 时间戳 / 相似度 / 计数口径。
替换：评论正文、账号键、昵称、IP 属地、抖音作品 ID 与链接。

用法：
    python scripts/make-public-demo-data.py                 # 原地改写 lib/data/*.json
    python scripts/make-public-demo-data.py --out DIR       # 写到 DIR（不改原文件）
    python scripts/make-public-demo-data.py --check         # 只报告会改多少字段

映射是确定性的：同一个原值在三个文件里映射成同一个假名，前后对照不会错位。
"""
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

DATA_FILES = ('coordination.json', 'graphs.json', 'douyin-sample.json')

TEXT_FIELDS = {'text', 'content'}
ID_FIELDS = {'uid', 'accountId'}
NICK_FIELDS = {'nickname', 'representative'}
REGION_FIELDS = {'ipRegion'}
WORK_ID_FIELDS = {'workId'}
URL_FIELDS = {'url'}

# 图谱 group.representative 是节点 id（如 g38n0），不是昵称，不能动
NODE_ID = re.compile(r'^g\d+n\d+$')

stats = {name: 0 for name in ('text', 'id', 'nick', 'region', 'work', 'url')}
_pools: dict[str, dict[str, str]] = {name: {} for name in ('text', 'id', 'nick', 'work')}


def _fake(kind: str, value: str, prefix: str) -> str:
    pool = _pools[kind]
    if value not in pool:
        pool[value] = f'{prefix}{len(pool) + 1:05d}'
    return pool[value]


def _fake_work_id(original: str) -> str:
    """作品 ID 必须保持「works.workId == comments.workId == url 里的 ID」这层引用关系，
    否则导入时外键约束直接失败（第一版就是这么挂的），所以走稳定映射而不是逐个编号。"""
    pool = _pools['work']
    if original not in pool:
        pool[original] = f'7{len(pool) + 1:018d}'
    return pool[original]


def _mask_field(field: str, value):
    if not isinstance(value, str) or not value:
        return value
    if field in TEXT_FIELDS:
        stats['text'] += 1
        return f'［示例评论］{_fake("text", value, "示例文本")}'
    if field in ID_FIELDS:
        stats['id'] += 1
        return _fake('id', value, 'demo_account_')
    if field in NICK_FIELDS:
        if NODE_ID.match(value):
            return value
        stats['nick'] += 1
        return _fake('nick', value, '示例用户')
    if field in REGION_FIELDS:
        stats['region'] += 1
        return '示例属地'
    if field in WORK_ID_FIELDS:
        stats['work'] += 1
        return _fake_work_id(value)
    if field in URL_FIELDS and 'douyin.com' in value:
        stats['url'] += 1
        match = re.search(r'video/(\d+)', value)
        if match:
            return 'https://www.douyin.com/video/' + _fake_work_id(match.group(1))
        return 'https://www.douyin.com/video/0000000000000000000'
    return value


def walk(obj):
    if isinstance(obj, dict):
        return {key: _mask_field(key, walk(value)) if key in (
            TEXT_FIELDS | ID_FIELDS | NICK_FIELDS | REGION_FIELDS | WORK_ID_FIELDS | URL_FIELDS
        ) else walk(value) for key, value in obj.items()}
    if isinstance(obj, list):
        return [walk(item) for item in obj]
    return obj


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('--data-dir', default='lib/data', help='原始数据目录，默认 lib/data')
    parser.add_argument('--out', default='', help='输出目录；留空表示原地改写')
    parser.add_argument('--check', action='store_true', help='只统计不写文件')
    args = parser.parse_args()

    src = Path(args.data_dir)
    out = Path(args.out) if args.out else src
    out.mkdir(parents=True, exist_ok=True)

    for name in DATA_FILES:
        path = src / name
        payload = json.loads(path.read_text(encoding='utf-8'))
        masked = walk(payload)
        if not args.check:
            target = out / name
            target.write_text(json.dumps(masked, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
        print(f'{name:20} 处理完成')

    print('\n替换字段计数：')
    for key, value in stats.items():
        print(f'  {key:8} {value}')
    print(f'\n唯一假名：文本 {len(_pools["text"])} / 账号键 {len(_pools["id"])} / '
          f'昵称 {len(_pools["nick"])} / 作品 {len(_pools["work"])}')

    # 引用完整性：抖音评论的作品 ID 必须仍能对上 works 里的一行
    douyin = json.loads((out / 'douyin-sample.json').read_text(encoding='utf-8'))
    work_ids = {w['workId'] for w in douyin['works']}
    orphan = [c for c in douyin['comments'] if c['workId'] not in work_ids]
    print(f'  引用自检 抖音评论->作品：{len(douyin["comments"]) - len(orphan)} 条对得上，孤儿 {len(orphan)} 条')
    if orphan:
        return 1

    # 结构自检：条数必须与原文一致，否则说明脱敏走错了
    if not args.check:
        pairs = [
            ('coordination.json', lambda d: (len(d['leads']), len(d['events']))),
            ('graphs.json', lambda d: len(d)),
            ('douyin-sample.json', lambda d: (len(d['works']), len(d['comments']), len(d['accounts']))),
        ]
        for name, counter in pairs:
            before = counter(json.loads((src / name).read_text(encoding='utf-8')))
            after = counter(json.loads((out / name).read_text(encoding='utf-8')))
            flag = 'OK' if before == after else '不一致'
            print(f'  结构自检 {name:20} {before} -> {after} {flag}')
            if before != after:
                return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
