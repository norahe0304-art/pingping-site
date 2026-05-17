#!/usr/bin/env node
/**
 * fetch-og-images.mjs — replace curated-stock Unsplash with real OG.
 *
 * For each (date, slot) item across feed/days/*.json:
 *   1. fetch item.url with a real-browser UA
 *   2. parse og:image / twitter:image out of the HEAD
 *   3. download that image to feed/og/<sha1(og_url)[0:10]>.<ext>
 *      (items sharing an og:image share the file — honest dedup)
 *   4. rewrite item.image_url to './og/<hash>.<ext>'
 *
 * HTML fetches are cached per item.url within a run. Concurrency 8.
 * Failures blank image_url (renderer skips empty <img> gracefully).
 *
 * Note: item.id (c001..c007) is a slot, not a story key — same id
 * appears across all day files with different headlines. We key by
 * (date, id) for iteration and by og URL hash for files.
 *
 * Usage: node scripts/fetch-og-images.mjs
 *        node scripts/fetch-og-images.mjs --dry        (no writes)
 *        node scripts/fetch-og-images.mjs --force      (re-fetch existing)
 */
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, '..');
const DAYS_DIR  = path.join(ROOT, 'feed', 'days');
const OG_DIR    = path.join(ROOT, 'feed', 'og');

const DRY   = process.argv.includes('--dry');
const FORCE = process.argv.includes('--force');

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36';
const HEADERS = {
  'user-agent': UA,
  'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'accept-language': 'en-US,en;q=0.9',
};
const TIMEOUT_MS = 12_000;

// ============================================================
// utils
// ============================================================
function timeout(ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  return { signal: ctrl.signal, clear: () => clearTimeout(t) };
}

