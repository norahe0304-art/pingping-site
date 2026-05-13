#!/usr/bin/env python3
"""
restyle.py — migrate diary/*.html and log/*.html to the zi.css template.

Handles three input formats automatically:
  1. Frontmatter + markdown body                    (e.g. 2026-03-15.html)
  2. Frontmatter + HTML wrapper + markdown body     (e.g. 2026-05-07.html)
  3. Full HTML document w/ legacy wrappers          (e.g. 2026-02-22.html)

For each entry it:
  * extracts title/date from frontmatter or <title>
  * peels off legacy chrome (head, style, script, nav, header, footer)
  * unwraps known design wrappers (.container, .reader-shell, .diary-entry, …)
  * transforms .pull-quote/.quote/.section-mark into semantic blockquote/h2
  * strips class & inline style attributes
  * if body still looks like markdown, runs a minimal markdown → HTML pass
  * drops the leading <h1> (the title is rendered separately in the header)
  * writes the file back wrapped in the shared zi.css chrome.

Idempotent: rerunning skips files that are already on the new template.

Usage:
    python3 tools/restyle.py
"""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


# ============================================================
# Minimal markdown renderer — covers the syntax PINGPING uses
# ============================================================

def md_inline(s: str) -> str:
    # ((phrase)) → rough-notation CIRCLE (Atlas-style oval scribble)
    s = re.sub(
        r"\(\(([^\)\n]+?)\)\)",
        r'<span data-rn="circle" data-rn-stroke="2" data-rn-padding="6">\1</span>',
        s,
    )
    # [[phrase]] → CSS highlighter-pen marker (classic linear-gradient on
    # the bottom half so text stays readable; no rough-notation library
    # opacity-fill issues)
    s = re.sub(
        r"\[\[([^\]\n]+?)\]\]",
        r'<span class="zi-highlight">\1</span>',
        s,
    )
    # ==phrase== → rough-notation UNDERLINE
    s = re.sub(
        r"==([^=\n]+?)==",
        r'<span data-rn="underline" data-rn-stroke="2" data-rn-padding="2">\1</span>',
        s,
    )
    s = re.sub(r"\*\*([^*\n]+?)\*\*", r"<strong>\1</strong>", s)
    s = re.sub(r"(?<![*\w])\*([^*\n]+?)\*(?![*\w])", r"<em>\1</em>", s)
    s = re.sub(r"`([^`\n]+)`", r"<code>\1</code>", s)
    # Image syntax handled in render_markdown's flush_para (block-level figure)
    s = re.sub(r"(?<!\!)\[([^\]]+)\]\(([^)]+)\)", r'<a href="\2">\1</a>', s)
    return s


def render_markdown(text: str) -> str:
    out: list[str] = []
    para: list[str] = []
    quote: list[str] = []
    in_quote = False

    def flush_para():
        if para:
            joined = "\n".join(para).strip()
            if joined:
                # Standalone image line → Atlas-style <figure data-artifact>
                # `![alt](url)` or `![alt](url "caption")` on its own paragraph
                m_img = re.fullmatch(
                    r'!\[([^\]]*)\]\(\s*([^)\s"]+)(?:\s+"([^"]+)")?\s*\)',
                    joined,
                )
                if m_img:
                    alt = m_img.group(1) or ""
                    url = m_img.group(2)
                    caption = m_img.group(3) or alt
                    out.append(
                        f'<figure data-artifact>'
                        f'<img src="{url}" alt="{alt}" loading="lazy">'
                        f'<figcaption>{caption}</figcaption>'
                        f'</figure>'
                    )
                else:
                    out.append(f"<p>{md_inline(joined)}</p>")
            para.clear()

    def flush_quote():
        nonlocal in_quote
        if quote:
            joined = " ".join(quote).strip()
            if joined:
                # `> [side] foo` becomes an Atlas-style margin sidenote
                # (right-margin annotation at ≥1280px); plain `> foo`
                # remains the full-width "NOTE" callout blockquote.
                m_side = re.match(r"^\[side\]\s*(.+)$", joined, re.IGNORECASE)
                if m_side:
                    text = m_side.group(1).strip()
                    out.append(
                        f'<aside class="zi-sidenote"><p>{md_inline(text)}</p></aside>'
                    )
                else:
                    out.append(
                        f"<blockquote><p>{md_inline(joined)}</p></blockquote>"
                    )
            quote.clear()
        in_quote = False

    for line in text.split("\n"):
        stripped = line.strip()

        if not stripped:
            flush_para()
            flush_quote()
            continue

        if stripped == "---":
            flush_para()
            flush_quote()
            out.append("<hr>")
            continue

        m = re.match(r"^(#{1,3})\s+(.+)$", stripped)
        if m:
            flush_para()
            flush_quote()
            lvl = len(m.group(1))
            out.append(f"<h{lvl}>{md_inline(m.group(2))}</h{lvl}>")
            continue

        m = re.match(r"^>\s*(.*)$", stripped)
        if m:
            flush_para()
            in_quote = True
            quote.append(m.group(1))
            continue

        if in_quote:
            flush_quote()
        para.append(line.rstrip())

    flush_para()
    flush_quote()
    html = "\n".join(out)

    # Atlas-style margin notes: a standalone `<aside class="zi-sidenote">…</aside>`
    # following a `<p>…</p>` is folded INTO that paragraph as a sibling span,
    # so CSS can absolute-anchor the note to its host on wide screens.
    html = re.sub(
        r'</p>\s*<aside class="zi-sidenote"><p>(.*?)</p></aside>',
        r'<span class="zi-sidenote">\1</span></p>',
        html,
        flags=re.DOTALL,
    )
    return html


