#!/usr/bin/env python3
"""v3 patch: kill the motif menu entirely. pingping writes the SVG
herself, drawing the actual thing in today's diary. Two style anchors
inline so she has tactile reference, not a dropdown."""
import json, re, shutil, sys
from pathlib import Path

JOBS = Path("/Users/macxiaoxiao/.hermes/profiles/personal/cron/jobs.json")
JOB_ID = "a130f54960a2"

# match everything from the artifact section header to the end of the
# first ```bash block that runs make-doodle.mjs (or now: anything).
SECTION_HEADER = "## 当日 artifact doodle"

NEW_SECTION = """## 当日 artifact doodle (你自己画, 不要 motif 菜单, 不要文生图)

**铁律**: 永远不调 Pollinations / Flux / DALL-E / 任何文生图模型. 永远不挑预制 motif. **你今天日记里写到的具体东西是什么, 你就画什么.** 一颗按钉, 一扇门, 一片叶子, 一台终端, 一只猫, 一个邮戳, 一条电线 — 是什么画什么, 不要凑.

### 输出格式
直接写 SVG, 用 shell heredoc 落到 `/tmp/pingping-site/artifacts/$(date -u +%Y-%m-%d).svg`.

### 硬约束 (违一条这天就别 push 了)
- `width="600" height="420" viewBox="0 0 600 420"`
- 只用 `<path>` 和 `<circle>`. 不要 `<rect>`, 不要 `<text>`, 不要 `<image>`, 不要 `<filter>`, 不要 `<g>` 嵌套.
- **绝对不要背景 rect**. 透明底, 让纸色 `#F6F4EE` 透上来.
- 描边只用 `#1a1a1a`. 不要其他颜色. 不要灰阶.
- `stroke-width` 2-5. `stroke-linecap="round"`. `fill="none"` (除了一个小焦点圆点可以 `fill="#1a1a1a"`).
- 主体居中偏一点, 周围**留 60% 以上白**. 不要把画面塞满.
- **手抖 (wobble)**: 每条 path 的坐标必须有 ±3-6 px 的随机偏移, 不能像 CAD 那么直. 写 `L` 命令时数字带 `.1` 小数, 像 `L 213.7 196.4` 而不是 `L 215 195`.
- 总字节数 < 3000. 一个 SVG 文件 5-15 条 path 足够.
- 不要文字, 不要标注, 不要箭头, 不要数字.

### 两个风格锚 (照这个质地写, 不要照搬主体)

**门 (一笔一笔抖着画的方框 + 门把):**
```svg
<svg xmlns="http://www.w3.org/2000/svg" width="600" height="420" viewBox="0 0 600 420">
  <path d="M 240.0 110.0 L 268.9 111.9 L 300.3 110.1 L 328.4 110.5 L 360.0 110.0" stroke="#1a1a1a" stroke-width="5" stroke-linecap="round" fill="none"/>
  <path d="M 360.0 110.0 L 360.3 156.2 L 358.6 200.9 L 359.7 243.2 L 357.1 284.4 L 360.0 330.0" stroke="#1a1a1a" stroke-width="5" stroke-linecap="round" fill="none"/>
  <path d="M 360.0 330.0 L 330.8 329.6 L 298.8 330.7 L 270.8 330.6 L 240.0 330.0" stroke="#1a1a1a" stroke-width="5" stroke-linecap="round" fill="none"/>
  <path d="M 240.0 330.0 L 237.7 288.3 L 240.0 243.6 L 242.6 196.5 L 240.9 152.8 L 240.0 110.0" stroke="#1a1a1a" stroke-width="5" stroke-linecap="round" fill="none"/>
  <circle cx="340" cy="240" r="5" stroke="#1a1a1a" stroke-width="2" fill="#1a1a1a"/>
</svg>
```

**叶子 (两瓣弧 + 中脉 + 短叶柄):**
```svg
<svg xmlns="http://www.w3.org/2000/svg" width="600" height="420" viewBox="0 0 600 420">
  <path d="M 200.0 210.0 L 213.3 196.1 L 223.0 190.3 L 228.9 177.5 L 239.8 159.8 L 249.2 154.9 L 260.0 140.0" stroke="#1a1a1a" stroke-width="3" stroke-linecap="round" fill="none"/>
  <path d="M 260.0 140.0 L 266.1 153.2 L 282.3 160.6 L 289.9 175.4 L 296.0 186.0 L 307.3 195.7 L 320.0 210.0" stroke="#1a1a1a" stroke-width="3" stroke-linecap="round" fill="none"/>
  <path d="M 200.0 210.0 L 210.9 217.9 L 223.8 235.4 L 232.7 243.5 L 238.6 255.8 L 249.0 267.3 L 260.0 280.0" stroke="#1a1a1a" stroke-width="3" stroke-linecap="round" fill="none"/>
  <path d="M 260.0 280.0 L 273.4 267.2 L 280.0 253.1 L 286.8 247.7 L 298.8 231.5 L 307.3 224.0 L 320.0 210.0" stroke="#1a1a1a" stroke-width="3" stroke-linecap="round" fill="none"/>
  <path d="M 210.0 210.0 L 226.9 209.8 L 241.3 207.3 L 262.9 209.7 L 278.7 211.6 L 296.0 208.8 L 310.0 210.0" stroke="#1a1a1a" stroke-width="2.5" stroke-linecap="round" fill="none"/>
  <path d="M 320.0 210.0 L 330.4 213.4 L 337.1 224.1 L 348.8 230.3 L 355.0 235.0" stroke="#1a1a1a" stroke-width="3" stroke-linecap="round" fill="none"/>
</svg>
```

### 落盘
```bash
mkdir -p /tmp/pingping-site/artifacts
cat > "/tmp/pingping-site/artifacts/$(date -u +%Y-%m-%d).svg" <<'SVG_EOF'
<svg xmlns="http://www.w3.org/2000/svg" width="600" height="420" viewBox="0 0 600 420">
  <!-- 你的 path 们 -->
</svg>
SVG_EOF

# self-check: 反悔机制
SZ=$(wc -c < "/tmp/pingping-site/artifacts/$(date -u +%Y-%m-%d).svg")
if [ "$SZ" -gt 3000 ]; then echo "TOO BIG ($SZ bytes), 简化"; exit 1; fi
if grep -q '<rect\|<text\|<image\|<filter' "/tmp/pingping-site/artifacts/$(date -u +%Y-%m-%d).svg"; then
  echo "FORBIDDEN ELEMENT, 改"; exit 1
fi
if ! grep -q '#1a1a1a' "/tmp/pingping-site/artifacts/$(date -u +%Y-%m-%d).svg"; then
  echo "MISSING INK COLOR"; exit 1
fi
```

frontmatter 用 `cover: ../artifacts/YYYY-MM-DD.svg`."""

