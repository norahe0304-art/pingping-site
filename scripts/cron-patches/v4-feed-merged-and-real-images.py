#!/usr/bin/env python3
"""v4 patch for X-feed cron (a536f6d6ea3a):
1. SIGNAL items: deck = ONE paragraph that includes the why.
   `why` field MUST be "" for SIGNAL items (still used for MUST-DO).
2. After JSON is written, fetch og:image for each item.url and
   write it into image_url. Skip x.com URLs (blocked).
3. Items with placeholder URL (x.com/home, x.com or empty) must be
   dropped — only items with a real, specific source URL stay.

Idempotent.
"""
import json, shutil, sys
from pathlib import Path

JOBS = Path("/Users/macxiaoxiao/.hermes/profiles/personal/cron/jobs.json")
JOB_ID = "a536f6d6ea3a"

INSERT_BEFORE_MARKER = "## 中文 Telegram 早报"  # we splice rules just before output sections
SENTINEL = "v4-merged-deck-and-real-images"

NEW_RULES = f"""## 数据质量铁律 (v4 — {SENTINEL})

**1. deck 写一段 (不要单独的 why):**

对 SIGNAL items (rank 1-5), `deck` 字段必须**一段连贯英文**, 既说"是什么"又说"为什么值得看", 融合在 2-3 句里. **不要**单独留 `why`. 对 SIGNAL items 永远写 `"why": ""`.

错误示范 (会被合并显示, 但污染数据):
```json
{{ "deck": "OpenAI is pushing Codex to mobile.",
   "why": "This matters because mobile approval reduces friction." }}
```

正确写法 (一段, why=""):
```json
{{ "deck": "OpenAI is pushing Codex into the phone workflow. Mobile approval and task handoff cut the friction that slows long-running agent work, so this is the clearest near-term wedge for shipping agent surfaces.",
   "why": "" }}
```

对 MUST-DO items (rank 6-7), 规则不变: `deck=""`, `why="为什么今天必须做"` 一句话, `try="具体动作 + timer"`.

**2. 每个 item 必须有真链接:**

`url` 字段必须指向具体一条 post / 一篇 newsletter, **不能是** `https://x.com/home`, `https://x.com`, 或空字符串. 如果一条信号没有真链接, **就不要收**, 重新选一条有具体 URL 的.

**3. image_url 必须有图. 两段 fallback:**

写完 JSON 后, 对每个 SIGNAL item 必须填出 `image_url`. 两段 fallback:

1. **og:image** (优先, 适合 newsletter / 博客 / 公开 web 文章):
   抓 item.url 的 HTML, 找 `<meta property="og:image">`.

2. **LoremFlickr** (X / Twitter 链接, 或 og:image 抓不到):
   X.com 永远 block 爬虫. 从 headline 提 2-3 个具体关键词 (实物名词:
   iphone, chip, laptop, marketing, camera, newspaper...), 组成
   `https://loremflickr.com/600/420/{keywords}?lock={N}` 这个 URL.
   `lock` 是稳定 seed (用 item.id 的数字部分即可, 比如 c001 → 5161),
   保证同一条信号每次拿到同一张真图.

```bash
# JSON 写完后, 跑这段填 image_url
python3 <<'PY'
import json, re, urllib.request, pathlib, hashlib
p = pathlib.Path(f"/tmp/pingping-site/feed/days/{{DATE}}.json")
data = json.loads(p.read_text())

# crude keyword extraction: pick concrete nouns from headline
CONCRETE = {{
    "phone": "iphone", "mobile": "iphone", "codex": "coding",
    "chip": "silicon", "arm": "processor", "google": "chip",
    "newsletter": "newspaper", "ubi": "city,architecture",
    "marketing": "marketing,workshop", "ai": "robot",
    "model": "chip", "agent": "laptop", "video": "camera",
    "image": "studio", "creative": "studio",
}}
def keywords_for(headline):
    h = headline.lower()
    tokens = []
    for k, v in CONCRETE.items():
        if k in h:
            for t in v.split(","): tokens.append(t)
    # always add a generic anchor
    if not tokens:
        tokens = ["office", "laptop"]
    # dedupe, keep first 3
    seen, out = set(), []
    for t in tokens:
        if t not in seen:
            seen.add(t); out.append(t)
        if len(out) >= 3: break
    return ",".join(out)

for it in data["items"]:
    if (it.get("source") or {{}}).get("kind") == "task":
        continue  # MUST-DO items don't need image
    u = it.get("url", "")
    found = None
    if u and "x.com" not in u and "twitter.com" not in u:
        try:
            req = urllib.request.Request(u, headers={{"User-Agent": "Mozilla/5.0"}})
            html = urllib.request.urlopen(req, timeout=8).read().decode("utf-8", "ignore")
            m = re.search(r'<meta[^>]+property=["\\']og:image["\\'][^>]+content=["\\']([^"\\']+)["\\']', html)
            if m: found = m.group(1)
        except Exception: pass
    if not found:
        kw = keywords_for(it.get("headline",""))
        # stable lock from item id like "c003" → 5163
        digits = "".join(c for c in it["id"] if c.isdigit()) or "0"
        lock = 5160 + int(digits)
        found = f"https://loremflickr.com/600/420/{{kw}}?lock={{lock}}"
    it["image_url"] = found
p.write_text(json.dumps(data, indent=2, ensure_ascii=False))
PY
```

(把 `{{DATE}}` 换成 `$(date -u +%Y-%m-%d)` 之类的 shell 表达式.)

也别忘了同步 manifest.json 的 `lead_image_url` (rank-1 item 的 image_url, 用于 rack 封面).

"""

def main():
    raw = JOBS.read_text()
    data = json.loads(raw)
    target = next((j for j in data["jobs"] if j["id"] == JOB_ID), None)
    if not target:
        sys.exit(f"job {JOB_ID} not found")

    p = target["prompt"]
    if SENTINEL in p:
        print("✓ already on v4, no-op")
        return

    idx = p.find(INSERT_BEFORE_MARKER)
    if idx < 0:
        sys.exit(f"could not find marker `{INSERT_BEFORE_MARKER}`")

    shutil.copy(JOBS, JOBS.with_suffix(".json.bak-feed-v4"))
    new_p = p[:idx] + NEW_RULES + "\n" + p[idx:]
    target["prompt"] = new_p
    JOBS.write_text(json.dumps(data, indent=2, ensure_ascii=False))
    print(f"✓ v4 applied to X-feed cron")
    print(f"  added: {len(NEW_RULES)} chars")
    print(f"  backup: jobs.json.bak-feed-v4")

if __name__ == "__main__":
    main()
