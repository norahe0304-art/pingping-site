#!/usr/bin/env python3
"""
process_artifact.py — convert any raw image into the canonical PINGPING
artifact format: transparent paper background + pixelated near-black ink.

Steps applied to every input:
  1. Aggressive bg removal — any near-cream / near-grey pixel becomes
     transparent (lum > 205, low saturation)
  2. Ink recolor — surviving pixels become near-black #1c1b1b with
     luminance-mapped alpha (dark stays solid, midtones go semi)
  3. Pixelate — downscale to 1/PIXEL then upscale with nearest-neighbor
     so every edge gets MS-Paint mouse-drawn jaggedness, hiding any
     polish the generator tried to add

Usage:
    python3 tools/process_artifact.py [path1.webp path2.webp ...]
    python3 tools/process_artifact.py            # process every *.webp in artifacts/
    python3 tools/process_artifact.py --no-pixelate FILE...
"""
import sys
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
ARTIFACTS = ROOT / "artifacts"

INK = (28, 27, 27)
PIXEL = 3            # downscale divisor; bigger = chunkier MS-Paint edges


def process(p: Path, pixelate: bool = True) -> None:
    im = Image.open(p).convert("RGBA")
    w, h = im.size
    pixels = list(im.getdata())

    # Inversion detection: if the average luminance is dark, the image was
    # generated with dark bg + light ink. Invert RGB so cream/light dominates
    # and the ink reads as dark — that's what the rest of the pipeline expects.
    avg_lum = sum(0.299*r + 0.587*g + 0.114*b for r,g,b,_ in pixels) / max(1, len(pixels))
    if avg_lum < 110:
        pixels = [(255-r, 255-g, 255-b, a) for r,g,b,a in pixels]

    out = []
    for r, g, b, a in pixels:
        if a == 0:
            out.append((0, 0, 0, 0))
            continue
        lum = 0.299 * r + 0.587 * g + 0.114 * b
        # near-cream / near-grey / near-white bg → transparent
        if lum > 205 and abs(r - g) < 35 and abs(g - b) < 35:
            out.append((0, 0, 0, 0))
            continue
        # ink — luminance-mapped alpha, recolored to near-black
        alpha = int((1 - lum / 255) * 255 * 1.35)
        alpha = min(255, max(0, alpha))
        out.append((INK[0], INK[1], INK[2], alpha))
    im.putdata(out)

    if pixelate:
        # MS-Paint jaggedness: shrink with nearest then re-upscale nearest
        small = im.resize((w // PIXEL, h // PIXEL), Image.NEAREST)
        im = small.resize((w, h), Image.NEAREST)

    im.save(p, "WEBP", quality=92, lossless=False)
    print(f"  ✓ {p.name}")


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    pixelate = "--no-pixelate" not in sys.argv
    targets = [Path(x) for x in args] or sorted(ARTIFACTS.glob("*.webp"))
    if not targets:
        print("no artifact files found")
        sys.exit(0)
    for t in targets:
        process(t, pixelate=pixelate)
    print(f"done. {len(targets)} processed{' (no pixelate)' if not pixelate else ''}.")
