#!/usr/bin/env node
/**
 * diversify-tag-colors.mjs — strict 4-color rotation across the feed.
 *
 * Constraints (hard):
 *   1. within a day: items[i].tag_color != items[i-1].tag_color
 *   2. across days: manifest[i].tag_color != manifest[i-1].tag_color
 *   3. cover↔lead: day's cover tag_color != that day's rank-1 item color
 *      (cover stripe sits visually adjacent to the lead story stripe)
 *
 * Strategy (soft):
 *   - keep usage of all 4 colors as even as possible
 *   - prefer the least-used color that satisfies the hard constraints
 *   - within a day, also prefer not to reuse a color seen 2 positions
 *     back (avoid X,Y,X,Y,X stripes)
 *
 * tag_color is purely decorative — same tag can have any color — so
 * we're free to reassign all of them.
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

const PALETTE = ['pink', 'amber', 'cyan', 'indigo'];

// pick — return the best palette color subject to hard constraints
// (blocked set) and soft preferences (least-used globally, then
// avoid two-back repeat). Stable: deterministic given inputs.
function pick(blocked, usage, twoBack) {
  const cands = PALETTE.filter(c => !blocked.has(c));
  // sort by: usage asc → twoBack-mismatch (prefer not equal to twoBack)
  //         → palette order (stable tiebreak)
  cands.sort((a, b) => {
    if (usage[a] !== usage[b]) return usage[a] - usage[b];
    const aTb = a === twoBack ? 1 : 0;
    const bTb = b === twoBack ? 1 : 0;
    if (aTb !== bTb) return aTb - bTb;
    return PALETTE.indexOf(a) - PALETTE.indexOf(b);
  });
  return cands[0];
}

async function main() {
  // ----- 1) build state -----
  const dayFiles = (await readdir(DAYS_DIR))
    .filter(f => /^2026-.*\.json$/.test(f))
    .map(f => path.join(DAYS_DIR, f));

  const docs = [];
  for (const f of dayFiles) {
    docs.push({ f, doc: JSON.parse(await readFile(f, 'utf8')) });
  }

  const manifestPath = path.join(DAYS_DIR, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const docByDate = new Map(docs.map(({ f, doc }) => [doc.date, { f, doc }]));

  // ----- 2) assign cover colors (manifest, newest-first stack) -----
  // also produces a per-date constraint = the cover color, which the
  // lead (rank=1) item of that day must not equal
  const usage = Object.fromEntries(PALETTE.map(c => [c, 0]));
  let coverSwaps = 0;
  for (let i = 0; i < manifest.length; i++) {
    const prev = i > 0 ? manifest[i - 1].tag_color : null;
    const blocked = new Set([prev].filter(Boolean));
    const chosen = pick(blocked, usage, null);
    if (manifest[i].tag_color !== chosen) coverSwaps++;
    manifest[i].tag_color = chosen;
    usage[chosen]++;
  }

  // ----- 3) assign within-day item colors (rank order, lead first) -----
  // resets usage per-day so each day uses all 4 colors evenly
  let itemSwaps = 0;
  for (const { doc } of docs) {
    if (!Array.isArray(doc.items)) continue;
    const items = [...doc.items].sort((a, b) => (a.rank || 99) - (b.rank || 99));
    const coverColor = manifest.find(e => e.date === doc.date)?.tag_color;

    const localUsage = Object.fromEntries(PALETTE.map(c => [c, 0]));
    const seq = [];
    for (let i = 0; i < items.length; i++) {
      const prev = i > 0 ? seq[i - 1] : null;
      const blocked = new Set([prev].filter(Boolean));
      // lead (i === 0) must also differ from the day's cover color
      if (i === 0 && coverColor) blocked.add(coverColor);
      const twoBack = i >= 2 ? seq[i - 2] : null;
      const chosen = pick(blocked, localUsage, twoBack);
      if (items[i].tag_color !== chosen) itemSwaps++;
      items[i].tag_color = chosen;
      localUsage[chosen]++;
      seq.push(chosen);
    }
    // write back by id (doc.items may not be in rank order)
    const byId = new Map(items.map(it => [it.id, it.tag_color]));
    for (const it of doc.items) if (byId.has(it.id)) it.tag_color = byId.get(it.id);
  }

  // ----- 4) write -----
  if (!DRY) {
    for (const { f, doc } of docs) await writeFile(f, JSON.stringify(doc, null, 2) + '\n');
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  }

  // ----- 5) report -----
  console.log('=== cover strip (newest → oldest) ===');
  console.log('  ' + manifest.map(e => `${e.date}=${e.tag_color}`).join('  '));
  console.log(`\n=== per-day item sequences ===`);
  for (const { doc } of docs) {
    const items = [...doc.items].sort((a, b) => (a.rank || 99) - (b.rank || 99));
    const cover = manifest.find(e => e.date === doc.date)?.tag_color;
    console.log(`  ${doc.date}  cover=${cover.padEnd(6)}  items: ${items.map(it => it.tag_color).join(',')}`);
  }
  console.log(`\n=== ${coverSwaps} cover swaps + ${itemSwaps} item swaps ===`);
  if (DRY) console.log('(dry run — nothing written)');
}

main().catch(e => { console.error(e); process.exit(1); });
