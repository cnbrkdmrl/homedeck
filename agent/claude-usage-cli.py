#!/usr/bin/env python3
"""Sunucuda Claude Code'un `claude -p "/usage"` ciktisini okuyup hub'a kota olarak yollar.

- Resmi olmayan uc noktaya DOKUNMAZ: sadece Claude Code'un kendi /usage komutunu calistirir.
- Token'a bakmaz; yenilemeyi Claude Code kendisi yapar. Bu betik hicbir gizli bilgi okumaz/yazmaz.
- Yapilandirma: ~/.homedeck-claude/config.json  {"hub": "http://127.0.0.1:8787", "token": "...", "plan": "Pro"}
Kullanim:  claude-usage-cli.py            (oku + yolla)
           claude-usage-cli.py --dry-run  (sadece oku, yazdir)
"""
import json, os, re, subprocess, sys, time, urllib.request
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

CLAUDE = os.environ.get("CLAUDE_BIN") or os.path.expanduser("~/.local/bin/claude")
CFG = os.path.expanduser("~/.homedeck-claude/config.json")
LINE = re.compile(r"^\s*(?P<name>[^:]+?):\s*(?P<pct>\d+(?:\.\d+)?)%\s*used(?:\s*[·•-]\s*resets\s+(?P<when>.+?))?\s*$")
WHEN = re.compile(r"^(?P<mon>[A-Za-z]{3})[a-z]*\s+(?P<day>\d{1,2}),?\s+(?P<h>\d{1,2})(?::(?P<m>\d{2}))?\s*(?P<ap>[ap]m)(?:\s*\((?P<tz>[^)]+)\))?$", re.I)
MONTHS = {m: i + 1 for i, m in enumerate("jan feb mar apr may jun jul aug sep oct nov dec".split())}


def parse_when(text, now):
    """'Nov 12, 1:50am (Europe/Istanbul)' -> epoch ms (yil yok: en yakin gelecek)."""
    m = WHEN.match((text or "").strip())
    if not m:
        return None
    try:
        tz = ZoneInfo(m.group("tz")) if m.group("tz") else now.astimezone().tzinfo
        h = int(m.group("h")) % 12 + (12 if m.group("ap").lower() == "pm" else 0)
        base = dict(month=MONTHS[m.group("mon").lower()[:3]], day=int(m.group("day")),
                    hour=h, minute=int(m.group("m") or 0))
        cand = datetime(now.year, tzinfo=tz, **base)
        if cand < now - timedelta(days=2):
            cand = datetime(now.year + 1, tzinfo=tz, **base)
        return int(cand.timestamp() * 1000)
    except Exception:
        return None


def label_and_window(name):
    n = name.strip().lower()
    if "session" in n:
        return "Oturum", 5 * 3600
    if n.startswith("current week"):
        inner = re.search(r"\(([^)]*)\)", name)
        who = inner.group(1).strip() if inner else ""
        if not who or who.lower() == "all models":
            return "Hafta", 7 * 86400
        return ("Hafta · " + who)[:30], 7 * 86400
    return name.strip()[:30], None


def parse_usage(text, now=None):
    now = now or datetime.now().astimezone()
    limits = []
    for raw in text.splitlines():
        m = LINE.match(raw)
        if not m:
            continue
        label, win = label_and_window(m.group("name"))
        limits.append({
            "label": label,
            "percent": float(m.group("pct")),
            "resetsAt": parse_when(m.group("when"), now) if m.group("when") else None,
            "windowSec": win,
        })
    return limits


def main():
    dry = "--dry-run" in sys.argv
    try:
        out = subprocess.run([CLAUDE, "-p", "/usage"], stdin=subprocess.DEVNULL, capture_output=True,
                             text=True, timeout=90, cwd=os.path.expanduser("~")).stdout
    except Exception as e:
        print("claude calistirilamadi:", e, file=sys.stderr)
        return 1
    limits = parse_usage(out)
    if not limits:
        print("limit satiri bulunamadi (giris suresi dolmus olabilir). Cikti:", out[:300].strip(), file=sys.stderr)
        return 2
    cfg = {}
    try:
        cfg = json.load(open(CFG))
    except Exception:
        if not dry:
            print("config okunamadi:", CFG, file=sys.stderr)
            return 3
    body = {"providers": [{"id": "claude", "name": "Claude", "plan": cfg.get("plan", "Pro"),
                           "observedAt": int(time.time() * 1000), "limits": limits}]}
    if dry:
        print(json.dumps(body, indent=2, ensure_ascii=False))
        return 0
    req = urllib.request.Request(cfg["hub"].rstrip("/") + "/api/quota", data=json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json", "Authorization": "Bearer " + cfg["token"]})
    try:
        urllib.request.urlopen(req, timeout=10).read()
    except Exception as e:
        print("hub'a yollanamadi:", e, file=sys.stderr)
        return 4
    return 0


if __name__ == "__main__":
    sys.exit(main())
