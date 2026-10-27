# -*- coding: utf-8 -*-
"""生成 WB01 TS 实现的数值对账夹具。

直接用算法包原始 app.py 的 predict_one 计算期望值,再抽样抖音真实评论,
输出 tests/fixtures/wb01-samples.json 供 tests/wb01-parity.test.cjs 比对。

用法:
    python scripts/make-wb01-fixtures.py <wb01包目录> <抖音评论csv> <输出json>
"""
from __future__ import annotations

import csv
import importlib.util
import json
import random
import sys
import types
from pathlib import Path


def load_reference(pkg_dir: Path):
    fake = types.ModuleType("flask")

    class Flask:  # noqa: D401 - 仅用于导入期占位
        def __init__(self, *a, **k):
            pass

        def route(self, *a, **k):
            return lambda fn: fn

        def after_request(self, *a, **k):
            return lambda fn: fn

        def run(self, *a, **k):
            pass

    fake.Flask = Flask
    fake.jsonify = lambda *a, **k: None
    fake.request = types.SimpleNamespace(method="GET", get_json=lambda **k: {})
    sys.modules.setdefault("flask", fake)
    spec = importlib.util.spec_from_file_location("wb01_reference", pkg_dir / "app.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


HANDCRAFTED = [
    "这事必须严查，转发让更多人看到！",
    "用啥铁丝组装的小玫瑰花？太漂亮了了",
    "哈哈哈哈哈哈太搞笑了",
    "支持国家严查网络水军，转发扩散！！！",
    "楼主说得对，一起举报这个账号",
    "好",
    "",
    "   ",
    "太美了吧这个配色绝了",
    "点击链接领取福利 https://example.com/a?b=1 速看",
    "感谢 @小明 的分享，学到了#干货#",
    "This is a normal English comment about the video quality.",
    "水军集合！！兄弟们冲！统一口径刷起来！！！",
    "有点意思，不过我更关心后续的处理结果。",
    "🔥🔥🔥太好看了吧！！！",
    "早就看出来了，这批号全是同一天注册的。",
    "我就想问一下这个价格到底多少？",
    "已举报，勿念。",
    "作者辛苦了，期待下一期更新～",
    "转发让更多人看到，别让这事沉了！",
]

rng = random.Random(20261027)


def main() -> int:
    pkg_dir = Path(sys.argv[1]).resolve()
    comments_csv = Path(sys.argv[2]).resolve()
    out_path = Path(sys.argv[3]).resolve()

    reference = load_reference(pkg_dir)

    texts: list[dict] = []
    for i, text in enumerate(HANDCRAFTED):
        texts.append({"case": f"handcrafted-{i}", "content": text})

    rows = []
    with comments_csv.open("r", encoding="utf-8-sig", newline="") as fh:
        for row in csv.DictReader(fh):
            content = (row.get("评论内容") or "").strip()
            if content:
                rows.append({"comment_id": row.get("评论ID"), "content": content})

    rng.shuffle(rows)
    for row in rows[:24]:
        texts.append({"case": f"douyin-{row['comment_id']}", "comment_id": row["comment_id"], "content": row["content"]})

    samples = []
    for item in texts:
        expected = reference.predict_one(item["content"])
        samples.append(
            {
                "case": item["case"],
                "comment_id": item.get("comment_id"),
                "content": item["content"],
                "expected": expected,
            }
        )

    out_path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "model_version": reference.VERSION,
        "threshold": reference.THRESHOLD,
        "dimension": reference.D,
        "samples": samples,
    }
    out_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"已写入 {out_path} 共 {len(samples)} 条样例,版本 {reference.VERSION},维度 {reference.D}")
    water = sum(1 for s in samples if s["expected"]["label"] == "water")
    print(f"其中 water={water} normal={len(samples) - water}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
