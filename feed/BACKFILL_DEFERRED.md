# Feed backfill — not viable from cron archive

## What we tried

Mirrored the 47 `.md` files from
`~/.hermes/profiles/personal/cron/output/a536f6d6ea3a/` on the Mac
mini to `pingping-site/.cron-archive/` and classified each one:

- **30 legacy-screenshots** (2026-04-30 → 2026-05-06):
  the cron used to run `x-feed-push.py`, which scraped X via
  OpenCLI browser and pushed screenshots. The .md output is the
  job report — no JSON content to lift.
- **2 unknown** (2026-04-30 early): pre-screenshot format, also
  unusable.
- **11 brief-text** (2026-05-07 → 2026-05-16 morning):
  the cron schedule transitioned. The output for these days is
  just the **delivery receipt** ("早报已发送至 Home channel.").
  The actual brief content was delivered to Telegram and never
  written to .md.
- **1 v2-json** (2026-05-16 11:12): the post-patch cron run that
  produced the structured 11+2+1 JSON. **This is the only file in
  the archive that contains the brief content**, and it's already
  live on the site as `feed/days/2026-05-16.json`.

## Conclusion

There is no usable backfill source on the Mac mini. The pre-v2 cron
delivered briefs straight to Telegram and only logged delivery
confirmations, not content.

## Real paths forward (none done)

1. **Telegram export** — Nora's Telegram chat with the bot has the
   actual brief text for each day. Export the chat (Telegram Desktop
   → Export Chat History → JSON), then parse + translate + write
   `feed/days/YYYY-MM-DD.json`. This is the only way to recover
   content for 2026-05-07 → 2026-05-15.
2. **Synthesize** — manually write 10 plausible brief issues from
   memory or other sources. Loses authenticity; skip.
3. **Accept the gap** — feed/days starts at 2026-05-16 and grows
   forward as the cron runs daily. The patched cron from this
   session produces v2-shaped JSON; tomorrow there should be a
   2026-05-17.json.

The .cron-archive/ folder is gitignored — kept locally for reference
but not committed.