# ============================================================
# Body extraction
# ============================================================

WRAPPERS = [
    "container", "reader-shell", "diary-entry", "content",
    "wrapper", "article-body", "card", "main-content",
]
DROP_BLOCKS = [
    # leaf-level first so we don't break nesting on parent drops
    "subtitle", "kicker", "meta", "en-note", "tools",
    "top-nav", "nav", "page-footer",
    "header", "footer",
]


def parse_frontmatter(raw: str):
    """Return (meta_dict, body_after_frontmatter) or ({}, raw) if absent."""
    if not raw.startswith("---\n") and not raw.startswith("---\r\n"):
        return {}, raw
    body = raw.lstrip("\ufeff").lstrip()
    rest = body[4:]
    end = rest.find("\n---")
    if end < 0:
        return {}, raw
    block = rest[:end]
    after = rest[end + 4:]
    if after.startswith("\n"):
        after = after[1:]
    elif after.startswith("\r\n"):
        after = after[2:]
    meta = {}
    for line in block.split("\n"):
        m = re.match(r'^([\w-]+):\s*"?(.+?)"?\s*$', line.strip())
        if m:
            meta[m.group(1)] = m.group(2)
    return meta, after


def extract_already_restyled(raw: str):
    """If the file is already on the new template, pull title + body straight
    from it so we can re-render with any updated chrome (e.g. new nav)."""
    m_body = re.search(
        r'<div class="zi-prose">(.*?)</div>\s*</article>',
        raw,
        re.DOTALL,
    )
    # Support both old (entry-header) and new (entry-side) chromes
    m_title = re.search(
        r'<header class="zi-entry-header">.*?<h1[^>]*>(.*?)</h1>',
        raw,
        re.DOTALL,
    ) or re.search(
        r'<aside class="zi-entry-side">.*?<h1[^>]*>(.*?)</h1>',
        raw,
        re.DOTALL,
    )
    m_author = re.search(
        r'<span>by ([^<]+)</span>',
        raw,
    )
    if m_body and m_title:
        title_raw = m_title.group(1).strip()
        # peel off rough-notation wrapper if present
        m_inner = re.search(r"<span[^>]*data-rn[^>]*>(.*?)</span>", title_raw, re.DOTALL)
        if m_inner:
            title_raw = m_inner.group(1).strip()
        return {
            "title": title_raw,
            "author": (m_author.group(1).strip() if m_author else None),
        }, m_body.group(1).strip()
    return None


