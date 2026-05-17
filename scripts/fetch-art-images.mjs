#!/usr/bin/env node
/**
 * fetch-art-images.mjs — every.to-grade editorial imagery via the Met
 * Museum Open Access API. Each story gets a stable, unique piece of
 * public-domain fine art keyed off its headline.
 *
 * Why this (and not OG / Unsplash):
 *   - Met has ~470k objects with public-domain images, no key required.
 *   - Filtering to Paintings / Drawings / Prints removes catalog-y crap.
 *   - Stable hash → same headline always gets the same artwork.
 *   - Real fine art next to tech news is a deliberate editorial move,
 *     not an accident. Atlas / NYT Magazine tone.
 *
 * Usage:
 *   node scripts/fetch-art-images.mjs --date 2026-05-16   (one day, sample)
 *   node scripts/fetch-art-images.mjs                     (all days)
 *   node scripts/fetch-art-images.mjs --dry               (no writes)
 */
import { readdir, readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, '..');
const DAYS_DIR  = path.join(ROOT, 'feed', 'days');
const OUT_DIR   = path.join(ROOT, 'feed', 'art');

const DRY  = process.argv.includes('--dry');
const dateArg = (() => {
  const i = process.argv.indexOf('--date');
  return i >= 0 ? process.argv[i + 1] : null;
})();

const API = 'https://collectionapi.metmuseum.org/public/collection/v1';
const ALLOWED_CLASS = /(paint|print|draw|engrav|etch|litho|watercolor|illumination|miniature|fresco|gouache|scroll|woodblock|pastel|drawing|aquatint)/i;

// stopwords + tech-jargon that don't make good art queries
const STOP = new Set([
  'the','a','an','of','for','to','in','on','at','with','and','or','but','as',
  'is','are','was','were','be','been','it','its','this','that','these','those',
  'into','from','by','about','than','then','also','again','more','most','less',
  'try','read','apply','run','listen','watch','draft','map','audit','sketch','pick','use',
  'one','two','three','some','any','every','your','my','our','their','his','her',
  'workflow','step','minute','minutes','day','week','today','tomorrow','now',
  // overly-tech words that yield bad Met matches
  'ai','llm','api','sdk','gpu','tpu','ux','ui','plg','b2b','saas','copilot','agent',
  'gpt','codex','claude','gemini','openai','anthropic','meta','google','microsoft','stripe',
  'cloudflare','vercel','replit','linear','notion','android','ios','xcode',
  'instant','turn','turns','ship','ships','open','opens','add','adds','adds','release','releases',
  'patch','update','launch','launches','drop','drops','strike','strikes','publish','publishes',
  'tier','version','feature','launch','workflow',
]);

// pure-noun art-friendly synonyms — tech term → art-search term
const ART_LIFT = {
  mobile: 'communication letter', phone: 'communication',
  compute: 'machine industry', server: 'tower industry',
  alignment: 'order harmony', benchmark: 'measurement',
  pricing: 'market merchant', dashboard: 'instrument',
  marketing: 'merchant scene', positioning: 'portrait pose',
  funnel: 'water flow', migration: 'journey caravan',
  agent: 'messenger figure', sidekick: 'companion duet',
  memory: 'remembrance allegory', kernel: 'seed nature',
  bundle: 'still life arrangement', enterprise: 'workshop',
  research: 'study scholar', protocol: 'ceremony procession',
  newsletter: 'reading letter', podcast: 'music voice',
  episode: 'scene theater', evaluation: 'judgment scale',
  inference: 'thought study', latency: 'time clock',
  streaming: 'river current', cache: 'storehouse',
  workflow: 'workshop labor', skills: 'craft trade',
  product: 'object still life', metric: 'measurement scale',
  digest: 'gathering assembly', signal: 'beacon torch',
  pattern: 'tapestry textile', growth: 'garden tree',
  ubi: 'common labor harvest', payment: 'merchant coin',
  bookkeeping: 'merchant ledger',
};

function tokenize(headline) {
  // strip leading "Try ... " / "Read ... " action prefixes
  const cleaned = headline
    .replace(/^[A-Z][a-z]+:\s*/, '')                     // "OpenAI: ..."
    .replace(/^(Try|Read|Apply|Run|Listen|Watch|Draft|Map|Audit|Sketch|Pick|Use|Take)\b\s+/i, '');
  // lowercase, strip punct, split
  return cleaned
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter(w => w && !STOP.has(w) && w.length > 2);
}

