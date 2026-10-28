# -*- coding: utf-8 -*-
"""把算法包交付的协同线索与事件图,转成工作台可用的数据文件。

输入(算法包 outputs/):
    coordination/leads.jsonl                     803 条预计算线索
    coordination/summary.json                    离线扫描汇总
    coordination_visualization/index.html        173 个事件的索引(内嵌 JSON)
    coordination_visualization/events/*.html     每个事件的交互图(内嵌 eventData JSON)

输出(工程内):
    lib/data/coordination.json                   线索 + 事件元数据(随服务端代码打包)
    public/graphs/<eventId>.json                 按需加载的事件图谱(只保留线索相关节点)

用法:
    python scripts/prepare-coordination-data.py <outputs目录> <工程根目录>
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

INDEX_RE = re.compile(r'<script id="indexData" type="application/json">(.*?)</script>', re.S)
EVENT_RE = re.compile(r'<script id="eventData" type="application/json">(.*?)</script>', re.S)


def read_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def namespace(source: str) -> str:
    """来源命名空间:trend_information.jsonl -> trend,verified_information.jsonl -> verified。"""
    name = str(source or "unknown")
    for suffix in ("_information.jsonl", ".jsonl", ".csv"):
        if name.endswith(suffix):
            return name[: -len(suffix)]
    return name


def event_id(source: str, event_line: int) -> str:
    # 两个来源文件都存在 2431 行,内部 ID 必须带来源命名空间,不能只用行号。
    return f"event_{namespace(source)}_{event_line:05d}"


def lead_id(number: int) -> str:
    return f"lead_{number:04d}"


def node_id(gi: int, ni: int) -> str:
    return f"g{gi}n{ni}"


def main() -> int:
    outputs = Path(sys.argv[1]).resolve()
    root = Path(sys.argv[2]).resolve()

    leads_path = outputs / "coordination" / "leads.jsonl"
    summary_path = outputs / "coordination" / "summary.json"
    viz = outputs / "coordination_visualization"
    events_dir = viz / "events"

    summary = read_json(summary_path) if summary_path.exists() else {}

    # ---- 事件索引 ----
    index_html = (viz / "index.html").read_text(encoding="utf-8")
    index_match = INDEX_RE.search(index_html)
    if not index_match:
        raise SystemExit("index.html 中未找到 indexData")
    index_rows = json.loads(index_match.group(1))

    events: dict[str, dict] = {}
    graphs: dict[str, dict] = {}
    similarity_by_lead: dict[int, list] = {}
    rep_node_by_lead: dict[int, str | None] = {}
    similarity_by_lead: dict[int, list] = {}
    rep_node_by_lead: dict[int, str | None] = {}
    total_nodes = 0
    total_reply_edges = 0
    kept_nodes = 0

    for row in index_rows:
        event_line = int(row["eventLine"])
        source = str(row.get("source") or "")
        eid = event_id(source, event_line)
        html_path = events_dir / row["file"]
        if not html_path.exists():
            print(f"  ! 缺少事件文件 {row['file']}")
            continue
        match = EVENT_RE.search(html_path.read_text(encoding="utf-8"))
        if not match:
            print(f"  ! {row['file']} 中未找到 eventData")
            continue
        data = json.loads(match.group(1))
        nodes = data.get("nodes") or []
        reply_edges = data.get("replyEdges") or []
        lead_groups = data.get("leads") or []
        total_nodes += len(nodes)
        total_reply_edges += len(reply_edges)

        keep = {
            str(n["id"])
            for n in nodes
            if (n.get("leadIds") or n.get("representativeFor"))
        }
        slim_nodes = [
            {
                "id": str(n["id"]),
                "uid": str(n.get("uid") or ""),
                "text": str(n.get("text") or ""),
                "time": n.get("time"),
                "likes": n.get("likes") or 0,
                "replyTo": n.get("replyTo"),
                "leadIds": n.get("leadIds") or [],
                "rep": bool(n.get("representativeFor")),
            }
            for n in nodes
            if str(n["id"]) in keep
        ]
        kept_nodes += len(slim_nodes)
        slim_edges = [
            {"source": str(e["source"]), "target": str(e["target"])}
            for e in reply_edges
            if str(e.get("source")) in keep and str(e.get("target")) in keep
        ]
        slim_groups = [
            {
                "leadId": g.get("leadId"),
                "accountCount": g.get("accountCount"),
                "commentCount": g.get("commentCount"),
                "start": g.get("start"),
                "end": g.get("end"),
                "minimumSimilarity": g.get("minimumSimilarity"),
                "representative": g.get("representative"),
                "members": [str(m) for m in (g.get("members") or []) if str(m) in keep],
                "starEdges": [
                    {"source": str(e["source"]), "target": str(e["target"]), "similarity": e.get("similarity")}
                    for e in (g.get("starEdges") or [])
                    if str(e.get("source")) in keep and str(e.get("target")) in keep
                ][:400],
            }
            for g in lead_groups
        ]

        for g in slim_groups:
            if g.get("leadId") is None:
                continue
            similarity_by_lead[int(g["leadId"])] = [
                [e["source"], e["target"], e.get("similarity")] for e in g["starEdges"]
            ]
            rep_node_by_lead[int(g["leadId"])] = g.get("representative")

        for g in slim_groups:
            if g.get("leadId") is None:
                continue
            similarity_by_lead[int(g["leadId"])] = [
                [e["source"], e["target"], e.get("similarity")] for e in g["starEdges"]
            ]
            rep_node_by_lead[int(g["leadId"])] = g.get("representative")

        graphs[eid] = {
            "eventId": eid,
            "sourceFile": str(data.get("source") or source),
            "eventLine": event_line,
            "eventRef": data.get("eventRef"),
            "timeMin": data.get("timeMin"),
            "timeMax": data.get("timeMax"),
            "nodeTotal": len(nodes),
            "nodes": slim_nodes,
            "replyEdges": slim_edges,
            "groups": slim_groups,
        }
        events[eid] = {
            "id": eid,
            "sourceFile": str(data.get("source") or source),
            "eventLine": event_line,
            "eventRef": str(data.get("eventRef") or f"{row.get('source')}:{event_line}"),
            "leadCount": int(row.get("leadCount") or 0),
            "nodeCount": len(nodes),
            "replyCount": len(reply_edges),
            "maxAccounts": int(row.get("maxAccounts") or 0),
            "leadNodeCount": len(slim_nodes),
            "timeMin": data.get("timeMin"),
            "timeMax": data.get("timeMax"),
            "graphPath": f"/api/v1/events/{eid}/graph",
            "replyEdges": [[e["source"], e["target"]] for e in slim_edges],
        }

    # ---- 线索 ----
    leads: list[dict] = []
    total_comments = 0
    missing_graph = 0
    with leads_path.open("r", encoding="utf-8") as fh:
        for number, line in enumerate(fh, start=1):
            line = line.strip()
            if not line:
                continue
            raw = json.loads(line)
            event_line = int(raw["event_line"])
            source = str(raw.get("source_file") or "")
            eid = event_id(source, event_line)
            if eid not in events:
                missing_graph += 1
            comments = raw.get("comments") or []
            total_comments += len(comments)
            slug = int(raw.get("lead_id") or number)
            rep_node = rep_node_by_lead.get(slug)
            members: dict[str, dict] = {}
            slim_comments = []
            for c in comments:
                uid = str(c.get("uid") or "")
                gi, ni = c.get("graph_index"), c.get("node_index")
                node = node_id(int(gi), int(ni)) if gi is not None and ni is not None else None
                is_rep = bool(node is not None and node == rep_node)
                slide_to = c.get("reply_to")
                reply_node = None
                if slide_to is not None and c.get("reply_to_node") is not None:
                    reply_node = node_id(int(slide_to), int(c["reply_to_node"]))
                slim_comments.append(
                    {
                        "uid": uid,
                        "text": str(c.get("text") or ""),
                        "time": c.get("time"),
                        "likes": c.get("like_count") or 0,
                        "node": node,
                        "rep": is_rep,
                        "replyTo": reply_node,
                    }
                )
                if uid:
                    slot = members.setdefault(uid, {"uid": uid, "comments": 0, "first": None, "last": None, "rep": False})
                    slot["comments"] += 1
                    slot["rep"] = slot["rep"] or is_rep
                    t = c.get("time")
                    if isinstance(t, (int, float)):
                        slot["first"] = t if slot["first"] is None else min(slot["first"], t)
                        slot["last"] = t if slot["last"] is None else max(slot["last"], t)
            leads.append(
                {
                    "id": lead_id(number),
                    "eventId": eid,
                    "sourceFile": source,
                    "eventLine": event_line,
                    "eventRef": str(raw.get("local_event_ref") or f"{source}:{event_line}"),
                    "accountCount": int(raw.get("account_count") or 0),
                    "commentCount": int(raw.get("comment_count") or 0),
                    "startTime": raw.get("start_time"),
                    "endTime": raw.get("end_time"),
                    "minSimilarity": raw.get("minimum_text_similarity"),
                    "representative": str(raw.get("representative") or ""),
                    "sourceLeadId": slug,
                    "similarityEdges": similarity_by_lead.get(slug, []),
                    "members": sorted(members.values(), key=lambda m: -m["comments"]),
                    "comments": slim_comments,
                }
            )
    if missing_graph:
        print(f"  ! {missing_graph} 条线索找不到对应事件图")

    payload = {
        "dataset": {
            "name": "协同线索预计算结果",
            "version": str(summary.get("version") or "coordination-20261023"),
            "sourceFile": "trend_information.jsonl",
            "generatedAt": "2026-10-23T15:19:00+08:00",
            "leadCount": len(leads),
            "eventCount": len(events),
            "summary": summary,
        },
        "events": sorted(events.values(), key=lambda e: -e["nodeCount"]),
        "leads": leads,
    }

    out_dir = root / "lib" / "data"
    out_dir.mkdir(parents=True, exist_ok=True)
    target = out_dir / "coordination.json"
    target.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    # 图谱不放 public:静态资源绕过登录校验,原始评论会变成公开可读。
    # 改为随服务端打包、写入 D1 events.graph_json,由需要鉴权的 /events/:id/graph 读取。
    graph_file = out_dir / "graphs.json"
    graph_text = json.dumps(graphs, ensure_ascii=False, separators=(",", ":"))
    graph_file.write_text(graph_text, encoding="utf-8")
    graph_bytes = len(graph_text.encode("utf-8"))

    print(f"线索 {len(leads)} 条 / 评论 {total_comments} 条 / 账号成员 {sum(len(l['members']) for l in leads)} 个")
    print(f"事件 {len(events)} 个,原始节点 {total_nodes},保留线索相关节点 {kept_nodes},回复边 {total_reply_edges}")
    print(f"写入 {target} ({target.stat().st_size/1024/1024:.2f} MB)")
    print(f"写入 {graph_file} 共 {len(graphs)} 个事件图 ({graph_bytes/1024/1024:.2f} MB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