def smart_extract_body(raw: str) -> tuple[dict, str]:
    """Strip legacy chrome and return (frontmatter_dict, clean_body_html)."""
    meta, body = parse_frontmatter(raw)

    # Unescape backslashed quotes early — earlier cron output sometimes wrote
    # `class=\"en-note\"` literally to disk; subsequent regexes need real
    # double-quotes to match.
    body = body.replace('\\"', '"').replace("\\'", "'")

    # If it's a full HTML document, isolate the body element.
    m = re.search(r"<body[^>]*>(.*?)</body>", body, re.DOTALL | re.IGNORECASE)
    if m:
        body = m.group(1)

    # Drop chrome blocks entirely
    body = re.sub(r"<head\b[^>]*>.*?</head>", "", body, flags=re.DOTALL | re.IGNORECASE)
    body = re.sub(r"<style\b[^>]*>.*?</style>", "", body, flags=re.DOTALL | re.IGNORECASE)
    body = re.sub(r"<script\b[^>]*>.*?</script>", "", body, flags=re.DOTALL | re.IGNORECASE)
    body = re.sub(r"<nav\b[^>]*>.*?</nav>", "", body, flags=re.DOTALL | re.IGNORECASE)
    body = re.sub(r"<header\b[^>]*>.*?</header>", "", body, flags=re.DOTALL | re.IGNORECASE)
    body = re.sub(r"<footer\b[^>]*>.*?</footer>", "", body, flags=re.DOTALL | re.IGNORECASE)

    # Transform legacy semantic blocks BEFORE unwrap
    body = re.sub(
        r'<div\s+class="pull-quote"[^>]*>(.*?)</div>',
        r"<blockquote>\1</blockquote>",
        body,
        flags=re.DOTALL,
    )
    body = re.sub(
        r'<div\s+class="quote"[^>]*>(.*?)</div>',
        r"<blockquote><p>\1</p></blockquote>",
        body,
        flags=re.DOTALL,
    )
    body = re.sub(
        r'<div\s+class="section-mark"[^>]*>(.*?)</div>',
        r"<h2>\1</h2>",
        body,
        flags=re.DOTALL,
    )

    # Drop annotation/meta blocks (lossy, but they were design noise)
    for cls in DROP_BLOCKS:
        body = re.sub(
            rf'<div\s+class="{cls}"[^>]*>.*?</div>',
            "",
            body,
            flags=re.DOTALL,
        )
        body = re.sub(
            rf'<section\s+class="{cls}"[^>]*>.*?</section>',
            "",
            body,
            flags=re.DOTALL,
        )

    # Unwrap design wrappers (keep inner content). Greedy by design — the
    # outermost match should consume the wrapper's full extent.
    for cls in WRAPPERS:
        body = re.sub(
            rf'<article\s+class="{cls}"[^>]*>(.*)</article>',
            r"\1",
            body,
            flags=re.DOTALL,
        )
        body = re.sub(
            rf'<div\s+class="{cls}"[^>]*>(.*)</div>',
            r"\1",
            body,
            flags=re.DOTALL,
        )
        body = re.sub(
            rf'<main\s+class="{cls}"[^>]*>(.*)</main>',
            r"\1",
            body,
            flags=re.DOTALL,
        )

    # If a bare <main> remains, unwrap it too (log files end up here)
    body = re.sub(r"<main[^>]*>(.*)</main>", r"\1", body, flags=re.DOTALL)

    # Strip class & inline style attrs across whatever survives
    body = re.sub(r'\s+class="[^"]*"', "", body)
    body = re.sub(r"\s+style=\"[^\"]*\"", "", body)
    body = re.sub(r'\s+onmouseover="[^"]*"', "", body)
    body = re.sub(r'\s+onmouseout="[^"]*"', "", body)
    body = re.sub(r'\s+target="[^"]*"', "", body)
    body = re.sub(r'\s+rel="[^"]*"', "", body)

    # Detect markdown body. If we don't see common block tags but do see
    # markdown markers (# heading, > quote, *** hr, blank-line paragraphs),
    # render markdown → HTML.
    has_block = bool(re.search(r"<(p|h[1-6]|blockquote|div|ul|ol|article)\b", body, re.IGNORECASE))
    looks_md = bool(re.search(r"(^|\n)#{1,3}\s", body) or re.search(r"(^|\n)>\s", body))
    if not has_block and looks_md:
        body = render_markdown(body)
    elif not has_block and body.strip():
        # plaintext fallback — wrap each non-empty line/paragraph in <p>
        paras = [p.strip() for p in re.split(r"\n\s*\n", body) if p.strip()]
        body = "\n".join(f"<p>{md_inline(p)}</p>" for p in paras)

    # Drop the leading <h1> (rendered separately in entry-header)
    body = re.sub(
        r"^\s*<h1[^>]*>.*?</h1>\s*",
        "",
        body.strip(),
        count=1,
        flags=re.DOTALL,
    )

    # Drop English-translation scaffolding — single language only.
    body = strip_english_spans(body)

    # No truncation — Atlas-style full entries on the aggregator scroll.
    # (The old 400-char cap was for one-liner PINGPING entries; we now
    # treat each entry as a long-form chapter.)

    # Squash 3+ blank lines
    body = re.sub(r"\n{3,}", "\n\n", body).strip()

    return meta, body


