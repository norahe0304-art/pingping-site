# pingping feed pipeline

Daily AI-marketing wire. Every cover = one day. Every story = real source URL.

## Architecture

The daily content cron runs on the **Mac mini Hermes** system (job id `a536f6d6ea3a`),
NOT on GitHub Actions. Pingping (the AI agent on that machine) is the
source of truth for daily curation output. The site mutation is no
longer prompt-driven: `scripts/pingping-site-publisher.py` is the
no-agent bridge that reads Hermes cron output, writes feed/diary files,
commits, and pushes from the canonical repo at `/Users/macxiaoxiao/code/pingping-site`.

```
~08:30 ET daily (Mac mini Hermes cron a536f6d6ea3a)
   │
   ▼ step 1
Pingping reads X timeline + newsletter feeds and writes the Chinese
Telegram-ready brief into Hermes cron output. It does not mutate the repo.
   │
   ▼ step 2
scripts/pingping-site-publisher.py --kind feed
   ├─ parses ~/.hermes/profiles/personal/cron/output/a536f6d6ea3a/YYYY-MM-DD_*.md
   ├─ writes feed/days/YYYY-MM-DD.json
   ├─ updates feed/days/manifest.json
   └─ optionally enriches art only when PINGPING_FETCH_ART=1
   │
   ▼ optional enrich
node scripts/fetch-art-images.mjs
   ├─ tokenize each headline → ART_LIFT → Met API query
   ├─ stable hash picks a public-domain masterwork per slot
   ├─ global uniqueness (usedOids Set) — no oid reused anywhere
   ├─ pipes download through `magick`: 1400px, q82 jpeg
   └─ writes feed/art/met-<oid>.jpg + sets item.image_url
   │
   ▼ step 3
node scripts/diversify-tag-colors.mjs
   ├─ 4-color palette rotation, no adjacent same-color
   ├─ enforces cover ≠ that day's lead
   └─ rewrites tag_color in day jsons + manifest
   │
   ▼ step 4
git add feed/days/ feed/art/  →  commit  →  push  →  Vercel auto-deploys
   │
   ▼
feed/index.html
   ├─ fetches manifest.json on load
   ├─ renders rack (one cover per day)
   └─ on click → fetches that day's JSON → renders issue paper
        (every <a href="…" target="_blank"> points to real source)
```

Steps 2-4 are stitched into the no-agent publisher and local node scripts. The old v5 prompt patch is legacy; fresh installs should register `scripts/pingping-site-publisher.py --kind feed` at 08:55 ET and `--kind diary` at 09:10 ET. Art fetch is an optional enrich job; the publisher leaves it disabled unless `PINGPING_FETCH_ART=1` is set.

All three scripts are **idempotent**:
- `fetch-art-images.mjs` skips slots that already have a unique image_url
- `diversify-tag-colors.mjs` only swaps colors when there's a collision
- safe to re-run locally any time without breaking state

## One-time setup

The Mac mini Hermes cron is the runtime. There's no GitHub Action.

### 1. Apply cron patches

```bash
scp scripts/cron-patches/v3-free-form-svg.py   pingping-mini:/tmp/
scp scripts/cron-patches/v5-art-and-colors.py  pingping-mini:/tmp/
ssh pingping-mini 'python3 /tmp/v3-free-form-svg.py && python3 /tmp/v5-art-and-colors.py'
```

- v3 → diary cron (`a130f54960a2`): free-form SVG doodle generator
- v5 → X-feed cron (`a536f6d6ea3a`): runs fetch-art + diversify-colors after JSON write

Both patchers are idempotent (re-runs are no-ops, written backups
named `jobs.json.bak-doodle-v3` / `jobs.json.bak-feed-v5`).

### 2. Customize sources (optional)

The Mac mini cron reads its source list from its own prompt, not from
`feed/sources.json`. The `feed/sources.json` file in this repo is only
used by `scripts/pingping-daily.mjs` (the manual-backfill fallback —
see "Local testing" below). To change what pingping reads daily, edit
the cron prompt directly via SSH.