function buildQuery(headline) {
  const words = tokenize(headline);
  const lifted = words.flatMap(w => (ART_LIFT[w] ? ART_LIFT[w].split(' ') : [w])).filter(Boolean);
  // take first 3 distinctive tokens to keep the search narrow but not empty
  const seen = new Set();
  const picked = [];
  for (const w of lifted) {
    if (!seen.has(w)) { seen.add(w); picked.push(w); }
    if (picked.length >= 3) break;
  }
  return picked.join(' ') || 'figure scene';
}

// stable RNG seeded by (date, id) so a given slot always picks the same artwork
function stableRng(seed) {
  let s = createHash('sha1').update(seed).digest().readUInt32BE(0);
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 0x100000000; };
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Met API will 403 on bursts. Serialize through this gate + retry with
// exponential backoff. ~150ms baseline pace is well under their published
// 80 req/sec headroom but tolerates whatever soft cap they actually use.
let lastReqAt = 0;
const MIN_GAP_MS = 180;
async function throttledFetch(url, init) {
  const wait = Math.max(0, MIN_GAP_MS - (Date.now() - lastReqAt));
  if (wait) await sleep(wait);
  lastReqAt = Date.now();
  return fetch(url, init);
}

async function fetchJson(url) {
  const headers = { 'user-agent': 'pingping-site/1.0 (https://github.com/norahe0304-art/pingping-site)' };
  let delay = 500;
  for (let attempt = 0; attempt < 5; attempt++) {
    const r = await throttledFetch(url, { headers });
    if (r.ok) return r.json();
    if (r.status === 403 || r.status === 429 || r.status >= 500) {
      await sleep(delay);
      delay = Math.min(delay * 2, 8000);
      continue;
    }
    throw new Error(`HTTP ${r.status}`);
  }
  throw new Error(`HTTP retry exhausted`);
}

async function candidateArt(query, seed) {
  const url = `${API}/search?q=${encodeURIComponent(query)}&hasImages=true&isPublicDomain=true`;
  const sr = await fetchJson(url);
  const ids = sr.objectIDs || [];
  if (ids.length === 0) return [];
  const rng = stableRng(seed);
  const tries = Math.min(ids.length, 18);
  const picks = [];
  while (picks.length < tries) {
    const idx = Math.floor(rng() * ids.length);
    if (!picks.includes(idx)) picks.push(idx);
  }
  const out = [];
  for (const idx of picks) {
    const oid = ids[idx];
    try {
      const obj = await fetchJson(`${API}/objects/${oid}`);
      const img = obj.primaryImage || obj.primaryImageSmall;
      const cls = `${obj.classification || ''} ${obj.medium || ''}`;
      if (img && ALLOWED_CLASS.test(cls)) {
        out.push({
          oid, img,
          title: obj.title || '',
          artist: obj.artistDisplayName || '',
          date: obj.objectDate || '',
          classification: obj.classification || '',
        });
        if (out.length >= 6) break;   // enough fallbacks
      }
    } catch {}
  }
  return out;
}

// Met returns full-res masterworks (3-5 MB each, 4000+ px). The feed card
// renders at 600x420, so we resize to 1400px max + q82 jpg on the way in.
// 13x size reduction with no perceptible quality loss at display size.
const HAS_MAGICK = spawnSync('which', ['magick']).status === 0;