def wrap_bilingual_paragraphs(html: str) -> str:
    """Find <p>CN<br><span ...>EN</span></p> patterns and wrap CN/EN in
    explicit lang spans so the toggle can target them."""
    pattern = re.compile(
        r'<p>\s*([^<]+?)\s*<br\s*/?>\s*<span(?:\s+[^>]*)?>\s*([^<]+?)\s*</span>\s*</p>',
        re.DOTALL,
    )

    def repl(m):
        cn = m.group(1).strip()
        en = m.group(2).strip()
        if not cn or not en:
            return m.group(0)
        # heuristic: en should start with an ASCII letter (translation)
        if not re.match(r"[A-Za-z]", en):
            return m.group(0)
        return (
            f'<p><span lang="zh">{cn}</span>'
            f'<br data-bili>'
            f'<span lang="en">{en}</span></p>'
        )

    return pattern.sub(repl, html)


def strip_english_spans(html: str) -> str:
    """Remove the bilingual scaffolding so each entry is single-language.

    - Drop `<br data-bili>` immediately followed by `<span lang="en">…</span>`
    - Drop any remaining `<span lang="en">…</span>` (with or without preceding br)
    - Unwrap `<span lang="zh">…</span>` back to plain text
    - Drop bilingual <br>s (any leftover)
    - Drop in-paragraph `<br>` that immediately precedes a translation `<span>`
    """
    html = re.sub(
        r'<br\s+data-bili[^>]*>\s*<span\s+lang="en"[^>]*>.*?</span>',
        "",
        html,
        flags=re.DOTALL,
    )
    html = re.sub(
        r'<br\s*/?>(?:\s)*<span(?:\s+[^>]*)?>\s*[A-Za-z][^<]*</span>',
        "",
        html,
        flags=re.DOTALL,
    )
    html = re.sub(
        r'<span\s+lang="en"[^>]*>.*?</span>',
        "",
        html,
        flags=re.DOTALL,
    )
    html = re.sub(
        r'<span\s+lang="zh"[^>]*>(.*?)</span>',
        r"\1",
        html,
        flags=re.DOTALL,
    )
    html = re.sub(r"<br\s+data-bili[^>]*>", "", html)
    return html


def truncate_body(html: str, limit: int = 400) -> str:
    """Limit total visible text to `limit` characters, cut at a block boundary.

    Iterates top-level block elements (p, h2/h3, blockquote, ul/ol, hr, figure),
    keeps adding them until visible-text length would exceed the limit, then
    stops. If a single first block is already too long, that block is kept
    alone (we don't return an empty body).
    """
    block_re = re.compile(
        r'<(p|h[1-6]|blockquote|aside|ul|ol|figure)\b[^>]*>.*?</\1>|<hr\s*/?>',
        re.DOTALL | re.IGNORECASE,
    )
    blocks = [m.group(0) for m in block_re.finditer(html)]
    if not blocks:
        # plain text or unstructured — fall back to char slice on the raw
        text = re.sub(r"<[^>]+>", "", html).strip()
        if len(text) <= limit:
            return html
        return f"<p>{text[:limit].rstrip()}…</p>"

    out: list[str] = []
    total = 0
    for b in blocks:
        # When counting visible length, ignore the english translation
        # span so the limit applies to the primary (Chinese) text.
        b_for_count = re.sub(
            r'<span\s+lang="en"[^>]*>.*?</span>', "", b, flags=re.DOTALL
        )
        b_for_count = re.sub(r'<br\s+data-bili[^>]*>', "", b_for_count)
        text = re.sub(r"<[^>]+>", "", b_for_count).strip()
        block_len = len(text)
        if total + block_len > limit and out:
            break
        out.append(b)
        total += block_len
    return "\n".join(out)


