#!/usr/bin/env python3
"""v5 patch for X-feed cron (a536f6d6ea3a):

After Pingping writes feed/days/YYYY-MM-DD.json, run the two helper
scripts checked into this repo so each new day's items get:
  1. a unique Met Museum public-domain masterwork (fetch-art-images.mjs)
  2. no two adjacent stripes in the same color (diversify-tag-colors.mjs)

Both scripts are idempotent — re-running on existing days is a no-op.

Replaces v4 (og:image + LoremFlickr). v4 was never applied; v5 is the
only image-related cron rule going forward. Pingping must leave
`image_url: ""` on every item it writes — the fetcher fills them in.

Idempotent. Re-runs detect the SENTINEL and exit.
"""
import json, shutil, sys
from pathlib import Path

JOBS = Path("/Users/macxiaoxiao/.hermes/profiles/personal/cron/jobs.json")
JOB_ID = "a536f6d6ea3a"

INSERT_BEFORE_MARKER = "## 中文 Telegram 早报"
SENTINEL = "v5-art-and-colors"

NEW_RULES = f"""## 数据质量铁律 (v5 — {SENTINEL})

**1. SIGNAL items: deck 一段、why=""**

对 SIGNAL items (rank 1-5), `deck` 字段必须**一段连贯英文**, 既说"是什么"又说"为什么值得看", 2-3 句融合, **不要**单独留 `why` —— SIGNAL items 永远写 `"why": ""`.

对 MUST-DO items (rank 6-7), 规则不变: `deck=""`, `why="为什么今天必须做"`, `try="具体动作 + timer"`.

**2. url 必须真**

`url` 必须指向具体一条 post / 一篇 newsletter, **不能是** `https://x.com/home`, `https://x.com`, 或空字符串. 没真链接的信号就不要收, 换一条.

**3. image_url 永远写空字符串**

每个 item 的 `image_url` 字段**永远写 `""`**. 不要试图抓 og:image, 不要用 LoremFlickr, 不要 Pollinations. 写完 JSON 后由仓库里的 `fetch-art-images.mjs` 脚本统一从 Met Museum Open Access API 抓独家真画 (公共领域, 全局去重).

**4. 写完 JSON 必须跑两个脚本**

JSON 落盘 + manifest 更新之后, **commit 之前**, 在 `/tmp/pingping-site` 仓库目录下顺序跑:

```bash
cd /tmp/pingping-site

# 给新 day 的每个 item 配一张独家 Met 真画
# (downloads to feed/art/met-<oid>.jpg, sets image_url)
# 已经有图的 item 自动 skip, 只填空 slot
node scripts/fetch-art-images.mjs

# 修色 stripe 相邻不撞色 (within-day + cover strip + cover↔lead)
node scripts/diversify-tag-colors.mjs
```

两个脚本都是 idempotent. fetch-art-images.mjs 需要 ImageMagick (`magick` 命令); Mac mini 已经装了, GitHub Actions 没装所以这两脚本不能跑在 Actions 里.

**5. commit 必须带上 art 文件夹**

最终的 `git add` 不止 feed/days/, 还要带 feed/art/:

```bash
git add feed/days/ feed/art/
git commit -m "feed: $(date -u +%Y-%m-%d)"
git push
```

"""

def main():
    raw = JOBS.read_text()
    data = json.loads(raw)
    target = next((j for j in data["jobs"] if j["id"] == JOB_ID), None)
    if not target:
        sys.exit(f"job {JOB_ID} not found")

    p = target["prompt"]
    if SENTINEL in p:
        print("✓ already on v5, no-op")
        return

    # also strip any v4 fragments if a previous half-applied attempt left them
    if "v4-merged-deck-and-real-images" in p:
        # find the v4 block boundaries and remove
        start = p.find("## 数据质量铁律 (v4")
        end   = p.find(INSERT_BEFORE_MARKER, start)
        if start >= 0 and end > start:
            p = p[:start] + p[end:]
            print(f"  removed orphaned v4 block ({end-start} chars)")

    idx = p.find(INSERT_BEFORE_MARKER)
    if idx < 0:
        sys.exit(f"could not find marker `{INSERT_BEFORE_MARKER}`")

    shutil.copy(JOBS, JOBS.with_suffix(".json.bak-feed-v5"))
    new_p = p[:idx] + NEW_RULES + "\n" + p[idx:]
    target["prompt"] = new_p
    JOBS.write_text(json.dumps(data, indent=2, ensure_ascii=False))
    print(f"✓ v5 applied to X-feed cron")
    print(f"  added: {len(NEW_RULES)} chars")
    print(f"  backup: jobs.json.bak-feed-v5")

if __name__ == "__main__":
    main()
