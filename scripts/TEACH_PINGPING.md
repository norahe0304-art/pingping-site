# Teach pingping — diary cron now uses local SVG doodle pipeline

## What this records

Pingping's diary cron (`a130f54960a2`) prompt evolved across 3 patches:

| Version | What it did | Status |
|---|---|---|
| v1 | swap Pollinations curl → `node scripts/make-doodle.mjs` with a 6-motif menu | **applied** 2026-05-16 |
| v2 | swap `.webp` → `.svg` output (Mac mini has no rsvg/cwebp) | **applied** 2026-05-16 |
| v3 | **kill the motif menu**. pingping draws the actual thing in today's diary as raw SVG (with 2 inline style anchors + self-check). | **pending — apply when next on the Mac mini's network** |
| v4 | X-feed cron `a536f6d6ea3a`: SIGNAL items must merge `why` into `deck` (one paragraph, `why=""`). Drop items without real source URLs (no `x.com/home` placeholders). Fetch `og:image` from non-X URLs to fill `image_url`. | **pending — apply when next on the Mac mini's network** |

v3 + v4 patchers live at `scripts/cron-patches/`. Apply both:

```bash
scp scripts/cron-patches/v3-free-form-svg.py             pingping-mini:/tmp/
scp scripts/cron-patches/v4-feed-merged-and-real-images.py pingping-mini:/tmp/
ssh pingping-mini 'python3 /tmp/v3-free-form-svg.py && python3 /tmp/v4-feed-merged-and-real-images.py'
```

The script is idempotent — re-runs are no-ops. Backup written to
`jobs.json.bak-doodle-v3`.

## Why v3 matters

Menu-of-6 (thumbprint/house/rain/door/circle/leaf) makes every doodle
a stock image. The original artifacts (a thumbtack pinned to paper, a
silhouette door, a wobbly circle with chick-foot triangles, an open
door frame) are each genuinely the *thing in that day's diary*. v3
puts pingping back in charge of drawing — two style anchors in the
prompt give her the visual vocabulary, plus a self-check shell guard
that rejects oversized / wrong-colored / forbidden-element SVGs.

## Verifying the patch is still applied

```bash
ssh pingping-mini 'python3 -c "
import json
p = json.load(open(\"/Users/macxiaoxiao/.hermes/profiles/personal/cron/jobs.json\"))
for j in p[\"jobs\"]:
    if j[\"id\"] == \"a130f54960a2\":
        prompt = j[\"prompt\"]
        assert \"make-doodle.mjs\" in prompt, \"FAIL: not patched\"
        assert \"pollinations.ai\" not in prompt.lower(), \"FAIL: pollinations still referenced as live URL\"
        assert \".svg\\\"\" in prompt, \"FAIL: still on .webp\"
        print(\"OK\")
"'
```

## What the cron now does

After Claude writes the diary, the prompt instructs:

1. **Pick a motif** from 6 named options based on the diary's
   concrete image:
   - `thumbprint` — pressed mark / trace
   - `house` — wobbly house + chimney + sun
   - `rain` — rain over a terminal desk
   - `door` — a closed door / threshold
   - `circle` — wobbly circle (fallback)
   - `leaf` — single leaf with vein
2. **Run the generator** (writes `.svg`, ~1KB):
   ```bash
   node /tmp/pingping-site/scripts/make-doodle.mjs \
     --date "$DATE" --motif "$MOTIF" \
     --out "/tmp/pingping-site/artifacts/$DATE.svg"
   ```
3. **Set diary frontmatter** `cover: ../artifacts/$DATE.svg`
4. **Build + push** as usual (`build-diary.mjs` already accepts the
   cover field from frontmatter)

## Re-applying the patch (if the cron prompt ever gets reset)

The patcher script lives in `/tmp/patch-diary-cron-doodle.py` /
`/tmp/patch-diary-cron-doodle-v2.py` on this Mac mini. To redo from
scratch, port them via `scp` and run with python3.

## Adding new motifs

Edit `scripts/make-doodle.mjs`, find the `MOTIFS` object, add a new
key. Each motif fn receives a seeded `rand()` and returns SVG inner
markup. Use `wobblyLine(rand, x1, y1, x2, y2, segs, amp)` and
`wobblyShape(rand, cx, cy, points, amp)` for trembling strokes. Push;
pingping's `git pull --rebase` will pick it up on the next cron run.

## Aesthetic guardrails (do not negotiate)

- Stroke color: `#1a1a1a` only.
- Background: transparent (no `<rect>` fill); the page paper `#F6F4EE`
  shows through.
- File size: 1-3 KB. >10KB means something regressed.
- Output extension: `.svg`. Not `.webp`, not `.png`, not via any image
  model.
