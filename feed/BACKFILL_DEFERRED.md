# Feed backfill — deferred (Mac mini offline)

## Status as of 2026-05-16

- `feed/days/` currently has **1** issue: `2026-05-16.json`
- Pingping's cron archive on Mac mini has ~47 historical 早报 .md files
  at `~/.hermes/profiles/personal/cron/output/a536f6d6ea3a/`
  spanning 2026-05-05 → 2026-05-16
- Mac mini (`macxiaoxiao@192.168.1.245`) is **unreachable** today
  (ping times out, SSH times out)

## When Mac mini is back, do this

```bash
# 1. mirror the archive locally
mkdir -p ~/cron-archive-pingping
rsync -avz macxiaoxiao@192.168.1.245:'~/.hermes/profiles/personal/cron/output/a536f6d6ea3a/*.md' \
  ~/cron-archive-pingping/

# 2. translate + restructure each .md into feed JSON
# (run from pingping-site root; needs ANTHROPIC_API_KEY)
node scripts/backfill-feed.mjs --archive ~/cron-archive-pingping \
                               --limit 10 \
                               --out feed/days/

# 3. rebuild manifest.json from all feed/days/*.json
node scripts/rebuild-feed-manifest.mjs

# 4. push
git add feed/days artifacts && git commit -m "feed: backfill 10 historical issues" && git push
```

## What still needs writing

- `scripts/backfill-feed.mjs` — reads .md, calls Claude to translate
  + restructure to the `feed/days/YYYY-MM-DD.json` schema, picks 10
  most-recent unique-day issues
- `scripts/rebuild-feed-manifest.mjs` — scans feed/days/, generates
  the manifest.json preview list

Both deferred until source archive is reachable. No point writing
translation logic against schema we cannot verify against real source
files.

## Schema target (matches 2026-05-16.json)

```jsonc
{
  "date": "YYYY-MM-DD",
  "weekday": "Saturday",
  "no": 107,
  "edition": "Nora's Early Brief",
  "generated_at": "...Z",
  "promo_headline": "...",
  "whats_news": ["<b>X</b>: ...", ...],     // 5 bolded leads
  "digest": { "title": "...", "body": "..." },
  "items": [
    // 5 SIGNAL items + 2 MUST-DO tasks = 7 total
    {
      "id": "c001", "rank": 1,
      "tag": "SIGNAL", "tag_color": "indigo|pink|cyan|amber",
      "kicker": "Today's Top Signal",
      "headline": "...", "deck": "...", "why": "...", "try": "",
      "url": "https://...", "image_url": "",
      "read_time_min": 5,
      "author": { "name", "handle", "role", "avatar_url" },
      "source": { "label": "X · trend", "kind": "x|newsletter|task" }
    },
    // ... last 2 items have kind: "task", kicker: "Today's Must-Do"
  ]
}
```
