#!/usr/bin/env python3
"""查询 OpenCode Go 与 MiniMax Token Plan 订阅额度。

  usage_check.py [show] [--json]
  usage_check.py opencode [--json]
  usage_check.py minimax [--json]
  usage_check.py set-key {opencode,minimax-cn,minimax-global} KEY
  usage_check.py unset-key {opencode,minimax-cn,minimax-global}

Key 来源：环境变量 > ~/.config/pi-work-usage-check/keys.json（0600）。
"""

from __future__ import annotations

import argparse
import json
import os
import re
import stat
import sys
import urllib.error
import urllib.request
from datetime import datetime
from pathlib import Path

CONFIG_DIR = Path(os.environ.get("USAGE_CHECK_CONFIG_DIR", Path.home() / ".config" / "pi-work-usage-check"))
CONFIG_FILE = CONFIG_DIR / "keys.json"
OPENCODE_BASE = os.environ.get("OPENCODE_GO_BASE_URL", "https://opencode.ai/inference/go/v1")
TIMEOUT = float(os.environ.get("USAGE_CHECK_TIMEOUT", "20"))
MAX_BYTES = 1024 * 1024

TARGETS = {
    "opencode": {
        "label": "OpenCode Go",
        "env": "OPENCODE_GO_API_KEY",
        "hint": "set-key opencode",
    },
    "minimax-cn": {
        "label": "MiniMax 国内站",
        "env": "MINIMAX_CN_API_KEY",
        "hint": "set-key minimax-cn",
        "urls": (
            "https://api.minimaxi.com/v1/token_plan/remains",
            "https://www.minimaxi.com/v1/token_plan/remains",
        ),
    },
    "minimax-global": {
        "label": "MiniMax 国际站",
        "env": "MINIMAX_API_KEY",
        "hint": "set-key minimax-global",
        "urls": (
            "https://www.minimax.io/v1/token_plan/remains",
            "https://api.minimax.io/v1/token_plan/remains",
        ),
    },
}

AUTH_WORDS = re.compile(
    r"cookie is missing|log in again|unauthorized|invalid api key|invalid token|status_code[\"\s:]*1004|1004",
    re.IGNORECASE,
)


class QuotaError(Exception):
    pass


class HttpFailure(QuotaError):
    def __init__(self, status: int, body: str) -> None:
        super().__init__(f"HTTP {status}")
        self.status = status
        self.body = body


class TransportFailure(QuotaError):
    pass


def script_path() -> str:
    return str(Path(__file__).resolve())