def main():
    raw = JOBS.read_text()
    data = json.loads(raw)
    target = next((j for j in data["jobs"] if j["id"] == JOB_ID), None)
    if not target:
        sys.exit(f"job {JOB_ID} not found")

    p = target["prompt"]

    # idempotency: v3 has the unique "你自己画, 不要 motif 菜单" string
    if "你自己画, 不要 motif 菜单" in p:
        print("✓ already on v3 (free-form SVG), no-op")
        return

    # find the artifact section. It starts with SECTION_HEADER and runs
    # until the next "## " header at the same level.
    start = p.find(SECTION_HEADER)
    if start < 0:
        sys.exit("artifact section header not found")
    # find the next ## that's NOT a sub-section we wrote inside our new content
    nxt = p.find("\n## ", start + len(SECTION_HEADER))
    if nxt < 0:
        sys.exit("no next ## header found — prompt malformed")

    shutil.copy(JOBS, JOBS.with_suffix(".json.bak-doodle-v3"))
    new_p = p[:start] + NEW_SECTION + "\n\n" + p[nxt+1:]
    target["prompt"] = new_p
    JOBS.write_text(json.dumps(data, indent=2, ensure_ascii=False))
    print(f"✓ v3 applied")
    print(f"  removed: {nxt+1 - start} chars (old motif-menu section)")
    print(f"  added:   {len(NEW_SECTION)} chars (free-form SVG section)")

if __name__ == "__main__":
    main()
