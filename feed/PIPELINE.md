# pingping feed pipeline

Daily AI-marketing wire. Every cover = one day. Every story = real source URL.

## Architecture

```
13:00 UTC daily (GitHub Action — .github/workflows/daily-feed.yml)
   │
   ▼ step 1
scripts/pingping-daily.mjs
   ├─ reads feed/sources.json  (RSS feeds + manual X picks)
   ├─ fetches RSS in parallel, filters last 48h
   ├─ Claude curates + paraphrases (falls back to top-N by recency)
   ├─ writes feed/days/YYYY-MM-DD.json  (7 items, image_url empty)
   └─ updates feed/days/manifest.json
   │
   ▼ step 2
scripts/fetch-art-images.mjs
   ├─ tokenizes each new headline → ART_LIFT → Met API query
   ├─ stable hash picks a public-domain masterwork per slot
   ├─ enforces global uniqueness (usedOids Set)
   ├─ pipes download through `magick`: 1400px, q82 jpeg
   └─ writes feed/art/met-<oid>.jpg + sets item.image_url
   │
   ▼ step 3
scripts/diversify-tag-colors.mjs
   ├─ rotates 4-color palette with no adjacent same-color
   ├─ enforces cover ≠ that day's lead
   └─ rewrites tag_color in day jsons + manifest
   │
   ▼ step 4
git commit & push → Vercel rebuilds → live
   │
   ▼
feed/index.html
   ├─ fetches manifest.json on load
   ├─ renders rack (one cover per day)
   └─ on click → fetches that day's JSON → renders issue paper
        (every <a href="…" target="_blank"> points to real source)
```

All three scripts are **idempotent**:
- `fetch-art-images.mjs` skips slots that already have a unique image_url
- `diversify-tag-colors.mjs` only swaps colors when there's a collision
- safe to re-run locally any time without breaking state

## One-time setup

### 1. Get a Claude API key
- https://console.anthropic.com → API keys → create
- Free tier covers ~30-40 days of curation; paid plans for more

### 2. Add as GitHub Secret
- Repo → Settings → Secrets and variables → Actions → New repository secret
- Name: `ANTHROPIC_API_KEY`
- Value: your key (starts with `sk-ant-…`)

### 3. Customize sources
Edit `feed/sources.json`:
- **`rss`** — list of RSS feeds pingping reads daily. Newsletters, podcasts, YouTube channels — anything with a public feed.
- **`manual_picks`** — hand-curated URLs (usually X threads, since X doesn't have stable RSS). Pingping will include these in today's issue and Claude will expand them.

```json
{
  "rss": [
    { "id": "latent-space", "name": "Latent Space",
      "url": "https://www.latent.space/feed", "kind": "podcast" }
  ],
  "manual_picks": [
    { "url": "https://x.com/helloitsaustin/status/...",
      "title": "Optional title",
      "author": "Austin Hughes",
      "source_label": "X · thread",
      "kind": "x" }
  ]
}
```

### 4. Enable the workflow
- `.github/workflows/daily-feed.yml` already exists
- Push to `main` once; GitHub will start scheduling

## Daily flow (after setup)

- **Automatic**: 13:00 UTC cron runs the script, commits today's `.json`, Vercel auto-deploys.
- **Manual trigger**: Repo → Actions → "daily pingping feed" → Run workflow
- **Backfill a specific date**: same Run workflow form, paste `YYYY-MM-DD` into the date field

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
