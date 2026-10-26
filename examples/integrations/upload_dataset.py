"""Validate a dataset through ClearTrace, then optionally import it.

Credentials come from environment variables, never command-line arguments.
CLEARTRACE_URL: Site origin; CLEARTRACE_API_TOKEN: application integration token.
CLEARTRACE_SITE_TOKEN: optional owner-private Sites access token.
SITES_AUTH_TOKEN is accepted as a lower-priority alias.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        # Never forward either credential to a redirected origin/sign-in page.
        return None


def request(site: str, path: str, body: dict) -> dict:
    headers = {"Content-Type": "application/json", "Accept": "application/json"}
    token = os.environ.get("CLEARTRACE_API_TOKEN")
    site_token = os.environ.get("CLEARTRACE_SITE_TOKEN") or os.environ.get("SITES_AUTH_TOKEN")
    if token:
        headers["Authorization"] = "Bearer " + token
    if site_token:
        headers["OAI-Sites-Authorization"] = "Bearer " + site_token
    req = urllib.request.Request(site + path, data=json.dumps(body, ensure_ascii=False).encode("utf-8"),
                                 headers=headers, method="POST")
    try:
        with urllib.request.build_opener(NoRedirect()).open(req, timeout=30) as response:
            if "application/json" not in response.headers.get("Content-Type", ""):
                raise RuntimeError("Site returned a sign-in page. Check Site access and service credentials.")
            return json.load(response)
    except urllib.error.HTTPError as error:
        try:
            detail = json.load(error).get("error", {})
            message = detail.get("message", "Request rejected") if isinstance(detail, dict) else str(detail)
        except (ValueError, AttributeError):
            message = "Request rejected; check Site access and application token."
        raise RuntimeError(f"HTTP {error.code}: {message}") from None


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("file", type=Path)
    parser.add_argument("--site", default=os.environ.get("CLEARTRACE_URL", ""))
    parser.add_argument("--name", required=True)
    parser.add_argument("--source", default="数据组导入")
    parser.add_argument("--commit", action="store_true", help="Import after successful validation (default validates only)")
    args = parser.parse_args()
    site = args.site.rstrip("/")
    parsed = urllib.parse.urlparse(site)
    if parsed.scheme != "https" and not (parsed.scheme == "http" and parsed.hostname in ("localhost", "127.0.0.1")):
        parser.error("--site must be an HTTPS origin (HTTP allowed only on localhost)")
    if parsed.path not in ("", "/") or parsed.query or parsed.fragment or parsed.username or parsed.password:
        parser.error("--site must contain only scheme and host")
    format_name = args.file.suffix.lower().lstrip(".")
    if format_name not in ("csv", "json"):
        parser.error("The input file must be .csv or .json")
    if args.file.stat().st_size > 5 * 1024 * 1024:
        parser.error("Maximum file size is 5 MiB")
    body = {"name": args.name, "source": args.source, "format": format_name,
            "content": args.file.read_text(encoding="utf-8-sig"), "dryRun": True}
    result = request(site, "/api/v1/datasets/import", body)["data"]
    print(json.dumps(result, ensure_ascii=False, indent=2))
    if not result.get("valid"):
        print("Validation failed; no dataset was imported.", file=sys.stderr)
        return 2
    if args.commit:
        body["dryRun"] = False
        imported = request(site, "/api/v1/datasets/import", body)["data"]
        print(json.dumps({"imported": imported.get("dataset"), "accepted": imported.get("accepted")},
                         ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (OSError, RuntimeError, KeyError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
