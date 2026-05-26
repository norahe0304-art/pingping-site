# feed/
> L2 | 父级: ../AGENTS.md

AI marketing feed 层。静态 reader、daily JSON issues、manifest、art cache 与发布流水线文档都在这里；推送 main 后由 Vercel 发布。

成员清单
index.html: feed 首页 reader，读取 posts/json 数据并展示 issues。
posts.json: feed 聚合数据源。
sources.json: feed source registry。
PIPELINE.md: feed 生成、取图、着色、提交与 Vercel deploy 流程。
BACKFILL_DEFERRED.md: 延后 backfill 记录。
days/: per-day JSON issues 与 manifest。
art/: Met Museum artwork cache。
hot_*.png: 首页/issue 热点缩略图。

法则: JSON 即内容·art cache 可再生·deploy 语义写清楚

[PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
