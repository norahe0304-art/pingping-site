# Teach pingping — diary cron now uses local SVG doodle pipeline

## What this records

Pingping's diary cron (`a130f54960a2`) used to call Pollinations.ai
for daily artifact doodles. Pollinations produces parchment-textured,
colored, shaded sketches — wrong for the MS-Paint-mouse-drawn-pathetic
aesthetic. As of **2026-05-16**, the cron prompt was patched to use
`scripts/make-doodle.mjs` instead, which writes a `.svg` file directly
(no rsvg/cwebp/native deps — Mac mini doesn't have those).

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
