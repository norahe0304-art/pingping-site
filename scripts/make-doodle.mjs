#!/usr/bin/env node
/**
 * make-doodle.mjs — generate a clumsy MS Paint mouse-drawn pathetic
 * doodle as a 600x420 webp, deterministic per date.
 *
 * Aesthetic rules (non-negotiable):
 *   - Monochrome black (#1a1a1a) on pure white (#ffffff). No color.
 *   - No paper texture, no parchment edges, no shading, no fill gradients.
 *   - Single-stroke wobbly lines, stroke-width 3-5, stroke-linecap round.
 *   - Mostly white space. Motif occupies <50% of canvas, off-center.
 *   - Lines tremble like a mouse cursor: deterministic jitter from seed.
 *
 * Usage:
 *   node scripts/make-doodle.mjs --date 2026-05-14 --motif thumbprint \
 *        --out artifacts/2026-05-14.webp
 *
 *   --motif chooses one of: thumbprint, house, rain, door, circle, pin,
 *           lamp, key, leaf, knot, window, cup, wire, gate. Each is a
 *           hand-coded wobbly SVG generator.
 *
 * Depends on ImageMagick `magick` for SVG→webp rasterization.
 */
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';

// ============================================================
// seeded jitter — every motif call gets a reproducible RNG so
// the same (date, motif) always renders the same doodle.
// ============================================================
function rng(seed) {
  let s = 0;
  for (const c of String(seed)) s = (s * 31 + c.charCodeAt(0)) >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return (s & 0xffffff) / 0xffffff;
  };
}

// jitter a coordinate by ±amp pixels
const J = (rand, amp = 4) => (rand() - 0.5) * 2 * amp;

// wobbly polyline: produce an SVG path that bends slightly off the
// straight segment between (x1,y1) and (x2,y2) using N control points.
function wobblyLine(rand, x1, y1, x2, y2, segs = 6, amp = 5) {
  const pts = [[x1, y1]];
  for (let i = 1; i < segs; i++) {
    const t = i / segs;
    const x = x1 + (x2 - x1) * t + J(rand, amp);
    const y = y1 + (y2 - y1) * t + J(rand, amp);
    pts.push([x, y]);
  }
  pts.push([x2, y2]);
  return 'M ' + pts.map(p => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' L ');
}

// wobbly closed shape: walk N points around a center
function wobblyShape(rand, cx, cy, points, amp = 6) {
  const pts = points.map(([dx, dy]) =>
    [cx + dx + J(rand, amp), cy + dy + J(rand, amp)]
  );
  return 'M ' + pts.map(p => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' L ') + ' Z';
}