async function fetchText(url) {
  const { signal, clear } = timeout(TIMEOUT_MS);
  try {
    const r = await fetch(url, { headers: HEADERS, redirect: 'follow', signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const ct = r.headers.get('content-type') || '';
    if (!ct.includes('html')) throw new Error(`non-html: ${ct}`);
    // only need the HEAD — cap at 256KB
    const buf = await r.arrayBuffer();
    return new TextDecoder('utf-8', { fatal: false }).decode(buf.slice(0, 262_144));
  } finally { clear(); }
}

async function fetchBinary(url, referer) {
  const { signal, clear } = timeout(TIMEOUT_MS);
  try {
    const headers = { ...HEADERS, accept: 'image/avif,image/webp,image/png,image/*,*/*;q=0.8' };
    if (referer) headers.referer = referer;
    const r = await fetch(url, { headers, redirect: 'follow', signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const ct = r.headers.get('content-type') || '';
    if (!ct.startsWith('image/')) throw new Error(`non-image: ${ct}`);
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length < 1024) throw new Error(`tiny: ${buf.length}b`);
    return { buf, ct };
  } finally { clear(); }
}

// twitter.com / x.com URLs don't serve og:image in static HTML.
// For URLs with a real handle (not home/search/i/...) → use unavatar.io
// to get the profile photo, which is at least account-specific.
const X_BLOCKED_HANDLES = new Set(['home','search','explore','notifications','messages','i','settings','compose','login','signup']);
function xHandleFromUrl(u) {
  try {
    const url = new URL(u);
    if (!/(^|\.)(x|twitter)\.com$/i.test(url.hostname)) return null;
    const seg = url.pathname.split('/').filter(Boolean)[0];
    if (!seg) return null;
    if (X_BLOCKED_HANDLES.has(seg.toLowerCase())) return null;
    if (!/^[A-Za-z0-9_]{1,15}$/.test(seg)) return null;
    return seg;
  } catch { return null; }
}

function extractOg(html) {
  // <meta property=".." content=".."> in either attribute order, single/double quotes
  const A = /<meta\s+[^>]*?(?:property|name)\s*=\s*["'](og:image(?::secure_url|:url)?|twitter:image(?::src)?)["'][^>]*?content\s*=\s*["']([^"']+)["']/gi;
  const B = /<meta\s+[^>]*?content\s*=\s*["']([^"']+)["'][^>]*?(?:property|name)\s*=\s*["'](og:image(?::secure_url|:url)?|twitter:image(?::src)?)["']/gi;
  const found = new Map();
  let m;
  while ((m = A.exec(html))) found.set(m[1].toLowerCase(), m[2]);
  while ((m = B.exec(html))) found.set(m[2].toLowerCase(), m[1]);
  for (const key of ['og:image:secure_url', 'og:image', 'twitter:image', 'twitter:image:src', 'og:image:url']) {
    if (found.has(key)) return found.get(key);
  }
  return null;
}

function extFromContentType(ct) {
  if (ct.includes('jpeg')) return 'jpg';
  if (ct.includes('png'))  return 'png';
  if (ct.includes('webp')) return 'webp';
  if (ct.includes('gif'))  return 'gif';
  if (ct.includes('avif')) return 'avif';
  return 'jpg';
}

function resolve(base, ref) {
  try { return new URL(ref, base).toString(); }
  catch { return ref; }
}

function hash10(s) {
  return createHash('sha1').update(s).digest('hex').slice(0, 10);
}

async function parallel(items, limit, worker) {
  const results = [];
  let i = 0;
  const runners = Array.from({ length: limit }, async () => {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await worker(items[idx], idx);
    }
  });
  await Promise.all(runners);
  return results;
}

// ============================================================
// main
// ============================================================
async function main() {
  await mkdir(OG_DIR, { recursive: true });

  const dayFiles = (await readdir(DAYS_DIR))
    .filter(f => /^2026-.*\.json$/.test(f))
    .map(f => path.join(DAYS_DIR, f));

  // load all day docs, build flat list of (doc, item) pairs
  const docs = [];
  const slots = [];      // { date, id, url, ref (mutates back into doc) }
  for (const f of dayFiles) {
    const doc = JSON.parse(await readFile(f, 'utf8'));
    docs.push({ f, doc });
    if (!Array.isArray(doc.items)) continue;
    for (const it of doc.items) {
      if (!it.url) continue;
      slots.push({ date: doc.date, id: it.id, url: it.url, item: it });
    }
  }
  console.log(`[og] ${slots.length} slots across ${dayFiles.length} day files`);

  // cache OG resolution per URL (HTML fetch + meta parse — same for all slots that share a URL)
  const ogByUrl = new Map();   // url -> { ok, src, err }
  // cache binary download per og:image URL (slots sharing og:image share the file)
  const fileByOgUrl = new Map(); // ogUrl -> { rel, ok, err }

  const stats = { ok: 0, skipped: 0, ogMiss: 0, dlFail: 0, sharedDl: 0 };

  await parallel(slots, 8, async (slot) => {
    // 1. resolve og:image url for slot.url (cached)
    //    fast-path for x.com / twitter.com → unavatar (twitter doesn't ship og)
    let og = ogByUrl.get(slot.url);
    if (!og) {
      const xHandle = xHandleFromUrl(slot.url);
      if (xHandle) {
        og = { ok: true, src: `https://unavatar.io/twitter/${xHandle}?fallback=https://unavatar.io/x/${xHandle}` };
      } else {
        og = await (async () => {
          try {
            const html = await fetchText(slot.url);
            const raw  = extractOg(html);
            if (!raw) return { ok: false, err: 'no og:image in head' };
            return { ok: true, src: resolve(slot.url, raw) };
          } catch (e) { return { ok: false, err: String(e.message || e) }; }
        })();
      }
      ogByUrl.set(slot.url, og);
    }
    if (!og.ok) {
      console.log(`  [miss] ${slot.date} ${slot.id}  ${slot.url.slice(0, 50)}  — ${og.err}`);
      stats.ogMiss++;
      slot.item.image_url = '';
      return;
    }

    // 2. download og:image (cached by og url → shared file)
    let file = fileByOgUrl.get(og.src);
    if (file) {
      slot.item.image_url = file.rel;
      stats.sharedDl++;
      return;
    }

    const h = hash10(og.src);
    const existing = ['jpg','png','webp','gif','avif'].find(e => existsSync(path.join(OG_DIR, h + '.' + e)));
    if (existing && !FORCE) {
      const rel = `./og/${h}.${existing}`;
      fileByOgUrl.set(og.src, { rel, ok: true });
      slot.item.image_url = rel;
      stats.skipped++;
      return;
    }

    try {
      const { buf, ct } = await fetchBinary(og.src, slot.url);
      const ext = extFromContentType(ct);
      const rel = `./og/${h}.${ext}`;
      const abs = path.join(OG_DIR, `${h}.${ext}`);
      if (!DRY) await writeFile(abs, buf);
      fileByOgUrl.set(og.src, { rel, ok: true });
      slot.item.image_url = rel;
      console.log(`  [ok]   ${slot.date} ${slot.id}  ${String(buf.length).padStart(7)}b  ${ct.padEnd(12)}  ${rel}`);
      stats.ok++;
    } catch (e) {
      console.log(`  [dlerr] ${slot.date} ${slot.id}  ${og.src.slice(0, 60)}  — ${e.message}`);
      fileByOgUrl.set(og.src, { ok: false, err: e.message });
      stats.dlFail++;
      slot.item.image_url = '';
    }
  });

  // write day docs back
  if (!DRY) {
    for (const { f, doc } of docs) {
      await writeFile(f, JSON.stringify(doc, null, 2) + '\n');
    }
  }

  // sync manifest.json's lead_image_url with each day's rank-1 (c001) item.
  // manifest is the lightweight index loaded by feed/index.html for the list view.
  const manifestPath = path.join(DAYS_DIR, 'manifest.json');
  try {
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    if (Array.isArray(manifest)) {
      const byDate = new Map();
      for (const { doc } of docs) {
        const lead = (doc.items || []).find(it => it.rank === 1) || (doc.items || [])[0];
        if (lead) byDate.set(doc.date, lead.image_url || '');
      }
      let updated = 0;
      for (const entry of manifest) {
        if (byDate.has(entry.date)) {
          const newUrl = byDate.get(entry.date);
          if (entry.lead_image_url !== newUrl) { entry.lead_image_url = newUrl; updated++; }
        }
      }
      if (!DRY) await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
      console.log(`\n[manifest] synced ${updated} lead_image_url entries`);
    }
  } catch (e) {
    console.log(`[manifest] skipped (${e.message})`);
  }

  // report uniqueness of resulting images
  const final = new Map();  // image_url -> count
  for (const s of slots) {
    const u = s.item.image_url || '(empty)';
    final.set(u, (final.get(u) || 0) + 1);
  }
  const sorted = [...final.entries()].sort((a, b) => b[1] - a[1]);

  console.log('\n=== summary ===');
  console.log(`  ok           ${stats.ok}`);
  console.log(`  shared dl    ${stats.sharedDl}  (slot points to a file fetched earlier in this run)`);
  console.log(`  skipped      ${stats.skipped}  (og/<hash>.* already on disk)`);
  console.log(`  og miss      ${stats.ogMiss}`);
  console.log(`  dl fail      ${stats.dlFail}`);
  console.log(`  total slots  ${slots.length}`);
  console.log(`  unique files ${sorted.filter(([u]) => u !== '(empty)').length}`);
  console.log('\n=== top dupes (final image_url use count) ===');
  for (const [u, c] of sorted.slice(0, 12)) {
    if (c > 1) console.log(`  ${String(c).padStart(2)}x  ${u}`);
  }
  if (DRY) console.log('\n  (dry run — nothing written)');
}

main().catch(e => { console.error(e); process.exit(1); });
