#!/usr/bin/env python3
"""
 * [INPUT]: Reads Hermes cron markdown output for PINGPING feed and diary jobs, plus existing pingping-site JSON/frontmatter files.
 * [OUTPUT]: Writes feed/days/YYYY-MM-DD.json, feed/days/manifest.json, diary/YYYY-MM-DD.html, optional artifact SVGs, git commits, and pushes.
 * [POS]: scripts publishing bridge between Hermes cron output and the static Vercel site; replaces prompt-driven site mutation.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
"""

import argparse
import json
import os
import re
import subprocess
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(os.environ.get("PINGPING_SITE_REPO", "/Users/macxiaoxiao/code/pingping-site")).expanduser()
CRON_OUT = Path(os.environ.get("PINGPING_CRON_OUTPUT", "/Users/macxiaoxiao/.hermes/profiles/personal/cron/output")).expanduser()
FEED_JOB = os.environ.get("PINGPING_FEED_JOB_ID", "a536f6d6ea3a")
DIARY_JOB = os.environ.get("PINGPING_DIARY_JOB_ID", "a130f54960a2")
FIRST_ISSUE = date(2026, 1, 30)
PALETTE = ["pink", "amber", "cyan", "indigo"]
NODE_CANDIDATES = [
    os.environ.get("NODE_BIN", ""),
    "/Users/macxiaoxiao/.hermes/node/bin/node",
    "node",
]
ART_FETCH_TIMEOUT = int(os.environ.get("PINGPING_FETCH_ART_TIMEOUT", "45"))


def log(msg):
    print(f"[pingping-site-publisher] {msg}", file=sys.stderr)


def run(cmd, cwd=ROOT, check=True):
    log("$ " + " ".join(cmd))
    return subprocess.run(cmd, cwd=cwd, check=check, text=True, capture_output=True)


def clean_text(s):
    return re.sub(r"\s+", " ", s.replace("**", "").strip())


def parse_date(value):
    return datetime.strptime(value, "%Y-%m-%d").date()


def date_range(start, end):
    cur = start
    while cur <= end:
        yield cur
        cur += timedelta(days=1)


def choose_cron_file(job_id, day):
    out_dir = CRON_OUT / job_id
    files = sorted(out_dir.glob(f"{day.isoformat()}_*.md"))
    if not files:
        return None
    preferred = []
    for f in files:
        m = re.search(r"_(\d{2})-(\d{2})-", f.name)
        if not m:
            continue
        hour = int(m.group(1))
        minute = int(m.group(2))
        if 8 <= hour <= 9 or (hour == 10 and minute == 0):
            preferred.append(f)
    return preferred[0] if preferred else files[-1]


def extract_response(path):
    raw = path.read_text(encoding="utf-8", errors="replace")
    marker = "\n## Response\n"
    if marker not in raw:
        raise RuntimeError(f"missing ## Response in {path}")
    return raw.split(marker, 1)[1].strip().replace("\r\n", "\n")


def split_numbered_item(line):
    m = re.match(r"^\s*(\d+)[\)\.、]\s*(.+?)\s*$", line)
    return (int(m.group(1)), m.group(2).strip()) if m else None


def split_link(text):
    m = re.search(r"(?:链接|link)\s*[:：]\s*(https?://\S+)", text, flags=re.I)
    if not m:
        return text.strip(), ""
    url = m.group(1).rstrip("。.,，)）]")
    return (text[:m.start()] + text[m.end():]).strip(), url


def split_value(text):
    m = re.search(r"值得看\s*[:：]\s*", text)
    if not m:
        return clean_text(text), ""
    title = clean_text(text[:m.start()].rstrip(".。:："))
    deck = clean_text(text[m.end():])
    if "一句话标题" in title:
        source = title.split(":", 1)[0].split("：", 1)[0].strip()
        first = re.split(r"[。.!?？]", deck)[0].strip()
        title = clean_text(f"{source}: {first[:64]}")
    return title, deck


def split_task(text):
    rest, _url = split_link(text)
    why = ""
    timer = ""
    m = re.search(r"为什么今天必须做\s*[:：]\s*", rest)
    if m:
        title = clean_text(rest[:m.start()].rstrip(".。"))
        tail = rest[m.end():]
    else:
        title = clean_text(rest)
        tail = ""
    tm = re.search(r"时间\s*[:：]\s*([^。\.]+)", tail)
    if tm:
        why = clean_text(tail[:tm.start()].rstrip(".。"))
        timer = clean_text(tm.group(1))
    else:
        why = clean_text(tail)
    return title, why, timer