def load_keys() -> dict[str, str]:
    if not CONFIG_FILE.is_file():
        return {}
    mode = stat.S_IMODE(CONFIG_FILE.stat().st_mode)
    if mode & 0o077:
        os.chmod(CONFIG_FILE, 0o600)
        print(f"已把 {CONFIG_FILE} 权限收紧为 600", file=sys.stderr)
    try:
        data = json.loads(CONFIG_FILE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise QuotaError(f"无法读取 {CONFIG_FILE}：{error}") from error
    if not isinstance(data, dict):
        raise QuotaError(f"{CONFIG_FILE} 必须是 JSON 对象")
    return {
        name: value.strip()
        for name, value in data.items()
        if isinstance(name, str) and isinstance(value, str) and value.strip()
    }


def save_keys(keys: dict[str, str]) -> None:
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    os.chmod(CONFIG_DIR, 0o700)
    temporary = CONFIG_FILE.with_name(f".{CONFIG_FILE.name}.{os.getpid()}.tmp")
    temporary.write_text(json.dumps(keys, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    os.chmod(temporary, 0o600)
    os.replace(temporary, CONFIG_FILE)
    os.chmod(CONFIG_FILE, 0o600)


def mask(key: str) -> str:
    if len(key) <= 12:
        return "*" * len(key)
    return f"{key[:6]}…{key[-4:]}"


def resolve_key(name: str, keys: dict[str, str]) -> tuple[str | None, str | None]:
    env = os.environ.get(TARGETS[name]["env"], "").strip()
    if env:
        return env, f"环境变量 {TARGETS[name]['env']}"
    from_file = keys.get(name)
    if from_file:
        return from_file, str(CONFIG_FILE)
    return None, None


def valid_key(value: str) -> str:
    key = value.strip()
    if len(key) < 8 or len(key) > 512 or re.search(r"\s", key):
        raise QuotaError("key 为空、过短或包含空白字符")
    return key


def read_json(url: str, headers: dict[str, str]) -> object:
    request = urllib.request.Request(
        url,
        headers={"User-Agent": "pi-work-usage-check/1.0", **headers},
        method="GET",
    )
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
            raw = response.read(MAX_BYTES + 1)
    except urllib.error.HTTPError as error:
        body = error.read(4096).decode("utf-8", "replace")
        raise HttpFailure(error.code, body) from error
    except (urllib.error.URLError, TimeoutError, OSError) as error:
        reason = getattr(error, "reason", error)
        raise TransportFailure(str(reason)) from error
    if len(raw) > MAX_BYTES:
        raise QuotaError(f"响应超过 {MAX_BYTES} 字节")
    try:
        return json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise QuotaError("响应不是合法 JSON") from error


def number(value: object) -> float | None:
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, (int, float)) and value == value:
        return float(value)
    if isinstance(value, str) and value.strip():
        try:
            parsed = float(value)
        except ValueError:
            return None
        return parsed if parsed == parsed else None
    return None


def first_number(row: dict, names: tuple[str, ...]) -> float | None:
    for name in names:
        parsed = number(row.get(name))
        if parsed is not None:
            return parsed
    return None


def pm(value: float | None) -> str:
    return "未知" if value is None else f"{value:g}%"


def fmt_time(milliseconds: int | None) -> str:
    if milliseconds is None:
        return "未知"
    return datetime.fromtimestamp(milliseconds / 1000).astimezone().strftime("%Y-%m-%d %H:%M %Z")


def epoch_ms(value: object) -> int | None:
    parsed = number(value)
    if parsed is None or parsed <= 0:
        return None
    if parsed > 1e12:
        return int(parsed)
    if parsed > 1e9:
        return int(parsed * 1000)
    return None


def parse_iso(value: object) -> int | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        return int(datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp() * 1000)
    except ValueError:
        return None


def query_opencode(key: str) -> dict:
    base = OPENCODE_BASE.rstrip("/")
    url = f"{base}/usage"
    try:
        body = read_json(url, {
            "Authorization": f"Bearer {key}",
            "Accept": "application/json",
            "Accept-Encoding": "identity",
        })
    except HttpFailure as error:
        hint = "。请检查 key 和 Go 订阅权限" if error.status in (401, 403) else ""
        raise QuotaError(f"HTTP {error.status}{hint}") from error
    except TransportFailure as error:
        raise QuotaError(f"网络错误：{error}") from error

    usage = body.get("usage") if isinstance(body, dict) else None
    if not isinstance(usage, dict):
        raise QuotaError("响应缺少 usage 字段")
    windows: dict[str, dict] = {}
    for name in ("rolling", "weekly", "monthly"):
        row = usage.get(name)
        if not isinstance(row, dict):
            raise QuotaError(f"响应缺少 {name} 窗口")
        status = row.get("status")
        percent = number(row.get("percent"))
        resets_at = parse_iso(row.get("resetsAt"))
        if status not in ("ok", "rate-limited") or percent is None or not 0 <= percent <= 100 or resets_at is None:
            raise QuotaError(f"{name} 窗口数据无效")
        windows[name] = {"status": status, "percent": percent, "resetsAt": resets_at}
    return {"status": "ok", "url": url, "windows": windows}


def minimax_percent(row: dict, window: str) -> float | None:
    direct = first_number(row, (
        f"current_{window}_remaining_percent",
        f"{window}_remaining_percent",
        f"current_{window}_remain_percent",
    ))
    if direct is not None:
        return min(100.0, max(0.0, direct))
    remaining = first_number(row, (
        f"current_{window}_remaining_count",
        f"current_{window}_remains_count",
        f"{window}_remaining_count",
        f"{window}_remains_count",
    ))
    total = first_number(row, (f"current_{window}_total_count", f"{window}_total_count"))
    if remaining is None or total is None or total <= 0:
        remaining = first_number(row, (f"current_{window}_usage_count", f"{window}_usage_count"))
    if remaining is not None and total is not None and total > 0:
        return min(100.0, max(0.0, remaining / total * 100))
    return None


def minimax_end_at(row: dict, window: str, now_ms: int) -> int | None:
    key = "end_time" if window == "interval" else "weekly_end_time"
    raw = first_number(row, (key, f"current_{window}_end_time", f"{window}_end_time"))
    parsed = epoch_ms(raw)
    if parsed is not None:
        return parsed
    remains = first_number(row, (
        "remains_time" if window == "interval" else "weekly_remains_time",
        f"current_{window}_remains_time",
        f"{window}_remains_time",
    ))
    if remains is not None and remains >= 0:
        return now_ms + int(remains)
    return None


def minimax_included(row: dict) -> bool:
    quotas = [
        number(row.get(name))
        for name in (
            "current_interval_quota",
            "current_weekly_quota",
            "interval_quota",
            "weekly_quota",
            "quota",
        )
    ]
    known = [value for value in quotas if value is not None]
    return True if not known else any(value > 0 for value in known)


def string(value: object) -> str | None:
    if isinstance(value, str) and value.strip():
        return value.strip()
    return None


def plan_name(body: dict, rows: list[dict]) -> str | None:
    for source in [body, *rows]:
        for name in ("current_subscribe_title", "plan_name", "subscribe_title", "plan"):
            found = string(source.get(name))
            if found:
                return found
    return None


def normalize_minimax(body: object, url: str) -> dict:
    if not isinstance(body, dict):
        raise QuotaError("响应不是 JSON 对象")
    base = body.get("base_resp") if isinstance(body.get("base_resp"), dict) else {}
    code = number(base.get("status_code"))
    if code not in (None, 0):
        message = string(base.get("status_msg")) or f"错误码 {code:g}"
        if AUTH_WORDS.search(message) or code == 1004:
            message += "（不是订阅 Key，或区域不对；Token Plan 需使用订阅 Key）"
        raise QuotaError(message)

    raw_rows = body.get("model_remains") or body.get("models") or body.get("data")
    if not isinstance(raw_rows, list):
        raise QuotaError("响应缺少 model_remains")
    rows = [row for row in raw_rows if isinstance(row, dict)]
    now_ms = int(datetime.now().timestamp() * 1000)
    models: list[dict] = []
    for row in rows:
        name = string(row.get("model_name")) or string(row.get("name")) or string(row.get("model"))
        if not name:
            continue
        interval_remain = minimax_percent(row, "interval")
        weekly_remain = minimax_percent(row, "weekly")
        models.append({
            "name": name,
            "included": minimax_included(row),
            "intervalRemainingPercent": interval_remain,
            "weeklyRemainingPercent": weekly_remain,
            "intervalEndAt": minimax_end_at(row, "interval", now_ms),
            "weeklyEndAt": minimax_end_at(row, "weekly", now_ms),
        })
    if not models:
        raise QuotaError("响应没有可用的模型额度")
    return {"status": "ok", "url": url, "plan": plan_name(body, rows), "models": models}


def query_minimax(name: str, key: str) -> dict:
    urls = TARGETS[name]["urls"]
    failures: list[str] = []
    for url in urls:
        try:
            body = read_json(url, {
                "Authorization": f"Bearer {key}",
                "Accept": "application/json",
            })
        except HttpFailure as error:
            if error.status in (408, 429) or error.status >= 500:
                failures.append(f"{url} → HTTP {error.status}")
                continue
            hint = "。请检查 key 和订阅权限" if error.status in (401, 403) else ""
            raise QuotaError(f"HTTP {error.status}{hint}") from error
        except TransportFailure as error:
            failures.append(f"{url} → {error}")
            continue
        return normalize_minimax(body, url)
    raise QuotaError("无法连接 MiniMax：" + "；".join(failures))


def collect(names: list[str]) -> list[dict]:
    keys = load_keys()
    results: list[dict] = []
    for name in names:
        target = TARGETS[name]
        key, origin = resolve_key(name, keys)
        if key is None:
            results.append({
                "name": name,
                "label": target["label"],
                "env": target["env"],
                "hint": target["hint"],
                "status": "unconfigured",
            })
            continue
        try:
            result = query_opencode(key) if name == "opencode" else query_minimax(name, key)
            results.append({"name": name, "label": target["label"], "keySource": origin, **result})
        except QuotaError as error:
            results.append({
                "name": name,
                "label": target["label"],
                "keySource": origin,
                "status": "error",
                "error": str(error),
            })
    return results


WINDOW_LABELS = {"rolling": "5 小时", "weekly": "每周", "monthly": "每月"}


def print_human(results: list[dict]) -> None:
    minimax_configured = any(
        result["status"] != "unconfigured" for result in results if result["name"].startswith("minimax")
    )
    nudged_minimax = False
    for result in results:
        if result["status"] == "unconfigured" and result["name"].startswith("minimax") and minimax_configured:
            continue
        if result["status"] == "unconfigured":
            if result["name"].startswith("minimax"):
                if nudged_minimax:
                    continue
                nudged_minimax = True
                print("MiniMax：未配置 key")
                print(f"  运行：python3 {script_path()} set-key minimax-cn <key>     # 国内站")
                print(f"  或：  python3 {script_path()} set-key minimax-global <key>  # 国际站")
                print("  或用环境变量 MINIMAX_CN_API_KEY / MINIMAX_API_KEY")
            else:
                print(f"{result['label']}：未配置 key")
                print(f"  运行：python3 {script_path()} {result['hint']} <key>")
                print(f"  或设置环境变量 {result['env']}")
            continue
        if result["status"] == "error":
            print(f"{result['label']}：查询失败 — {result['error']}")
            continue
        if result["name"] == "opencode":
            print(f"{result['label']}（{result['url']}）")
            for name in ("rolling", "weekly", "monthly"):
                window = result["windows"][name]
                limited = "（已限流）" if window["status"] == "rate-limited" else ""
                print(f"  {WINDOW_LABELS[name]:<6} 已用 {pm(window['percent'])}{limited}    "
                      f"重置 {fmt_time(window['resetsAt'])}")
            continue
        plan = f"  套餐：{result['plan']}" if result.get("plan") else ""
        print(f"{result['label']}（{result['url']}）{plan}")
        for model in result["models"]:
            if not model["included"]:
                print(f"  {model['name']}：套餐未包含")
                continue
            print(f"  {model['name']}  5 小时剩余 {pm(model['intervalRemainingPercent'])}   "
                  f"每周剩余 {pm(model['weeklyRemainingPercent'])}")
            print(f"    5 小时重置 {fmt_time(model['intervalEndAt'])}   "
                  f"每周重置 {fmt_time(model['weeklyEndAt'])}")


def command_show(args: argparse.Namespace) -> int:
    names = ["opencode", "minimax-cn", "minimax-global"]
    return run(names, args.json)


def command_opencode(args: argparse.Namespace) -> int:
    return run(["opencode"], args.json)


def command_minimax(args: argparse.Namespace) -> int:
    return run(["minimax-cn", "minimax-global"], args.json)


def run(names: list[str], as_json: bool) -> int:
    results = collect(names)
    if as_json:
        print(json.dumps({result["name"]: result for result in results}, ensure_ascii=False, indent=2))
    else:
        print_human(results)
    if all(result["status"] == "unconfigured" for result in results):
        return 2
    return 1 if any(result["status"] == "error" for result in results) else 0


def command_set_key(args: argparse.Namespace) -> int:
    value = args.key
    if value is None:
        if sys.stdin.isatty():
            raise QuotaError("请把 key 作为参数传入，或从标准输入提供")
        value = sys.stdin.read()
    key = valid_key(value)
    keys = load_keys()
    keys[args.name] = key
    save_keys(keys)
    print(f"已保存 {TARGETS[args.name]['label']} key：{mask(key)} → {CONFIG_FILE}（0600）")
    return 0


def command_unset_key(args: argparse.Namespace) -> int:
    keys = load_keys()
    if args.name not in keys:
        print(f"{TARGETS[args.name]['label']} 没有保存的 key")
        return 0
    del keys[args.name]
    save_keys(keys)
    print(f"已删除 {TARGETS[args.name]['label']} 的 key")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="查询 OpenCode Go 与 MiniMax Token Plan 额度")
    parser.add_argument("--json", action="store_true", help="输出 JSON")
    subcommands = parser.add_subparsers(dest="command")

    show = subcommands.add_parser("show", help="查询全部已配置来源")
    show.set_defaults(handler=command_show)

    opencode = subcommands.add_parser("opencode", help="查询 OpenCode Go")
    opencode.set_defaults(handler=command_opencode)

    minimax = subcommands.add_parser("minimax", help="查询 MiniMax")
    minimax.set_defaults(handler=command_minimax)

    set_key = subcommands.add_parser("set-key", help="保存 key")
    set_key.add_argument("name", choices=sorted(TARGETS))
    set_key.add_argument("key", nargs="?", help="省略时从标准输入读取")
    set_key.set_defaults(handler=command_set_key)

    unset_key = subcommands.add_parser("unset-key", help="删除 key")
    unset_key.add_argument("name", choices=sorted(TARGETS))
    unset_key.set_defaults(handler=command_unset_key)
    return parser


def main() -> int:
    parser = build_parser()
    raw = [argument for argument in sys.argv[1:] if argument != "--json"]
    args = parser.parse_args(raw)
    args.json = "--json" in sys.argv[1:]
    handler = getattr(args, "handler", command_show)
    try:
        return handler(args)
    except QuotaError as error:
        print(f"错误：{error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
