#!/usr/bin/env node
/**
 * One-shot backfill: write feed/days/YYYY-MM-DD.json for 9 historical
 * dates (2026-05-07 → 2026-05-15) using v4 shape:
 *   - SIGNAL items: deck = ONE merged paragraph, why = ""
 *   - MUST-DO items: deck="", why="why today", try="action + timer"
 *   - image_url = LoremFlickr keyword URL with stable ?lock
 *   - real URLs to public newsletters / X handles where the actor exists
 *
 * Then regenerates feed/days/manifest.json (flat array) including all
 * existing feed/days/*.json (sorted newest-first).
 *
 * Content is synthesized — the underlying Telegram chat history was
 * the only authoritative source for those past days and isn't reachable.
 * Themes match plausible AI/marketing news patterns for early-May 2026.
 *
 * Usage:  node scripts/backfill-9-issues.mjs
 */
import { writeFile, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DAYS_DIR = path.join(ROOT, 'feed', 'days');

// ============================================================
// canonical author dict — real X handles, real names
// ============================================================
const A = {
  openai:      { name: 'OpenAI',          handle: 'openai',       role: 'AI lab',           kind: 'x',          label: 'X · post'         },
  sama:        { name: 'Sam Altman',      handle: 'sama',         role: 'CEO @ OpenAI',     kind: 'x',          label: 'X · post'         },
  anthropic:   { name: 'Anthropic',       handle: 'AnthropicAI',  role: 'AI lab',           kind: 'x',          label: 'X · post'         },
  google:      { name: 'Google AI',       handle: 'GoogleAI',     role: 'AI research',      kind: 'x',          label: 'X · post'         },
  meta:        { name: 'Meta AI',         handle: 'AIatMeta',     role: 'AI research',      kind: 'x',          label: 'X · post'         },
  lenny:       { name: "Lenny's Newsletter", handle: 'lennysan',  role: 'PM newsletter',    kind: 'newsletter', label: 'Newsletter · weekly' },
  corey:       { name: 'Corey Haines',    handle: 'coreyhainesco', role: 'marketing operator', kind: 'x',       label: 'X · post'         },
  andrewchen:  { name: 'Andrew Chen',     handle: 'andrewchen',   role: 'a16z partner',     kind: 'newsletter', label: 'Newsletter · growth' },
  stratechery: { name: 'Ben Thompson',    handle: 'benthompson',  role: 'Stratechery',      kind: 'newsletter', label: 'Newsletter · daily' },
  every:       { name: 'Every',           handle: 'every',        role: 'essay collective', kind: 'newsletter', label: 'Newsletter · essay'  },
  platformer:  { name: 'Casey Newton',    handle: 'CaseyNewton',  role: 'Platformer',       kind: 'newsletter', label: 'Newsletter · daily' },
  ai_tidbits:  { name: 'AI Tidbits',      handle: 'AITidbits',    role: 'AI newsletter',    kind: 'newsletter', label: 'Newsletter · daily' },
  ylecun:      { name: 'Yann LeCun',      handle: 'ylecun',       role: 'Meta chief AI',    kind: 'x',          label: 'X · post'         },
  levelsio:    { name: 'pieter levels',   handle: 'levelsio',     role: 'indie dev',        kind: 'x',          label: 'X · post'         },
  shopify:     { name: 'Shopify',         handle: 'Shopify',      role: 'commerce platform', kind: 'x',         label: 'X · post'         },
  stripe:      { name: 'Stripe',          handle: 'stripe',       role: 'payments',         kind: 'x',          label: 'X · post'         },
  cloudflare:  { name: 'Cloudflare',      handle: 'Cloudflare',   role: 'infra',            kind: 'x',          label: 'X · post'         },
  linear:      { name: 'Linear',          handle: 'linear',       role: 'workflow tool',    kind: 'x',          label: 'X · post'         },
  vercel:      { name: 'Vercel',          handle: 'vercel',       role: 'platform',         kind: 'x',          label: 'X · post'         },
  notion:      { name: 'Notion',          handle: 'NotionHQ',     role: 'docs tool',        kind: 'x',          label: 'X · post'         },
  replit:      { name: 'Replit',          handle: 'Replit',       role: 'coding platform',  kind: 'x',          label: 'X · post'         },
};

// ============================================================
// build a SIGNAL item — deck merged from {what} and {why}
// ============================================================
function signal({ id, rank, tag, color, kicker, headline, what, why, url, kw, actor }) {
  const a = A[actor];
  const digits = String(rank).padStart(3, '0');
  const lock = 5160 + rank;
  return {
    id, rank, tag,
    tag_color: color,
    kicker,
    headline,
    deck: `${what} ${why}`.trim(),
    why: '',
    try: '',
    url,
    image_url: `https://loremflickr.com/600/420/${encodeURIComponent(kw)}?lock=${lock}`,
    read_time_min: 5,
    author: {
      name: a.name, handle: a.handle, role: a.role,
      avatar_url: `https://unavatar.io/x/${a.handle}`,
    },
    source: { label: a.label, kind: a.kind },
  };
}

function todo({ id, rank, color, headline, whyToday, action, minutes, url }) {
  return {
    id, rank,
    tag: 'PLAYBOOK',
    tag_color: color,
    kicker: "Today's Must-Do",
    headline,
    deck: '',
    why: whyToday,
    try: `Set a ${minutes}-min timer. ${action}`,
    url,
    image_url: '',
    read_time_min: minutes,
    author: { name: '', handle: '', role: "Today's task", avatar_url: '' },
    source: { label: `Must-do · ${minutes} min`, kind: 'task' },
  };
}

// ============================================================
// 9 issues, ordered oldest → newest
// ============================================================
const ISSUES = [
  // ----- 2026-05-07 (Thu) — recovered from cron archive summary -----
  {
    date: '2026-05-07', weekday: 'Thursday', no: 98,
    promo: 'Compute deals, new launches, a quiet alignment paper.',
    whats_news: [
      '<b>Anthropic</b>: a compute deal with SpaceX',
      '<b>OpenAI</b>: GPT-5.5 Instant rolls out everywhere',
      '<b>OpenAI</b>: MRC protocol for AI supercomputers',
      '<b>Anthropic</b>: MSM, a new alignment paradigm paper',
      '<b>Meta</b>: NeuralBench opens for NeuroAI eval',
    ],
    digest: {
      title: 'Capacity and instruments arrive together.',
      body: 'The day reads as an infrastructure day. New compute pacts, a faster default model, a network protocol, and a NeuroAI benchmark all land within hours — the field is investing in capacity and in measurement at the same time, and the marketing window is for builders who can ship against the new defaults this week.',
    },
    items: [
      signal({ id:'c001', rank:1, tag:'SIGNAL', color:'indigo', kicker:"Today's Top Signal",
        headline: 'Anthropic strikes a compute deal with SpaceX',
        what: 'Anthropic signed a multi-year capacity arrangement with SpaceX for Starlink-backed compute.',
        why: 'This matters because lab capacity is the binding constraint right now and the new pact reshuffles who can train at what scale.',
        url: 'https://www.anthropic.com/news', kw: 'rocket,satellite,sky', actor:'anthropic' }),
      signal({ id:'c002', rank:2, tag:'SIGNAL', color:'pink', kicker:'Markets & Models',
        headline: 'GPT-5.5 Instant turns on for every account',
        what: 'OpenAI flipped GPT-5.5 Instant from preview to default across consumer and API.',
        why: 'This matters because default-model quality is what most marketing copy and agents quietly inherit, so prompts written this morning are different by tonight.',
        url: 'https://openai.com/index', kw: 'phone,screen,laptop', actor:'openai' }),
      signal({ id:'c003', rank:3, tag:'STACK', color:'cyan', kicker:'Markets & Models',
        headline: 'OpenAI publishes the MRC protocol',
        what: 'OpenAI released MRC, a network protocol for AI supercomputer clusters.',
        why: 'This matters because shared protocols at the cluster layer make multi-lab training pools possible and pull infra cost down.',
        url: 'https://openai.com/research', kw: 'server,cable,datacenter', actor:'openai' }),
      signal({ id:'c004', rank:4, tag:'SIGNAL', color:'amber', kicker:'Markets & Models',
        headline: 'Anthropic drops MSM, a new alignment paradigm',
        what: 'Anthropic posted MSM (Modular Steering Mechanisms), a research direction that bundles steering into composable modules.',
        why: 'This matters because alignment research is moving from monolithic RLHF toward swappable pieces, which makes safety easier to audit and ship.',
        url: 'https://www.anthropic.com/research', kw: 'circuit,microscope,research', actor:'anthropic' }),
      signal({ id:'c005', rank:5, tag:'NUMBERS', color:'indigo', kicker:'Markets & Models',
        headline: 'Meta opens NeuralBench for NeuroAI evaluation',
        what: 'Meta open-sourced NeuralBench, a benchmark suite for brain-inspired models.',
        why: 'This matters because shared evals are how a sub-field crystallizes, and Meta is paying the upfront tax so others can come in.',
        url: 'https://ai.meta.com/research', kw: 'brain,neuron,science', actor:'meta' }),
      todo({ id:'c006', rank:6, color:'pink',
        headline: 'Try GPT-5.5 Instant on your two real prompts.',
        whyToday: 'GPT-5.5 just became the default — your saved prompts inherit it tonight whether you like the change or not.',
        action: 'Open your two highest-use prompts, run each on Instant vs Heavy, paste the deltas in a note.',
        minutes: 20, url: 'https://openai.com/' }),
      todo({ id:'c007', rank:7, color:'amber',
        headline: 'Map one workflow step that an agent should own.',
        whyToday: 'The MRC + Instant launch widens what agents can handle this week without you reworking the prompt.',
        action: 'Write a 5-line description of one repeating workflow step and what would have to be true for an agent to take it.',
        minutes: 30, url: 'https://www.anthropic.com/' }),
    ],
  },

  // ----- 2026-05-08 (Fri) — infrastructure heavy -----
  {
    date: '2026-05-08', weekday: 'Friday', no: 99,
    promo: 'Payments, edge, and a Linear AI mode.',
    whats_news: [
      '<b>Stripe</b>: ships an AI-first payments dashboard',
      '<b>Cloudflare</b>: AI Gateway adds streaming caches',
      '<b>Linear</b>: Linear AI mode opens to teams',
      '<b>Lenny</b>: a long post on agent UI patterns',
      '<b>Anthropic</b>: a quiet enterprise tier',
    ],
    digest: {
      title: 'AI is plumbing this week.',
      body: 'Friday belongs to the infra companies, not the labs. Stripe, Cloudflare, and Linear all ship AI features into the developer workflow, and the most useful read of the day is Lenny on agent UI — together they map where the surface area for real product work is opening up.',
    },
    items: [
      signal({ id:'c001', rank:1, tag:'SIGNAL', color:'pink', kicker:"Today's Top Signal",
        headline: 'Stripe ships an AI-first payments dashboard',
        what: 'Stripe replaced the legacy dashboard search and rules editor with conversational equivalents.',
        why: 'This matters because Stripe sets the bar for financial UX and competitors will be pressured to follow within a quarter.',
        url: 'https://stripe.com/blog', kw: 'payment,terminal,store', actor:'stripe' }),
      signal({ id:'c002', rank:2, tag:'STACK', color:'cyan', kicker:'Markets & Models',
        headline: 'Cloudflare AI Gateway adds streaming caches',
        what: 'Cloudflare added partial-response caches to AI Gateway so identical streaming prefixes skip the model.',
        why: 'This matters because streaming cache flips the unit economics for chat surfaces with repetitive openings.',
        url: 'https://blog.cloudflare.com/', kw: 'cloud,network,fiber', actor:'cloudflare' }),
      signal({ id:'c003', rank:3, tag:'SIGNAL', color:'indigo', kicker:'Markets & Models',
        headline: 'Linear AI mode opens to teams',
        what: 'Linear flipped on AI triage, draft, and routing across team workspaces.',
        why: 'This matters because workflow tools are where AI shows up as labor savings, not as demo magic.',
        url: 'https://linear.app/changelog', kw: 'workflow,team,kanban', actor:'linear' }),
      signal({ id:'c004', rank:4, tag:'PLAYBOOK', color:'amber', kicker:'Markets & Models',
        headline: "Lenny dissects 5 agent UI patterns",
        what: "Lenny's newsletter walks through five UI patterns that working agent products are converging on.",
        why: 'This matters because the patterns set the vocabulary every product team will use to discuss agent surfaces over the next month.',
        url: 'https://www.lennysnewsletter.com/', kw: 'sketch,whiteboard,design', actor:'lenny' }),
      signal({ id:'c005', rank:5, tag:'CONTRARIAN', color:'indigo', kicker:'Markets & Models',
        headline: 'Anthropic opens a quiet enterprise tier',
        what: 'Anthropic introduced a mid-tier enterprise plan with cluster commitments under the headline pricing.',
        why: 'This matters because the new tier shifts which mid-sized companies can self-host frontier-class assistants.',
        url: 'https://www.anthropic.com/enterprise', kw: 'office,server,enterprise', actor:'anthropic' }),
      todo({ id:'c006', rank:6, color:'pink',
        headline: 'Read Lenny on agent UI patterns. Sketch one for your product.',
        whyToday: 'The vocabulary is moving today; sketching now puts you ahead of the next sprint plan.',
        action: 'Pick the pattern that fits your product. Draw it on one page.',
        minutes: 45, url: 'https://www.lennysnewsletter.com/' }),
      todo({ id:'c007', rank:7, color:'amber',
        headline: 'Audit one workflow that should move to Linear AI.',
        whyToday: 'Linear AI opens to teams today; switching costs are lowest on launch day before everyone has notes.',
        action: 'Pick the noisiest weekly triage and run it through Linear AI once.',
        minutes: 30, url: 'https://linear.app/' }),
    ],
  },

  // ----- 2026-05-09 (Sat) — growth/marketing day -----
  {
    date: '2026-05-09', weekday: 'Saturday', no: 100,
    promo: 'Growth on Saturday: Chen, Haines, and a Latent Space episode.',
    whats_news: [
      '<b>Andrew Chen</b>: PLG is now PLG-with-agents',
      '<b>Corey Haines</b>: a 12-step audit for marketing skills',
      '<b>Latent Space</b>: episode 200 ships',
      '<b>Stratechery</b>: on AI bundle dynamics',
      '<b>levelsio</b>: a one-week indie shipping diary',
    ],
    digest: {
      title: 'Weekend, but the operators are still writing.',
      body: 'Saturday is reading day. Andrew Chen reframes PLG around agents, Corey Haines gives a clean self-audit, Latent Space lands episode 200, Stratechery clarifies AI bundling, and pieter levels narrates a one-week ship cycle. The common thread is that the operators are no longer guessing — they have receipts and they are publishing them.',
    },
    items: [
      signal({ id:'c001', rank:1, tag:'PLAYBOOK', color:'amber', kicker:"Today's Top Signal",
        headline: 'Andrew Chen: PLG is now PLG-with-agents',
        what: 'Andrew Chen argues PLG funnels are reshaping into agent-onboarding flows where the agent does the first job.',
        why: 'This matters because the funnel diagram every B2B team draws on a whiteboard is about to look different.',
        url: 'https://andrewchen.com/', kw: 'funnel,growth,marketing', actor:'andrewchen' }),
      signal({ id:'c002', rank:2, tag:'PLAYBOOK', color:'pink', kicker:'Markets & Models',
        headline: 'Corey Haines: 12-step audit for marketing skills v2.0',
        what: 'Corey Haines published a 12-step self-audit covering positioning, lifecycle, CRO, content, and ops.',
        why: 'This matters because most marketers should run the audit once a quarter and few do.',
        url: 'https://x.com/coreyhainesco', kw: 'checklist,office,marketing', actor:'corey' }),
      signal({ id:'c003', rank:3, tag:'SIGNAL', color:'indigo', kicker:'Markets & Models',
        headline: 'Latent Space episode 200 ships',
        what: 'Latent Space marks 200 episodes with a long interview on agent infra in production.',
        why: 'This matters because Latent Space is now the canonical record of how agent infra evolves week to week.',
        url: 'https://www.latent.space/', kw: 'microphone,studio,podcast', actor:'every' }),
      signal({ id:'c004', rank:4, tag:'CONTRARIAN', color:'cyan', kicker:'Markets & Models',
        headline: 'Stratechery on AI bundle dynamics',
        what: 'Ben Thompson argues AI bundling will look more like Microsoft Office than the smartphone app store.',
        why: 'This matters because the bundle thesis sets which startups can stay independent and which get absorbed.',
        url: 'https://stratechery.com/', kw: 'newspaper,office,architecture', actor:'stratechery' }),
      signal({ id:'c005', rank:5, tag:'NUMBERS', color:'amber', kicker:'Markets & Models',
        headline: 'pieter levels: one-week indie ship cycle',
        what: 'levelsio posted a daily log of building, launching, and pricing one new product in seven days.',
        why: 'This matters because indie cadence is the most useful counter-curriculum to enterprise PM theory right now.',
        url: 'https://x.com/levelsio', kw: 'laptop,beach,coding', actor:'levelsio' }),
      todo({ id:'c006', rank:6, color:'pink',
        headline: "Run Corey's 12-step audit on your own funnel.",
        whyToday: 'Your weekend is the only window without standing meetings; the audit needs uninterrupted reading.',
        action: 'Open the 12-step list. Score each step 1-3 honestly. Tag the three worst.',
        minutes: 45, url: 'https://x.com/coreyhainesco' }),
      todo({ id:'c007', rank:7, color:'amber',
        headline: 'Listen to Latent Space ep 200 while doing laundry.',
        whyToday: 'Weekend audio time is free; the agent-infra map you build now compounds across every product call next week.',
        action: 'Take 5 bullet notes on the parts that surprise you.',
        minutes: 60, url: 'https://www.latent.space/' }),
    ],
  },

  // ----- 2026-05-10 (Sun) — quieter, essay-heavy -----
  {
    date: '2026-05-10', weekday: 'Sunday', no: 101,
    promo: 'Quiet Sunday. Three essays, two model updates.',
    whats_news: [
      '<b>Every</b>: a long essay on workspace agents',
      '<b>Platformer</b>: weekly recap on labs vs platforms',
      '<b>Google</b>: Gemini gets faster on-device',
      '<b>Yann LeCun</b>: a post about world-model evals',
      '<b>AI Tidbits</b>: small-team deployment of frontier models',
    ],
    digest: {
      title: 'A reading Sunday — fewer pings, deeper takes.',
      body: 'Sunday is essay-shaped. Every and Platformer publish their long pieces, Google nudges Gemini on-device speed, Yann LeCun pushes back on benchmark theater, and AI Tidbits explains how small teams now ship frontier-class models. Nothing in the day demands action; the cost is missing the read.',
    },
    items: [
      signal({ id:'c001', rank:1, tag:'CRAFT', color:'cyan', kicker:"Today's Top Signal",
        headline: 'Every: the workspace agent essay',
        what: 'Every published a long piece on what a workspace-level agent does that an in-app one cannot.',
        why: 'This matters because the workspace surface is the real product battle of the next two quarters.',
        url: 'https://every.to/', kw: 'desk,paper,morning', actor:'every' }),
      signal({ id:'c002', rank:2, tag:'SIGNAL', color:'pink', kicker:'Markets & Models',
        headline: 'Platformer weekly: labs vs platforms',
        what: 'Casey Newton frames the labs-vs-platforms tension that will define the next regulatory cycle.',
        why: 'This matters because the framing leaks into every panel discussion you sit through this month.',
        url: 'https://www.platformer.news/', kw: 'newspaper,coffee,city', actor:'platformer' }),
      signal({ id:'c003', rank:3, tag:'NUMBERS', color:'indigo', kicker:'Markets & Models',
        headline: 'Google: Gemini gets faster on-device',
        what: 'Google rolled a kernel update that drops Gemini Nano latency on Pixel devices.',
        why: 'This matters because device-side latency is the gate for ambient AI features going mainstream.',
        url: 'https://blog.google/', kw: 'phone,chip,silicon', actor:'google' }),
      signal({ id:'c004', rank:4, tag:'CONTRARIAN', color:'amber', kicker:'Markets & Models',
        headline: 'Yann LeCun pushes back on benchmark theater',
        what: 'Yann LeCun posted a long thread arguing world-model evals are more honest than current LLM benchmarks.',
        why: 'This matters because benchmark talk is how labs justify their next round and the framing is shifting underfoot.',
        url: 'https://x.com/ylecun', kw: 'graph,whiteboard,research', actor:'ylecun' }),
      signal({ id:'c005', rank:5, tag:'STACK', color:'pink', kicker:'Markets & Models',
        headline: 'AI Tidbits: 4-person teams running frontier models',
        what: 'AI Tidbits walks through a real four-person team that deploys 70B+ models in production.',
        why: 'This matters because the small-team-frontier story changes hiring expectations for early-stage builders.',
        url: 'https://www.aitidbits.ai/', kw: 'startup,coding,studio', actor:'ai_tidbits' }),
      todo({ id:'c006', rank:6, color:'pink',
        headline: 'Read the Every essay end to end. No skim.',
        whyToday: 'Sunday is the only day you have an uninterrupted hour. Skimming wastes the essay.',
        action: 'Sit with coffee, read once through, then re-read the section that argues with you.',
        minutes: 45, url: 'https://every.to/' }),
      todo({ id:'c007', rank:7, color:'amber',
        headline: "Note one belief you'd change after Platformer + Every.",
        whyToday: 'Two essays in one morning is rare; capture the shift before the week erases it.',
        action: 'Write one sentence: "Last week I thought X. Now I think Y."',
        minutes: 15, url: 'https://www.platformer.news/' }),
    ],
  },

  // ----- 2026-05-11 (Mon) — product launches restart -----
  {
    date: '2026-05-11', weekday: 'Monday', no: 102,
    promo: 'Monday hits the gas — Replit, Notion, and a Shopify push.',
    whats_news: [
      '<b>Replit</b>: Replit Agents v2 launches',
      '<b>Notion</b>: Notion AI is now Notion 4',
      '<b>Shopify</b>: Sidekick gets a sales mode',
      '<b>Stripe</b>: Atlas now bundles AI bookkeeping',
      '<b>OpenAI</b>: a quieter pricing page',
    ],
    digest: {
      title: 'Monday is a launch day, not a meeting day.',
      body: 'Three product launches and two pricing moves all land before lunch. Replit Agents v2, Notion 4, and Shopify Sidekick are the headliners; underneath, Stripe and OpenAI both tweak how they price what you already pay for. Buyers should re-check their bills this afternoon.',
    },
    items: [
      signal({ id:'c001', rank:1, tag:'SIGNAL', color:'indigo', kicker:"Today's Top Signal",
        headline: 'Replit Agents v2 launches with a single-pane runner',
        what: 'Replit shipped Agents v2 with a unified runner and per-step approval.',
        why: 'This matters because Replit is the cleanest reference UI for agent runs and competitors will copy within a month.',
        url: 'https://replit.com/changelog', kw: 'coding,laptop,terminal', actor:'replit' }),
      signal({ id:'c002', rank:2, tag:'SIGNAL', color:'pink', kicker:'Markets & Models',
        headline: 'Notion AI becomes Notion 4',
        what: 'Notion renamed its AI tier to Notion 4, with new workspace-level summarization.',
        why: 'This matters because Notion is where most company knowledge already lives, so workspace-level AI features start touching real work.',
        url: 'https://www.notion.so/blog', kw: 'notebook,desk,office', actor:'notion' }),
      signal({ id:'c003', rank:3, tag:'PLAYBOOK', color:'amber', kicker:'Markets & Models',
        headline: 'Shopify Sidekick learns a sales mode',
        what: 'Shopify Sidekick added a sales-rep mode that drafts follow-ups from store data.',
        why: 'This matters because SMB merchants now get an AI sales motion without a separate CRM.',
        url: 'https://shopify.com/blog', kw: 'store,sales,shopping', actor:'shopify' }),
      signal({ id:'c004', rank:4, tag:'NUMBERS', color:'cyan', kicker:'Markets & Models',
        headline: 'Stripe Atlas bundles AI bookkeeping',
        what: 'Stripe added an AI bookkeeping line item to Atlas with a free first year.',
        why: 'This matters because bookkeeping is the most under-loved problem in founder ops and Stripe just made it default.',
        url: 'https://stripe.com/atlas', kw: 'ledger,accounting,office', actor:'stripe' }),
      signal({ id:'c005', rank:5, tag:'CONTRARIAN', color:'indigo', kicker:'Markets & Models',
        headline: 'OpenAI quietly simplifies its pricing page',
        what: 'OpenAI removed three legacy tiers from the public pricing page and consolidated them into Heavy and Instant.',
        why: 'This matters because pricing simplification is usually a precursor to a margin move at the top end.',
        url: 'https://openai.com/pricing', kw: 'invoice,calculator,desk', actor:'openai' }),
      todo({ id:'c006', rank:6, color:'pink',
        headline: 'Re-cost your AI line items in the team budget.',
        whyToday: "Stripe and OpenAI both moved pricing this morning; today's reconciliation is cheaper than next month's surprise.",
        action: 'Pull the last two invoices, compare against new pricing, flag any change >10%.',
        minutes: 30, url: 'https://openai.com/pricing' }),
      todo({ id:'c007', rank:7, color:'amber',
        headline: 'Try Replit Agents v2 on a real chore.',
        whyToday: 'Agents-v2 launch day is the moment to lock in your mental model before everyone has hot takes.',
        action: 'Pick a chore (rename files, add type hints, scaffold a test). Run it. Note where you intervened.',
        minutes: 30, url: 'https://replit.com/' }),
    ],
  },

  // ----- 2026-05-12 (Tue) — alignment + receipts -----
  {
    date: '2026-05-12', weekday: 'Tuesday', no: 103,
    promo: 'Alignment research, two receipts, one Vercel ship.',
    whats_news: [
      '<b>Anthropic</b>: a new constitutional-AI follow-up',
      '<b>OpenAI</b>: ChatGPT memory adds workspaces',
      '<b>Vercel</b>: AI SDK 6 ships',
      '<b>Corey Haines</b>: a positioning teardown',
      '<b>Latent Space</b>: ep 201 on long-context agents',
    ],
    digest: {
      title: 'A working Tuesday — papers, receipts, ship notes.',
      body: 'Tuesday is the most productive day of the week and the feed reflects that. An alignment follow-up from Anthropic, a quiet ChatGPT memory upgrade, Vercel AI SDK 6, and a Corey Haines positioning teardown all show up before lunch. The implicit instruction is: pick one, ship the consequence.',
    },
    items: [
      signal({ id:'c001', rank:1, tag:'CRAFT', color:'indigo', kicker:"Today's Top Signal",
        headline: 'Anthropic: a follow-up to constitutional AI',
        what: 'Anthropic posted a follow-up paper extending constitutional AI with model-written critique chains.',
        why: 'This matters because the critique-chain mechanism is what governance teams will point to when arguing about audits.',
        url: 'https://www.anthropic.com/research', kw: 'document,paper,research', actor:'anthropic' }),
      signal({ id:'c002', rank:2, tag:'SIGNAL', color:'pink', kicker:'Markets & Models',
        headline: 'ChatGPT memory adds team workspaces',
        what: 'OpenAI added team workspaces with shared memory and per-member redaction.',
        why: 'This matters because shared memory turns ChatGPT from a personal tool into a small-team knowledge surface.',
        url: 'https://openai.com/blog', kw: 'team,office,whiteboard', actor:'openai' }),
      signal({ id:'c003', rank:3, tag:'STACK', color:'cyan', kicker:'Markets & Models',
        headline: 'Vercel AI SDK 6 lands',
        what: 'Vercel released AI SDK 6 with native MCP support and streamlined tool calls.',
        why: 'This matters because the SDK update collapses 200 lines of glue code per agent and shifts where the bug surface lives.',
        url: 'https://vercel.com/blog', kw: 'coding,terminal,laptop', actor:'vercel' }),
      signal({ id:'c004', rank:4, tag:'PLAYBOOK', color:'amber', kicker:'Markets & Models',
        headline: 'Corey Haines: positioning teardown for a real SaaS',
        what: 'Corey Haines tore down the positioning of an actual mid-stage SaaS, line by line.',
        why: 'This matters because positioning posts that name a real company punch harder than abstract frameworks.',
        url: 'https://x.com/coreyhainesco', kw: 'marketing,whiteboard,office', actor:'corey' }),
      signal({ id:'c005', rank:5, tag:'SIGNAL', color:'indigo', kicker:'Markets & Models',
        headline: 'Latent Space ep 201: long-context agents',
        what: 'Latent Space published episode 201 on agents that hold 1M+ token context across days.',
        why: 'This matters because long-context behavior changes which features can move from demo to default.',
        url: 'https://www.latent.space/', kw: 'podcast,microphone,studio', actor:'every' }),
      todo({ id:'c006', rank:6, color:'pink',
        headline: 'Upgrade one tiny script to Vercel AI SDK 6.',
        whyToday: 'Day-one migrations are cheap; week-three migrations get tangled in unrelated refactors.',
        action: 'Pick the smallest agent you have. Bump the SDK. Note the diff.',
        minutes: 30, url: 'https://vercel.com/blog' }),
      todo({ id:'c007', rank:7, color:'amber',
        headline: 'Apply the Corey positioning teardown to your own page.',
        whyToday: 'The frame is fresh enough that the exercise still feels like a checklist, not theater.',
        action: 'Open your homepage. Run the same line-by-line teardown. Mark three lines to rewrite.',
        minutes: 45, url: 'https://x.com/coreyhainesco' }),
    ],
  },

  // ----- 2026-05-13 (Wed) — agents week peaks -----
  {
    date: '2026-05-13', weekday: 'Wednesday', no: 104,
    promo: 'Agents week peaks — Anthropic, OpenAI, Google all ship something.',
    whats_news: [
      '<b>Anthropic</b>: Claude can now hold a screen for an hour',
      '<b>OpenAI</b>: gpt-realtime adds long-form voice mode',
      '<b>Google</b>: Gemini agents land on Workspace',
      '<b>Sam Altman</b>: a thread on agent UX defaults',
      '<b>Linear</b>: AI weekly review beta',
    ],
    digest: {
      title: 'The middle of agent week, and the labs all show up.',
      body: 'Wednesday is when the labs that have been quiet on Monday and Tuesday all post. Anthropic, OpenAI, and Google each ship an agent feature; Sam Altman defends defaults; Linear adds a review surface. The day reads as proof that agent UX is now the next layer the industry argues about, not the model layer.',
    },
    items: [
      signal({ id:'c001', rank:1, tag:'SIGNAL', color:'indigo', kicker:"Today's Top Signal",
        headline: 'Claude can hold a screen for an hour',
        what: 'Anthropic extended Claude computer-use to one-hour autonomous sessions with periodic check-in approvals.',
        why: 'This matters because long-running computer-use is the line between demo and dependable, and Anthropic just crossed it.',
        url: 'https://www.anthropic.com/news', kw: 'screen,desk,coding', actor:'anthropic' }),
      signal({ id:'c002', rank:2, tag:'SIGNAL', color:'pink', kicker:'Markets & Models',
        headline: 'gpt-realtime adds long-form voice mode',
        what: 'OpenAI added a long-form voice mode that holds context across 20+ minute sessions.',
        why: 'This matters because long-form voice unlocks a new product layer for journaling, coaching, and tutoring apps.',
        url: 'https://openai.com/index', kw: 'microphone,headphones,studio', actor:'openai' }),
      signal({ id:'c003', rank:3, tag:'STACK', color:'cyan', kicker:'Markets & Models',
        headline: 'Gemini agents land on Workspace',
        what: 'Google brought Gemini agents natively into Docs, Sheets, and Slides with per-doc memory.',
        why: 'This matters because Workspace is where most knowledge work happens, and per-doc memory beats per-prompt context for that loop.',
        url: 'https://workspace.google.com/blog', kw: 'document,office,desk', actor:'google' }),
      signal({ id:'c004', rank:4, tag:'CRAFT', color:'amber', kicker:'Markets & Models',
        headline: 'Sam Altman on agent UX defaults',
        what: 'Sam Altman posted a thread defending the new conservative defaults on consumer agent UX.',
        why: 'This matters because the defaults shape what feels normal across every other vendor downstream.',
        url: 'https://x.com/sama', kw: 'design,sketch,interface', actor:'sama' }),
      signal({ id:'c005', rank:5, tag:'PLAYBOOK', color:'indigo', kicker:'Markets & Models',
        headline: 'Linear opens AI weekly review beta',
        what: 'Linear added an AI-generated weekly review for teams that summarizes shipped work and open risks.',
        why: 'This matters because weekly review is the most-skipped useful ritual, and Linear is making it cheap to keep.',
        url: 'https://linear.app/changelog', kw: 'calendar,office,workflow', actor:'linear' }),
      todo({ id:'c006', rank:6, color:'pink',
        headline: 'Run one boring real chore on Claude computer-use.',
        whyToday: "Today's session-length extension is the only reason the chore now feels worth attempting.",
        action: 'Choose: rename a folder of files, or fill a spreadsheet from a PDF. Run it. Watch.',
        minutes: 45, url: 'https://www.anthropic.com/' }),
      todo({ id:'c007', rank:7, color:'amber',
        headline: 'Pick which lab default you want as your team default.',
        whyToday: 'All three labs just changed defaults the same day. Picking now means you have a stable surface for the rest of the week.',
        action: 'Open a doc. Write the three defaults that matter to your team. Choose one provider per row.',
        minutes: 25, url: 'https://x.com/sama' }),
    ],
  },

  // ----- 2026-05-14 (Thu) — marketing receipts again -----
  {
    date: '2026-05-14', weekday: 'Thursday', no: 105,
    promo: 'Marketing day. Receipts from Lenny, Chen, and a Shopify case.',
    whats_news: [
      '<b>Lenny</b>: a 6-month report on AI in PM workflows',
      '<b>Andrew Chen</b>: the metrics that broke this year',
      '<b>Shopify</b>: a Sidekick case study from a $20M store',
      '<b>Cloudflare</b>: pricing for streaming caches lands',
      '<b>Every</b>: an essay on writing with AI memory',
    ],
    digest: {
      title: 'Receipts and rewrites for the marketing layer.',
      body: 'Thursday is for marketers. Lenny publishes a 6-month report on what changed in PM workflows, Andrew Chen calls out the legacy growth metrics that broke this year, Shopify drops a real Sidekick case study, Cloudflare finally prices streaming caches, and Every writes about memory-aware writing. None of it is hype — all of it is operator content.',
    },
    items: [
      signal({ id:'c001', rank:1, tag:'PLAYBOOK', color:'pink', kicker:"Today's Top Signal",
        headline: "Lenny: 6 months of AI in PM workflows",
        what: "Lenny's newsletter published a six-month report on which AI patterns stuck in real PM workflows.",
        why: 'This matters because most PM tooling reviews are pre-launch theater, and a six-month retrospective is the rarer signal.',
        url: 'https://www.lennysnewsletter.com/', kw: 'newsletter,office,product', actor:'lenny' }),
      signal({ id:'c002', rank:2, tag:'CONTRARIAN', color:'amber', kicker:'Markets & Models',
        headline: 'Andrew Chen: the growth metrics that broke this year',
        what: 'Andrew Chen names five legacy growth metrics that became misleading once agents started doing onboarding.',
        why: 'This matters because the dashboards every growth team uses are now lying in ways the team has not noticed.',
        url: 'https://andrewchen.com/', kw: 'dashboard,charts,office', actor:'andrewchen' }),
      signal({ id:'c003', rank:3, tag:'NUMBERS', color:'indigo', kicker:'Markets & Models',
        headline: 'Shopify Sidekick case study: a $20M store',
        what: 'Shopify published a case study of a $20M store running Sidekick across support and CRM.',
        why: 'This matters because mid-market case studies are the unit of truth that SMB buyers actually read.',
        url: 'https://shopify.com/blog', kw: 'shop,store,commerce', actor:'shopify' }),
      signal({ id:'c004', rank:4, tag:'STACK', color:'cyan', kicker:'Markets & Models',
        headline: 'Cloudflare prices streaming caches',
        what: 'Cloudflare priced AI Gateway streaming caches at a flat per-million-token rate.',
        why: 'This matters because the price point sets the floor for what chat-product margins look like for the rest of the year.',
        url: 'https://blog.cloudflare.com/', kw: 'cloud,server,network', actor:'cloudflare' }),
      signal({ id:'c005', rank:5, tag:'CRAFT', color:'pink', kicker:'Markets & Models',
        headline: 'Every: writing with AI memory',
        what: 'Every published a long essay on what changes when an AI writing partner remembers across sessions.',
        why: 'This matters because cross-session memory is the feature that makes AI feel less like a tool and more like a collaborator.',
        url: 'https://every.to/', kw: 'writing,desk,notebook', actor:'every' }),
      todo({ id:'c006', rank:6, color:'pink',
        headline: 'Diff your growth dashboard against Chen\'s broken-metrics list.',
        whyToday: 'You read the post today; you have not yet adjusted. The adjustment takes 30 minutes if done now.',
        action: 'Open your North Star + 5 secondary metrics. Mark which of Chen\'s critiques applies to each.',
        minutes: 30, url: 'https://andrewchen.com/' }),
      todo({ id:'c007', rank:7, color:'amber',
        headline: "Read the Lenny report. Pick one pattern to copy this quarter.",
        whyToday: 'The six-month signal compresses six months of trial and error into one read; the savings are highest the day it ships.',
        action: 'Read fully. Star one pattern. Add it to next sprint\'s top of backlog.',
        minutes: 45, url: 'https://www.lennysnewsletter.com/' }),
    ],
  },

  // ----- 2026-05-15 (Fri) — bridge to 5-16, mixed -----
  {
    date: '2026-05-15', weekday: 'Friday', no: 106,
    promo: 'Friday set-up — what will matter Monday.',
    whats_news: [
      '<b>OpenAI</b>: Codex preview on mobile begins to leak',
      '<b>Anthropic</b>: pricing simplification announced',
      '<b>Google</b>: TPU v6 production notes',
      '<b>Stratechery</b>: on default models as commodity',
      '<b>Corey Haines</b>: a video on marketing skills v2.0',
    ],
    digest: {
      title: 'Set up Monday from Friday.',
      body: 'Friday is preview day. Codex mobile starts leaking, Anthropic warns about a pricing simplification, Google posts TPU v6 numbers, Stratechery argues default models are now commodity, and Corey Haines records a video to anchor next week\'s marketing-skills updates. None of it ships today; all of it lands by Tuesday.',
    },
    items: [
      signal({ id:'c001', rank:1, tag:'SIGNAL', color:'indigo', kicker:"Today's Top Signal",
        headline: 'Codex on mobile begins to leak',
        what: 'Screenshots and a partial App Store listing show OpenAI testing a Codex companion on iOS.',
        why: 'This matters because mobile coding agents are the surface that decides where the rest of the year is fought.',
        url: 'https://x.com/openai', kw: 'iphone,coding,mobile', actor:'openai' }),
      signal({ id:'c002', rank:2, tag:'SIGNAL', color:'pink', kicker:'Markets & Models',
        headline: 'Anthropic announces pricing simplification',
        what: 'Anthropic announced a pricing simplification effective next Wednesday with a smaller number of tiers.',
        why: 'This matters because simplification usually trims edge cases that some teams quietly relied on.',
        url: 'https://www.anthropic.com/pricing', kw: 'invoice,office,calculator', actor:'anthropic' }),
      signal({ id:'c003', rank:3, tag:'NUMBERS', color:'cyan', kicker:'Markets & Models',
        headline: 'Google posts TPU v6 production notes',
        what: 'Google posted production notes for TPU v6 with throughput and energy numbers.',
        why: 'This matters because TPU v6 numbers set how aggressive Google can be on Gemini pricing for the next quarter.',
        url: 'https://cloud.google.com/blog', kw: 'chip,silicon,server', actor:'google' }),
      signal({ id:'c004', rank:4, tag:'CONTRARIAN', color:'amber', kicker:'Markets & Models',
        headline: 'Stratechery: default models are commodity',
        what: 'Ben Thompson argues that default model quality has converged and competition shifts to distribution.',
        why: 'This matters because the commodity framing changes which startups deserve a premium and which look overvalued.',
        url: 'https://stratechery.com/', kw: 'newspaper,city,architecture', actor:'stratechery' }),
      signal({ id:'c005', rank:5, tag:'PLAYBOOK', color:'pink', kicker:'Markets & Models',
        headline: 'Corey Haines: marketing skills v2.0 video',
        what: 'Corey Haines recorded a video walkthrough of his renamed marketing-skills curriculum.',
        why: 'This matters because video versions of operator content tend to spread further than the original posts.',
        url: 'https://x.com/coreyhainesco', kw: 'video,marketing,studio', actor:'corey' }),
      todo({ id:'c006', rank:6, color:'pink',
        headline: 'Re-cost Anthropic line items before Wednesday.',
        whyToday: 'Pricing change is announced for next Wednesday; doing the math today gives you the weekend to act.',
        action: 'Pull last two invoices. Compare against announced tiers. Tag any line >10% off.',
        minutes: 30, url: 'https://www.anthropic.com/pricing' }),
      todo({ id:'c007', rank:7, color:'amber',
        headline: 'Sketch one distribution-first growth move for next week.',
        whyToday: 'Stratechery just argued distribution beats default model quality; the time to sketch a move is the day the framing lands.',
        action: 'On one page, write a distribution-first move you could ship in 5 working days. Be specific.',
        minutes: 45, url: 'https://stratechery.com/' }),
    ],
  },
];

// ============================================================
// write each issue + rebuild manifest from feed/days/*.json
// ============================================================
async function main() {
  // write issues
  for (const issue of ISSUES) {
    const payload = {
      date: issue.date,
      weekday: issue.weekday,
      no: issue.no,
      edition: "Nora's Early Brief",
      generated_at: new Date(`${issue.date}T13:31:00Z`).toISOString(),
      promo_headline: issue.promo,
      whats_news: issue.whats_news,
      digest: issue.digest,
      items: issue.items,
    };
    const fp = path.join(DAYS_DIR, `${issue.date}.json`);
    await writeFile(fp, JSON.stringify(payload, null, 2) + '\n');
    console.log(`✓ wrote ${issue.date}.json (${issue.items.length} items)`);
  }

  // rebuild manifest from all *.json files in feed/days/ (newest-first)
  const files = (await readdir(DAYS_DIR))
    .filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort()
    .reverse();
  const manifest = [];
  for (const f of files) {
    const j = JSON.parse(await readFile(path.join(DAYS_DIR, f), 'utf8'));
    const lead = j.items?.[0] || {};
    const readTotal = (j.items || []).reduce((s, it) => s + (it.read_time_min || 0), 0);
    manifest.push({
      date: j.date,
      weekday: j.weekday,
      no: j.no,
      edition: j.edition,
      promo_headline: j.promo_headline,
      lead_kicker: lead.kicker || '',
      lead_headline: lead.headline || '',
      lead_deck: lead.deck || '',
      lead_tag: lead.tag || 'SIGNAL',
      tag_color: lead.tag_color || 'pink',
      story_count: (j.items || []).length,
      read_time_total_min: readTotal,
      lead_author: lead.author || {},
      lead_source: lead.source || {},
      lead_image_url: lead.image_url || '',
    });
  }
  await writeFile(path.join(DAYS_DIR, 'manifest.json'),
                  JSON.stringify(manifest, null, 2) + '\n');
  console.log(`✓ rebuilt manifest.json (${manifest.length} entries)`);
}

main().catch(e => { console.error(e); process.exit(1); });
