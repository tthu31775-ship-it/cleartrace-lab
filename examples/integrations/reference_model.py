"""ClearTrace inference protocol reference. Python standard library only.

This is an executable rule example, not a trained or evaluated detector.
Run: python examples/integrations/reference_model.py --port 8788
Expose /predict through your team's HTTPS gateway for a deployed Sites adapter.
"""
from __future__ import annotations

import argparse
import hmac
import json
import math
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

MODEL_VERSION = "reference-rule-adapter-v1"
MAX_BYTES = 5 * 1024 * 1024
FEATURES = (
    "postsCount", "followersCount", "followingCount", "accountAgeDays",
    "duplicateRatio", "burstRatio", "nightRatio", "avgIntervalSeconds",
)


def predict(payload: object) -> dict:
    """Validate the public adapter contract and produce one result per input."""
    if not isinstance(payload, dict) or payload.get("schemaVersion") != "1.0":
        raise ValueError("schemaVersion must be 1.0")
    accounts = payload.get("accounts")
    if not isinstance(accounts, list) or not 1 <= len(accounts) <= 1000:
        raise ValueError("accounts must contain between 1 and 1000 items")
    seen, results = set(), []
    for item in accounts:
        if not isinstance(item, dict):
            raise ValueError("Each account must be an object")
        account_id = item.get("accountId")
        if not isinstance(account_id, str) or not account_id.strip() or account_id in seen:
            raise ValueError("accountId must be a nonempty unique string")
        seen.add(account_id)
        features = item.get("features")
        if not isinstance(features, dict):
            raise ValueError("features must be an object")
        for name in FEATURES:
            value = features.get(name)
            if isinstance(value, bool) or not isinstance(value, (int, float)):
                raise ValueError(f"{name} must be a finite nonnegative number")
            if not math.isfinite(value) or value < 0:
                raise ValueError(f"{name} must be a finite nonnegative number")
            if name.endswith("Ratio") and value > 1:
                raise ValueError(f"{name} must be between 0 and 1")
        related = item.get("relatedIds", [])
        if (not isinstance(related, list) or len(related) > 100
                or any(not isinstance(value, str) or len(value) > 128 for value in related)):
            raise ValueError("relatedIds must contain at most 100 string IDs")
        texts = item.get("textSamples", [])
        if (not isinstance(texts, list) or len(texts) > 20
                or any(not isinstance(value, str) or len(value) > 1000 for value in texts)):
            raise ValueError("textSamples must contain at most 20 strings of at most 1000 characters")
        # Replace only this scoring block with your trained model's inference.
        # relatedIds/textSamples are preserved by the platform for graph/text
        # models. This numeric reference rule deliberately does not use them.
        raw = (features["duplicateRatio"] * 40
               + features["burstRatio"] * 35
               + features["nightRatio"] * 10
               + (10 if features["accountAgeDays"] < 30 else 0)
               + (5 if features["avgIntervalSeconds"] < 60 else 0))
        reasons = []
        if features["duplicateRatio"] >= 0.6:
            reasons.append("示例规则：重复内容比例较高")
        if features["burstRatio"] >= 0.6:
            reasons.append("示例规则：集中发布比例较高")
        if features["accountAgeDays"] < 30:
            reasons.append("示例规则：账号注册时间较短")
        results.append({
            "accountId": account_id,
            "score": round(max(0, min(100, raw)), 2),
            "reasons": reasons or ["示例规则：当前行为特征未出现较强信号"],
        })
    return {"modelVersion": MODEL_VERSION, "results": results}


class Handler(BaseHTTPRequestHandler):
    server_version = "ClearTraceReference/1.0"

    def reply(self, status: int, body: dict) -> None:
        encoded = json.dumps(body, ensure_ascii=False, allow_nan=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(encoded)

    def do_GET(self) -> None:
        if self.path != "/health":
            return self.reply(404, {"error": "not_found"})
        self.reply(200, {"status": "ok", "modelVersion": MODEL_VERSION, "trained": False})

    def do_POST(self) -> None:
        if self.path != "/predict":
            return self.reply(404, {"error": "not_found"})
        expected = os.environ.get("REFERENCE_MODEL_API_KEY", "")
        supplied = self.headers.get("Authorization", "")
        if expected and not hmac.compare_digest(supplied, f"Bearer {expected}"):
            return self.reply(401, {"error": "unauthorized"})
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            return self.reply(400, {"error": "invalid_content_length"})
        if not 1 <= length <= MAX_BYTES:
            return self.reply(413, {"error": "body_size_exceeded"})
        try:
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
            result = predict(payload)
        except (ValueError, UnicodeDecodeError) as error:
            return self.reply(400, {"error": str(error)})
        self.reply(200, result)

    def log_message(self, fmt: str, *args) -> None:
        # HTTP status/path only. Never log payloads, account features or tokens.
        print(f"[reference-model] {fmt % args}", flush=True)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8788)
    args = parser.parse_args()
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    server.daemon_threads = True
    print(f"Reference model: http://{args.host}:{args.port}/predict", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
