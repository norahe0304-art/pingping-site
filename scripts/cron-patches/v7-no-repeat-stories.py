#!/usr/bin/env python3
"""v7 patch for X-feed cron (a536f6d6ea3a):

Eliminate cross-day story repeats. Today's feed must contain ZERO stories
that appeared in any of the last 7 days. The repeat-protection isn't
just string match — it's topic match. "Codex Mobile begins to leak"
(5-15), "OpenAI puts Codex on mobile" (5-16), "OpenAI puts Codex in
ChatGPT iOS" (5-17) are all the SAME story.

Before v7: same Codex-mobile story shipped as #1 cover headline 3
consecutive days. Corey Haines marketing skills v2.0 hit all 3 days.
Sam Altman UBI + Google CPU inference each hit 2 days.

v7 adds a mandatory "read last 7 days, dedupe by topic" step to the
cron prompt with an explicit before-finalize self-check.

Idempotent. Re-runs no-op via SENTINEL.
"""
import json, shutil, sys
from pathlib import Path

JOBS = Path("/Users/macxiaoxiao/.hermes/profiles/personal/cron/jobs.json")
JOB_ID = "a536f6d6ea3a"
SENTINEL = "v7-no-repeat-stories"

INSERT_BEFORE_MARKER = "## 中文 Telegram 早报"

NEW_RULES = f"""## 反复读铁律 (v7 — {SENTINEL})

**每天的 11 条 SIGNAL 必须都是新故事**. 不允许任何一条跟过去 7 天的 lead/headlines/decks 在主题层面重复. 这是硬性要求.

### 写 today JSON 之前的强制流程

1. **读过去 7 天**:
   ```bash
   for d in $(python3 -c "
   from datetime import date, timedelta
   t = date.fromisoformat('$(date -u +%Y-%m-%d)')
   for i in range(1, 8):
       print((t - timedelta(days=i)).isoformat())
   "); do
       if [ -f "/tmp/pingping-site/feed/days/$d.json" ]; then
           echo "=== $d ==="
           jq -r '.items[] | "[" + .id + "] " + .headline + " — " + (.deck // "")[:120]' "/tmp/pingping-site/feed/days/$d.json"
       fi
   done
   ```

2. **提取过去 7 天的所有"主题"**: 不是 headline 的字面 string, 是**底层故事概念**. 例如这三条都是同一主题:
   - "Codex on mobile begins to leak" (5-15)
   - "OpenAI puts Codex on mobile, not just desktop" (5-16)
   - "OpenAI puts Codex in ChatGPT iOS — ship code from your phone" (5-17)

   一个主题 = 一个独立的产品发布 / 公司动作 / 人物声明 / 数据点. 同一公司的不同产品算不同主题; 同一产品的渐进 update 不算新主题.

3. **写今天 11 条 SIGNAL 时**: 每一条都跟过去 7 天的主题列表 **AND** 今天已经写的其他 11 条互相 cross-check, 任何一条已经出现过的主题立即换掉. 即使新闻 newsletter 这周都在炒 Codex Mobile, 你今天也**不允许**再写它, 除非有**根本性**的新事实 (例如 "Codex 数据泄漏" "Codex 被下架" — 跟之前的 "Codex 上 iOS" 是不同故事).

4. **落盘前自检 — 必须通过才 commit**:
   ```bash
   python3 <<'PY'
   import json
   from datetime import date, timedelta
   today = date.fromisoformat('$(date -u +%Y-%m-%d)')
   today_doc = json.load(open(f"/tmp/pingping-site/feed/days/{{today}}.json"))
   today_headlines = [it["headline"].lower() for it in today_doc.get("items", [])]
   # check overlap with last 7 days
   repeats = []
   for i in range(1, 8):
       d = (today - timedelta(days=i)).isoformat()
       try:
           prev = json.load(open(f"/tmp/pingping-site/feed/days/{{d}}.json"))
       except FileNotFoundError:
           continue
       prev_corpus = " ".join((it.get("headline","") + " " + it.get("deck","")).lower() for it in prev.get("items", []))
       for th in today_headlines:
           # any 3-word noun phrase from today's headline appearing in prev?
           words = [w for w in th.split() if len(w) > 3 and w not in {{"with","from","this","that","into","than","also","then"}}]
           for j in range(len(words)-2):
               trigram = " ".join(words[j:j+3])
               if trigram in prev_corpus:
                   repeats.append((th[:60], d, trigram))
                   break
   if repeats:
       print("REPEAT DETECTED — DO NOT COMMIT, rewrite today's items:")
       for h, d, t in repeats:
           print(f"  '{{h}}...' matches {{d}} via '{{t}}'")
       import sys; sys.exit(1)
   else:
       print("OK no repeats with last 7 days")
   PY
   ```

   自检脚本退出 1 → **不要 commit**, 改完上面的 SIGNAL items 再重新跑.

### 边界情况

- **正在发展的故事 (e.g. OpenAI 跟 SpaceX 的算力合作连发 3 周新闻)**: 只在有**真正的新闻发展**的当天写, 否则跳过. 不要为了凑数把过去的事再说一遍.
- **多事件 cluster (e.g. 一周 5 个 AI 视频模型发布)**: 每天选**不同**的那个写, 不要每天都写"Seedance" 或都写 "Sora 后续".
- **作者维度** (e.g. Corey Haines 这周连续发 3 条): 选最新最 sharp 的那条, 其余跳过.

"""

def main():
    raw = JOBS.read_text()
    data = json.loads(raw)
    target = next((j for j in data["jobs"] if j["id"] == JOB_ID), None)
    if not target:
        sys.exit(f"job {JOB_ID} not found")

    p = target["prompt"]
    if SENTINEL in p:
        print("✓ already on v7, no-op")
        return

    idx = p.find(INSERT_BEFORE_MARKER)
    if idx < 0:
        sys.exit(f"could not find marker `{INSERT_BEFORE_MARKER}`")

    shutil.copy(JOBS, JOBS.with_suffix(".json.bak-feed-v7"))
    new_p = p[:idx] + NEW_RULES + "\n" + p[idx:]
    target["prompt"] = new_p
    JOBS.write_text(json.dumps(data, indent=2, ensure_ascii=False))
    print(f"✓ v7 applied to X-feed cron")
    print(f"  prompt: {len(p)} → {len(new_p)} chars ({len(new_p)-len(p):+d})")
    print(f"  backup: jobs.json.bak-feed-v7")

if __name__ == "__main__":
    main()