## Daily flow

- **Automatic**: Mac mini cron fires daily ~15:00 UTC → writes JSON →
  runs `diversify-tag-colors.mjs` →
  commits + pushes feed/days/ + feed/art/ → Vercel auto-deploys
- **Optional art enrich**: run with `PINGPING_FETCH_ART=1` or invoke
  `node scripts/fetch-art-images.mjs --date YYYY-MM-DD` manually
- **Backfill a specific date manually**: see Local testing below

## Local testing

```bash
# 1. generate today's issue (writes feed/days/YYYY-MM-DD.json, items have empty image_url)
node scripts/pingping-daily.mjs

# 2. pull a unique Met masterwork per item
node scripts/fetch-art-images.mjs              # only new/empty slots
node scripts/fetch-art-images.mjs --rebuild    # re-roll every slot from scratch

# 3. ensure no two adjacent stripes share a color
node scripts/diversify-tag-colors.mjs

# backfill a specific date
PINGPING_DATE=2026-05-14 node scripts/pingping-daily.mjs
node scripts/fetch-art-images.mjs --date 2026-05-14

# preview locally
python3 -m http.server 4747
# → http://localhost:4747/feed/
```

If `ANTHROPIC_API_KEY` is not set in the local shell, the script falls back to top-N-by-recency mode (no Claude curation). `fetch-art-images.mjs` and `diversify-tag-colors.mjs` need no keys — Met Museum Open Access API is public.

## Data shape

### `feed/days/manifest.json`
Preview cards used by the rack. Generated automatically; don't hand-edit.

```json
{
  "updated_at": "2026-05-16T13:00:00Z",
  "days": [
    { "date": "2026-05-16", "no": 107, "edition": "Weekend Edition",
      "lead_kicker": "…", "lead_headline": "…", "lead_deck": "…",
      "tag_color": "pink", "story_count": 7, "read_time_total_min": 101,
      "lead_author": {...}, "lead_source": {...} }
  ]
}
```

### `feed/days/YYYY-MM-DD.json`
Full issue. Loaded when a cover is clicked.

```json
{
  "date": "…", "no": 107, "edition": "…",
  "promo_headline": "…",
  "whats_news": ["<b>…</b>: …"],
  "digest": { "title": "…", "body": "…" },
  "items": [
    { "id": "c001", "rank": 1, "tag": "PLAYBOOK", "tag_color": "pink",
      "kicker": "Lead of the Day",
      "headline": "…", "deck": "…", "why": "…", "try": "…",
      "url": "https://real-source.com/...",
      "read_time_min": 5,
      "author": { "name": "…", "handle": "…", "role": "…",
                  "avatar_url": "https://unavatar.io/x/…" },
      "source":  { "label": "X · thread", "kind": "x" } }
  ]
}
```

## Editing pingping's voice

The Claude prompt lives in `scripts/pingping-daily.mjs` (`CURATE_PROMPT`). It tells Claude to write in pingping's voice: restrained, lowercase confidence, no clickbait, no em dashes. Edit that prompt to tune editorial style.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Action fails with "rate limited" | Switch model in `pingping-daily.mjs` (`claude-sonnet-4-6` → `claude-haiku-4-5`) or reduce `MAX_ITEMS` |
| Cover shows fewer stories than expected | RSS sources are dry today; check `feed/days/YYYY-MM-DD.json` `items` length |
| "manifest fetch failed" in browser | `feed/days/manifest.json` missing — run the script locally once to seed |
| Headlines are too long / truncating | Raise CSS line-clamp on `.cover-headline` (currently 3 lines) |

## Adding a new source

1. Find the RSS URL (usually `/feed`, `/rss`, `/feed.xml`)
2. Append to `feed/sources.json` → `rss` array with a unique `id`
3. Push. Tomorrow's issue includes it.

If a source you want has no RSS (most X handles), add the specific URLs you want featured to `manual_picks` each week. Pingping treats them as first-class candidates.