def source_from_url(url, fallback):
    if not url:
        return fallback or "PINGPING"
    host = urlparse(url).netloc.lower().replace("www.", "")
    if "x.com" in host or "twitter.com" in host:
        parts = [p for p in urlparse(url).path.split("/") if p]
        return parts[0] if parts else "X"
    return host.split(".")[0] or fallback or "web"


def extract_sections(response):
    section = None
    news = []
    tasks = []
    insight = []
    for raw in response.splitlines():
        line = raw.strip().strip(" \u3000")
        if not line:
            continue
        if line.startswith("📌") or "今日速览" in line:
            section = "news"
            continue
        if line.startswith("✅") or "今日必做" in line:
            section = "tasks"
            continue
        if line.startswith("💡") or "今日洞察" in line or "深度思考" in line:
            section = "insight"
            continue
        if line.lower().startswith("view on web"):
            continue
        numbered = split_numbered_item(line)
        if section == "news" and numbered:
            rest, url = split_link(numbered[1])
            title, deck = split_value(rest)
            if title and url:
                news.append({"rank": numbered[0], "title": title, "deck": deck, "url": url})
            continue
        if section == "tasks" and numbered:
            title, why, timer = split_task(numbered[1])
            if title:
                tasks.append({"rank": numbered[0], "title": title, "why": why, "timer": timer})
            continue
        if section == "insight":
            insight.append(clean_text(line.lstrip("-• ")))
    return news, tasks, insight


def build_feed_issue(day, response):
    news, tasks, insight_lines = extract_sections(response)
    if not news:
        raise RuntimeError(f"no feed news items parsed for {day}")
    issue_no = (day - FIRST_ISSUE).days + 1
    items = []
    lead_url = news[0]["url"]
    for idx, item in enumerate(news, 1):
        color = PALETTE[(idx - 1) % len(PALETTE)]
        source_name = source_from_url(item["url"], item["title"].split(":", 1)[0])
        kind = "x" if "x.com" in item["url"] or "twitter.com" in item["url"] else "web"
        items.append({
            "id": f"c{idx:03d}",
            "rank": idx,
            "tag": "SIGNAL",
            "tag_color": color,
            "kicker": "Today's Top Signal" if idx == 1 else "Markets & Models",
            "headline": item["title"],
            "deck": item["deck"],
            "why": "",
            "try": "",
            "url": item["url"],
            "image_url": "",
            "read_time_min": 5,
            "author": {
                "name": source_name,
                "handle": source_name if kind == "x" else "",
                "role": "source",
                "avatar_url": f"https://unavatar.io/x/{source_name}" if kind == "x" else "",
            },
            "source": {"label": "X · post" if kind == "x" else source_name, "kind": kind},
        })
    for task in tasks:
        rank = len(items) + 1
        timer = task.get("timer") or "30 min"
        items.append({
            "id": f"c{rank:03d}",
            "rank": rank,
            "tag": "PLAYBOOK",
            "tag_color": PALETTE[(rank - 1) % len(PALETTE)],
            "kicker": "Today's Must-Do",
            "headline": task["title"],
            "deck": "",
            "why": task.get("why", ""),
            "try": f"Timer: {timer}.",
            "url": lead_url,
            "image_url": "",
            "read_time_min": 4,
            "author": {"name": "PINGPING", "handle": "", "role": "daily editor", "avatar_url": ""},
            "source": {"label": f"Must-do · {timer}", "kind": "task"},
        })
    insight = " ".join(insight_lines).strip() or news[0]["deck"]
    whats_news = []
    for item in news[:5]:
        actor = item["title"].split(":", 1)[0].split("：", 1)[0][:40]
        whats_news.append(f"<b>{actor}</b>: {item['title']}")
    return {
        "date": day.isoformat(),
        "weekday": day.strftime("%A"),
        "no": issue_no,
        "edition": "Nora's Early Brief",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "promo_headline": f"{len(news)} signals. {len(tasks)} moves. One pattern.",
        "whats_news": whats_news,
        "digest": {"title": "Today in AI operations", "body": insight},
        "items": items,
    }


