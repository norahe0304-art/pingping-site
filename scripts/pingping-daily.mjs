#!/usr/bin/env node
/**
 * pingping-daily.mjs — daily AI-marketing feed generator.
 *
 * Flow:
 *   1. Read feed/sources.json (RSS feeds + manual X picks)
 *   2. Fetch each RSS source (pure regex parse, zero deps)
 *   3. Filter to last 48h
 *   4. Optionally call Claude API to curate + rewrite in pingping voice
 *      (falls back to top-N by recency if no ANTHROPIC_API_KEY)
 *   5. Write feed/days/YYYY-MM-DD.json (full issue)
 *   6. Update feed/days/manifest.json (preview per day)
 *
 * env:
 *   ANTHROPIC_API_KEY    optional — enables Claude curation
 *   PINGPING_DATE        optional — override date (default = today UTC)
 *   PINGPING_MAX_ITEMS   optional — max items per issue (default 8)
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ============================================================
// Paths + date
// ============================================================
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const FEED_DIR = path.join(ROOT, 'feed', 'days');
const SOURCES_PATH = path.join(ROOT, 'feed', 'sources.json');
const MANIFEST_PATH = path.join(FEED_DIR, 'manifest.json');

const TODAY = process.env.PINGPING_DATE || new Date().toISOString().slice(0, 10);
const TODAY_DATE = new Date(TODAY + 'T12:00:00Z');
const WEEKDAY = TODAY_DATE.toLocaleDateString('en-US', { weekday: 'long' });
// Nora's early brief is fixed shape: 5 signals + 2 must-do = 7 items + 1 digest insight
const MAX_ITEMS = parseInt(process.env.PINGPING_MAX_ITEMS || '7', 10);

const FIRST_ISSUE = new Date('2026-01-30T00:00:00Z');
const ISSUE_NO = Math.floor((TODAY_DATE - FIRST_ISSUE) / 86400000) + 1;
const EDITION = ['Saturday', 'Sunday'].includes(WEEKDAY)
  ? 'Weekend Edition'
  : `${WEEKDAY} Edition`;

const TAG_COLORS = {
  PLAYBOOK: 'pink', STACK: 'cyan', CRAFT: 'amber',
  SIGNAL: 'indigo', NUMBERS: 'pink', CONTRARIAN: 'amber',
};

// ============================================================
// RSS parsing — pure regex, no external deps
// ============================================================
function clean(s) {
  return (s || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'").replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function readTag(block, name) {
  const re = new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`, 'i');
  const m = block.match(re);
  return m ? m[1] : '';
}

// ============================================================
// OG image extraction — fetch URL, parse <meta property="og:image">
// (also handles twitter:image fallback). Best-effort with timeout.
// ============================================================
async function fetchOgImage(url) {
  if (!url || url.startsWith('https://x.com/search')) return ''; // X search URLs have no useful OG
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'pingping/1.0 (+https://pingping.fyi)' },
      signal: AbortSignal.timeout(8000),
      redirect: 'follow',
    });
    if (!res.ok) return '';
    const html = await res.text();
    // try og:image first, then twitter:image, then any property=image
    const patterns = [
      /<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
      /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i,
    ];
    for (const re of patterns) {
      const m = html.match(re);
      if (m) {
        let img = m[1].trim();
        // resolve protocol-relative + relative URLs
        if (img.startsWith('//')) img = 'https:' + img;
        else if (img.startsWith('/')) {
          try { img = new URL(img, url).href; } catch {}
        }
        return img;
      }
    }
    return '';
  } catch (e) {
    return '';
  }
}

async function fetchRSS(source) {
  try {
    const res = await fetch(source.url, {
      headers: { 'User-Agent': 'pingping/1.0 (+https://pingping.fyi)' },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      console.error(`[${source.id}] HTTP ${res.status}`);
      return [];
    }
    const xml = await res.text();
    const blocks = [...xml.matchAll(/<(?:item|entry)\b[^>]*>([\s\S]*?)<\/(?:item|entry)>/g)];
    const items = blocks.slice(0, 12).map(m => {
      const block = m[1];
      const title = clean(readTag(block, 'title'));
      // <link>url</link> for RSS, <link href="url"/> for Atom
      let url = clean(readTag(block, 'link'));
      if (!url) {
        const atomLink = block.match(/<link[^>]+href=["']([^"']+)["']/i);
        if (atomLink) url = atomLink[1];
      }
      const summary = clean(
        readTag(block, 'description') ||
        readTag(block, 'summary') ||
        readTag(block, 'content:encoded')
      ).slice(0, 600);
      const pubDate = clean(
        readTag(block, 'pubDate') ||
        readTag(block, 'published') ||
        readTag(block, 'updated') ||
        readTag(block, 'dc:date')
      );
      const author = clean(
        readTag(block, 'author') ||
        readTag(block, 'dc:creator')
      ).slice(0, 80);
      return {
        title, url, summary, pubDate, author,
        source: source.id,
        source_label: source.name,
        kind: source.kind,
      };
    }).filter(it => it.title && it.url);
    console.log(`[${source.id}] ${items.length} items`);
    return items;
  } catch (e) {
    console.error(`[${source.id}] fetch failed: ${e.message}`);
    return [];
  }
}

// ============================================================
// Claude curation (optional)
// ============================================================
const CURATE_PROMPT = `You are pingping, an AI-marketing daily editor with strong taste. You write Nora's morning brief — concise, scannable, no fluff. Output ALWAYS in English even if sources are Chinese.

Structure for today's issue (exact counts):
  • 5 SIGNAL items  (the day's most important news/threads/launches) — these go first as ranks 1-5
  • 2 MUST-DO items (concrete tasks Nora should do TODAY, derived from the signals) — ranks 6-7, kicker "Today's Must-Do"
  • 1 INSIGHT       (the pattern under today's noise) — goes into digest

Voice rules (non-negotiable):
  • restrained, lowercase-confident, NO clickbait, NO em dashes
  • never use "game-changer", "revolutionizes", "in this article we explore"
  • each "why" / "try" / "deck" is at most ONE clean sentence
  • headlines under 70 chars
  • specific, not generic — name the actor, name the move

For SIGNAL items (rank 1-5):
  - kicker = "Today's Top Signal" (rank 1) or "Markets & Models" (rank 2-5)
  - headline = crisp one-line summary
  - deck = one sentence: what happened + the relevant detail
  - why = one sentence: the operator takeaway
  - try = one sentence: concrete thing to do today (45-60 min)
  - keep the ORIGINAL url unchanged

For MUST-DO items (rank 6-7):
  - kicker = "Today's Must-Do"
  - headline = "Do X. Pull/Map/Audit Y." (verb-first task title)
  - deck = one sentence: what to do, with the WHY-NOW tied to the day's signals
  - why = one sentence: why TODAY specifically (heat / timing / windowed insight)
  - try = one sentence: a 30-50 min scoped action with a timer
  - source.label = "Must-do · 40 min" format
  - source.kind = "task"
  - url = link back to the signal that prompted this task

Tags: SIGNAL / STACK / CRAFT / NUMBERS / PLAYBOOK / CONTRARIAN

Output ONLY valid JSON (no markdown fence) matching this exact shape:
{
  "promo_headline": "five signals · two moves · one pattern (one short cover line)",
  "digest_title": "one-sentence theme of the day",
  "digest_body": "3 sentences max. State the pattern. Tie 2-3 signals to it. End with what Nora ships this week.",
  "items": [
    {
      "rank": 1,
      "tag": "SIGNAL",
      "kicker": "Today's Top Signal",
      "headline": "≤70 char headline",
      "deck": "one sentence",
      "why": "one sentence",
      "try": "one sentence",
      "url": "ORIGINAL url unchanged",
      "author_name": "if known",
      "author_handle": "x handle without @ if known",
      "author_role": "role @ org",
      "source_label": "X · post / X · thread / Newsletter / Podcast / YouTube",
      "source_kind": "x / newsletter / podcast / youtube / essay / paper",
      "read_time_min": 5
    }
  ]
}`;

async function curate(items) {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.log('[curate] no ANTHROPIC_API_KEY — falling back to top-N by recency');
    return null;
  }
  console.log(`[curate] calling Claude with ${items.length} candidates`);
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      messages: [{
        role: 'user',
        content: `${CURATE_PROMPT}\n\n=== ITEMS ===\n${JSON.stringify(items.slice(0, 40), null, 2)}`,
      }],
    }),
  });
  if (!res.ok) {
    console.error('[curate] Claude API error:', res.status, await res.text());
    return null;
  }
  const data = await res.json();
  const text = data.content?.[0]?.text || '';
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    console.error('[curate] no JSON in Claude response');
    return null;
  }
  try {
    return JSON.parse(jsonMatch[0]);
  } catch (e) {
    console.error('[curate] JSON parse failed:', e.message);
    return null;
  }
}

// ============================================================
// Fallback: top-N by recency (no Claude)
// ============================================================
function fallbackCurate(items) {
  const fallbackTags = ['PLAYBOOK', 'STACK', 'CRAFT', 'SIGNAL', 'NUMBERS', 'CONTRARIAN'];
  return {
    promo_headline: `${WEEKDAY}'s edition — ${items.length} stories from across the AI internet.`,
    digest_title: `Auto-generated briefing for ${TODAY}.`,
    digest_body: 'No Claude curation available; this is a raw RSS pull ranked by recency. Set ANTHROPIC_API_KEY to enable editorial curation.',
    items: items.slice(0, MAX_ITEMS).map((it, i) => ({
      rank: i + 1,
      tag: fallbackTags[i % fallbackTags.length],
      kicker: i === 0 ? 'Lead of the Day' : '',
      headline: it.title.slice(0, 80),
      deck: it.summary.slice(0, 180),
      why: '',
      try: '',
      url: it.url,
      author_name: it.author || '',
      author_handle: '',
      author_role: it.source_label,
      source_label: it.source_label,
      source_kind: it.kind || 'newsletter',
      read_time_min: Math.max(2, Math.round(it.summary.length / 200)),
    })),
  };
}

// ============================================================
// Normalize curated → on-disk schema
// ============================================================
// build a Pollinations.ai prompt URL from a headline + tag
// (free public AI image gen, no auth — used when no real OG image)
function pollinationsImage(headline, tag, seed) {
  const styleByTag = {
    SIGNAL:     'news editorial photography, sharp, modern',
    PLAYBOOK:   'desk setup with notes, editorial photography',
    STACK:      'product photo, clean minimal, professional',
    CRAFT:      'magazine editorial photo, considered composition',
    NUMBERS:    'data visualization on screen, editorial photo',
    CONTRARIAN: 'editorial photo, moody, sharp',
  };
  const style = styleByTag[(tag || '').toUpperCase()] || styleByTag.SIGNAL;
  const prompt = `${headline.replace(/[^\w\s\-,]/g, '').slice(0, 140)}. ${style}`;
  const enc = encodeURIComponent(prompt);
  return `https://image.pollinations.ai/prompt/${enc}?width=800&height=450&nologo=true&model=flux&seed=${seed || 1}`;
}

async function normalize(curated) {
  // for each item, try to fetch og:image in parallel
  const ogImages = await Promise.all(
    curated.items.map(it => fetchOgImage(it.url))
  );
  return curated.items.map((it, i) => {
    let imageUrl = ogImages[i];
    // fallback: Pollinations AI image generation from headline + tag
    if (!imageUrl) {
      imageUrl = pollinationsImage(it.headline || '', it.tag || 'SIGNAL', (it.rank || i + 1) * 17);
    }
    return {
      id: `c${String(i + 1).padStart(3, '0')}`,
      rank: it.rank || i + 1,
      tag: (it.tag || 'SIGNAL').toUpperCase(),
      tag_color: TAG_COLORS[(it.tag || 'SIGNAL').toUpperCase()] || 'pink',
      kicker: it.kicker || '',
      headline: it.headline || '',
      deck: it.deck || '',
      why: it.why || '',
      try: it.try || '',
      url: it.url || '',
      image_url: imageUrl || '',
      image_alt: it.headline || '',
      read_time_min: it.read_time_min || 4,
      author: {
        name: it.author_name || '',
        handle: it.author_handle || '',
        role: it.author_role || '',
        avatar_url: it.author_handle
          ? `https://unavatar.io/x/${it.author_handle}`
          : '',
      },
      source: {
        label: it.source_label || '',
        kind: it.source_kind || '',
      },
    };
  });
}

// ============================================================
// Main
// ============================================================
async function main() {
  console.log(`\npingping daily · ${TODAY} (${WEEKDAY})\n`);

  // 1. read sources
  if (!existsSync(SOURCES_PATH)) {
    console.error(`✗ feed/sources.json missing`);
    process.exit(1);
  }
  const sources = JSON.parse(await readFile(SOURCES_PATH, 'utf8'));

  // 2. fetch all RSS in parallel
  console.log(`fetching ${sources.rss.length} sources...`);
  const all = (await Promise.all(sources.rss.map(fetchRSS))).flat();
  console.log(`\ntotal gathered: ${all.length} items`);

  // 3. filter last 48h
  const cutoff = Date.now() - 48 * 3600 * 1000;
  const fresh = all.filter(it => {
    if (!it.pubDate) return true;
    const t = Date.parse(it.pubDate);
    return isNaN(t) || t > cutoff;
  });
  console.log(`fresh (last 48h): ${fresh.length}\n`);

  // 4. include manual picks (user-curated URLs)
  const manual = (sources.manual_picks || []).map(p => ({
    title: p.title || p.url,
    url: p.url,
    summary: p.summary || '',
    pubDate: TODAY + 'T00:00:00Z',
    author: p.author || '',
    source: 'manual',
    source_label: p.source_label || 'Hand-picked',
    kind: p.kind || 'x',
  }));

  const candidates = [...manual, ...fresh];
  if (candidates.length === 0) {
    console.error('✗ no candidates — aborting');
    process.exit(1);
  }

  // 5. curate (Claude or fallback)
  const curated = (await curate(candidates)) || fallbackCurate(candidates);
  console.log('fetching og:image for each item...');
  const items = await normalize(curated);
  const withImages = items.filter(it => it.image_url).length;
  console.log(`curated: ${items.length} items · ${withImages} have real images`);

  // 6. build issue document
  const issue = {
    date: TODAY,
    weekday: WEEKDAY,
    no: ISSUE_NO,
    edition: EDITION,
    generated_at: new Date().toISOString(),
    promo_headline: curated.promo_headline ||
      `Today's edition — ${items.length} stories.`,
    whats_news: items.slice(0, 5).map(it =>
      `<b>${it.author.name || it.source.label}</b>: ${it.headline}`
    ),
    digest: {
      title: curated.digest_title || `Briefing · ${TODAY}`,
      body: curated.digest_body || '',
    },
    items,
  };

  // 7. write day file
  await mkdir(FEED_DIR, { recursive: true });
  const dayFile = path.join(FEED_DIR, `${TODAY}.json`);
  await writeFile(dayFile, JSON.stringify(issue, null, 2));
  console.log(`✓ wrote ${path.relative(ROOT, dayFile)}`);

  // 8. update manifest (preview per day)
  const lead = items[0] || {};
  const totalReadTime = items.reduce((sum, it) => sum + (it.read_time_min || 0), 0);
  const preview = {
    date: TODAY,
    weekday: WEEKDAY,
    no: ISSUE_NO,
    edition: EDITION,
    promo_headline: issue.promo_headline,
    lead_kicker: lead.kicker || '',
    lead_headline: lead.headline || '',
    lead_deck: lead.deck || '',
    lead_tag: lead.tag || '',
    tag_color: lead.tag_color || 'pink',
    story_count: items.length,
    read_time_total_min: totalReadTime,
    lead_author: lead.author || {},
    lead_source: lead.source || {},
    // hero image for the rack cover — real OG if scraper got one, else falls back to author avatar in frontend
    lead_image_url: lead.image_url || (lead.author?.handle ? `https://unavatar.io/x/${lead.author.handle}?fallback=false` : ''),
  };

  let manifest = { updated_at: '', days: [] };
  if (existsSync(MANIFEST_PATH)) {
    try {
      manifest = JSON.parse(await readFile(MANIFEST_PATH, 'utf8'));
    } catch {}
  }
  // remove any existing entry for today, prepend new
  manifest.days = (manifest.days || []).filter(d => d.date !== TODAY);
  manifest.days.unshift(preview);
  // keep latest 60 days
  manifest.days = manifest.days.slice(0, 60);
  manifest.updated_at = new Date().toISOString();
  await writeFile(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
  console.log(`✓ manifest now has ${manifest.days.length} days`);
  console.log(`\ndone.\n`);
}

main().catch(e => {
  console.error('\n✗ fatal:', e);
  process.exit(1);
});