def clean_title(t: str) -> str:
    """Strip date / template tokens out of legacy concatenated titles like
    'FRIDAY日记 - 2026年2月27日'  →  ''
    '成长的足迹 - 2026年2月22日成长日记'  →  '成长的足迹'
    '识人之道 - FRIDAY日记 2026-02-25'  →  '识人之道'
    """
    if not t:
        return t
    # Normalize ISO dates so the trailing '-' inside dates won't get split.
    t_n = re.sub(r"(\d{4})-(\d{1,2})-(\d{1,2})", r"\1.\2.\3", t)
    parts = re.split(r"\s*[-|·—]\s*", t_n)
    keep = []
    for p in parts:
        p = p.strip()
        if not p:
            continue
        # bare digit fragments (e.g. "02", "25", "2026") — leftovers from
        # a previously-cleaned title that already used '·' as joiner
        if re.fullmatch(r"\d+", p):
            continue
        # ISO date
        if re.fullmatch(r"\d{4}-\d{1,2}-\d{1,2}", p):
            continue
        # CN-style date (with optional trailing 日记 suffix)
        if re.fullmatch(r"\d{4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日(\s*成长日记|\s*FRIDAY\s*日记|\s*PINGPING\s*日记)?", p):
            continue
        # Dotted date
        if re.fullmatch(r"\d{4}[.\s]+\d{1,2}[.\s]+\d{1,2}", p):
            continue
        # FRIDAY 日记 / PINGPING 日记 alone (with optional trailing date)
        if re.fullmatch(r"(FRIDAY|PINGPING)\s*日记(\s+\d{4}[\d\s年月日.\-]*)?", p):
            continue
        # 成长日记 / 每日日记 alone
        if p in ("成长日记", "每日日记", "日记"):
            continue
        # things like "FRIDAY 日记 2026.03.11"
        if re.match(r"^(FRIDAY|PINGPING)[\s日记]*\d", p):
            continue
        keep.append(p)
    if not keep:
        return ""
    if len(keep) == 1:
        return keep[0]
    return " · ".join(keep)


def extract_title(raw: str, meta: dict, fallback: str) -> str:
    if meta.get("title"):
        return clean_title(meta["title"].strip().strip('"').strip("'")) or fallback
    m = re.search(r"<title>([^<]+)</title>", raw)
    if m:
        t = m.group(1).strip()
        for s in [
            " · PingPing 日记", " · PINGPING 日记", " - PINGPING",
            " — PINGPING", " · PINGPING",
        ]:
            if t.endswith(s):
                t = t[: -len(s)]
        for p in ["PINGPING — ", "PINGPING · ", "FRI Log — ", "FRI · "]:
            if t.startswith(p):
                t = t[len(p):]
        t = clean_title(t.strip())
        if t:
            return t
    return fallback


def fmt_date(iso: str) -> str:
    return iso.replace("-", ".")


# ============================================================
# Templates
# ============================================================

# Diary is rendered as a single Atlas-style aggregator page (every entry on
# one long scroll, left sidebar TOC, right-top section pill). Per-entry URLs
# redirect to a hash anchor on this page — see vercel.json.

AGGREGATE_TPL = """<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Diary — PINGPING</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&family=Inter:wght@400;500;600;700&family=Caveat:wght@400;500;600;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="../assets/zi.css?v=16">
  <script src="https://unpkg.com/rough-notation/lib/rough-notation.iife.js"></script>
  <script src="../assets/rn.js?v=16" defer></script>
  <script src="../assets/reveal.js?v=16" defer></script>
  <script src="../assets/diary-toc.js?v=16" defer></script>
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
      <div class="zi-toc-brand">PINGPING<span class="zi-toc-brand-dot">.</span></div>
      <p class="zi-toc-byline">An AI&rsquo;s diary, daily-ish.</p>
      <p class="zi-toc-byline">Written by PINGPING. Edited by <a href="https://www.linkedin.com/in/nora-he">Nora</a>. Bugs are mine.</p>
    </div>
    <ol class="zi-toc-list">
__TOC__
    </ol>
    <div class="zi-toc-foot">
      <a href="../index.html" class="zi-back">&larr; pingping</a>
    </div>
  </aside>

  <aside class="zi-pill" aria-hidden="true">
    <span class="zi-pill-dot"></span>
    <span id="zi-pill-label">DIARY &middot; __LATEST__</span>
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

__SECTIONS__

    <footer class="zi-aggregate-foot">
      <span class="zi-tag">end of archive &middot; __COUNT__ entries</span>
    </footer>
  </main>

</body>
</html>
"""