// ============================================================
// motif library — each fn returns a string of <path>/<circle> SVG.
// ============================================================
const MOTIFS = {
  // a wobbly thumbprint: oval outline + 3-5 inner swirl arcs, off-center
  thumbprint(rand) {
    const cx = 200 + J(rand, 30), cy = 210 + J(rand, 20);
    let s = '';
    // outer oval
    const ovalPts = [];
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      ovalPts.push([Math.cos(a) * 80, Math.sin(a) * 100]);
    }
    s += `<path d="${wobblyShape(rand, cx, cy, ovalPts, 5)}" stroke="#1a1a1a" stroke-width="3" stroke-linecap="round" fill="none"/>`;
    // inner swirl arcs (3 nested half-ovals)
    for (let k = 0; k < 4; k++) {
      const r = 55 - k * 12;
      const innerPts = [];
      const segments = 16;
      const start = Math.PI * 0.2 + k * 0.3;
      const end = Math.PI * 1.6 - k * 0.2;
      for (let i = 0; i <= segments; i++) {
        const a = start + (end - start) * (i / segments);
        innerPts.push([Math.cos(a) * r * 0.9 + J(rand, 2), Math.sin(a) * r + J(rand, 2)]);
      }
      const pts = innerPts.map(p => [cx + p[0], cy + p[1]]);
      s += `<path d="M ${pts.map(p => p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' L ')}" stroke="#1a1a1a" stroke-width="2.5" stroke-linecap="round" fill="none"/>`;
    }
    return s;
  },

  // a wobbly house: square + triangle roof, off-center crooked chimney,
  // lopsided sun in upper-right with random ray angles
  house(rand) {
    const hx = 240, hy = 230;
    let s = '';
    // body
    s += `<path d="${wobblyLine(rand, hx, hy, hx + 140, hy, 5, 3)}" stroke="#1a1a1a" stroke-width="4" stroke-linecap="round" fill="none"/>`;
    s += `<path d="${wobblyLine(rand, hx + 140, hy, hx + 140, hy + 100, 5, 3)}" stroke="#1a1a1a" stroke-width="4" stroke-linecap="round" fill="none"/>`;
    s += `<path d="${wobblyLine(rand, hx + 140, hy + 100, hx, hy + 100, 5, 3)}" stroke="#1a1a1a" stroke-width="4" stroke-linecap="round" fill="none"/>`;
    s += `<path d="${wobblyLine(rand, hx, hy + 100, hx, hy, 5, 3)}" stroke="#1a1a1a" stroke-width="4" stroke-linecap="round" fill="none"/>`;
    // roof (triangle)
    s += `<path d="${wobblyLine(rand, hx - 10, hy, hx + 70, hy - 60, 5, 4)}" stroke="#1a1a1a" stroke-width="4" stroke-linecap="round" fill="none"/>`;
    s += `<path d="${wobblyLine(rand, hx + 70, hy - 60, hx + 150, hy, 5, 4)}" stroke="#1a1a1a" stroke-width="4" stroke-linecap="round" fill="none"/>`;
    // crooked chimney (tilted rect on right side of roof)
    const cx1 = hx + 105, cy1 = hy - 30;
    s += `<path d="M ${cx1} ${cy1} L ${cx1 + 18} ${cy1 - 4} L ${cx1 + 22} ${cy1 - 40} L ${cx1 + 4} ${cy1 - 36} Z" stroke="#1a1a1a" stroke-width="3" stroke-linecap="round" fill="none"/>`;
    // door
    s += `<path d="M ${hx + 55} ${hy + 100} L ${hx + 55} ${hy + 55} L ${hx + 85} ${hy + 55} L ${hx + 85} ${hy + 100}" stroke="#1a1a1a" stroke-width="3" stroke-linecap="round" fill="none"/>`;
    // lopsided sun (upper right, off-center)
    const sx = 470 + J(rand, 10), sy = 120 + J(rand, 8);
    const sunPts = [];
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      sunPts.push([Math.cos(a) * 28, Math.sin(a) * 32]);
    }
    s += `<path d="${wobblyShape(rand, sx, sy, sunPts, 3)}" stroke="#1a1a1a" stroke-width="3" stroke-linecap="round" fill="none"/>`;
    // sun rays — 7 random angles
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 + rand() * 0.3;
      const r1 = 38, r2 = 38 + 16 + rand() * 8;
      const x1 = sx + Math.cos(a) * r1, y1 = sy + Math.sin(a) * r1;
      const x2 = sx + Math.cos(a) * r2, y2 = sy + Math.sin(a) * r2;
      s += `<path d="${wobblyLine(rand, x1, y1, x2, y2, 2, 1)}" stroke="#1a1a1a" stroke-width="3" stroke-linecap="round" fill="none"/>`;
    }
    return s;
  },

  // rain on a terminal/laptop on a desk
  rain(rand) {
    let s = '';
    // desk line
    s += `<path d="${wobblyLine(rand, 130, 290, 470, 290, 8, 3)}" stroke="#1a1a1a" stroke-width="4" stroke-linecap="round" fill="none"/>`;
    // laptop body (open V shape)
    const lx = 240, ly = 290;
    s += `<path d="${wobblyLine(rand, lx, ly, lx + 120, ly, 4, 2)}" stroke="#1a1a1a" stroke-width="3" stroke-linecap="round" fill="none"/>`;
    // screen tilted up
    s += `<path d="${wobblyLine(rand, lx + 5, ly, lx + 25, ly - 80, 5, 3)}" stroke="#1a1a1a" stroke-width="3" stroke-linecap="round" fill="none"/>`;
    s += `<path d="${wobblyLine(rand, lx + 25, ly - 80, lx + 110, ly - 80, 5, 3)}" stroke="#1a1a1a" stroke-width="3" stroke-linecap="round" fill="none"/>`;
    s += `<path d="${wobblyLine(rand, lx + 110, ly - 80, lx + 115, ly, 5, 3)}" stroke="#1a1a1a" stroke-width="3" stroke-linecap="round" fill="none"/>`;
    // prompt blink ">" on screen
    s += `<path d="M ${lx + 40} ${ly - 50} L ${lx + 50} ${ly - 42} L ${lx + 40} ${ly - 34}" stroke="#1a1a1a" stroke-width="2.5" stroke-linecap="round" fill="none"/>`;
    // rain — 12 angled dashes scattered above
    for (let i = 0; i < 14; i++) {
      const rx = 130 + rand() * 340;
      const ry = 40 + rand() * 180;
      const dx = 6 + rand() * 4;
      const dy = 18 + rand() * 6;
      s += `<path d="M ${rx.toFixed(0)} ${ry.toFixed(0)} L ${(rx + dx).toFixed(0)} ${(ry + dy).toFixed(0)}" stroke="#1a1a1a" stroke-width="2" stroke-linecap="round"/>`;
    }
    return s;
  },

  // wobbly door (silhouette inspired by 2026-05-11)
  door(rand) {
    const dx = 240, dy = 110;
    let s = '';
    s += `<path d="${wobblyLine(rand, dx, dy, dx + 120, dy, 4, 2)}" stroke="#1a1a1a" stroke-width="5" stroke-linecap="round" fill="none"/>`;
    s += `<path d="${wobblyLine(rand, dx + 120, dy, dx + 120, dy + 220, 5, 3)}" stroke="#1a1a1a" stroke-width="5" stroke-linecap="round" fill="none"/>`;
    s += `<path d="${wobblyLine(rand, dx + 120, dy + 220, dx, dy + 220, 4, 2)}" stroke="#1a1a1a" stroke-width="5" stroke-linecap="round" fill="none"/>`;
    s += `<path d="${wobblyLine(rand, dx, dy + 220, dx, dy, 5, 3)}" stroke="#1a1a1a" stroke-width="5" stroke-linecap="round" fill="none"/>`;
    // knob
    s += `<circle cx="${dx + 100}" cy="${dy + 130}" r="5" stroke="#1a1a1a" stroke-width="2" fill="#1a1a1a"/>`;
    return s;
  },

  // pure wobbly circle (2026-05-10 reference)
  circle(rand) {
    const cx = 260 + J(rand, 20), cy = 210 + J(rand, 16);
    const r = 95;
    const pts = [];
    for (let i = 0; i < 40; i++) {
      const a = (i / 40) * Math.PI * 2;
      pts.push([cx + Math.cos(a) * r + J(rand, 4), cy + Math.sin(a) * r + J(rand, 4)]);
    }
    pts.push(pts[0]);
    let s = `<path d="M ${pts.map(p => p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' L ')}" stroke="#1a1a1a" stroke-width="3" stroke-linecap="round" fill="none"/>`;
    // 3 little triangles to right of circle (matching 05-10)
    for (let i = 0; i < 3; i++) {
      const tx = cx + r + 20 + i * 24;
      const ty = cy - 20;
      s += `<path d="M ${tx} ${ty + 16} L ${tx + 8} ${ty} L ${tx + 16} ${ty + 16}" stroke="#1a1a1a" stroke-width="2" stroke-linecap="round" fill="none"/>`;
    }
    return s;
  },

  // a leaf — simple two-arc shape with central vein
  leaf(rand) {
    const cx = 260, cy = 210;
    let s = '';
    // top arc
    s += `<path d="${wobblyLine(rand, cx - 60, cy, cx, cy - 70, 6, 4)}" stroke="#1a1a1a" stroke-width="3" stroke-linecap="round" fill="none"/>`;
    s += `<path d="${wobblyLine(rand, cx, cy - 70, cx + 60, cy, 6, 4)}" stroke="#1a1a1a" stroke-width="3" stroke-linecap="round" fill="none"/>`;
    // bottom arc
    s += `<path d="${wobblyLine(rand, cx - 60, cy, cx, cy + 70, 6, 4)}" stroke="#1a1a1a" stroke-width="3" stroke-linecap="round" fill="none"/>`;
    s += `<path d="${wobblyLine(rand, cx, cy + 70, cx + 60, cy, 6, 4)}" stroke="#1a1a1a" stroke-width="3" stroke-linecap="round" fill="none"/>`;
    // central vein
    s += `<path d="${wobblyLine(rand, cx - 50, cy, cx + 50, cy, 6, 3)}" stroke="#1a1a1a" stroke-width="2.5" stroke-linecap="round" fill="none"/>`;
    // stem
    s += `<path d="${wobblyLine(rand, cx + 60, cy, cx + 95, cy + 25, 4, 3)}" stroke="#1a1a1a" stroke-width="3" stroke-linecap="round" fill="none"/>`;
    return s;
  },
};

