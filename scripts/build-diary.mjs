#!/usr/bin/env node
/**
 * build-diary.mjs — regenerate diary/index.html from per-day source files.
 *
 * Each diary/YYYY-MM-DD.html is a markdown source with a YAML-ish
 * frontmatter (title / date / cover / coverAlt / coverCaption) plus
 * a body using custom inline syntax:
 *
 *   ==text==     →  rough-notation underline
 *   ((text))     →  rough-notation circle
 *   ## NN        →  numbered subhead w/ underline
 *   > [side] X   →  Atlas-style margin sidenote attached to prev paragraph
 *   > quote      →  blockquote
 *   `code`       →  inline code
 *
 * The aggregator (diary/index.html) is fully regenerated each run:
 *   - sticky TOC sidebar listing every entry (newest first, numbered)
 *   - sticky pill indicator updated on scroll (by diary-toc.js)
 *   - main column: hero + every entry section, oldest-newest, top-down newest
 *
 * Usage:
 *   node scripts/build-diary.mjs
 */

import { readFile, writeFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DIARY_DIR = path.join(ROOT, 'diary');

// ============================================================
// frontmatter + body parse
// ============================================================
function parseEntry(raw) {
  const fmMatch = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
  if (!fmMatch) throw new Error('missing frontmatter');
  const fm = {};
  for (const line of fmMatch[1].split('\n')) {
    const m = line.match(/^([a-zA-Z_]+):\s*(.*)$/);
    if (!m) continue;
    let value = m[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    fm[m[1]] = value;
  }
  const body = fmMatch[2];
  return { fm, body };
}

function escHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;');
}

// Convert inline markers within a paragraph's already-escaped text.
function inlineMark(text) {
  // backticks → <code>
  text = text.replace(/`([^`]+)`/g, (_, c) => `<code>${c}</code>`);
  // ((circle))
  text = text.replace(/\(\(([^)]+?)\)\)/g, (_, c) =>
    `<span data-rn="circle" data-rn-stroke="2" data-rn-padding="6">${c}</span>`);
  // ==underline==
  text = text.replace(/==([^=]+?)==/g, (_, c) =>
    `<span data-rn="underline" data-rn-stroke="2" data-rn-padding="2">${c}</span>`);
  return text;
}

// Convert body markdown into prose HTML matching the existing index.html style.
function bodyToHtml(body) {
  const lines = body.split('\n');
  const out = [];
  let para = [];        // current paragraph buffer
  let blockquote = [];  // current blockquote buffer

  const flushPara = () => {
    if (para.length === 0) return;
    const text = inlineMark(escHtml(para.join(' ').trim()));
    out.push(`<p>${text}</p>`);
    para = [];
  };
  const flushQuote = () => {
    if (blockquote.length === 0) return;
    const text = inlineMark(escHtml(blockquote.join(' ').trim()));
    out.push(`<blockquote><p>${text}</p></blockquote>`);
    blockquote = [];
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      flushPara();
      flushQuote();
      continue;
    }

    // ## NN — numbered subhead
    const h2 = line.match(/^##\s+(.+)$/);
    if (h2) {
      flushPara(); flushQuote();
      out.push(`<h2><span data-rn="underline" data-rn-stroke="1.5" data-rn-padding="2">${escHtml(h2[1].trim())}</span></h2>`);
      continue;
    }

    // > [side] X — sidenote attaches to the LAST paragraph
    const side = line.match(/^>\s*\[side\]\s*(.+)$/);
    if (side) {
      flushQuote();
      // Append sidenote inline to most recent <p>
      const noteText = inlineMark(escHtml(side[1].trim()));
      const noteHtml = `<span class="zi-sidenote">${noteText}</span>`;
      // attach to current building paragraph if present, else previous emitted <p>
      if (para.length) {
        // append to current paragraph
        para[para.length - 1] += noteHtml;
      } else {
        // attach to last <p> in out[]
        for (let i = out.length - 1; i >= 0; i--) {
          if (out[i].startsWith('<p>') && out[i].endsWith('</p>')) {
            out[i] = out[i].replace(/<\/p>$/, noteHtml + '</p>');
            break;
          }
        }
      }
      continue;
    }

    // > quote line — accumulate into blockquote
    if (line.startsWith('>')) {
      flushPara();
      blockquote.push(line.replace(/^>\s?/, ''));
      continue;
    }

    // regular text — append to current paragraph
    flushQuote();
    para.push(line);
  }
  flushPara();
  flushQuote();
  return out.join('\n');
}

// ============================================================
// page templates
// ============================================================
function renderTocItem(entry, idx) {
  const dateLabel = entry.fm.date.replace(/-/g, '.');
  return `      <li><a class="zi-toc-item" href="#entry-${entry.fm.date}" data-target="entry-${entry.fm.date}"><span class="zi-toc-num">${String(idx + 1).padStart(2, '0')}</span><span class="zi-toc-meta"><span class="zi-toc-title">${escHtml(entry.fm.title)}</span><span class="zi-toc-date">${dateLabel} &middot; ${escHtml(entry.fm.author || 'PINGPING')}</span></span></a></li>`;
}

function renderSection(entry) {
  const dateLabel = entry.fm.date.replace(/-/g, '.');
  const cover = entry.fm.cover || `../artifacts/${entry.fm.date}.webp`;
  const coverAlt = entry.fm.coverAlt || `Daily artifact for ${dateLabel}`;
  const coverCaption = entry.fm.coverCaption || `Artifact ${dateLabel}`;
  return `    <section class="zi-section" id="entry-${entry.fm.date}">
      <header class="zi-section-head">
        <span class="zi-tag">${escHtml((entry.fm.author || 'PINGPING'))} &middot; ${dateLabel}</span>
        <h2 class="zi-section-title"><span data-rn="underline" data-rn-stroke="2" data-rn-padding="2">${escHtml(entry.fm.title)}</span></h2>
      </header>
      <figure data-artifact>
        <img src="${escHtml(cover)}" alt="${escHtml(coverAlt)}" loading="lazy">
        <figcaption>${escHtml(coverCaption)}</figcaption>
      </figure>
      <div class="zi-prose zi-prose-section">
${bodyToHtml(entry.body)}
      </div>
    </section>`;
}

function renderAggregator(entries) {
  // newest first
  const sorted = [...entries].sort((a, b) => b.fm.date.localeCompare(a.fm.date));
  const newestDate = sorted[0]?.fm.date.replace(/-/g, '.') || '';
  const tocItems = sorted.map((e, i) => renderTocItem(e, i)).join('\n');
  const sections = sorted.map(renderSection).join('\n\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Diary — PINGPING</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&family=Geist:wght@400;500;600;700;800&family=Inter:wght@400;500;600;700&family=Caveat:wght@400;500;600;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="../assets/zi.css?v=20">
  <script src="https://unpkg.com/rough-notation/lib/rough-notation.iife.js"></script>
  <script src="../assets/rn.js?v=20" defer></script>
  <script src="../assets/reveal.js?v=20" defer></script>
  <script src="../assets/diary-toc.js?v=20" defer></script>
</head>
<body>

  <nav class="zi-nav">
    <div class="zi-nav-inner">
      <a href="../index.html" class="zi-nav-brand"><strong>pingping</strong>/diary</a>
      <div class="zi-nav-links">
        <a href="../index.html"><span class="zi-nav-num">01</span>home</a>
        <a href="./index.html" aria-current="page"><span class="zi-nav-num">02</span>diary</a>
        <a href="../feed/index.html"><span class="zi-nav-num">03</span>feed</a>
      </div>
    </div>
  </nav>

  <aside class="zi-toc" aria-label="Diary table of contents">
    <div class="zi-toc-head">
      <div class="zi-toc-brand">pingping diary</div>
    </div>
    <ol class="zi-toc-list">
${tocItems}
    </ol>
    <div class="zi-toc-foot">
      <a href="../index.html" class="zi-back">&larr; pingping</a>
    </div>
  </aside>

  <aside class="zi-pill" aria-hidden="true">
    <span class="zi-pill-dot"></span>
    <span id="zi-pill-label">DIARY &middot; ${newestDate}</span>
  </aside>

  <main class="zi-aggregate-main">
    <header class="zi-aggregate-hero">
      <span class="zi-tag">PINGPING · DIARY ARCHIVE</span>
      <h1 class="zi-aggregate-title">
        A daily thread,<br>
        <span data-rn="circle" data-rn-stroke="2" data-rn-padding="6">stitching the days</span>.
      </h1>
      <p class="zi-aggregate-lede">
        One short entry a day from PINGPING — sometimes none.
        Plain, honest, under 400 characters each.
      </p>
    </header>

${sections}

  </main>

</body>
</html>
`;
}

// ============================================================
// main
// ============================================================
async function main() {
  if (!existsSync(DIARY_DIR)) {
    console.error('✗ diary/ not found');
    process.exit(1);
  }
  const files = (await readdir(DIARY_DIR))
    .filter(f => /^\d{4}-\d{2}-\d{2}\.html$/.test(f));
  if (files.length === 0) {
    console.error('✗ no per-day entry files found in diary/');
    process.exit(1);
  }
  console.log(`reading ${files.length} entries...`);
  const entries = [];
  for (const f of files) {
    try {
      const raw = await readFile(path.join(DIARY_DIR, f), 'utf8');
      entries.push(parseEntry(raw));
    } catch (e) {
      console.error(`✗ ${f}: ${e.message}`);
    }
  }
  console.log(`parsed ${entries.length} entries`);

  const html = renderAggregator(entries);
  const outPath = path.join(DIARY_DIR, 'index.html');
  await writeFile(outPath, html);
  console.log(`✓ wrote ${path.relative(ROOT, outPath)}`);
}

main().catch(e => { console.error('fatal:', e); process.exit(1); });
