#!/usr/bin/env node
/**
 * diversify-tag-colors.mjs — guarantee no two adjacent stripe colors
 * are equal across:
 *   - items within a single day (story cards stack vertically)
 *   - daily covers in manifest.json (cover strip stacks horizontally)
 *
 * tag_color is decorative, not tied to tag semantics (same tag can have
 * any color), so we're free to reassign. We do a stable greedy walk:
 * for each position, if the color collides with its previous neighbor
 * (or its known next neighbor), swap to the next palette color that
 * doesn't collide with either side.
 *
 * Usage: node scripts/diversify-tag-colors.mjs [--dry]
 */
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT     = path.resolve(__dirname, '..');
const DAYS_DIR = path.join(ROOT, 'feed', 'days');
const DRY      = process.argv.includes('--dry');

// indigo (#5648FB) reads purple; pink (#F45397) reads magenta — both
// in the cool-purple family. Treat as same-family for adjacency so
// "two purples next to each other" never happens. amber + cyan each
// stand alone.
const PALETTE = ['pink', 'amber', 'cyan', 'indigo'];
const FAMILY = {
  pink:   'purple',
  indigo: 'purple',
  amber:  'amber',
  cyan:   'cyan',
};

// pickNonAdjacent — return a palette color whose hue family doesn't
// collide with prev/next. Rotates from desired forward so we stay
// close to the original assignment.
function pickNonAdjacent(desired, prev, next) {
  const blockedFams = new Set([prev, next].filter(Boolean).map(c => FAMILY[c]));
  if (!blockedFams.has(FAMILY[desired])) return desired;
  const start = PALETTE.indexOf(desired);
  for (let k = 1; k <= PALETTE.length; k++) {
    const c = PALETTE[(start + k) % PALETTE.length];
    if (!blockedFams.has(FAMILY[c])) return c;
  }
  return desired;
}

function diversify(seq) {
  // single pass: fix collisions left-to-right, knowing right neighbor too
  let changes = 0;
  for (let i = 0; i < seq.length; i++) {
    const prev = i > 0 ? seq[i - 1] : null;
    const next = i < seq.length - 1 ? seq[i + 1] : null;
    const fixed = pickNonAdjacent(seq[i], prev, next);
    if (fixed !== seq[i]) { seq[i] = fixed; changes++; }
  }
  return changes;
}

async function main() {
  // 1) day files — diversify items within each day
  const dayFiles = (await readdir(DAYS_DIR))
    .filter(f => /^2026-.*\.json$/.test(f))
    .map(f => path.join(DAYS_DIR, f));

  let totalItemChanges = 0;
  for (const f of dayFiles) {
    const doc = JSON.parse(await readFile(f, 'utf8'));
    if (!Array.isArray(doc.items)) continue;
    // sort by rank (or keep insertion order) — stripes render in this order
    const items = [...doc.items].sort((a, b) => (a.rank || 0) - (b.rank || 0));
    const seq = items.map(it => it.tag_color || 'pink');
    const before = seq.join(',');
    const changes = diversify(seq);
    const after = seq.join(',');
    if (changes) {
      console.log(`  [day]      ${path.basename(f, '.json')}  ${before}\n             → ${after}  (${changes} swap${changes > 1 ? 's' : ''})`);
      // write back — match by id since we sorted
      for (let i = 0; i < items.length; i++) items[i].tag_color = seq[i];
      // doc.items keeps original order; update tag_color by matching id
      const byId = new Map(items.map(it => [it.id, it.tag_color]));
      for (const it of doc.items) if (byId.has(it.id)) it.tag_color = byId.get(it.id);
      totalItemChanges += changes;
    }
    if (!DRY) await writeFile(f, JSON.stringify(doc, null, 2) + '\n');
  }

  // 2) manifest covers — diversify across days
  const manifestPath = path.join(DAYS_DIR, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  if (Array.isArray(manifest)) {
    // manifest is sorted newest-first → that's the stacking order on the page
    const seq = manifest.map(e => e.tag_color || 'pink');
    const before = seq.join(',');
    const changes = diversify(seq);
    const after = seq.join(',');
    if (changes) {
      console.log(`  [manifest] cover strip  ${before}\n             → ${after}  (${changes} swap${changes > 1 ? 's' : ''})`);
      for (let i = 0; i < manifest.length; i++) manifest[i].tag_color = seq[i];
    }
    if (!DRY) await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  }

  // 3) also propagate manifest cover tag_color into the per-day doc's
  // top-level "tag_color" if it exists (some day docs may have it)
  console.log(`\n=== ${totalItemChanges} item swaps + manifest synced ===`);
  if (DRY) console.log('(dry run — nothing written)');
}

main().catch(e => { console.error(e); process.exit(1); });