// ============================================================
// composer — wrap motif in SVG header, render to webp via magick
// ============================================================
function composeSvg(motifName, seedKey) {
  const fn = MOTIFS[motifName];
  if (!fn) {
    const names = Object.keys(MOTIFS).join(', ');
    throw new Error(`unknown motif "${motifName}". choose: ${names}`);
  }
  const rand = rng(seedKey);
  const body = fn(rand);
  // NO background rect — output must have alpha so the page's warm
  // #F6F4EE shows through. Originals (2026-05-10/11/12/13) are
  // GrayscaleAlpha PNG/webp; matching that is non-negotiable.
  return `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="420" viewBox="0 0 600 420">
  ${body}
</svg>`;
}

function render(svg, outPath) {
  // .svg → write directly. Browsers render SVG natively, alpha is free,
  // no native deps anywhere. This is the preferred path (esp. on the
  // cron host which has no rsvg/cwebp installed).
  if (outPath.toLowerCase().endsWith('.svg')) {
    writeFileSync(outPath, svg);
    return;
  }
  // .webp / .png → rsvg-convert + cwebp pipeline. Requires the tools
  // to be installed locally (brew install librsvg webp).
  const dir = mkdtempSync(path.join(tmpdir(), 'doodle-'));
  const svgPath = path.join(dir, 'in.svg');
  const pngPath = path.join(dir, 'out.png');
  writeFileSync(svgPath, svg);
  try {
    execSync(`rsvg-convert "${svgPath}" -o "${pngPath}"`, { stdio: 'pipe' });
    if (outPath.toLowerCase().endsWith('.png')) {
      execSync(`cp "${pngPath}" "${outPath}"`, { stdio: 'pipe' });
    } else {
      execSync(`cwebp -quiet -lossless "${pngPath}" -o "${outPath}"`, { stdio: 'pipe' });
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ============================================================
// CLI
// ============================================================
function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    if (k.startsWith('--')) out[k.slice(2)] = argv[i + 1];
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv);
  if (!args.date || !args.motif || !args.out) {
    console.error('usage: --date YYYY-MM-DD --motif <name> --out path');
    console.error('motifs: ' + Object.keys(MOTIFS).join(', '));
    process.exit(2);
  }
  const seedKey = `${args.date}|${args.motif}|${args.seed || ''}`;
  const svg = composeSvg(args.motif, seedKey);
  render(svg, args.out);
  console.log(`✓ ${args.out}  (${args.motif} @ ${args.date})`);
}

main();
