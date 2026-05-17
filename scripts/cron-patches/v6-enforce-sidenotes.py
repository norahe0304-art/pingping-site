#!/usr/bin/env python3
"""v6 patch for diary cron (a130f54960a2):

Make `> [side]` margin notes MANDATORY (not optional). The original
prompt listed five custom markdown affordances and said "use 2-4 of
them" — MiniMax-M2.7 consistently picks `==phrase==` and `((phrase))`
but skips sidenotes entirely. Result: 9 consecutive days (2026-05-09
through 2026-05-17) shipped without a single right-margin annotation.

This patch replaces the optional "use 2-4" instruction with an
explicit per-section count, so pingping must produce at least one
sidenote per `## NN` section (3 minimum per entry).

Idempotent. Re-runs no-op via SENTINEL.
"""
import json, shutil, sys
from pathlib import Path

JOBS = Path("/Users/macxiaoxiao/.hermes/profiles/personal/cron/jobs.json")
JOB_ID = "a130f54960a2"
SENTINEL = "v6-enforce-sidenotes"

OLD_BLOCK = """### 英文正文里用 2-4 处自定义 markdown
- `==phrase==`  → 下划线 (一句你想强调的)
- `((phrase))`  → 圆圈 (页面里安静但重要的一句)
- `> [side] short margin note` → Atlas 风格旁注 (max 14 words)
- `> regular blockquote` → 引文
- `## 01` / `## 02` / `## 03` → 三个小节, 跟中文版一一对应"""

NEW_BLOCK = f"""### 英文正文里用 4 类自定义 markdown (v6 — {SENTINEL})

每个 `## NN` 小节**必须**至少有 1 处 `> [side] margin note` (Atlas 风格旁注). 三个小节 = 至少 3 处 sidenote, 这是硬性要求, 不是建议. Sidenote 漏掉 = 这天别 push.

- `==phrase==`            → 下划线 (一句你想强调的; 每篇 1-2 处)
- `((phrase))`            → 圆圈 (页面里安静但重要的一句; 每篇 1-2 处)
- `> [side] note text`    → Atlas 旁注, 出现在段落右侧空白 (**每个 ## 小节至少 1 处, max 14 words, 衔接段落语义但不重复段落里的话**)
- `> regular blockquote`  → 引文 (按需, 0-2 处)
- `## 01` / `## 02` / `## 03` → 三个小节, 跟中文版一一对应

**Sidenote 写法的关键**: 不是把段落里的句子复读一遍, 而是给段落加一个**旁观者视角**的注脚 — 把段落想说的事情, 用半句话从侧面戳一下. 例如:
- 段落: "I sat with the cursor blinking. Not writer's block — something quieter."
- ✓ 好 sidenote: `> [side] The blank page is patient because it has nothing to lose.`
- ✗ 坏 sidenote (复读): `> [side] Cursor was blinking and I was sitting.`

写完 push 前自检: grep `^> \\[side\\]` 在 diary/YYYY-MM-DD.html 对应的 markdown 阶段, 必须 >= 3. <3 就别 push, 重写."""

def main():
    raw = JOBS.read_text()
    data = json.loads(raw)
    target = next((j for j in data["jobs"] if j["id"] == JOB_ID), None)
    if not target:
        sys.exit(f"job {JOB_ID} not found")

    p = target["prompt"]
    if SENTINEL in p:
        print("✓ already on v6, no-op")
        return

    if OLD_BLOCK not in p:
        # try to be defensive — find the partial header
        anchor = "### 英文正文里用 2-4 处自定义 markdown"
        if anchor in p:
            # remove old block by finding it more loosely
            start = p.find(anchor)
            # OLD_BLOCK extends until the section after (## 当日 artifact doodle)
            end_marker = "## 当日 artifact doodle"
            end = p.find(end_marker, start)
            if end < 0:
                sys.exit("cannot find OLD_BLOCK end marker")
            old_actual = p[start:end].rstrip()
            print(f"  using loose OLD_BLOCK ({len(old_actual)} chars)")
            new_p = p.replace(old_actual, NEW_BLOCK)
        else:
            sys.exit(f"could not find old markdown-affordances block")
    else:
        new_p = p.replace(OLD_BLOCK, NEW_BLOCK)

    if new_p == p:
        sys.exit("replace produced no change — already current?")

    shutil.copy(JOBS, JOBS.with_suffix(".json.bak-diary-v6"))
    target["prompt"] = new_p
    JOBS.write_text(json.dumps(data, indent=2, ensure_ascii=False))
    print(f"✓ v6 applied to diary cron")
    print(f"  prompt: {len(p)} → {len(new_p)} chars ({len(new_p)-len(p):+d})")
    print(f"  backup: jobs.json.bak-diary-v6")

if __name__ == "__main__":
    main()
