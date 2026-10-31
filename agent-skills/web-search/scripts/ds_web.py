#!/usr/bin/env python3
"""Thin CLI over the DeepSeek Search / Fetch API.

  ds_web.py search "query" [--count N] [--content] [--compact] [--json]
  ds_web.py fetch URL [--max-chars N] [--json]

Auth: $DEEPSEEK_API_KEY, else the key file at ~/.config/deepseek-search-fetch/key.
Standard proxy env vars (HTTPS_PROXY / ALL_PROXY) are honored automatically.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

BASE_URL = os.environ.get("DEEPSEEK_BASE_URL", "https://api.deepseek.com").rstrip("/")
KEY_FILE = Path.home() / ".config" / "deepseek-search-fetch" / "key"
TIMEOUT = float(os.environ.get("DEEPSEEK_TIMEOUT", "60"))


def api_key() -> str:
    key = os.environ.get("DEEPSEEK_API_KEY", "").strip()
    if not key and KEY_FILE.is_file():
        key = KEY_FILE.read_text(encoding="utf-8").strip()
    if not key:
        sys.exit(
            f"missing API key: set DEEPSEEK_API_KEY or write it to {KEY_FILE}"
        )
    return key


def post(path: str, payload: dict) -> dict:
    req = urllib.request.Request(
        BASE_URL + path,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key()}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", "replace")[:800]
        sys.exit(f"HTTP {e.code} from {path}: {body}")
    except urllib.error.URLError as e:
        sys.exit(f"network error calling {path}: {e.reason}")


def cmd_search(args) -> None:
    payload = {"query": args.query, "count": args.count, "need_content": args.content}
    if args.ori_question:
        payload["ori_question"] = args.ori_question
    if args.localization:
        payload["localization"] = args.localization

    data = post("/v1/tools/search", payload)
    results = data.get("results") or []
    if args.json:
        print(json.dumps(data, ensure_ascii=False, indent=2))
        return
    if not results:
        print("no results")
        return

    for i, r in enumerate(results, 1):
        meta = " | ".join(
            x
            for x in (
                r.get("site_name") or "",
                (r.get("date") or "")[:10],
                f"score={r.get('rerank_score', 0):.2f}",
                f"authority={r.get('authority')}",
            )
            if x
        )
        print(f"[{i}] {r.get('title', '')}")
        print(f"    {r.get('url', '')}")
        if meta:
            print(f"    {meta}")
        text = r.get("snippet") if args.compact else (r.get("summary") or r.get("snippet"))
        if text:
            print(f"    {text.strip()}")
        if args.content and r.get("content"):
            print("    --- content ---")
            print("    " + r["content"].strip().replace("\n", "\n    "))
        print()


def cmd_fetch(args) -> None:
    data = post("/v1/tools/fetch", {"url": args.url})
    if args.json:
        print(json.dumps(data, ensure_ascii=False, indent=2))
        return
    title = data.get("title") or ""
    content = data.get("content") or ""
    if args.max_chars and len(content) > args.max_chars:
        content = content[: args.max_chars] + "\n\n[... truncated]"
    print(f"# {title}\n\n{content}")


def main() -> None:
    p = argparse.ArgumentParser(description="DeepSeek web search & fetch")
    sub = p.add_subparsers(dest="cmd", required=True)

    s = sub.add_parser("search", help="search the web")
    s.add_argument("query")
    s.add_argument("--count", type=int, default=10, help="1-50, default 10")
    s.add_argument("--content", action="store_true", help="include full page content")
    s.add_argument("--compact", action="store_true", help="use short snippet instead of long summary")
    s.add_argument("--ori-question", dest="ori_question", help="original user question for intent")
    s.add_argument("--localization", help="IP used for localized results")
    s.add_argument("--json", action="store_true", help="raw JSON output")
    s.set_defaults(func=cmd_search)

    f = sub.add_parser("fetch", help="fetch a page as Markdown")
    f.add_argument("url")
    f.add_argument("--max-chars", dest="max_chars", type=int, default=0)
    f.add_argument("--json", action="store_true", help="raw JSON output")
    f.set_defaults(func=cmd_fetch)

    args = p.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