async function downloadBinary(url, outPath) {
  const r = await fetch(url, { headers: { 'user-agent': 'pingping-site/1.0', referer: 'https://www.metmuseum.org/' } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length < 4096) throw new Error(`tiny: ${buf.length}b`);
  if (DRY) return buf.length;
  if (HAS_MAGICK) {
    const proc = spawnSync('magick', ['-', '-resize', '1400x1400>', '-strip', '-quality', '82', '-interlace', 'Plane', '-sampling-factor', '4:2:0', outPath], { input: buf });
    if (proc.status === 0) {
      try { const s = await stat(outPath); return s.size; } catch { return buf.length; }
    }
  }
  await writeFile(outPath, buf);
  return buf.length;
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  let dayFiles = (await readdir(DAYS_DIR))
    .filter(f => /^2026-.*\.json$/.test(f))
    .map(f => path.join(DAYS_DIR, f));
  if (dateArg) dayFiles = dayFiles.filter(f => f.includes(dateArg));

  const docs = [];
  for (const f of dayFiles) {
    docs.push({ f, doc: JSON.parse(await readFile(f, 'utf8')) });
  }

  // cache search results per query so multiple stories with same query share artwork lookup
  const searchCache = new Map();   // query -> [ids]
  let ok = 0, miss = 0, dlFail = 0;
  const log = [];

  for (const { doc } of docs) {
    for (const it of (doc.items || [])) {
      if (!it.headline) continue;
      const seed   = `${doc.date}:${it.id}:${it.headline}`;
      const query  = buildQuery(it.headline);
      let candidates;
      try {
        candidates = await candidateArt(query, seed);
      } catch (e) {
        miss++;
        log.push(`  [apierr] ${doc.date} ${it.id}  q='${query}'  — ${e.message}`);
        continue;
      }
      // generic fallback — if the specific query yielded nothing, fall back
      // to a broad art-topic search seeded by the slot so we still get a
      // stable per-story masterwork rather than an empty card
      if (candidates.length === 0) {
        const GENERIC = ['figure portrait', 'landscape scene', 'study allegory', 'merchant scene', 'scholar study', 'still life'];
        const idx = Math.floor(stableRng(seed + ':fallback')() * GENERIC.length);
        const fallbackQuery = GENERIC[idx];
        try {
          candidates = await candidateArt(fallbackQuery, seed + ':fallback');
          if (candidates.length) log.push(`  [fbk]    ${doc.date} ${it.id}  primary q='${query}' empty → fallback '${fallbackQuery}'`);
        } catch (e) {
          log.push(`  [fbkerr] ${doc.date} ${it.id}  fallback '${fallbackQuery}'  — ${e.message}`);
        }
      }
      if (candidates.length === 0) {
        miss++;
        log.push(`  [miss]   ${doc.date} ${it.id}  q='${query}'`);
        continue;
      }
      // try each candidate until download succeeds — Met sometimes lists
      // an image URL that 404s; the next pick is usually fine
      let picked = null;
      for (const art of candidates) {
        const ext = (art.img.match(/\.(jpe?g|png|webp)(\?|$)/i) || [,'jpg'])[1].toLowerCase().replace('jpeg','jpg');
        const out = path.join(OUT_DIR, `met-${art.oid}.${ext}`);
        const rel = `./art/met-${art.oid}.${ext}`;
        if (existsSync(out)) {
          picked = { art, rel };
          log.push(`  [cache]  ${doc.date} ${it.id}  #${art.oid}  ${art.title.slice(0,32)}`);
          break;
        }
        try {
          const bytes = await downloadBinary(art.img, out);
          picked = { art, rel };
          log.push(`  [ok]     ${doc.date} ${it.id}  #${art.oid}  ${art.title.slice(0,32).padEnd(32)}  ${art.artist.slice(0,18)}  (${bytes}b)`);
          break;
        } catch (e) {
          log.push(`  [retry]  ${doc.date} ${it.id}  #${art.oid} 404 — trying next candidate`);
        }
      }
      if (!picked) {
        dlFail++;
        log.push(`  [dlerr]  ${doc.date} ${it.id}  all ${candidates.length} candidates failed`);
        continue;
      }
      it.image_url = picked.rel;
      it.image_alt = `${picked.art.title} — ${picked.art.artist || 'Unknown'} (${picked.art.date || 'undated'})`;
      ok++;
    }
  }

  if (!DRY) {
    for (const { f, doc } of docs) await writeFile(f, JSON.stringify(doc, null, 2) + '\n');
  }

  // sync manifest leads
  if (!DRY && !dateArg) {
    const manifestPath = path.join(DAYS_DIR, 'manifest.json');
    try {
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
      const byDate = new Map(docs.map(({ doc }) => [doc.date, (doc.items.find(i => i.rank === 1) || doc.items[0])]));
      for (const entry of manifest) {
        const lead = byDate.get(entry.date);
        if (lead) entry.lead_image_url = lead.image_url || '';
      }
      await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
    } catch {}
  }

  console.log(log.join('\n'));
  console.log(`\n=== ${ok} ok | ${miss} miss | ${dlFail} dl-fail ===`);
  if (DRY) console.log('(dry run — nothing written)');
}

main().catch(e => { console.error(e); process.exit(1); });
