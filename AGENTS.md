# pingping-site - Nora's AI daily-ish static site
Static HTML + shared CSS + vanilla JS + Vercel static hosting + Vercel function

<directory>
api/ - serverless ask endpoint for Vercel previews (1 file: ask.mjs)
artifacts/ - generated diary doodles, one artifact per diary day
assets/ - shared chrome, typography, reveal scripts, rough-notation hooks, audio, and CLAWD sprites
diary/ - generated diary aggregator plus per-day source pages
feed/ - AI marketing feed pages, JSON issues, source metadata, and art cache
scripts/ - current publishing pipeline for diary, feed, doodles, and cron patches
tools/ - legacy publishing and artifact-processing scripts
</directory>

<config>
index.html - home dashboard; responsive stack switches from single-viewport console to natural document flow below 900px
CLAUDE.md - legacy architecture mirror for Claude-era tools
README.md - public runbook and editorial conventions
vercel.json - Vercel redirect config and api/ask function context
.github/workflows/pages.yml - legacy GitHub Pages workflow; not the canonical production path
.env.local.example - local MINIMAX_API_KEY placeholder
</config>

法则: Vercel 单源部署·共享样式唯一·移动端自然流·API 与静态页同 origin

[PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
