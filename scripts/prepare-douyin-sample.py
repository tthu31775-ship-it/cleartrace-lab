# -*- coding: utf-8 -*-
"""把抖音小样本的三个 CSV 合成一份可导入的 JSON。

数据事实(逐行核对,见 README):5 个作品、231 条评论、215 个账号。
发布时间由"1周前"等相对时间推算,属近似值,导入后标记为 approximate,
不参与严格 10 分钟时间窗筛查;报告页眉的 91,286 / 9,958 不是本批次事实,禁止沿用。

用法:
    python scripts/prepare-douyin-sample.py <抖音数据集目录> <输出json>
"""
from __future__ import annotations

import csv
import json
import sys
from pathlib import Path


def read_csv(path: Path) -> list[dict]:
    with path.open("r", encoding="utf-8-sig", newline="") as fh:
        return list(csv.DictReader(fh))


def main() -> int:
    src = Path(sys.argv[1]).resolve()
    out = Path(sys.argv[2]).resolve()

    works = read_csv(src / "作品清单.csv")
    comments = read_csv(src / "抖音评论明细.csv")
    accounts = read_csv(src / "抖音账号汇总.csv")

    def num(value: str | None, default: int = 0) -> int:
        try:
            return int(str(value).strip())
        except (TypeError, ValueError):
            return default

    work_rows = [
        {
            "workId": str(w.get("作品ID") or "").strip(),
            "url": str(w.get("作品链接") or "").strip(),
            "declaredCommentCount": num(w.get("已采集评论数")),
        }
        for w in works
        if (w.get("作品ID") or "").strip()
    ]

    comment_rows = []
    for c in comments:
        content = (c.get("评论内容") or "").strip()
        if not content:
            continue
        comment_rows.append(
            {
                "commentId": str(c.get("评论ID") or "").strip(),
                "workId": str(c.get("作品ID") or "").strip(),
                "accountId": str(c.get("用户ID(sec_uid)") or "").strip(),
                "nickname": str(c.get("昵称") or "").strip(),
                "content": content,
                "publishTime": str(c.get("发布时间") or "").strip(),
                "likeCount": num(c.get("点赞数")),
                "ipRegion": str(c.get("IP属地") or "").strip(),
                "collectedAt": str(c.get("采集时间") or "").strip(),
            }
        )

    account_rows = [
        {
            "accountId": str(a.get("用户ID(sec_uid)") or "").strip(),
            "nickname": str(a.get("昵称") or "").strip(),
            "commentCount": num(a.get("评论数")),
            "workCount": num(a.get("涉及作品数")),
            "firstTime": str(a.get("首次评论时间") or "").strip(),
            "lastTime": str(a.get("最近评论时间") or "").strip(),
            "ipRegion": str(a.get("IP属地") or "").strip(),
        }
        for a in accounts
        if (a.get("用户ID(sec_uid)") or "").strip()
    ]

    # 内部一致性必须成立,否则拒绝产出数据文件。
    distinct_works = {c["workId"] for c in comment_rows}
    distinct_accounts = {c["accountId"] for c in comment_rows}
    problems = []
    if len(work_rows) != 5:
        problems.append(f"作品数 {len(work_rows)} != 5")
    if len(comment_rows) != 231:
        problems.append(f"评论数 {len(comment_rows)} != 231")
    if len(account_rows) != 215:
        problems.append(f"账号数 {len(account_rows)} != 215")
    if len(distinct_works) != 5:
        problems.append(f"评论覆盖作品 {len(distinct_works)} != 5")
    if len(distinct_accounts) != 215:
        problems.append(f"评论覆盖账号 {len(distinct_accounts)} != 215")
    for w in work_rows:
        actual = sum(1 for c in comment_rows if c["workId"] == w["workId"])
        if actual != w["declaredCommentCount"]:
            problems.append(f"作品 {w['workId']} 声明 {w['declaredCommentCount']} 实际 {actual}")
    if problems:
        raise SystemExit("抖音样本内部对账失败:" + ";".join(problems))

    payload = {
        "batch": "douyin-20261022",
        "platform": "douyin",
        "sourceNamespace": "douyin_sec_uid",
        "collectedAt": "2026-10-22T18:26:00+08:00",
        "timePrecision": "approximate",
        "timeNote": "发布时间由相对时间(如“1周前”)按采集时刻推算,属近似值,不用于严格时间窗筛查。",
        "ipNote": "IP 属地是平台公开展示的省级行政区,不是网络 IP,不能作为同设备或协同关系依据。",
        "likeNote": "本批次点赞数全为 0,无法区分真实零值与未采集默认值,不作为账号画像特征。",
        "works": work_rows,
        "accounts": account_rows,
        "comments": comment_rows,
        "counts": {"works": len(work_rows), "comments": len(comment_rows), "accounts": len(account_rows)},
    }
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"写入 {out} ({out.stat().st_size/1024:.1f} KB)")
    print(f"作品 {len(work_rows)} / 评论 {len(comment_rows)} / 账号 {len(account_rows)}  对账通过")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