def write_feed_issue(issue):
    days_dir = ROOT / "feed" / "days"
    days_dir.mkdir(parents=True, exist_ok=True)
    day_path = days_dir / f"{issue['date']}.json"
    day_path.write_text(json.dumps(issue, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    manifest_path = days_dir / "manifest.json"
    manifest_raw = json.loads(manifest_path.read_text(encoding="utf-8")) if manifest_path.exists() else {"updated_at": "", "days": []}
    wrapped = isinstance(manifest_raw, dict) and isinstance(manifest_raw.get("days"), list)
    days = manifest_raw["days"] if wrapped else manifest_raw
    lead = issue["items"][0]
    preview = {
        "date": issue["date"],
        "weekday": issue["weekday"],
        "no": issue["no"],
        "edition": issue["edition"],
        "promo_headline": issue["promo_headline"],
        "lead_kicker": lead["kicker"],
        "lead_headline": lead["headline"],
        "lead_deck": lead["deck"],
        "lead_tag": lead["tag"],
        "tag_color": lead["tag_color"],
        "story_count": len(issue["items"]),
        "read_time_total_min": sum(int(i.get("read_time_min", 0)) for i in issue["items"]),
        "lead_author": lead["author"],
        "lead_source": lead["source"],
        "lead_image_url": lead.get("image_url", ""),
    }
    days = [d for d in days if d.get("date") != issue["date"]]
    days.append(preview)
    days.sort(key=lambda d: d.get("date", ""), reverse=True)
    if wrapped:
        manifest_raw["days"] = days[:80]
        manifest_raw["updated_at"] = datetime.now(timezone.utc).isoformat()
        out = manifest_raw
    else:
        out = days[:80]
    manifest_path.write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    log(f"wrote feed issue {issue['date']} ({len(issue['items'])} items)")


def clean_diary_response(response):
    lines = []
    keep = False
    has_marker = "中文日记正文如下" in response
    for raw in response.splitlines():
        line = raw.rstrip()
        if "中文日记正文如下" in line:
            keep = True
            continue
        if has_marker and not keep:
            continue
        if line.startswith("本地已") or "push 失败" in line or line.startswith("⚠️"):
            continue
        if line.startswith("https://pingping-site.vercel.app/diary/"):
            continue
        if line.lower().startswith("view on web"):
            continue
        if line.startswith("commit:") or line.startswith("- commit:") or line.startswith("- 文件"):
            continue
        lines.append(line)
    body = "\n".join(lines).strip()
    if not body:
        raise RuntimeError("empty diary response")
    return body


def title_for_diary(body):
    for line in body.splitlines():
        line = clean_text(line.strip("#> -*"))
        if line and not line.startswith("side]"):
            words = re.findall(r"[A-Za-z]+", line.lower())
            if len(words) >= 3:
                return " ".join(words[:5])[:80]
            return "a day kept in place"
    return "a day kept in place"


def ensure_artifact(day):
    art_dir = ROOT / "artifacts"
    art_dir.mkdir(parents=True, exist_ok=True)
    svg = art_dir / f"{day.isoformat()}.svg"
    if svg.exists():
        return svg
    seed = sum(ord(c) for c in day.isoformat())
    x = 160 + seed % 120
    y = 135 + seed % 80
    svg.write_text(f'''<svg xmlns="http://www.w3.org/2000/svg" width="600" height="420" viewBox="0 0 600 420">
  <rect width="600" height="420" fill="#fff"/>
  <path d="M {x} {y} C {x+45} {y-28}, {x+115} {y+40}, {x+180} {y+8} S {x+270} {y+65}, {x+310} {y+36}" fill="none" stroke="#1a1a1a" stroke-width="4" stroke-linecap="round"/>
  <circle cx="{x+245}" cy="{y+54}" r="18" fill="none" stroke="#1a1a1a" stroke-width="4"/>
</svg>
''', encoding="utf-8")
    log(f"wrote artifact {svg.name}")
    return svg


def write_diary(day, response):
    body = clean_diary_response(response)
    ensure_artifact(day)
    diary_dir = ROOT / "diary"
    diary_dir.mkdir(parents=True, exist_ok=True)
    dot = day.isoformat().replace("-", ".")
    title = title_for_diary(body)
    out = diary_dir / f"{day.isoformat()}.html"
    frontmatter = (
        "---\n"
        f"title: \"{title}\"\n"
        f"date: {day.isoformat()}\n"
        "author: PINGPING\n"
        f"cover: ../artifacts/{day.isoformat()}.svg\n"
        "coverAlt: \"a small crooked line on white, drawn badly\"\n"
        f"coverCaption: \"Artifact {dot}: daily mark\"\n"
        "---\n\n"
    )
    out.write_text(frontmatter + body + "\n", encoding="utf-8")
    log(f"wrote diary {out.name}")


def find_node():
    for candidate in NODE_CANDIDATES:
        if not candidate:
            continue
        try:
            res = subprocess.run([candidate, "--version"], text=True, capture_output=True, timeout=5)
        except Exception:
            continue
        if res.returncode == 0:
            return candidate
    return None


def enabled(name):
    return os.environ.get(name, "").strip().lower() in {"1", "true", "yes", "on"}


def maybe_run_node_scripts(kind, dates):
    node = find_node()
    if not node:
        log("node not found; skipping optional node scripts")
        return
    unique_dates = sorted(set(dates))
    if kind in {"feed", "all"}:
        if enabled("PINGPING_FETCH_ART"):
            for d in unique_dates:
                try:
                    subprocess.run(
                        [node, "scripts/fetch-art-images.mjs", "--date", d.isoformat()],
                        cwd=ROOT,
                        text=True,
                        timeout=ART_FETCH_TIMEOUT,
                    )
                except subprocess.TimeoutExpired:
                    log(f"optional art fetch timed out for {d}; continuing")
        else:
            log("optional art fetch disabled; set PINGPING_FETCH_ART=1 to enable")
        subprocess.run([node, "scripts/diversify-tag-colors.mjs"], cwd=ROOT, text=True)
    if kind in {"diary", "all"}:
        subprocess.run([node, "scripts/build-diary.mjs"], cwd=ROOT, text=True, check=True)


def git_commit_and_push(message, push=True):
    run(["git", "add", "feed/days", "feed/art", "diary", "artifacts"], check=True)
    diff = subprocess.run(["git", "diff", "--cached", "--quiet"], cwd=ROOT)
    if diff.returncode == 0:
        log("no staged changes")
        print("[SILENT]")
        return
    run(["git", "-c", "user.name=pingping", "-c", "user.email=pingping@noreply.github.com", "commit", "-m", message], check=True)
    if push:
        run(["git", "push"], check=True)
    print("[SILENT]")


def publish(kind, dates, push=True, dry_run=False):
    if not (ROOT / "feed" / "days").exists():
        raise RuntimeError(f"not a pingping-site repo: {ROOT}")
    written = []
    for day in dates:
        if kind in {"feed", "all"}:
            f = choose_cron_file(FEED_JOB, day)
            if not f:
                log(f"no feed cron output for {day}")
            else:
                issue = build_feed_issue(day, extract_response(f))
                if not dry_run:
                    write_feed_issue(issue)
                written.append(("feed", day))
        if kind in {"diary", "all"}:
            f = choose_cron_file(DIARY_JOB, day)
            if not f:
                log(f"no diary cron output for {day}")
            else:
                if not dry_run:
                    write_diary(day, extract_response(f))
                written.append(("diary", day))
    if dry_run:
        for k, d in written:
            log(f"dry-run parsed {k} {d}")
        return
    maybe_run_node_scripts(kind, [d for _, d in written])
    if written:
        label = ", ".join(f"{k}:{d.isoformat()}" for k, d in written)
        git_commit_and_push(f"pingping-site: publish {label}", push=push)
    else:
        print("[SILENT]")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--kind", choices=["feed", "diary", "all"], default="all")
    ap.add_argument("--date", action="append")
    ap.add_argument("--start")
    ap.add_argument("--end")
    ap.add_argument("--no-push", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    if args.date:
        dates = [parse_date(d) for d in args.date]
    else:
        start = parse_date(args.start) if args.start else date.today()
        end = parse_date(args.end) if args.end else start
        dates = list(date_range(start, end))
    publish(args.kind, dates, push=not args.no_push, dry_run=args.dry_run)


if __name__ == "__main__":
    main()