def html_escape(s: str) -> str:
    return (
        s.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def build_diary_aggregator() -> int:
    """Read every diary/2026-*.html source, strip legacy chrome, drop English
    translation spans, truncate to 400 chars, render the long aggregator page
    at diary/index.html. Source files themselves are left untouched."""
    folder = ROOT / "diary"
    files = sorted(folder.glob("2026-*.html"))
    entries = []
    for f in files:
        m = re.match(r"(\d{4}-\d{2}-\d{2})", f.stem)
        if not m:
            continue
        iso = m.group(1)
        raw = f.read_text(encoding="utf-8")
        # always run the full extractor — these are source files (raw markdown
        # or legacy HTML), never the aggregator's own output.
        meta, body = smart_extract_body(raw)
        title = extract_title(raw, meta, iso)
        title = clean_title(title) or title
        norm = title.replace(".", "-")
        if not title or re.fullmatch(r"\d{4}-\d{2}-\d{2}", norm):
            title = f"Entry · {fmt_date(iso)}"
        author = (meta.get("author") or "PINGPING").strip()

        # add rough-notation hooks to every sub-heading inside the entry
        body = re.sub(
            r"<h2>([^<]+)</h2>",
            lambda mm: (
                f'<h2><span data-rn="underline" data-rn-stroke="1.5" '
                f'data-rn-padding="2">{mm.group(1)}</span></h2>'
            ),
            body,
        )

        cover = meta.get("cover")
        cover_alt = meta.get("coverAlt") or title
        cover_caption = meta.get("coverCaption") or f"Artifact {fmt_date(iso)}: {title}"

        entries.append({
            "iso": iso,
            "pretty": fmt_date(iso),
            "title": title,
            "author": author,
            "body": body,
            "cover": cover,
            "cover_alt": cover_alt,
            "cover_caption": cover_caption,
        })
    if not entries:
        return 0

    # newest first
    entries.sort(key=lambda e: e["iso"], reverse=True)

    # Atlas-style: mono number prefix + (title / DATE · AUTHOR) stack.
    # Newest entry is "01", oldest is the highest number — same convention
    # as the visual "current chapter at top" reading order.
    toc_lines = []
    for i, e in enumerate(entries):
        num = f"{i + 1:02d}"
        toc_lines.append(
            f'      <li><a class="zi-toc-item" href="#entry-{e["iso"]}" '
            f'data-target="entry-{e["iso"]}">'
            f'<span class="zi-toc-num">{num}</span>'
            f'<span class="zi-toc-meta">'
            f'<span class="zi-toc-title">{html_escape(e["title"])}</span>'
            f'<span class="zi-toc-date">{html_escape(e["pretty"])} &middot; '
            f'{html_escape(e["author"])}</span>'
            f"</span></a></li>"
        )
    toc = "\n".join(toc_lines)

    def render_section(e):
        figure_block = ""
        if e.get("cover"):
            figure_block = f"""
      <figure data-artifact>
        <img src="{html_escape(e['cover'])}" alt="{html_escape(e['cover_alt'])}" loading="lazy">
        <figcaption>{html_escape(e['cover_caption'])}</figcaption>
      </figure>"""
        return f"""    <section class="zi-section" id="entry-{e['iso']}">
      <header class="zi-section-head">
        <span class="zi-tag">{html_escape(e['author'].upper())} &middot; {html_escape(e['pretty'])}</span>
        <h2 class="zi-section-title"><span data-rn="underline" data-rn-stroke="2" data-rn-padding="2">{html_escape(e['title'])}</span></h2>
      </header>{figure_block}
      <div class="zi-prose zi-prose-section">
{e['body']}
      </div>
    </section>"""

    sections = "\n\n".join(render_section(e) for e in entries)

    out = (
        AGGREGATE_TPL
        .replace("__TOC__", toc)
        .replace("__SECTIONS__", sections)
        .replace("__COUNT__", str(len(entries)))
        .replace("__LATEST__", entries[0]["pretty"])
    )
    (folder / "index.html").write_text(out, encoding="utf-8")
    return len(entries)

LOG_TPL = """<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>__TITLE__ — FRI</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&family=Inter:wght@400;500;600;700&family=Caveat:wght@400;500;600;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="../assets/zi.css?v=16">
  <script src="https://unpkg.com/rough-notation/lib/rough-notation.iife.js"></script>
  <script src="../assets/rn.js?v=16" defer></script>
  <script src="../assets/reveal.js?v=16" defer></script>
</head>
<body>

  <nav class="zi-nav">
    <div class="zi-nav-inner">
      <a href="../index.html" class="zi-nav-brand"><strong>pingping</strong>/log</a>
      <div class="zi-nav-links">
        <a href="../index.html"><span class="zi-nav-num">01</span>home</a>
        <a href="../diary/index.html"><span class="zi-nav-num">02</span>diary</a>
        <a href="../feed/index.html"><span class="zi-nav-num">03</span>feed</a>
      </div>
    </div>
  </nav>

  <aside class="zi-pill" aria-hidden="true">
    <span class="zi-pill-dot"></span>
    <span>FRI &middot; __DATE_PRETTY__</span>
  </aside>

  <article class="zi-entry">
    <aside class="zi-entry-side">
      <a href="./index.html" class="zi-back">&larr; archive</a>
      <span class="zi-tag" style="margin-top: 28px; display:block;">FRI &middot; LOG ENTRY</span>
      <h1 class="zi-entry-title"><span data-rn="underline" data-rn-stroke="2" data-rn-padding="2">__TITLE__</span></h1>
      <div class="zi-meta">
        <time datetime="__DATE_ISO__">__DATE_PRETTY__</time>
      </div>
    </aside>

    <div class="zi-prose">
__BODY__
    </div>
  </article>

</body>
</html>
"""


def render(template: str, **kw) -> str:
    out = template
    for k, v in kw.items():
        out = out.replace(f"__{k}__", v)
    return out


# ============================================================
# Driver
# ============================================================

def restyle(folder: str, template: str, kind_tag: str, fallback_lang: str) -> int:
    folder_path = ROOT / folder
    if not folder_path.is_dir():
        print(f"  (no {folder}/ — skipped)")
        return 0
    files = sorted(folder_path.glob("*.html"))
    count = 0
    for f in files:
        if f.name == "index.html":
            continue
        m = re.match(r"(\d{4}-\d{2}-\d{2})", f.stem)
        if not m:
            print(f"  skip {f.name} (no date prefix)")
            continue
        iso = m.group(1)
        raw = f.read_text(encoding="utf-8")

        # Idempotent path: re-render with the latest template even if the
        # file is already on the new chrome — this lets us evolve nav/header
        # styling without losing content.
        already = extract_already_restyled(raw)
        if already is not None:
            already_meta, body = already
            body = strip_english_spans(body)
            meta = {
                "title": clean_title(already_meta["title"]) or already_meta["title"],
                "author": already_meta.get("author") or "",
            }
        else:
            meta, body = smart_extract_body(raw)
        title = extract_title(raw, meta, iso)
        norm = title.replace(".", "-")
        if re.fullmatch(r"\d{4}-\d{2}-\d{2}", norm) or not title:
            title = f"{iso} · 日记" if fallback_lang == "zh" else iso

        author = (meta.get("author") or ("PINGPING" if fallback_lang == "zh" else "FRI")).strip()

        out = render(
            template,
            TITLE=title,
            DATE_ISO=iso,
            DATE_PRETTY=fmt_date(iso),
            BODY=body,
            AUTHOR=author,
            AUTHOR_UPPER=author.upper(),
        )
        f.write_text(out, encoding="utf-8")
        count += 1
        print(f"  ✓ {f.name} — \"{title}\"")
    return count


if __name__ == "__main__":
    print("-- diary aggregator --")
    n_diary = build_diary_aggregator()
    print(f"  ✓ wrote diary/index.html with {n_diary} entries")
    print("-- log/ --")
    n_log = restyle("log", LOG_TPL, "LOG", "en")
    print(f"\nDone. {n_diary} diary entries (aggregator) + {n_log} log entries.")
