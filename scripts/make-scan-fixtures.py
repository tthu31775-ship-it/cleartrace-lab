# -*- coding: utf-8 -*-
"""生成协同扫描 TS 实现的对账夹具。

直接调用算法包 coordination_scan.py 的 normalize / find_groups 计算期望值,
覆盖:命中、账号不足、相似但不同文本、跨时间窗、通用短回复、去重。
输出 tests/fixtures/scan-cases.json。

用法:
    python scripts/make-scan-fixtures.py <算法包目录> <输出json>
"""
from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

BASE = 1720000000  # 2024-07-03 22:26:40 +08:00 附近的一个整点秒


def load_module(path: Path):
    spec = importlib.util.spec_from_file_location("coordination_scan_ref", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def build_comments(ref, rows):
    comments = []
    for index, (uid, text, offset) in enumerate(rows):
        comments.append({
            "uid": uid,
            "text": text,
            "normalized": ref.normalize(text),
            "time": float(BASE + offset),
            "graph_index": 0,
            "node_index": index,
            "reply_to": None,
            "reply_to_node": None,
            "like_count": 0,
        })
    comments.sort(key=lambda c: (c["time"], c["node_index"]))
    return comments


CASES = [
    {
        "name": "同文本 5 账号 1 分钟内",
        "minAccounts": 5,
        "windowMinutes": 10,
        "threshold": 0.82,
        "rows": [
            ("u_a", "这事必须严查，转发让更多人看到！", 0),
            ("u_b", "这事必须严查,转发让更多人看到!", 20),
            ("u_c", "这事必须严查，转发让更多人看到！", 45),
            ("u_d", "这事必须严查，转发让更多人看到！", 70),
            ("u_e", "这事必须严查，转发让更多人看到！", 110),
        ],
    },
    {
        "name": "只有 4 个账号(低于阈值)",
        "minAccounts": 5,
        "windowMinutes": 10,
        "threshold": 0.82,
        "rows": [
            ("u_a", "支持国家严查网络水军，转发扩散！", 0),
            ("u_b", "支持国家严查网络水军,转发扩散!", 10),
            ("u_c", "支持国家严查网络水军，转发扩散！", 20),
            ("u_d", "支持国家严查网络水军，转发扩散！", 30),
        ],
    },
    {
        "name": "相似但不同文本(阈值 0.82 应命中近似项)",
        "minAccounts": 5,
        "windowMinutes": 10,
        "threshold": 0.82,
        "rows": [
            ("u_a", "水军集合兄弟们冲统一口径刷起来", 0),
            ("u_b", "水军集合兄弟们冲统一口径刷起来", 15),
            ("u_c", "水军集合兄弟们冲统一口径刷起来", 30),
            ("u_d", "水军集合兄弟们冲统一口径刷起来啊", 45),
            ("u_e", "水军集合兄弟们冲统一口径刷起来", 60),
            ("u_f", "今天天气不错适合出去走走散散步", 75),
        ],
    },
    {
        "name": "跨时间窗(超过 10 分钟)不合并",
        "minAccounts": 5,
        "windowMinutes": 10,
        "threshold": 0.82,
        "rows": [
            ("u_a", "请严查这批账号同一个模板刷屏", 0),
            ("u_b", "请严查这批账号同一个模板刷屏", 30),
            ("u_c", "请严查这批账号同一个模板刷屏", 60),
            ("u_d", "请严查这批账号同一个模板刷屏", 90),
            ("u_e", "请严查这批账号同一个模板刷屏", 120),
            ("u_f", "请严查这批账号同一个模板刷屏", 900),
            ("u_g", "请严查这批账号同一个模板刷屏", 930),
            ("u_h", "请严查这批账号同一个模板刷屏", 960),
            ("u_i", "请严查这批账号同一个模板刷屏", 990),
            ("u_j", "请严查这批账号同一个模板刷屏", 1020),
        ],
    },
]


def main() -> int:
    pkg = Path(sys.argv[1]).resolve()
    out = Path(sys.argv[2]).resolve()
    ref = load_module(pkg / "coordination_scan.py")

    payload = []
    for case in CASES:
        comments = build_comments(ref, case["rows"])
        groups = ref.find_groups(comments, case["minAccounts"], case["windowMinutes"] * 60, case["threshold"])
        payload.append({
            "name": case["name"],
            "parameters": {
                "minAccounts": case["minAccounts"],
                "windowMinutes": case["windowMinutes"],
                "similarityThreshold": case["threshold"],
            },
            "comments": [
                {"accountId": c["uid"], "text": c["text"], "publishTime": c["time"]}
                for c in comments
            ],
            "expected": [
                {
                    "indices": sorted(g["indices"]),
                    "representative": g["representative"],
                    "accountCount": g["account_count"],
                    "start": g["start"],
                    "end": g["end"],
                    "minSimilarity": round(g["min_similarity"], 4),
                }
                for g in groups
            ],
        })

    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    for case in payload:
        print(f"{case['name']}:{len(case['expected'])} 组")
    print(f"写入 {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
