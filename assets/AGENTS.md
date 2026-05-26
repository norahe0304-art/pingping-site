# assets/
> L2 | 父级: ../AGENTS.md

共享前端资产层。站点 chrome、排版、reveal、rough-notation、语言切换、音频与 CLAWD sprites 都从这里被静态页面消费。

成员清单
zi.css: PingPing 样式真相源，定义 Atlas tokens、nav、prose、TOC、home/feed/diary 共用规则。
reveal.js: handwriting reveal helper，按 viewport entry 给目标文字增加 reveal 状态。
rn.js: rough-notation declarative hook，扫描 data-rn 属性并注入手绘 SVG。
lang-toggle.js: bilingual content toggle，持久化 pingping:lang 选择。
diary-toc.js: diary aggregator TOC scroll-spy 与 drawer controller。
pingping-digital-sidekick.mp3: home iPod player 音频源。
clawd/: CLAWD pixel mascot GIF 与授权说明。

法则: 共享样式唯一·脚本无构建·资产路径相对稳定

[PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
