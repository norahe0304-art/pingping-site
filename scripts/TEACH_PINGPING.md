# Teach pingping — the doodle pipeline (apply when Mac mini is reachable)

The Pollinations/Flux image generator produces parchment-textured, colored,
shaded sketches. That is **wrong** for diary artifacts. The correct
aesthetic — single-stroke wobbly black ink on pure white, MS Paint
mouse-drawn pathetic, mostly white space, 2-5KB per file — cannot be
produced by any text-to-image model.

Going forward, diary artifacts come from `scripts/make-doodle.mjs`,
which renders a deterministic SVG via `rsvg-convert` + `cwebp`.

## Prereqs on the Mac mini

```bash
brew install librsvg webp imagemagick   # cwebp ships with libwebp
cd ~/code/pingping-site && git pull origin main
```

## The one prompt change in her diary cron

Find the diary cron job (`a130f54960a2`) prompt. There should be a step
that calls Pollinations to produce the daily artifact. **Remove that step
and replace it with the snippet below.**

### Before (delete this kind of line)

```
# generate the doodle cover via Pollinations
curl -sSL "https://image.pollinations.ai/prompt/..." -o artifacts/$DATE.webp
```

### After

```
# generate the doodle cover via the local SVG pipeline.
# pick ONE motif from: thumbprint, house, rain, door, circle, leaf.
# choose based on the diary's main concrete image (a door, a leaf, etc).
# if nothing fits, use 'circle' as the default.
node scripts/make-doodle.mjs \
  --date "$DATE" \
  --motif "$MOTIF" \
  --out "artifacts/$DATE.webp"
```

The cron prompt itself should also tell Claude (when drafting the diary)
to **choose the motif** as part of its output, e.g.:

```
Output JSON:
{
  "title": "...",
  "body": "...",
  "motif": "house"   // pick ONE: thumbprint, house, rain, door, circle, leaf
}
```

Then the cron shell wraps the value into `$MOTIF` and invokes the
script.

## Why this is a hard rule

- File size: the originals are 2-5KB. Any AI-image output is 30-80KB.
  If you see a >20KB artifact in `artifacts/`, the pipeline regressed.
- Color: only `#1a1a1a` ink on `#ffffff`. No accent color in artifacts.
- Texture: zero. No paper grain, no parchment edges, no shading.

## Adding new motifs

Open `scripts/make-doodle.mjs`, find the `MOTIFS` object, add a new
key. Each motif function receives a seeded `rand()` and returns SVG
inner markup. Use `wobblyLine(rand, x1, y1, x2, y2, segs, amp)` for
trembling strokes. Commit + push so pingping picks it up on next pull.

## What I already did locally (2026-05-16)

- Regenerated `artifacts/2026-05-14.webp` (motif=thumbprint, 4.7KB)
- Regenerated `artifacts/2026-05-15.webp` (motif=house, 4.5KB)
- Regenerated `artifacts/2026-05-16.webp` (motif=rain, 2.9KB)

The Pollinations-generated versions of these (parchment + color) have
been overwritten. Once the cron prompt is patched, **future days will
generate cleanly without intervention**.
