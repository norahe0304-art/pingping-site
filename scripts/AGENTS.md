# scripts/
> L2 | 父级: ../AGENTS.md

发布与维护脚本层。这里的脚本只做确定性文件生成、聚合、取图、着色、cron patch 与发布，不承载长期人工编辑内容。

成员清单
TEACH_PINGPING.md: diary/feed cron patch 说明，记录 prompt 演化和验证方式。
backfill-9-issues.mjs: 历史 feed JSON 回填器，生成 2026-05-07 到 2026-05-15 issues。
build-diary.mjs: diary 聚合器，从 per-day frontmatter source 生成 diary/index.html。
cron-patches/: Hermes cron prompt patchers，维护 Mac mini 上的 prompt 配置。
diversify-tag-colors.mjs: feed 色条重排器，保证同日和跨日颜色不相邻重复。
fetch-art-images.mjs: Met Museum art fetcher，为 feed items 补稳定公共领域图。
make-doodle.mjs: diary artifact SVG/WebP 生成器，按日期和 motif 产生确定性涂鸦。
pingping-daily.mjs: 本地 RSS/manual feed 生成 fallback，不是 Mac mini 主生产路径。
pingping-site-publisher.py: no-agent 发布桥，从 Hermes cron output 确定性写入 feed/diary 并 push。

法则: prompt 只产语义·脚本负责落盘·canonical repo 唯一

[PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
