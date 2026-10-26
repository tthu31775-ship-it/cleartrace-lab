"""Read-only deployed API smoke check. No imports, tasks or reviews are created.

python scripts/team-smoke.py --site https://your-site.example
Optional env: CLEARTRACE_API_TOKEN, CLEARTRACE_SITE_TOKEN.
"""
import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--site", default=os.environ.get("CLEARTRACE_URL"), required=not os.environ.get("CLEARTRACE_URL"))
    parser.add_argument("--authenticated", action="store_true", help="Also verify protected bootstrap using environment credentials")
    args = parser.parse_args()
    site = args.site.rstrip("/")
    origin = urllib.parse.urlparse(site)
    if origin.scheme != "https" and not (origin.scheme == "http" and origin.hostname in ("localhost", "127.0.0.1")):
        parser.error("Expected HTTPS Site origin; HTTP allowed only for localhost")
    if origin.path or origin.query or origin.fragment or origin.username or origin.password:
        parser.error("Expected Site origin without a path, query or credentials")
    headers = {"Accept": "application/json"}
    for env_name, header in (("CLEARTRACE_SITE_TOKEN", "OAI-Sites-Authorization"), ("CLEARTRACE_API_TOKEN", "Authorization")):
        value = os.environ.get(env_name)
        if env_name == "CLEARTRACE_SITE_TOKEN":
            value = value or os.environ.get("SITES_AUTH_TOKEN")
        if value:
            headers[header] = "Bearer " + value
    paths = ["/api/v1/health"]
    if args.authenticated:
        paths.append("/api/v1/bootstrap")
    for path in paths:
        request = urllib.request.Request(site + path, headers=headers)
        with urllib.request.build_opener(NoRedirect()).open(request, timeout=30) as response:
            if "application/json" not in response.headers.get("Content-Type", ""):
                raise RuntimeError("Sign-in HTML returned; Site access has not been established")
            body = json.load(response)
            if response.status != 200 or "data" not in body:
                raise RuntimeError(f"Unexpected response for {path}")
            if path.endswith("bootstrap"):
                missing = {"user", "workspace", "stats", "datasets", "tasks", "accounts"} - body["data"].keys()
                if missing:
                    raise RuntimeError("Bootstrap missing keys: " + ", ".join(sorted(missing)))
            print("PASS " + path)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (OSError, ValueError, RuntimeError, KeyError) as error:
        print(f"FAIL: {error}", file=sys.stderr)
        sys.exit(1)
