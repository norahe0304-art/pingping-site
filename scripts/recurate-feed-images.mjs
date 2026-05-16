#!/usr/bin/env node
/**
 * Replace LoremFlickr URLs across feed/days/*.json + manifest.json
 * with hand-curated Unsplash editorial photos that match the Atlas
 * tonality (warm, clean, no stock cheese).
 *
 * Picks one of 14 curated photos per item based on keywords in
 * headline + deck. Same item always → same photo (stable).
 *
 * Usage: node scripts/recurate-feed-images.mjs
 */
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DAYS_DIR = path.join(ROOT, 'feed', 'days');

// ============================================================
// curated library — each tag has 2-3 photo IDs to add variety
// ============================================================
const LIB = {
  laptop:   ['1496181133206-80ce9b88a853'],  // warm wood + macbook + plant
  code:     ['1518770660439-4636190af475', '1555066931-4365d14bab8c'],
  whiteboard:['1517245386807-bb43f82c33c4'], // sticky notes meeting
  essay:    ['1488998427799-e3362cec87c3'],  // coffee + notebook
  numbers:  ['1551288049-bebda4e38f71'],     // analytics graph
  library:  ['1481627834876-b7833e8f5570'],  // book stack
  mobile:   ['1512941937669-90a1b58e7e9c'],  // phone in hand
  server:   ['1558494949-ef010cbdcc31'],     // server room blue
  camera:   ['1502920514313-52581002a659'],  // studio camera
  book:     ['1532012197267-da84d127e765'],  // open book
  workspace:['1556761175-5973dc0f32e7'],     // desk + plant
  city:     ['1480714378408-67cf0d13bc1b'],  // architecture
  writing:  ['1455390582262-044cdead277a'],  // hand + pen
};

function url(id) {
  return `https://images.unsplash.com/photo-${id}?w=600&h=420&fit=crop&auto=format&q=80`;
}

// ============================================================
// keyword → category. order matters, first match wins.
// ============================================================
// Each rule's regex must use \b word boundaries so partial matches
// don't fire (e.g. "knowledge" matching "edge", "invoice" matching "voice").
const RULES = [
  // narrowest / strongest signals first so general ones don't preempt
  [/\b(?:voice|gpt-realtime|podcast|latent space|microphone|audio|video|camera|creative|image and video)\b/i, 'camera'],
  [/\b(?:codex.*mobile|on mobile|on iphone|mobile workflow|phone workflow|on-device latency|gemini nano|sidekick)\b/i, 'mobile'],
  [/\b(?:server|datacenter|tpu|cluster|streaming cache|inference|cloudflare|edge|kernel update)\b/i, 'server'],
  [/\b(?:workspace|notion|google workspace|docs|sheets|slides|gemini agents)\b/i, 'workspace'],
  [/\b(?:replit|vercel ai sdk|sdk|coding|developer|repo|migration|atlas (?:bookkeeping|bundle))\b/i, 'code'],
  [/\b(?:pricing|invoice|dashboard|growth metric|metric|production note|bookkeeping|case study)\b/i, 'numbers'],
  [/\b(?:positioning|marketing|growth|funnel|plg|haines|andrew chen|playbook|teardown|sales mode|skills?)\b/i, 'whiteboard'],
  [/\b(?:alignment|constitutional|critique chain|msm|world-model|benchmark|neuralbench|research)\b/i, 'library'],
  [/\b(?:lenny|tidbits|newsletter|6-month|six-month|six months|long post)\b/i, 'book'],
  [/\b(?:stratechery|platformer|every|essay|memo|long-form essay|writing with ai)\b/i, 'essay'],
  [/\b(?:city|architecture|industry|legacy|commodity|bundle|enterprise tier|simplification)\b/i, 'city'],
  [/\b(?:draft|sketch|hand-written|by hand)\b/i, 'writing'],
];

function pickPhoto(item) {
  const text = [item.headline, item.deck].filter(Boolean).join(' ');
  for (const [re, cat] of RULES) {
    if (re.test(text)) {
      const pool = LIB[cat];
      // stable variant: use last digit of id (c001 → 1, c002 → 2)
      const digit = (item.id || '').slice(-1);
      const idx = (parseInt(digit, 10) || 0) % pool.length;
      return url(pool[idx]);
    }
  }
  // default: laptop
  return url(LIB.laptop[0]);
}

async function main() {
  const files = (await readdir(DAYS_DIR))
    .filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f));
  console.log(`updating ${files.length} issues...`);

  let updated = 0;
  for (const f of files) {
    const fp = path.join(DAYS_DIR, f);
    const data = JSON.parse(await readFile(fp, 'utf8'));
    for (const it of data.items || []) {
      // skip MUST-DO (no image)
      if ((it.source || {}).kind === 'task') {
        it.image_url = '';
        continue;
      }
      it.image_url = pickPhoto(it);
      updated++;
    }
    await writeFile(fp, JSON.stringify(data, null, 2) + '\n');
  }
  console.log(`  ${updated} item images replaced`);

  // rebuild manifest with lead_image_url from rank-1 of each issue
  const manifest = [];
  const sorted = files.sort().reverse();
  for (const f of sorted) {
    const j = JSON.parse(await readFile(path.join(DAYS_DIR, f), 'utf8'));
    const lead = j.items?.[0] || {};
    const readTotal = (j.items || []).reduce((s, it) => s + (it.read_time_min || 0), 0);
    manifest.push({
      date: j.date,
      weekday: j.weekday,
      no: j.no,
      edition: j.edition,
      promo_headline: j.promo_headline,
      lead_kicker: lead.kicker || '',
      lead_headline: lead.headline || '',
      lead_deck: lead.deck || '',
      lead_tag: lead.tag || 'SIGNAL',
      tag_color: lead.tag_color || 'pink',
      story_count: (j.items || []).length,
      read_time_total_min: readTotal,
      lead_author: lead.author || {},
      lead_source: lead.source || {},
      lead_image_url: lead.image_url || '',
    });
  }
  await writeFile(path.join(DAYS_DIR, 'manifest.json'),
                  JSON.stringify(manifest, null, 2) + '\n');
  console.log(`  manifest rebuilt: ${manifest.length} entries`);
}

main().catch(e => { console.error(e); process.exit(1); });
