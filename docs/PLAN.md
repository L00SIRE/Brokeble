# SquadTab: master plan (single source of truth)

Product name: SquadTab (internal identifiers keep the `tab` prefix).

**Event:** LA Hacks AI Hackathon, UCLA JWAC. Hacking runs Sat Oct 17 12:00 PM to **Sun Oct 18 12:00 PM PDT**. There is no grace period and late Devpost submissions are not accepted. Judging: Round 1 is a science fair from 12:30 to 2:00 PM, 4–5 min per judge, several judges per table. Round 2 is the top 5 on stage: 3 min demo plus 5 min Q&A. The whole team must be present.
**Written:** Sat 4:25 PM.
**Precedence:** this file → `docs/plans/{A,B,C}-*.md` → `docs/research/*`. If something here conflicts with code, fix the code or raise it in team chat. Never silently diverge.
**Rule:** anything tagged **UNVERIFIED** gets its smoke test run before anyone builds on it. Record each result in §19.

---

## 1. Pitch

- **Thesis (use everywhere):** *"Say no without saying why. Nobody pays until everyone's in."*
- **Pitch line:** *"SquadTab is the friend who knows everyone's budget and tells no one. It finds the plan you can all afford, and nobody pays until everyone's in."*
- **Product line:** *"SquadTab never joins your group chat, on purpose. Money talk only works in private."*
- **Privacy claim (the only one we make):** *"Only your own agent hears your budget. CREAO, the group messages, and everyone else's agent never get it, and every money decision is plain code."*
- **CREAO line:** *"CREAO does the open-world work; fast per-message parsing stays local for responsiveness. Remove the agent and SquadTab has nothing to vote on."*
- **Visa line:** *"A group purchase as an assurance contract at the merchant of record. N cardholder-initiated authorizations, and an identified agent that can commit only the exact consent set."*
- **Impact hook (verbatim):** *"According to Zelle research (June 2026), 76% of Gen Z consumers who have fronted money for a group expense, like a trip or event, say they were not fully repaid."*
- **Words to avoid on stage unless a judge asks:** "Nash welfare", "RFC 9421", "advocates", "agents negotiate", "Visa-verified agent", "$0 instantly".
- **Words to use instead:**
  - "private delegate per friend"
  - "sealed constraints"
  - "plain-code mechanism"
  - "hold" (until capture)
  - "released"
  - "signed agent request (Visa Trusted Agent Protocol)"

---

## 2. Prizes and requirement checklists

**Entering:**
- Main track: Applied Intelligence. Its official text is **UNVERIFIED**; read live.lahacks.com/tracks.
- Overall.
- Visa.
- CREAO Best AI-First Disruptor.
- Photon iMessage. The entry path is **UNVERIFIED** because Photon is not on Devpost; ask the booth.

**Only if voice ships:** Photon Best Voice Agent and MLH Best Use of ElevenLabs.

**Only if we already qualify as-is:** Paper Best Designed Hack, Intuit, MLH Commit Fellowship (opt-in plus a supplemental form).

**Skip:**
- Base44 and Cognition/Devin (another platform or product).
- Workday, Fetch.ai, Gemini, Solana and the other MLH tracks.
- CREAO Team Empowerment and One-Person Company. The CREAO brief says "Pick the track that fits" (singular). Enter Team Empowerment only if the booth explicitly says yes.

### 2.1 Devpost (required for every prize)

| Requirement | How | Owner | Due |
|---|---|---|---|
| Description: what it does, the problem, which track, and how it applies to each company challenge | Template in `docs/devpost.md` (B writes) | B | draft 9:30 AM |
| Public GitHub repo, documented | README with architecture, run steps, CREAO IDs and links | B | 9:30 AM |
| 2–3 min demo video | Doubles as the backup demo | B | 9:00 AM |
| Complete Devpost page: summary, technologies, extra resources | | B | final 11:45 AM |
| Whole team present in person for judging | | all | Sun 12:30 |

### 2.2 CREAO: Best AI-First Disruptor ($2,000)

Rubric: AI as foundation 30, Depth 25, Originality 20, Track fit 15, Demo 10.

| Requirement (creao.md) | How we exceed it | Where in demo |
|---|---|---|
| At least one CREAO agent does the core work | **SquadTab Scout** produces every option the group can vote on. **SquadTab Concierge** writes the itinerary, a hosted .ics and the Notion page after the commit. Code only filters, composes and scores. | Say out loud: "Remove the agent and SquadTab has nothing to vote on." |
| Built on agent.creao.ai | Both agents built by chatting, then Create Agent. The `tab` CLI is saved via Update Environment → Save to Agent, and is also a public GitHub SKILL.md repo. | [API] run thread in a second tab |
| README: run share link + agent ID | Share links to one Scout run and one Concierge run, both seeded from PII-free inputs (a share link exposes the full conversation). Both appIds, the skill repo URL and the exact API calls. | Devpost README |
| Show the agent running | A fresh live Scout run starts at second 0 of every demo. Agent-posted `tab progress` lines stream into the console CREAO lane. The flow uses a pre-warmed completed run, **and we say so**. | CREAO lane |
| Disruptor building blocks | API Trigger with webhook (re-fetched to verify) plus polling; `idempotencyKey`; artifacts; our own tools (skill + saved CLI); our services via Secrets (narrow `TAB_AGENT_TOKEN`); Notion connector. | Run chips: runId, status, elapsed |
| Depth | Agent self-validation: it writes options.json, runs `tab options validate`, fixes errors, then runs `tab options submit`. | Run thread shows the validate/fix loop |
| Keys server-side; unsigned webhooks | The `capi_` account key lives only in a Fly secret. The webhook is a hint: we re-fetch `GET /api/v1/runs/{id}`, dedupe on runId and X-Creao-Delivery-Id, and poll every 15 s. | Q&A |

### 2.3 Visa: "The Future of Shopping" ($2,000)

Rubric: Innovation 25, UX 25, Technical 20, Commerce Impact 15, Trust 15.

| Criterion | How we exceed it | Where in demo |
|---|---|---|
| Shopping stages | Discovery (CREAO) → decision (private ballot + fair shortlist) → personalization (private caps) → checkout/payments (split-tender holds + TAP commit) → post-purchase (receipt DMs, Concierge itinerary) | Whole demo |
| Innovation | An assurance contract at the merchant of record. The agent's signature can commit only the exact consent set. | TAP panel |
| UX ("intuitive, useful, seamless") | Everything happens in iMessage. One Microform page for the first card; later plans are one tap (TMS token + COF flags). Seven designed pay-page states. | Judge pays with the test card |
| Technical execution | Real Cybersource sandbox calls: auth `capture:false` + TOKEN_CREATE, capture, reversal, timeout reversal by transactionId. Our own Ed25519 RFC 9421 signer and a 6-step verifier: strict 8-min window, nonce store, content-digest over the consent set recomputed from the venue DB. | Ledger with real IDs |
| Commerce impact | Three live counters from our own data: groups converted all-or-nothing, $ fronted by any individual (always $0), holds released on failed plans. No invented stats. | Console |
| Trust and responsibility | **holdGate** (a share above your private max needs your private yes). Card data only in Microform iframes. Single-use, amount-bound pay links. Live tamper, replay, expired and wrong-tag rejections. Mock key directory labelled "mock". "Released" wording. | Tamper button; holdGate DM |

**Merchant honesty (mandatory):**
- The merchant is **"SquadTab Partner Venue (sandbox merchant of record)"**, selling a **prepaid, ticketed dinner + show bundle**, so capturing at booking is normal practice.
- Never put a real business's name or brand on the pay page.
- Say: "CREAO finds real options; partner merchants integrate SquadTab checkout; this demo merchant is ours."
- Say: "We send no Agentic Payment Container. Each human pays their own share; the agent's signature only proves which consent set it may commit."
- Say (Sat 10:45 PM change; C plan §0): "Payments are real Cybersource sandbox calls on Cybersource's published sample test merchant (`testrest`): shared, test cards only, no real money." In mock mode, say "labelled simulation" instead. Never say "our merchant account", "Visa-provided" or "approved".

### 2.4 Photon iMessage ($700 / $300)

| Requirement (photon.md) | How we exceed it | Where in demo |
|---|---|---|
| Built on Photon 2.0 | `@photon-ai/api@0.5.0` against `https://api.photon.codes/v1` plus Socket.IO events with a persisted replay cursor. The brief's "SDK reference" link points at spectrum-ts (Stable), so ask the booth which counts. | Photon delivery lane; beta dashboard tab |
| Live on ≥1 Photon channel | Live iMessage DMs. Judges join from **their own phones** via assignment-create (free tier: 25 seats, released after each judge). | QR → in a DM in about 60 s |
| Vision: hybrid intelligence | A private delegate per friend, a code mechanism between them, humans keep the final yes | Context X-ray panel |
| Craft: responsive | Typing within about 1 s, refreshed during runs. Mark-as-read on receipt. Threaded replies (`parentMessageId`). Agent profile "SquadTab" + avatar (visibility on shared lines **UNVERIFIED**). PNG cards are a stretch. | Judge's phone |
| Depth: edge cases | User texts first; the agent number can differ per user; `SHARED_LINE_*` errors handled; idempotent sends; Socket.IO replay; re-ping ladder; deadline releases all holds | Decline/deadline beat |
| Traction | No app install, no group app, works with the friend group you already have | Judge onboarding |

**Not used:** native polls, tapbacks, edit-in-place, unsend and effects. None of them are in the 2.0 iMessage content union (verified: `ImessageMessageContent = Text | Attachment | MessageRead | SpaceTypingUpdate | ImessageGroupContent`). Group chats are not used either: they need a dedicated line.

### 2.5 Main track / Overall

Criteria (lahacks.md): Technical Depth; Product Thinking & Impact; Originality & Insight; Execution & Polish.

- **Technical Depth:**
  - Context-isolation boundary.
  - The filter is a non-callable pipeline step, which blocks binary-search attacks on min(budget).
  - Exactly-once commit state machine.
  - TAP verifier.
- **Product thinking:**
  - Plans die at two moments of exposure: saying what you can afford, and chasing who owes what.
  - Zelle hook.
- **Originality:**
  - Prior art: Sunday (TreeHacks 2026) takes a public group budget inside group chats. PayByGroup (2012) and Airbnb split pay (2017) know nothing about constraints.
  - SquadTab combines sealed constraints with an assurance contract.
- **Execution:** three clean runs in a row by 4 AM; scope is cut before polish.

### 2.6 Voice (stretch, gated)

The go condition at 6:45 PM:
1. A payment method is on the Photon org.
2. An SMS number can be bought.
3. B is on schedule.

The work only starts after the 11 PM checkpoint passes.
- Outbound ElevenLabs nudge to the last holdout, built per the Photon ElevenLabs cookbook (`photon.codes/docs/beta/cookbooks/voice/elevenlabs`). The API details are **UNVERIFIED**; read the cookbook first.
- The call summary lands in that person's iMessage DM.
- Voice collects intent only; money moves only on a text YES.
- Hard stop at 2 AM if the SIP echo call fails.

---

## 3. Product flow

### 3.1 Happy path

| # | Step | System behaviour | Owner |
|---|---|---|---|
| 0 | **Demo prep** | 3 team phones assigned; each has sent ≥3 messages to SquadTab. `pnpm seed:demo` creates the demo plan (title "Dinner + show", area, date, 18:30–23:00, party target 4), seeds 3 members with budgets and prefs, and loads cached options from a real earlier Scout run (its real runId kept in `research_runs.result.cached_from_run_id`). | A |
| 1 | **Create plan** (non-demo) | Organizer opens `apps/web /` → `POST /plans` → gets code `4821`, join link `/j/4821` and a QR. The organizer pastes the link into **their own existing group chat**; SquadTab is never in it. | A + B |
| 2 | **Join** | `/j/4821`: phone (E.164), first name, optional private budget field, consent checkbox → `POST /join`. Then: (a) the agent upserts the user and participant; (b) it calls `assignments.create` (idempotency key `join:<planId>:<userId>`); (c) the page shows a "Text SquadTab" button `sms:<assignedNumber>&body=JOIN%204821` **and** the number and code in plain text (iOS prefilled-body behaviour is **UNVERIFIED**). | A (API), B (page) |
| 3 | **First DM** (user texts first) | Inbound `JOIN 4821` → route stored (spaceId, receivedBy.id) → markRead → typing → template `T_JOIN_WELCOME` + `T_BUDGET_ASK`. Text only, no links (Apple suppresses link-clicking until a reply lands). | A |
| 4 | **Private budget** | The reply goes to **that person's delegate** (Haiku, stateless; input is only this message plus the stage) → `BudgetParse` → code validates and writes `private_constraints` → template `T_BUDGET_CONFIRM` ("Just between us: aim ~$30, never over $30. Text 'change budget' anytime."). Low confidence → `T_BUDGET_TIERS` ("Reply 1: under $25, 2: $25–50, 3: $50–80, 4: no cap"), mapped in code. | A |
| 5 | **Prefs** | `T_PREFS_ASK` → delegate `parsePreferences` → `Preferences` (no money fields, enums for dietary and vibe). | A |
| 6 | **Research** | Plan reaches its research trigger (organizer GO with ≥2 prefs-done (under 3 → one `T_SMALL_GROUP` warning, then GO again), or party target reached, or the demo seed): (a) the code builds a `ResearchBrief` (enums + area/date/time + party size only); (b) **two parallel Scout runs** start (`dinner`, `show`); (c) the CREAO lane shows progress; (d) DMs get a typing refresh plus at most one `T_STILL_LOOKING` after 90 s. Webhook → re-fetch; poll every 15 s; 6-min timeout → cached options. | B |
| 7 | **Compose + filter + shortlist** (pure code) | (a) Compose bundles: dinner open at plan start T, show start ∈ [T+1.5h, T+2.5h], same area. (b) Price each bundle with `priceBundle()`, shared by agent and venue. (c) **Hard filter:** `all_in_pp ≤ effectiveHardMax` for **every** member, plus dietary and time windows. (d) Each delegate rates surviving bundles for its own person from prefs only (Sonnet). (e) Code picks **3 diverse bundles** (no shared dinner or show) by max Nash welfare of `rating × comfort` (comfort is code-only, against target). Fewer than 3 survive → one re-roll (stretch) or `T_NO_FIT`. | B (pure fns), A (wiring) |
| 8 | **Private ballot** | Each DM gets `T_PICKS` (3 numbered bundles: names, times, all-in per person, Scout pitch). Replies: digits ("2", "1 3"), or free text ("2, but not if it ends after 10") parsed by that person's delegate into `BallotParse`. `T_VOTE_TALLY` goes to all ("3 of 4 voted", no names). A membership or constraint change before the vote closes → recompute; if the shortlist changed, version+1, ballots reset, `T_PICKS_REFRESH` ("The group changed, so here are fresh picks that work for everyone"). | A |
| 9 | **Winner** | All voted or vote deadline → most approvals (conditional approvals evaluated in code), ties broken by Nash → `T_WINNER` to all. | A |
| 10 | **Order** | Agent → venue `GET /availability/{bundleKey}` (TAP `agent-browser-auth`) → `POST /orders` (TAP `agent-payer-auth`, content-digest). The **venue prices** via `priceBundle()` and creates N shares with single-use pay links. | C (venue), A (call) |
| 11 | **holdGate** | For each member: if `share.amount_cents > effectiveHardMax` → private `T_HOLD_GATE` (YES or NO). YES → link; NO → treated as "I'm out". Otherwise → `T_PAY_LINK` immediately. | A |
| 12 | **Hold** | Venue `/pay/[token]`: (a) the capture context is minted **on page load**; (b) Microform (first time) or one tap (saved TMS token); (c) auth `capture:false`; (d) the venue posts `share.authorized` to the agent hook. Then `T_HELD` to that person ("Held $30.00 on Visa ••1111. Not charged yet.") and `T_IN_COUNT` to all ("3 of 4 are in"). | C, A |
| 13 | **Commit** | The last share authorized → conditional UPDATE plan `APPROVING→COMMITTING` (exactly one worker) → agent builds a `ConsentSet` from `GET /orders/{id}` → TAP-signed `POST /checkout/{orderId}` → venue runs 6-step verify plus business checks → captures each share → `order.captured`. Then: plan `CONFIRMED`; `T_CAPTURED` to all; counters update. | C, A |
| 14 | **Post-purchase** | Concierge run (async, after commit): itinerary JSON + `.ics` + Notion page via `tab itinerary submit`. The agent hosts `/p/{planRef}/itinerary` and `/p/{planRef}/plan.ics` and DMs `T_ITINERARY`. Fallback: Notion page created from code via `@notionhq/client`. | B |

### 3.2 Failure flows

| Failure | Handling | Message (template) |
|---|---|---|
| Invitee never texts JOIN | The organizer gets `T_ORG_JOIN_STATUS` ("2 of 4 joined. Reply GO to plan with 2, or WAIT."). Groups under 3 get a privacy warning. | organizer only |
| Budget unparseable or low confidence | One clarifying ask → `T_BUDGET_TIERS` | to that person |
| Hard max below target, or absurd value (<$5 or >$1,000) | Code rejects it and re-asks with tiers | to that person |
| "change budget" after an order exists | Allowed until that person holds; changes after the order trigger holdGate, not a re-plan | to that person |
| Card number pasted in chat | Luhn regex runs **before** the LLM and before any logging. The text is never stored or logged; only a counter is kept. | `T_CARD_INTERCEPT` |
| "what's Sam's budget?" / asks about others | Delegate intent `ask_about_others` → template | `T_ONLY_YOURS`: "I only know yours." |
| CREAO run fails / 402 credits / no webhook | Poll every 15 s; at 6 min → cached options (`source:'cached'` logged and shown on the console). On 402, ask the booth for a top-up. | DMs: typing only |
| Scout output invalid | CLI path is primary. Fallback: `result.text` → zod → one Haiku repair (Scout output has no person data) → cached. | — |
| Fewer than 3 bundles survive | Stretch: one Scout re-roll with `threadId`. Otherwise `T_NO_FIT`. **Never say who or why.** | `T_NO_FIT` |
| Non-voters at the vote deadline | They count as approving nothing; ties broken by Nash | — |
| holdGate NO / "I'm out" / STOP | Cancel the order: the venue reverses every AUTHORIZED share and voids PENDING ones. Plan `CANCELLED`. | All: `T_CANCELLED` "Plan cancelled. Nobody was charged; your pending authorization was released." Nobody is named. |
| Approval deadline passes | Re-ping at T-30m (`T_REPING`, to pending people only, no names to others) → voice at T-15m (if shipped) → at the deadline, cancel as above | `T_REPING`, `T_CANCELLED` |
| Card declined | Share → `DECLINED` → `PENDING` with a new link (old token consumed); the deadline still applies | `T_DECLINED_RETRY` to that person only |
| Auth outcome unknown (timeout/5xx) | Share `AUTH_UNKNOWN`. **Never blind-retry.** A venue sweep at ≥60 s → `POST /pts/v2/reversals` (mitReversal) with the persisted `clientReferenceInformation.transactionId` → `RELEASED` → new link. | `T_DECLINED_RETRY` |
| TAP verify fails or a business check fails at checkout | No capture. Order stays OPEN. The agent logs `tap.verify rejected`. A real failure (not a demo test button) on an order that is still OPEN → cancel the plan (reverse all). If the order is COMMITTING or CAPTURED, wait for `order.captured`. | `T_CANCELLED` |
| Capture fails mid-loop | Order `NEEDS_ATTENTION`; check `GET /tss/v2/transactions/{id}` before any retry; console flag. Double-capture behaviour is **UNVERIFIED**. | none until resolved |
| Photon redelivery / reconnect | `inbound_events` insert-or-ignore on `(photon, event.id)`; cursor saved only after a successful handle; outbound idempotency key `reply:<inboundMessageId>:<n>` or `tpl:<planId>:<userId>:<templateId>:<version>` | — |
| `SHARED_LINE_CAP_EXCEEDED` / `POOL_EXHAUSTED` on join | The join page shows "SquadTab is at capacity, try again in a minute"; operator releases judge seats | page |
| `SHARED_LINE_INBOUND_REQUIRED` on send | Never send a first message; queue until that user texts | — |
| Process restart | Socket.IO resubscribes with the saved `startSeq`; due_jobs and state resume from the DB | — |
| Pay link forwarded | Single-use token, consumed on POST only (preview GETs don't consume it); amount from the DB; bound to share + order version | — |

---

## 4. Privacy and money invariants (numbered, each has a test)

| # | Invariant | Enforced by | Test |
|---|---|---|---|
| P1 | A person's budget lives **only** in `app.private_constraints`. It is read only by: (a) that person's delegate, (b) the filter/score module, (c) holdGate. | `PrivateConstraints` type exported only from `@tab/shared/private`. The only SQL touching `private_constraints` is in `apps/agent/src/repo/privateConstraints.ts`. | `privacy.imports.test.ts`: greps imports of `@tab/shared/private` and the SQL string `private_constraints`; fails outside the allowlist (`src/delegates/**`, `src/decide/filter.ts`, `src/decide/score.ts`, `src/money/holdGate.ts`, `src/repo/privateConstraints.ts`) |
| P2 | Delegate context = **one person's own inbound message + stage + that person's own parsed state**. No other person's data, no DM history of others. | `buildDelegateInput(userId, msg)` | `privacy.e2e.test.ts` (below) |
| P3 | **No group-coordinator LLM.** Every group-facing or fan-out message is a template, plus Scout copy (`pitch`, ≤140 chars, sanitized). | `notify(userId, TemplateId, vars, { key, planId?, replyTo? })` is the only path to `MessagingPort.sendText`; keys come from `tplKey(planId, userId, templateId, version, suffix?)` or `replyKey(inboundId, n)` (both exported from `src/notify/notify.ts`) | `templates.only.test.ts`: `sendText` is imported only by `src/notify/notify.ts` |
| P4 | Money and privacy messages are fixed templates; no LLM-generated text is ever sent to a user | P3 | P3 |
| P5 | No LLM call ever carries `tools` (no LLM can pay, sign, commit, cancel or filter). The filter is a pipeline step, not a callable. | `AnthropicLLM` adapter builds requests without `tools` | `llm.notools.test.ts` asserts that no recorded Anthropic request body has a `tools` key |
| P6 | CREAO inputs contain only enums, area, date, times and party size. No names, phones, budgets or free text from users. | `ResearchBrief` is a strict zod object with enums | `privacy.e2e.test.ts` + `brief.schema.test.ts` |
| P7 | **Value-specific payload test.** In a full mock run with 4 members whose budgets are $31.17/$40 max, $47.29/$52.11, $63.43/null, $88.61/$91.03: each value (as cents, `31.17`, `$31`…) appears **only** in (a) that member's own delegate calls and (b) outbound texts to that member. It must not appear in other delegates, CREAO inputs, fan-out texts, `app.events`, SSE frames, pino logs or venue requests. | Architecture | `privacy.e2e.test.ts` (never cut) |
| P8 | `app.events` / SSE carry no constraint values. The X-ray shows each delegate as 🔒 only. | Strict zod `SseEvent` union with no budget fields; `emit()` parses before insert | `sse.schema.test.ts` |
| M1 | Cybersource credentials, TMS tokens and card data exist **only** in `apps/venue` / schema `venue`. Card data exists only inside Microform iframes. | Separate app, env and DB role | `secrets.layout.test.ts`: no `CYBS_` env reads outside `apps/venue` |
| M2 | Money moves only on (a) a cardholder action on the venue pay page (auth), or (b) a deterministic state transition: TAP-verified commit (capture) or cancel/deadline (reverse). | No payment code in the agent; VenuePort only | `money.paths.test.ts` |
| M3 | All amounts come from the venue DB (`priceBundle()` → `shares.amount_cents`), never from URLs, LLM output or the request body. | Venue recomputes | `venue.pricing.test.ts` |
| M4 | All-or-nothing: capture only when **every** share is AUTHORIZED, Σshares = total, and the request body equals the canonical consent set rebuilt from the DB. Otherwise nothing is captured. | Checkout handler | `checkout.allornothing.test.ts` |
| M5 | Exactly-once commit/cancel: conditional UPDATEs (`WHERE state=…`), and only the caller that gets a row back acts | SQL | `statemachine.race.test.ts` (2 concurrent commits → 1 capture loop) |
| M6 | Cybersource has no idempotency header. Use unique `(share_id, op, attempt)`, a deterministic `clientReferenceInformation.code`, a persisted `transactionId` (≤30 chars) and a timeout reversal. Never blind-retry an auth. | `payment_ops` | `payments.idempotency.test.ts` |
| M7 | A share above that person's effective hard max is never linked without a private YES (holdGate) | `money/holdGate.ts` | `holdgate.test.ts` |
| M8 | TAP: 8-min window max (we sign 120 s), nonce single-use within 8 min, tag must match the route, keyid in the directory, Ed25519 verify over the rebuilt base, content-digest recomputed | `apps/venue/src/tap/verify.ts` | `tap.verify.test.ts` (valid, tampered, replayed, expired, wrong tag, unknown keyid) |
| M9 | Wording: never "$0 instantly" or "Visa-verified". Always "Nobody was charged; your pending authorization was released." | Templates | `copy.lint.test.ts` (banned-phrase grep) |
| S1 | No secrets in git. `.env*` is ignored. The `capi_` key is never in the browser or in CREAO Secrets (only `TAB_AGENT_TOKEN` + `TAB_API_BASE` go there). | `.gitignore`, review | `git status` before every report |

Effective hard max (code-only, `decide/filter.ts`): `hard_max_pp_cents ?? round(target_pp_cents × 1.10)`.

---

## 5. Architecture and repo layout

```
 iPhones (judge + team) ──iMessage DMs──▶ Photon 2.0 beta shared lines
                                            │ Socket.IO /v1/projects/{id}/events/ws (Bearer pho_sk_)
                                            ▼            ▲ REST: sendMessage, setSpaceTyping, markMessageRead,
┌──────────── apps/agent  (Hono + Node 22, Fly.io, 1 always-on machine) ───────────────────────────┐
│ photon consumer ─▶ router (regex cmds, Luhn) ─▶ delegates (Anthropic, per-person, stateless)      │
│ plan state machine · due_jobs poller (FOR UPDATE SKIP LOCKED) · notify(templates)                 │
│ decide/: compose · filter · score(Nash) · pickWinner  (pure)   money/: holdGate                  │
│ CREAO client (runs, re-fetch, poll) · /creao/hook/:secret · /agent/* (CLI, Bearer TAB_AGENT_TOKEN)│
│ TAP signer (Ed25519, node:crypto) ─▶ VenuePort · /venue/hook (HMAC) · /join /plans · SSE /events  │
└───────────────┬──────────────────────────────────────────────┬────────────────────────────────────┘
                │ RFC 9421-signed HTTPS (TAP)                    │ SSE (CONSOLE_KEY)
┌───────────────▼───── apps/venue (Next.js, Vercel) ─────┐   ┌───▼──── apps/web (Next.js, Vercel) ────┐
│ "SquadTab Partner Venue (sandbox merchant of record)"       │   │ /  (create plan)  /j/[code] (join)     │
│ TAP verifier (6 steps) · mock key dir /keys/[keyid]    │   │ /console (lanes, X-ray, CREAO, TAP,    │
│ /availability /orders /checkout/[id] /orders/[id]/cancel│   │  ledger, counters, ops buttons)        │
│ /pay/[token] Microform v2 · Cybersource (JWT shared sec)│   └────────────────────────────────────────┘
│ /ops/sweep (timeout reversals, expiry) · outbox → hook │
└───────────────┬────────────────────────────────────────┘
                ▼
     Supabase Postgres:  schema app (agent role)   schema venue (venue role)
CREAO agent.creao.ai: SquadTab Scout, SquadTab Concierge ──(tab CLI: TAB_API_BASE + TAB_AGENT_TOKEN)──▶ apps/agent /agent/*
```

```
/
├─ apps/
│  ├─ agent/            # A owns src/{photon,router,delegates,plan,notify,jobs,join,ops,money,repo,dev}, scripts/seedDemo.ts, fixtures/demo-*.json; B owns src/{creao,decide,agentApi,voice}, fixtures/cached-options/; C owns src/{tap,venueClient}. src/index.ts (foundation, then frozen) calls registerA (src/plan/register.ts), registerB (src/agentApi/register.ts), registerC (src/venueClient/register.ts); each owner mounts routes and due_jobs kinds only in its own register.ts
│  │  ├─ src/index.ts   # Hono app + serve(); starts consumer + poller
│  │  ├─ src/ports/     # MessagingPort, PlannerPort, LLMPort, VenuePort + mocks (foundation)
│  │  ├─ src/dev/       # POST /dev/inbound simulator (MESSAGING_MODE=mock only)
│  │  ├─ src/{plan,agentApi,venueClient}/register.ts  # foundation stubs: (app, jobs) => void
│  │  ├─ fixtures/      # cached-options/*.json, demo-seed.json
│  │  ├─ Dockerfile, fly.toml
│  ├─ venue/            # C owns. Next.js App Router. src/{tap,cybs,pricing-bridge,db,outbox,ids,token,sweep}, app/{pay,api,availability,orders,checkout,keys,ops}, scripts/, test/
│  └─ web/              # B owns. Next.js. app/{page.tsx, j/[code], console}
├─ packages/shared/     # zod contracts (§8). Changes: announce in chat; additive-only after 11 PM
│  ├─ src/index.ts      # public contracts
│  ├─ src/private.ts    # PrivateConstraints (restricted import, P1)
│  ├─ src/pricing.ts    # priceBundle() + constants (used by agent AND venue)
│  ├─ src/tap.ts        # C owns. canonicalConsent, consentFromOrder, signature-base builder. Imports node:crypto: export ONLY via subpath "@tab/shared/tap", never re-export from index.ts (keeps it out of apps/web)
│  ├─ src/templates.ts  # TemplateId enum + vars schemas (copy owned by A)
│  └─ package.json      # exports: ".", "./private", "./tap", "./pricing", "./templates"
├─ skills/tab/          # B owns. SKILL.md + tab (stdlib-only Python 3 CLI) + schema/*.json (generated via z.toJSONSchema)
├─ db/migrations/       # 001_app.sql, 002_venue.sql, 004_pay_links.sql (A), 005+_venue_*.sql (C); db/roles.sql run once via psql
├─ scratch/             # throwaway spikes (git-ignored except README)
├─ docs/PLAN.md, docs/plans/{A-platform-conversation,B-intelligence-experience,C-trust-commerce}.md, docs/research/
├─ CLAUDE.md, AGENTS.md, .env.example, .gitignore, pnpm-workspace.yaml, package.json
```

**Pinned versions** (npm registry, checked Sat 4:25 PM; pin exact with `--save-exact`):

| Package | Version | Notes |
|---|---|---|
| node | 22.x (local 22.20.0) | Fly image `node:22-slim` |
| pnpm | 10.21.0 (local) | `packageManager: "pnpm@10.21.0"` (12.14.0 is 2 days old, so don't use it) |
| @photon-ai/api | 0.5.0 | engines node ≥22; depends on zod ^4.6.5 |
| socket.io-client | 4.8.4 | |
| hono / @hono/node-server | 4.13.13 / 2.1.5 | `streamSSE` from `hono/streaming` |
| @anthropic-ai/sdk | 0.135.0 | peer zod `^3.25 \|\| ^4`; `zodOutputFormat` from `@anthropic-ai/sdk/helpers/zod` |
| zod | 4.6.7 | `z.toJSONSchema` for the CLI schema |
| postgres | 3.4.9 | the venue on Vercel uses `{ prepare: false }` (transaction pooler) |
| pino | 10.4.0 | `redact` paths |
| tsx | 4.23.15 | the agent runs TS directly |
| typescript | 6.0.3 | **not** 7.0.2 |
| vitest | 5.0.5 | needs node ^22.12 |
| next / react / react-dom | 16.4.2 / 19.3.1 / 19.3.1 | 2 days old: if it misbehaves, roll back one patch |
| tailwindcss | 4.3.3 | |
| cybersource-rest-client | 0.0.84 | venue only |
| @notionhq/client | 5.27.1 | fallback only; read the API before use |
| RFC 9421 signing | hand-built + `node:crypto` | no `http-message-sig` (0.3.0 API unconfirmed); no `web-bot-auth` |

---

## 6. Data model (SQL; foundation writes `db/migrations/*`)

```sql
-- 001_app.sql
create extension if not exists pgcrypto;
create schema if not exists app;

create table app.users (
  id uuid primary key default gen_random_uuid(),
  phone_e164 text not null unique,
  first_name text not null,
  photon_user_id text unique,
  payer_ref text not null unique,          -- hmacSha256Hex(PAYER_REF_SECRET, id).slice(0,32) (128 bits; matches ^[0-9a-f]{32}$); the ONLY identity the venue sees
  created_at timestamptz not null default now());

create table app.dm_routes (                 -- reply routing: always reply with these, never a guessed number
  user_id uuid primary key references app.users(id),
  space_id text not null,                    -- inbound message.space.id
  agent_user_id text not null,               -- inbound message.receivedBy.id  → senderId
  agent_number text,
  updated_at timestamptz not null default now());

create table app.assignments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app.users(id),
  photon_assignment_id text not null unique,
  assigned_number text not null,
  created_at timestamptz not null default now(),
  released_at timestamptz);

create table app.plans (
  id uuid primary key default gen_random_uuid(),
  ref uuid not null unique default gen_random_uuid(),  -- opaque; the only plan id CREAO and the venue see
  code char(4) not null unique,
  organizer_id uuid references app.users(id),
  state text not null default 'COLLECTING',
  version int not null default 1,
  title text not null, area text not null, event_date date not null,
  time_start time not null, time_end time not null, party_target smallint not null,
  chosen_bundle_id text, venue_order_id text,
  deadlines jsonb not null default '{}',     -- {vote_at, approve_at} ISO
  created_at timestamptz not null default now(), updated_at timestamptz not null default now());

create table app.participants (
  plan_id uuid references app.plans(id), user_id uuid references app.users(id),
  lane smallint not null,                    -- 1..n, console lane id (no phone on console)
  stage text not null default 'INVITED',
  joined_at timestamptz not null default now(),
  primary key (plan_id, user_id), unique (plan_id, lane));

create table app.private_constraints (       -- P1: read only via repo/privateConstraints.ts
  plan_id uuid references app.plans(id), user_id uuid references app.users(id),
  target_pp_cents int not null check (target_pp_cents between 500 and 100000),
  hard_max_pp_cents int check (hard_max_pp_cents is null or hard_max_pp_cents >= target_pp_cents),
  source text not null check (source in ('dm','tier','form')),
  confidence text not null check (confidence in ('high','low')),
  confirmed_at timestamptz,
  primary key (plan_id, user_id));

create table app.preferences (plan_id uuid, user_id uuid, prefs jsonb not null,
  updated_at timestamptz not null default now(), primary key (plan_id, user_id));

create table app.research_runs (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid references app.plans(id),
  kind text not null check (kind in ('scout','concierge','scout_live_demo')),
  category text check (category in ('dinner','show')),
  attempt smallint not null default 1,
  idempotency_key text not null unique,      -- 8..128 chars
  creao_run_id text unique, thread_id text,
  status text not null,                      -- pending|running|completed|failed|cancelled|timed_out
  source text not null default 'live' check (source in ('live','cached')),
  started_at timestamptz not null default now(), finished_at timestamptz,
  result jsonb);

create table app.options (plan_id uuid, id text, run_id uuid, category text not null,
  data jsonb not null, created_at timestamptz not null default now(), primary key (plan_id, id));

create table app.bundles (plan_id uuid, plan_version int, id text, data jsonb not null,
  all_in_pp_cents int not null, survived boolean not null, shortlist_rank smallint,
  primary key (plan_id, plan_version, id));

create table app.ratings (plan_id uuid, user_id uuid, bundle_id text, score real not null,
  primary key (plan_id, user_id, bundle_id));

create table app.ballots (plan_id uuid, user_id uuid, plan_version int,
  approvals text[] not null, constraints jsonb not null default '[]',
  source text not null check (source in ('digits','delegate')),
  created_at timestamptz not null default now(), primary key (plan_id, user_id, plan_version));

create table app.hold_gates (plan_id uuid, user_id uuid, plan_version int,
  share_amount_cents int not null, status text not null check (status in ('pending','approved','declined')),
  asked_at timestamptz not null default now(), answered_at timestamptz,
  primary key (plan_id, user_id, plan_version));

create table app.due_jobs (
  id bigserial primary key, plan_id uuid, kind text not null, dedupe_key text not null,
  due_at timestamptz not null, payload jsonb not null default '{}',
  attempts int not null default 0, locked_until timestamptz, done_at timestamptz, last_error text,
  unique (kind, dedupe_key));
create index due_jobs_ready on app.due_jobs (due_at) where done_at is null;
-- poll every 1s: select … where done_at is null and due_at<=now() and (locked_until is null or locked_until<now())
--   order by due_at limit 10 for update skip locked

create table app.inbound_events (source text check (source in ('photon','creao','venue')),
  event_id text, received_at timestamptz not null default now(), primary key (source, event_id));

create table app.photon_cursor (id smallint primary key default 1 check (id = 1), seq bigint not null default 0);

create table app.outbound_messages (            -- template id only; never message text (own-budget confirmations stay out of the DB)
  idempotency_key text primary key, user_id uuid, plan_id uuid, template_id text not null,
  photon_message_id text, status text not null, created_at timestamptz not null default now(),
  updated_at timestamptz not null default now());

create table app.events (                       -- SSE source; data validated by SseEvent (no budget fields)
  id bigserial primary key, at timestamptz not null default now(), plan_id uuid,
  type text not null, data jsonb not null);
```

```sql
-- 002_venue.sql
create schema if not exists venue;

create table venue.orders (
  id text primary key,                        -- 'ord_' + 10 base32
  plan_ref uuid not null, plan_version int not null,
  status text not null default 'OPEN',
  bundle jsonb not null, items jsonb not null, party_size smallint not null,
  total_cents int not null, currency char(3) not null default 'USD',
  deadline_at timestamptz not null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (plan_ref, plan_version));

create table venue.shares (
  id text primary key,                        -- 'shr_' + 10 base32
  order_id text not null references venue.orders(id),
  payer_ref text not null, amount_cents int not null,
  status text not null default 'PENDING',
  token_hash bytea not null unique,           -- sha256(token); 128-bit random token, single use
  token_expires_at timestamptz not null, token_used_at timestamptz,
  cybs_payment_id text, card_brand text, card_last4 text,
  updated_at timestamptz not null default now(),
  unique (order_id, payer_ref));

create table venue.customers (                -- TMS tokens only, merchant-scoped
  payer_ref text primary key, cybs_customer_id text not null,
  cybs_payment_instrument_id text, card_brand text, card_last4 text,
  created_at timestamptz not null default now());

create table venue.payment_ops (
  id bigserial primary key,
  share_id text not null references venue.shares(id),
  op text not null check (op in ('auth','capture','reverse','timeout_reverse')),
  attempt smallint not null,
  client_ref_code text not null unique,       -- '<shareId>-<op>-<attempt>'  (≤59 chars)
  transaction_id text not null unique,        -- 30 hex chars (Cybersource maxLength 30)
  cybs_id text, status text not null, http_status int,
  response jsonb,                             -- redacted: never a transient token or PAN
  created_at timestamptz not null default now(),
  unique (share_id, op, attempt));

create table venue.tap_nonces (nonce text primary key, seen_at timestamptz not null default now());
create table venue.outbox (id bigserial primary key, event jsonb not null, attempts int not null default 0,
  delivered_at timestamptz, created_at timestamptz not null default now());
```

```sql
-- db/roles.sql (NOT in db/migrations; run once as postgres: psql "$OWNER_DATABASE_URL" -v AGENT_DB_PW=… -v VENUE_DB_PW=… -f db/roles.sql). UNVERIFIED: custom-role login through Supavisor "role.projectref". Smoke test: psql with each role.
-- Fallback: one role, discipline enforced by tests M1/P1.)
revoke all on schema app, venue from anon, authenticated;
create role tab_agent login password :'AGENT_DB_PW';  grant usage on schema app to tab_agent;
grant all on all tables in schema app to tab_agent; grant all on all sequences in schema app to tab_agent;
create role tab_venue login password :'VENUE_DB_PW';  grant usage on schema venue to tab_venue;
grant all on all tables in schema venue to tab_venue; grant all on all sequences in schema venue to tab_venue;
alter default privileges in schema app   grant all on tables to tab_agent;  alter default privileges in schema app   grant all on sequences to tab_agent;
alter default privileges in schema venue grant all on tables to tab_venue;  alter default privileges in schema venue grant all on sequences to tab_venue;
-- migrations must run as the same owner role (postgres) for these defaults to apply
```

**Connections (Supabase docs, verified):**
- The agent on Fly is persistent: use the Session pooler `aws-<region>.pooler.supabase.com:5432` (IPv4), or direct (IPv6).
- The venue on Vercel is serverless: use the Transaction pooler `…:6543` with `postgres(url, { prepare: false })`.

---

## 7. State machines

**Plan (`app.plans.state`).** Every transition is a conditional UPDATE that bumps `updated_at`, writes `app.events` (`plan.state`) in the same transaction, and returns a row only to the winner.

```
COLLECTING ──(trigger: party_target prefs-done | organizer GO | demo seed)──▶ RESEARCHING
RESEARCHING ──(both categories have options: live|cached; shortlist ≥3)──▶ VOTING
RESEARCHING ──(shortlist <3 after optional re-roll)──▶ CANCELLED  [T_NO_FIT]
VOTING ──(member/constraint change; shortlist differs)──▶ VOTING (version+1, ballots reset, T_PICKS_REFRESH)
VOTING ──(all voted | vote deadline)──▶ ORDERING   [T_WINNER]
ORDERING ──(venue order created)──▶ APPROVING   [holdGate → T_PAY_LINK / T_HOLD_GATE]
APPROVING ──(share.authorized && all shares AUTHORIZED)──▶ COMMITTING
APPROVING ──(I'm out | holdGate NO | approval deadline)──▶ CANCELLING
COMMITTING ──(CommitResult.result='captured')──▶ CONFIRMED  [T_CAPTURED; start Concierge]
COMMITTING ──(rejected by a real verify/business failure)──▶ CANCELLING
CANCELLING ──(venue order CANCELLED)──▶ CANCELLED  [T_CANCELLED to all]
VOTING ──(shortlist <3 after a change)──▶ CANCELLED  [T_NO_FIT]
ORDERING ──(bundle unavailable)──▶ CANCELLED  [T_NO_FIT]
ORDERING ──(I'm out | cancel plan)──▶ CANCELLING
COLLECTING|RESEARCHING|VOTING ──(<2 members remain | ops reset)──▶ CANCELLED
any non-terminal ──(ops reset)──▶ CANCELLED  [no DMs]
SHOWCASE: B's live-Scout showcase row only. It never transitions; the router, Reset and jobs ignore it.
```
Example: `update app.plans set state='COMMITTING', updated_at=now() where id=$1 and state='APPROVING' and version=$2 returning id`.

**Participant (`app.participants.stage`, console lane):**
`INVITED → JOINED → BUDGET_LOCKED → PREFS_DONE → VOTED → GATED? → LINK_SENT → HELD → CAPTURED | RELEASED`. `DECLINED` is reachable from any pre-HELD stage.

**Order (`venue.orders.status`):**
`OPEN → COMMITTING → CAPTURED`. Also `OPEN → CANCELLING → CANCELLED`, and `COMMITTING → NEEDS_ATTENTION` (a capture failed after some succeeded).

**Share (`venue.shares.status`):**
```
PENDING → AUTHORIZING → AUTHORIZED | DECLINED | AUTH_UNKNOWN
DECLINED → PENDING (new token)                AUTH_UNKNOWN → TIMEOUT_REVERSING → RELEASED → PENDING (new token, attempt+1)
AUTHORIZED → CAPTURING → CAPTURED             AUTHORIZED → REVERSING → RELEASED
PENDING → VOID (order cancelled before auth)
```

---

## 8. Shared contracts (`packages/shared`, zod 4)

Everything below crosses an ownership boundary. Field names are final. Changes must be announced; additive-only after 11 PM.

```ts
import * as z from "zod";

// ---------- primitives ----------
export const Cents = z.number().int().nonnegative();
export const HHMM = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const IsoDate = z.iso.date();
export const IsoDateTime = z.iso.datetime();
export const PlanRef = z.uuid();
export const Category = z.enum(["dinner", "show"]);
export const PriceTier = z.enum(["<$25", "$25-50", "$50+"]);
export const DietaryTag = z.enum(["vegetarian","vegan","pescatarian","gluten_free","dairy_free","nut_free","halal","kosher"]);
export const Vibe = z.enum(["casual","lively","quiet","trendy","classic","outdoor","late_night"]);

// ---------- CREAO input (P6: enums/area/date/time/party only) ----------
export const ResearchBrief = z.strictObject({
  category: Category,
  area: z.string().min(2).max(60),              // organizer-set, e.g. "Westwood / Sawtelle"
  date: IsoDate,
  time_window: z.strictObject({ start: HHMM, end: HHMM }),
  party_size: z.number().int().min(2).max(8),
  dietary_tags: z.array(DietaryTag),            // aggregate, sorted, deduped, no identities
  vibe: z.array(Vibe).max(3),
  price_tiers: z.tuple([z.literal("<$25"), z.literal("$25-50"), z.literal("$50+")]),
  count_per_tier: z.literal(4),
});
// sent as CREAO inputs: { plan_ref: string(uuid), category: "dinner"|"show", brief: JSON.stringify(ResearchBrief) }

// ---------- Scout output (wire, from `tab options submit` or result.text) ----------
const ScoutBase = {
  name: z.string().min(1).max(120),
  address: z.string().min(5).max(200),
  area: z.string().max(60),
  url: z.url(),
  price_tier: PriceTier,
  est_low_pp_usd: z.number().int().min(0).max(500),
  est_high_pp_usd: z.number().int().min(0).max(500), // refine: high >= low
  price_evidence_url: z.url(),
  dietary_fit: z.array(DietaryTag),
  pitch: z.string().min(1).max(140),
};
export const ScoutOption = z.discriminatedUnion("category", [
  z.strictObject({ category: z.literal("dinner"), ...ScoutBase,
    opens: HHMM, closes: HHMM, hours_evidence_url: z.url() }),
  z.strictObject({ category: z.literal("show"), ...ScoutBase,
    show_start: HHMM, show_end_est: HHMM, showtime_evidence_url: z.url() }),
]);
export const ScoutSubmission = z.strictObject({
  plan_ref: PlanRef, category: Category,
  options: z.array(ScoutOption).min(6).max(16),     // 4 per tier requested; ≥6 accepted
});

// ---------- internal option / bundle ----------
export const Option = z.strictObject({
  id: z.string(),                       // 'opt_' + sha1(category|name|address)[0:10]
  run_id: z.string(), source: z.enum(["live","cached"]),
  data: ScoutOption,
  est_high_pp_cents: Cents,             // = est_high_pp_usd*100
});
export const Bundle = z.strictObject({
  id: z.string(),                       // 'bnd_' + sha1(dinnerId|showId)[0:10]
  dinner: Option, show: Option,
  dinner_time: HHMM, show_start: HHMM, show_end_est: HHMM,
  all_in_pp_cents: Cents,               // priceBundle(); public (everyone sees the same price)
});
export const PublicBundle = z.strictObject({    // what delegates, fan-out and console see
  id: z.string(), index: z.number().int().min(1).max(3),
  title: z.string(),                    // "Dinner at X → Show at Y"
  dinner_name: z.string(), show_name: z.string(),
  dinner_time: HHMM, show_start: HHMM, show_end_est: HHMM,
  all_in_pp_cents: Cents, dietary_fit: z.array(DietaryTag), pitch: z.string().max(280),
});
export const RateCandidate = PublicBundle.extend({ index: z.number().int().min(1).max(20) });  // rating input only

// ---------- delegate I/O (LLM-facing schemas: only types/enums; code validates ranges after) ----------
export const DelegateInput = z.strictObject({
  user_first_name: z.string(), stage: z.enum(["budget","prefs","ballot","holdgate","free"]),
  message_text: z.string().max(2000),   // this person's own inbound text only
});
export const BudgetParse = z.strictObject({
  target_pp_cents: z.number().int(), hard_max_pp_cents: z.number().int().nullable(),
  confidence: z.enum(["high","low"]),
});
export const Preferences = z.strictObject({        // NO money fields
  cuisines_like: z.array(z.string()).max(5), cuisines_avoid: z.array(z.string()).max(5),
  dietary: z.array(DietaryTag), vibe: z.array(Vibe).max(3),
  earliest_start: HHMM.nullable(), latest_end: HHMM.nullable(),
  dealbreakers: z.array(z.string()).max(3),
});
export const BallotConstraint = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("end_before"), time: HHMM }),
  z.strictObject({ kind: z.literal("start_after"), time: HHMM }),
  z.strictObject({ kind: z.literal("exclude"), index: z.number().int().min(1).max(3) }),
]);
export const BallotParse = z.strictObject({
  approvals: z.array(z.number().int().min(1).max(3)),
  constraints: z.array(BallotConstraint),
  none_of_these: z.boolean(),
  intent: z.enum(["ballot","ask_about_others","other"]),
  confidence: z.enum(["high","low"]),
});
export const Ratings = z.strictObject({
  ratings: z.array(z.strictObject({ index: z.number().int().min(1), score: z.number() })), // clamp [0.05,1] in code
});
export const Ballot = z.strictObject({
  plan_id: z.uuid(), user_id: z.uuid(), plan_version: z.number().int(),
  approvals: z.array(z.string()),       // bundle ids after constraints evaluated in code
  constraints: z.array(BallotConstraint), source: z.enum(["digits","delegate"]), at: IsoDateTime,
});

// ---------- privacy-restricted (packages/shared/src/private.ts; import allowlist P1) ----------
export const PrivateConstraints = z.strictObject({
  plan_id: z.uuid(), user_id: z.uuid(),
  target_pp_cents: z.number().int().min(500).max(100000),
  hard_max_pp_cents: z.number().int().min(500).max(100000).nullable(),
  source: z.enum(["dm","tier","form"]), confidence: z.enum(["high","low"]),
  confirmed_at: IsoDateTime.nullable(),
});

// ---------- venue contracts ----------
export const VenueBundle = z.strictObject({
  bundle_key: z.string(), date: IsoDate,
  dinner: z.strictObject({ name: z.string(), address: z.string(), time: HHMM, est_high_pp_usd: z.number().int() }),
  show:   z.strictObject({ name: z.string(), address: z.string(), time: HHMM, est_high_pp_usd: z.number().int() }),
});
export const OrderItem = z.strictObject({
  kind: Category, name: z.string(), address: z.string(), time: HHMM,
  unit_price_pp_cents: Cents, qty: z.number().int().min(1),
});
export const CreateOrderRequest = z.strictObject({
  plan_ref: PlanRef, plan_version: z.number().int(), bundle: VenueBundle,
  party_size: z.number().int().min(2).max(8),
  payer_refs: z.array(z.string().regex(/^[0-9a-f]{32}$/)),   // length === party_size
  deadline_at: IsoDateTime,
});
export const ShareStatus = z.enum(["PENDING","AUTHORIZING","AUTHORIZED","DECLINED","AUTH_UNKNOWN",
  "TIMEOUT_REVERSING","CAPTURING","CAPTURED","REVERSING","RELEASED","VOID"]);
export const Share = z.strictObject({
  share_id: z.string(), payer_ref: z.string(), amount_cents: Cents, status: ShareStatus,
  cybs_payment_id: z.string().nullable(), card_last4: z.string().nullable(),
});
export const CreateOrderResponse = z.strictObject({
  order_id: z.string(), total_cents: Cents, currency: z.literal("USD"), items: z.array(OrderItem),
  shares: z.array(z.strictObject({ share_id: z.string(), payer_ref: z.string(), amount_cents: Cents,
    pay_url: z.url(), expires_at: IsoDateTime })),
});
export const OrderStatus = z.strictObject({
  order_id: z.string(), plan_ref: PlanRef, plan_version: z.number().int(),
  status: z.enum(["OPEN","COMMITTING","CAPTURED","CANCELLING","CANCELLED","NEEDS_ATTENTION"]),
  total_cents: Cents, shares: z.array(Share), updated_at: IsoDateTime,
});
export const ConsentSet = z.strictObject({                 // body of POST /checkout/{orderId}
  order_id: z.string(), total_cents: Cents,
  shares: z.array(z.strictObject({ share_id: z.string(), cybs_payment_id: z.string(), amount_cents: Cents })),
});
export const TapStep = z.strictObject({ n: z.number().int().min(1).max(6),
  name: z.enum(["tag","params","timestamps","nonce","key","signature"]), ok: z.boolean(), detail: z.string() });
export const TapVerifyReport = z.strictObject({
  route: z.string(), tag: z.string().nullable(), steps: z.array(TapStep),
  business: z.strictObject({ all_authorized: z.boolean(), sum_matches: z.boolean(), consent_matches: z.boolean() }).nullable(),
  accepted: z.boolean(), reason: z.string().nullable(),
  signature_base: z.string(),           // shown on the TAP panel (no secrets)
});
export const CommitResult = z.strictObject({
  order_id: z.string(), result: z.enum(["captured","rejected","partial"]),
  tap: TapVerifyReport,
  captures: z.array(z.strictObject({ share_id: z.string(), status: ShareStatus, cybs_capture_id: z.string().nullable() })),
});
export const VenueEvent = z.strictObject({                 // venue → agent POST /venue/hook
  event_id: z.string(), at: IsoDateTime, order_id: z.string(), plan_ref: PlanRef,
  type: z.enum(["share.authorizing","share.authorized","share.declined","share.auth_unknown",
    "share.released","share.captured","order.captured","order.cancelled","order.needs_attention","tap.verified"]),
  share_id: z.string().nullable(), payer_ref: z.string().nullable(),
  data: z.record(z.string(), z.unknown()),  // per C §3.1: share.authorized {amount_cents, card_brand, card_last4, cybs_payment_id_short ('…'+last 8)}; share.declined {pay_url, expires_at}; share.released {retry, pay_url?, expires_at?}; share.captured {amount_cents, cybs_capture_id_short}; order.captured {total_cents}; order.cancelled {reason}; order.needs_attention {share_ids}. The venue never emits tap.verified. pay_url travels only on this HMAC hook; never written to app.events/SSE/logs
});

// ---------- inbound (normalized Photon event) ----------
export const InboundEvent = z.strictObject({
  event_id: z.string(),                 // Photon event.id (dedupe key)
  seq: z.number().int(),                // delivery metadata.seq (cursor)
  message_id: z.string(),               // pho_msg_…
  platform: z.literal("imessage"),
  from_handle: z.string(),              // sentBy.handle (E.164)
  from_user_id: z.string(),             // sentBy.id
  agent_user_id: z.string(),            // receivedBy.id → reply senderId
  space_id: z.string(),                 // space.id → reply spaceId
  space_kind: z.string(),               // must be "direct"
  content_type: z.string(),             // "text" | "attachment" | …
  text: z.string().nullable(),          // only when content.type==="text"
  parent_message_id: z.string().nullable(),
  received_at: IsoDateTime,
});

// ---------- CREAO ----------
export const CreaoRun = z.looseObject({     // lenient: GET shape field names UNVERIFIED (accept id|runId)
  id: z.string().optional(), runId: z.string().optional(),
  status: z.enum(["pending","running","completed","failed","cancelled"]),
  threadId: z.string().optional(), errorCode: z.string().optional(),
  result: z.looseObject({ text: z.string().optional(), chatText: z.string().optional(),
    artifacts: z.array(z.looseObject({ id: z.string(), title: z.string(), type: z.string(), url: z.string() })).optional(),
  }).optional(),
});
export const ConciergeInput = z.strictObject({ plan_ref: PlanRef,
  itinerary: z.strictObject({ date: IsoDate, area: z.string(), party_size: z.number().int(),
    dinner: z.strictObject({ name: z.string(), address: z.string(), time: HHMM }),
    show: z.strictObject({ name: z.string(), address: z.string(), time: HHMM }) }) });
export const Itinerary = z.strictObject({
  plan_ref: PlanRef, title: z.string().max(120), date: IsoDate,
  stops: z.array(z.strictObject({ kind: Category, name: z.string(), address: z.string(), time: HHMM, notes: z.string().max(400) })),
  logistics: z.strictObject({ getting_there: z.string().max(600), parking: z.string().max(400),
    doors: z.string().max(200), dress_code: z.string().max(200), know_before: z.array(z.string().max(200)).max(6) }),
  ics: z.string().max(20000).startsWith("BEGIN:VCALENDAR"),
  notion_url: z.url().nullable(),
});

// ---------- /agent/* CLI API (Bearer TAB_AGENT_TOKEN) ----------
export const AgentProgress = z.strictObject({ plan_ref: PlanRef, run_kind: z.enum(["scout","concierge"]),
  category: Category.nullable(), step: z.string().min(1).max(140) });
export const ValidationResult = z.strictObject({ ok: z.boolean(),
  errors: z.array(z.strictObject({ path: z.string(), message: z.string() })) });

// ---------- SSE (apps/agent GET /events; id = app.events.id) ----------
const laneStage = z.enum(["INVITED","JOINED","BUDGET_LOCKED","PREFS_DONE","VOTED","GATED","LINK_SENT","HELD","CAPTURED","RELEASED","DECLINED"]);
export const SseEvent = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("plan.state"), plan_id: z.uuid(), from: z.string(), to: z.string(), version: z.number().int() }),
  z.strictObject({ type: z.literal("lane"), plan_id: z.uuid(), lane: z.number().int(), first_name: z.string(), stage: laneStage,
    amount_cents: Cents.nullable(), cybs_id_short: z.string().nullable() }),       // amount = share amount (public), never budget
  z.strictObject({ type: z.literal("creao.run"), run_id: z.string(), kind: z.string(), category: Category.nullable(),
    status: z.string(), elapsed_ms: z.number().int(), source: z.enum(["live","cached"]), share_url: z.url().nullable() }),
  z.strictObject({ type: z.literal("creao.progress"), run_id: z.string().nullable(), kind: z.string(), category: Category.nullable(), step: z.string() }),
  z.strictObject({ type: z.literal("shortlist"), plan_id: z.uuid(), version: z.number().int(),
    from_count: z.number().int(), survived_count: z.number().int(), bundles: z.array(PublicBundle) }),
  z.strictObject({ type: z.literal("vote.tally"), plan_id: z.uuid(), voted: z.number().int(), total: z.number().int() }),
  z.strictObject({ type: z.literal("tap.signed"), order_id: z.string(), method: z.string(), path: z.string(),
    signature_input: z.string(), signature_short: z.string() }),
  z.strictObject({ type: z.literal("tap.verify"), order_id: z.string(), report: TapVerifyReport }),
  z.strictObject({ type: z.literal("ledger"), order_id: z.string(), lane: z.number().int(), status: ShareStatus,
    amount_cents: Cents, cybs_id_short: z.string().nullable() }),
  z.strictObject({ type: z.literal("counters"), groups_converted: z.number().int(),
    fronted_by_individual_cents: z.literal(0), holds_released: z.number().int() }),
  z.strictObject({ type: z.literal("xray"), contexts: z.array(z.strictObject({
    name: z.string(),                   // "scout_input:dinner" | "fanout" | "delegate:lane-2"
    locked: z.boolean(), preview: z.string().nullable() })) }),   // delegates: locked=true, preview=null. Partial list; console merges by name. B emits scout_input:*, A emits fanout + delegate:*
  z.strictObject({ type: z.literal("delivery"), lane: z.number().int().nullable(), message_id_short: z.string(),
    status: z.enum(["accepted","dispatched","delivered","failed"]) }),
  z.strictObject({ type: z.literal("system"), level: z.enum(["info","warn","error"]), msg: z.string().max(200) }),
]);
```

**`priceBundle()`** (`packages/shared/src/pricing.ts`, used by agent filter **and** venue order pricing):
- `all_in_pp_cents = ceilToDollar( dinner.est_high_pp_usd*100*(1 + TAX + TIP) + show.est_high_pp_usd*100*(1 + TAX) )`
- `TAX = 0.1025` (CDTFA Special Notice L-1037: LA County 9.750% → 10.250% from Oct 1, 2026. City of LA by address lookup is **UNVERIFIED**; smoke test: CDTFA lookup for 325 Westwood Plaza, 90095, before 11 PM). `TIP = 0.18`.
- Share = `all_in_pp_cents`; total = share × party_size (no remainder).

**TAP header and consent-digest format** (`packages/shared/src/tap.ts`, used by both signer and verifier):
- Canonical consent JSON: keys in the order `order_id, total_cents, shares`; shares sorted by `share_id` ascending, each `{share_id, cybs_payment_id, amount_cents}`; `JSON.stringify` with no whitespace. **The request body is exactly these bytes.**
- `Content-Digest: sha-256=:<base64(sha256(body))>:` (RFC 9530).
- `Signature-Input: sig2=("@method" "@authority" "@path" "content-digest");created=<unix>;expires=<unix+120>;keyid="<TAP_KEY_ID>";alg="ed25519";nonce="<base64 32 random bytes>";tag="agent-payer-auth"`
- GET availability: components `("@method" "@authority" "@path")`, `tag="agent-browser-auth"`.
- `Signature: sig2=:<base64 Ed25519 signature>:`.
- Signature base (LF-joined, no trailing LF):
  ```
  "@method": POST
  "@authority": <VENUE_PUBLIC_HOST lowercased>
  "@path": /checkout/ord_xxxxxxxxxx
  "content-digest": sha-256=:…:
  "@signature-params": <exact bytes after "sig2=" in Signature-Input>
  ```
- Sign: `crypto.sign(null, base, privateKey)`. Verify: `crypto.verify(null, base, publicKey, sig)` (Ed25519 in `node:crypto`).
- The verifier uses the configured `VENUE_PUBLIC_HOST` for `@authority`, never the incoming Host header.
- The spec minimum is `@authority @path` plus created/expires/keyid/alg/nonce/tag. `@method` and `content-digest` are **our declared extension**; confirm with Visa. The spec examples use label `sig2` and `alg="Ed25519"`, so the verifier accepts alg case-insensitively.

**/agent/\* CLI endpoints** (apps/agent; `Authorization: Bearer <TAB_AGENT_TOKEN>`, compared in constant time). The `plan_ref` must have an active run (`pending|running`, started <20 min ago) of the matching kind, else 403. Max 60 progress posts per run; text control-chars stripped.

| Method / path | Body | Response |
|---|---|---|
| `GET /agent/ping` | — | `200 {ok:true}` (smoke test for Secrets inside API runs) |
| `POST /agent/progress` | `AgentProgress` | `202 {ok:true}`; emits `creao.progress` |
| `POST /agent/options/validate` | `ScoutSubmission` | `200 ValidationResult` (zod is the single source of truth) |
| `POST /agent/options` | `ScoutSubmission` | `201 {ok:true, accepted:n}` / `422 ValidationResult` |
| `POST /agent/itinerary` | `Itinerary` | `201 {ok:true, itinerary_url, ics_url}` |

**Templates** (`TemplateId` enum; copy owned by A; vars zod-typed; money/privacy copy is final):
- `T_JOIN_WELCOME`: "You're in for {title}, {date}. A couple of quick questions, and what you tell me here stays between us."
- `T_BUDGET_ASK`: "What's the most you'd spend per person tonight, all-in? Just between us: nobody in the group, and no other agent, ever sees it."
- `T_BUDGET_CONFIRM`: "Just between us: aim ~${target}, never over ${max}. Text 'change budget' anytime."
- `T_BUDGET_TIERS`: "No problem. Reply 1 (under $25), 2 ($25–50), 3 ($50–80) or 4 (no cap)."
- `T_PREFS_ASK`: "Anything you're craving, can't eat, or want to avoid tonight?"
- `T_STILL_LOOKING`: "Still looking. Checking what's actually open and on tonight."
- `T_PICKS`: "3 plans that work for everyone:\n{lines}\nReply with the numbers you'd be happy with (like '1 3'), or tell me in your own words."
- `T_PICKS_REFRESH`: "The group changed, so here are fresh picks that work for everyone:\n{lines}"
- `T_VOTE_TALLY`: "{k} of {n} voted."
- `T_WINNER`: "It's {title}. Your hold link is coming. Nobody's charged unless everyone's in."
- `T_HOLD_GATE`: "Just between us: your share would be ${amount}, above the max you gave me. Reply YES to hold it anyway, or NO to sit this one out."
- `T_PAY_LINK`: "Your share for {title}: ${amount}. It's a hold, charged only if everyone's in by {deadline}; otherwise it's released. {url}"
- `T_HELD`: "Held ${amount} on {brand} ••{last4}. Not charged yet."
- `T_IN_COUNT`: "{k} of {n} are in."
- `T_REPING`: "Still need your hold for {title} by {deadline}: {url}"
- `T_CAPTURED`: "Everyone's in. You're booked for {title}. Charged ${amount}."
- `T_CANCELLED`: "Plan cancelled. Nobody was charged; your pending authorization was released."
- `T_NO_FIT`: "I couldn't find a plan that works for everyone this time. Want to try another night or area?"
- `T_ONLY_YOURS`: "I only know yours. Everyone's budget stays between them and me."
- `T_CARD_INTERCEPT`: "Please don't text card numbers. I didn't keep it. You'll get a secure pay page when it's time."
- `T_DECLINED_RETRY`: "That card didn't go through (only you see this). Try again: {url}"
- `T_ITINERARY`: "Your night, planned: {itinerary_url} · Add to calendar: {ics_url}"
- `T_ORG_JOIN_STATUS`: "{k} of {n} joined. Reply GO to plan with {k}, or WAIT."

---

## 9. Port interfaces (`apps/agent/src/ports`; every port has a mock, built in the foundation)

```ts
export type DmAddress = { userId: string; spaceId: string; agentUserId: string };

export interface MessagingPort {                       // A. real: @photon-ai/api + socket.io-client. mock: /dev/inbound + console log
  start(onInbound: (e: InboundEvent) => Promise<void>): Promise<void>;   // subscribe(startSeq), save seq only after handler resolves
  sendText(to: DmAddress, text: string, o: { idempotencyKey: string; replyTo?: string }): Promise<{ messageId: string }>;
  setTyping(to: DmAddress, on: boolean): Promise<void>;
  markRead(messageId: string, idempotencyKey: string): Promise<void>;
  assign(handle: string, firstName: string, idempotencyKey: string): Promise<{ assignmentId: string; assignedPhoneNumber: string }>;
  release(assignmentId: string): Promise<void>;
  sendImage?(to: DmAddress, png: Uint8Array, o: { idempotencyKey: string }): Promise<{ messageId: string }>; // stretch (uploadAttachment)
}

export interface PlannerPort {                         // B. real: CREAO REST. mock: fixtures/cached-options after 5 s + fake progress
  startScout(planRef: string, brief: ResearchBrief, attempt: number): Promise<{ runId: string }>;
  startConcierge(input: ConciergeInput): Promise<{ runId: string }>;
  getRun(runId: string): Promise<CreaoRun>;
  cancel(runId: string): Promise<void>;
  downloadArtifact(runId: string, artifactId: string): Promise<Uint8Array>; // follows redirect; never forwards Bearer cross-origin
}

export interface LLMPort {                             // A owns the one adapter (src/delegates/anthropicLLM.ts, one recorder for P5/P7); B owns rate/repair prompts (src/decide/ratePrompt.ts). mock: deterministic canned parses
  parseBudget(i: DelegateInput): Promise<BudgetParse>;          // claude-haiku-5-5
  parsePreferences(i: DelegateInput): Promise<Preferences>;     // claude-haiku-5-5
  parseBallot(i: DelegateInput, shortlist: PublicBundle[]): Promise<BallotParse>; // claude-haiku-5-5
  rateBundles(prefs: Preferences, candidates: RateCandidate[]): Promise<Ratings>;      // claude-sonnet-5-5, effort "low"
  repairScoutJson(raw: string, category: "dinner" | "show"): Promise<unknown>;    // claude-haiku-5-5; Scout text only
}

export interface VenuePort {                           // C. real: TAP-signed fetch. mock: in-memory venue with fake holds
  checkAvailability(bundleKey: string): Promise<{ available: boolean }>;           // GET  /availability/{key}  agent-browser-auth
  createOrder(req: CreateOrderRequest): Promise<CreateOrderResponse>;              // POST /orders              agent-payer-auth
  getOrder(orderId: string): Promise<OrderStatus>;                                 // GET  /orders/{id}         agent-browser-auth
  commit(orderId: string, consent: ConsentSet,
         test?: "tamper" | "replay" | "expired" | "wrong_tag"): Promise<CommitResult>; // POST /checkout/{id}   agent-payer-auth
  cancel(orderId: string, reason: string): Promise<OrderStatus>;                   // POST /orders/{id}/cancel  agent-payer-auth
}
// pure (B, src/decide): compose(options, plan) → Bundle[]; fitsPrefs(bundles, prefs[]) → Bundle[];
//   filter(bundles, constraints) → Bundle[]; effectiveHardMax(c) → cents; selectForRating(bundles) → Bundle[≤15];
//   shortlist(bundles, ratings, constraints) → Bundle[≤3]; pickWinner(shortlist, ballots, ratings, constraints) → bundleId;
//   resolveApprovals(parse: BallotParse, shortlist: PublicBundle[], planTimeStart: HHMM) → bundleId[]  (minutes since plan start, +24 h wrap)
// orchestrators (B, src/decide/score.ts; P1 allowlist, the ONLY place constraints are loaded for decisions):
//   computeShortlist(planId) → { from_count, survived_count, survivors: Bundle[], top3: Bundle[] }  (rates + upserts app.ratings; writes nothing else, emits nothing)
//   computeWinner(planId, version) → bundleId   (shortlist = app.bundles rows with shortlist_rank for that version)
// hooks (final): A → B: startResearch(planId), cancelResearch(planId), startConciergeFor(planId), startLiveScoutDemo()
//                B → A: plan.onOptionsReady(planId)  (enqueues recompute `recompute:<planId>:options`)
// A owns plan transitions, app.bundles writes, the `shortlist` SSE, T_STILL_LOOKING, research-phase typing and every fan-out.
```

**Anthropic call shape** (verified in the claude-api skill):
- `client.messages.parse({ model, max_tokens, system, messages, output_config: { format: zodOutputFormat(Schema), effort: "low" } })`, then read `response.parsed_output`. `parse()` **throws** `AnthropicError` on JSON/zod failure (verified: `@anthropic-ai/sdk@0.135.0` `helpers/zod.js`), so wrap it in try/catch. A throw, a null `parsed_output`, or `stop_reason` `refusal`/`max_tokens` all count as low confidence. Per-call limits go in the second argument: `messages.parse(body, { timeout, maxRetries })`.
- **No `tools`. No assistant prefill (400 on 5.5 models). No forced `tool_choice` (400).**
- Check `stop_reason === "refusal"` and treat it as low confidence.
- Haiku 5.5 effort default is `medium`, so set `low` explicitly. Sonnet 5.5 default is `high`, so set `low`.

---

## 10. External API facts (verified) and how we use them

**Photon 2.0 beta** (`@photon-ai/api@0.5.0` source + local OpenAPI + beta docs):
- Client: `new Photon({ headers: { Authorization: \`Bearer ${PHOTON_API_KEY}\` } })`. Base URL defaults to `https://api.photon.codes`.
- Send: `photon.projects.sendMessage({ path:{id:PROJECT}, headers:{"idempotency-key":k}, body:{ spaceId, senderId, parentMessageId?, content:{ type:"text", format:"plain", text } } })` → 202 SentMessage. Reply with inbound `space.id`, `receivedBy.id` and `id`.
- Typing: `photon.projects.setSpaceTyping({ path:{id, spaceId}, body:{ senderId, typing:true } })`. `true` starts or refreshes typing.
- Read: `photon.projects.markMessageRead({ path:{id, messageId}, headers:{"idempotency-key":k} })`.
- Assign: `photon.projects.platforms.imessage.assignments.create({ path:{id}, headers:{ idempotencyKey:k }, body:{ handle, firstName? } })` → 201 `{assignmentId, assignedPhoneNumber, …}`. Release: `.assignments.release({ path:{id, assignmentId} })` (repeat-safe).
- Agent profile: `photon.projects.agentProfile.update({firstName:"SquadTab"})`; avatar via `createAvatarUpload` + `commitAvatar`.
- Events:
  - Connect: `io("https://api.photon.codes", { path:\`/v1/projects/${id}/events/ws\`, addTrailingSlash:false, transports:["websocket"], extraHeaders:{Authorization:\`Bearer ${key}\`}, autoConnect:false })`.
  - On `connect`: `socket.timeout(10_000).emit("subscribe", { startSeq: saved, apiVersion:"2026-07-01" }, ack)`. `startSeq` 0 = live; a positive value resumes after it.
  - Deliveries arrive as `socket.on("delivery", (event, { seq, replyExpected }) => …)`. Inbound type is `"message.received"`, with `event.data.object` = Message (`content`, `sentBy`, `receivedBy`, `space`).
  - There is no ack callback, so process in order and save the cursor only after success. Redeliveries happen.
- Problems: `SHARED_LINE_CAP_EXCEEDED` 409, `SHARED_LINE_INBOUND_REQUIRED` 403, `SHARED_LINE_NOT_ASSIGNED` 403, `SHARED_LINE_POOL_EXHAUSTED` 503, `SHARED_LINE_GROUP_UNSUPPORTED` 422.

**CREAO** (creao.md is authoritative; docs.creao.ai/pro/api-trigger confirms):
- Base `https://agent.creao.ai`, `Authorization: Bearer capi_…` (account key from Settings → API Keys).
- `POST /api/v1/runs {appId, inputs, webhookUrl, idempotencyKey (8–128), threadId?}` → 202 `{id, status:"pending", appId, appName}`. Fallback route: `POST /api/v1/apps/{appId}/runs`.
- `GET /api/v1/runs/{id}`: poll until `completed|failed|cancelled` (`running` also exists).
- `POST /api/v1/runs/{id}/cancel`.
- Webhook body: `{runId, status, threadId, result:{text, chatText?, artifacts[]}}`, header `X-Creao-Delivery-Id`. Up to 3 attempts, 10 s timeout, unsigned, must be a public URL.
- Artifacts: `GET /api/v1/runs/{runId}/artifacts/download?artifactId=<encoded id>` with the key → redirect to a storage URL (≤1 h; don't forward the Bearer cross-origin).
- Every API run appears in the UI as "[API] …".

**Cybersource** (spec `cybersource-rest-client@0.0.84` + README + samples):
- SDK config: `{ authenticationType:'jwt', jwtKeyType:'SHARED_SECRET', merchantID, merchantKeyId, merchantsecretKey, runEnvironment:'apitest.cybersource.com' }` (HTTP Signature is deprecated).
- Capture context: `POST /microform/v2/sessions {clientVersion:"v2", targetOrigins:[VENUE_PUBLIC_URL], allowedCardNetworks:["VISA","MASTERCARD","AMEX"], allowedPaymentTypes:["CARD"]}` → 201 `application/jwt`. Decode it to get `clientLibrary` + `clientLibraryIntegrity`; never hard-code them. SDK class name for `generateCaptureContext` is **UNVERIFIED**; ask the Cybersource MCP.
- Auth: `PaymentsApi.createPayment` → `POST /pts/v2/payments`.
  - `clientReferenceInformation:{code, transactionId(≤30)}`
  - `processingInformation:{capture:false, actionList:["TOKEN_CREATE"], actionTokenTypes:["customer","paymentInstrument"], authorizationOptions:{initiator:{credentialStoredOnFile:true}}}` (first card, save opted in)
  - `tokenInformation:{transientTokenJwt}`
  - `orderInformation:{amountDetails:{totalAmount:"30.00", currency:"USD"}, billTo:{…}}`
  - `merchantInformation:{merchantDescriptor:{name:"TAB PARTNER VENUE"}}`
- Returning card: `paymentInformation:{customer:{id}}` + `authorizationOptions.initiator:{type:"customer", storedCredentialUsed:true}`, with no TOKEN_CREATE. These field paths exist in the spec; **sandbox acceptance is UNVERIFIED**.
- Capture: `CaptureApi.capturePayment(body, id)` (**body first**) → `POST /pts/v2/payments/{id}/captures`.
- Reverse: `ReversalApi.authReversal(id, body)` (**id first**) → `POST /pts/v2/payments/{id}/reversals {clientReferenceInformation:{code}, reversalInformation:{amountDetails:{totalAmount, currency}, reason}}`.
- Timeout reversal: `ReversalApi.mitReversal(body)` → `POST /pts/v2/reversals` with the original `clientReferenceInformation.transactionId`.
- Status: `GET /tss/v2/transactions/{id}`.
- Test card 4111 1111 1111 1111, any future expiry.
- Holds: Visa Business News AI13522 (effective Apr 2024): 10-calendar-day authorization-to-clearing window for cardholder-initiated card-not-present transactions. We release at our own deadline.

**TAP** (developer.visa.com spec):
- Tags `agent-browser-auth` and `agent-payer-auth`.
- Required: `@authority`, `@path`, created, expires, keyid, alg, nonce, tag.
- Timestamps no more than 8 min apart; created in the past; expires in the future.
- Nonces recorded for 8 min.
- Key lookup by keyid.
- Write our own verifier. The Visa sample is non-conformant: it guards `/product/` only, never checks the tag, and uses a 1 h nonce TTL.

---

## 11. Environment variables (`.env.example` holds names only; values go in Fly secrets / Vercel env / local `.env.local`)

**apps/agent** (Fly `tab-agent`):

| Var | Example / note |
|---|---|
| `PORT` | `8080` |
| `PUBLIC_BASE_URL` | `https://tab-agent.fly.dev` |
| `WEB_ORIGIN` | `https://<web>.vercel.app` (CORS for /join, /plans, /events, /events/snapshot; /ops/* uses `cors({ origin: WEB_ORIGIN, allowHeaders: ["Authorization","Content-Type"], allowMethods: ["POST"] })`, verified Context7 /honojs/website) |
| `DATABASE_URL` | Supabase session pooler :5432, role `tab_agent` |
| `OWNER_DATABASE_URL` | local/CI only: postgres-role URL for migrations; never on Fly or Vercel |
| `MESSAGING_MODE` | `photon` \| `mock` |
| `PHOTON_API_KEY` | `pho_sk_…` (project:read, project:write, platforms:write, platforms:read) |
| `PHOTON_PROJECT_ID` | `pho_prj_…` |
| `PHOTON_API_VERSION` | `2026-07-01` |
| `LLM_MODE` | `anthropic` \| `mock` |
| `ANTHROPIC_API_KEY` | |
| `PLANNER_MODE` | `live` \| `cached` \| `mock` |
| `CREAO_API_KEY` | `capi_…` account key (server only) |
| `CREAO_SCOUT_APP_ID`, `CREAO_CONCIERGE_APP_ID` | from each agent page |
| `CREAO_HOOK_SECRET` | 32+ random chars (path segment) |
| `TAB_AGENT_TOKEN` | 32+ random chars; the same value is stored in CREAO Secrets |
| `VENUE_MODE` | `live` \| `mock` |
| `VENUE_BASE_URL` | `https://<venue>.vercel.app` |
| `TAP_KEY_ID` | e.g. `tab-agent-ed25519-1` |
| `TAP_PRIVATE_KEY_PEM_B64` | base64 of PKCS8 PEM |
| `VENUE_HOOK_SECRET` | HMAC shared with the venue |
| `VENUE_OPS_KEY` | used to call venue `/ops/sweep` |
| `PAYER_REF_SECRET` | HMAC key for `payer_ref` |
| `CONSOLE_KEY` | read-only SSE key |
| `OPERATOR_KEY` | reset, replay, tap-test, seat release |
| `DEMO_TIMERS` | `1` → vote 5 min, approve 10 min, re-ping at T-3 min |
| `AGENT_API_ALLOW_TEST_REF` | `0` (B; `1` only during CREAO agent building) |
| `DEMO_TEAM` | `[{phone_e164, first_name}]` JSON (PII; secret) |
| `DEMO_CODE` | `4821` |
| `TYPING_REFRESH_MS` | `5000` until A's S4 result |
| `TEST_DATABASE_URL` | local/CI only |
| `VOICE_ENABLED`, `ELEVENLABS_API_KEY`, `ELEVENLABS_AGENT_ID`, `ELEVENLABS_PHONE_NUMBER_ID`, `ELEVENLABS_WEBHOOK_SECRET` | voice go only |
| `NOTION_TOKEN`, `NOTION_PARENT_PAGE_ID` | fallback only |
| `LOG_LEVEL` | `info` |

**apps/venue** (Vercel project root `apps/venue`):

| Var | Note |
|---|---|
| `VENUE_PUBLIC_URL`, `VENUE_PUBLIC_HOST` | stable production domain (Microform `targetOrigins`, TAP `@authority`) |
| `DATABASE_URL` | transaction pooler :6543, role `tab_venue`, `prepare:false` |
| `CYBS_MODE` | `live` \| `mock` (defaults to `mock` if unset: always set it explicitly) |
| `CYBS_MERCHANT_ID`, `CYBS_KEY_ID`, `CYBS_SECRET_KEY` | REST shared secret, JWT `SHARED_SECRET` auth. **Primary:** `testrest` plus the public key ID and secret from Cybersource's `cybersource-rest-samples-node` `Data/Configuration.js`; set them in Vercel and `apps/venue/.env.local`, never in tracked files. **Alternate:** the team merchant (blocked, reason 150). Switch matrix and runbook: C plan §0.2. No new variables. |
| `CYBS_RUN_ENV` | `apitest.cybersource.com` |
| `TAP_KEY_DIRECTORY_JSON` | `{"tab-agent-ed25519-1":{"kty":"OKP","crv":"Ed25519","x":"…"}}`, served at `/keys/[keyid]` labelled **mock** |
| `AGENT_HOOK_URL` | `https://tab-agent.fly.dev/venue/hook` |
| `VENUE_HOOK_SECRET`, `VENUE_OPS_KEY` | same values as the agent |
| `PAY_LINK_TTL_MIN` | `1440` (token expiry = `least(now()+TTL, deadline_at)`, so in practice the deadline; still single-use and amount-bound) |

**apps/web** (Vercel project root `apps/web`): `NEXT_PUBLIC_AGENT_URL`, `NEXT_PUBLIC_VENUE_URL`. The console key is passed as `?k=` in the URL and never baked into the bundle.

**CREAO Secrets** (account-wide; dedicated hackathon account): `TAB_API_BASE=https://tab-agent.fly.dev`, `TAB_AGENT_TOKEN`. **Nothing else.**

---

## 12. Accounts and keys checklist

| # | Item | Owner | Notes / done when |
|---|---|---|---|
| 1 | Cybersource sandbox (developer.cybersource.com/hello-world/sandbox) | **C, first** | Activation time **UNVERIFIED**. Merchant ID + REST shared-secret key ID/secret from the Test Business Center |
| 2 | Photon beta project + iMessage channel | A | Dashboard is app.beta.photon.codes (photon.md says app.photon.codes/dashboard; ask). Key `pho_sk_` with project:read/write and platforms:read/write. Assign 3 team phones + 1 spare |
| 3 | CREAO dedicated hackathon account | B | Sign up at agent.creao.ai via the hackathon link and send the email to the booth for Pro Plus. Account `capi_` key. Connect Notion with write setting Auto |
| 4 | Anthropic API key | A | |
| 5 | Supabase project (region near LAX) | A | Session + transaction pooler strings; DB password; roles from 003 |
| 6 | Fly org + app `tab-agent` (region `lax`) | A | `fly apps create tab-agent` |
| 7 | Vercel team + projects `tab-venue` (root apps/venue) + `tab-web` (root apps/web) | C / B | Production domains fixed in hour 1 (Microform needs them) |
| 8 | Public GitHub repo | A | Push the foundation. `.env*` ignored from the first commit |
| 9 | Public GitHub repo `tab-skill` (or `skills/tab` in the main repo; a GitHub URL is required for Install from GitHub) | B | |
| 10 | Notion workspace + "SquadTab Plans" parent page shared with the CREAO connection | B | |
| 11 | Devpost team (all 3 admitted) | B | |
| 12 | Visa Developer account (only if MCP features need OAuth) | C | |
| 13 | ElevenLabs + Photon SMS number + payment method (voice go only) | B | |
| 14 | 3 team iPhones on cellular + 1 borrowed spare; USB cable for mirroring | all | Each sends ≥3 messages to SquadTab before the demo |
| 15 | Secrets shared out-of-band (password manager / DM), never in git or chat logs | all | |

---

## 13. Timeline (PDT) with checkpoints and owners

| Time | Claude (foundation) | A: platform and conversation | B: intelligence and experience | C: trust and commerce | Gate |
|---|---|---|---|---|---|
| **4:25–4:45** | Starts the foundation from this doc | Photon booth (§17); create Photon project and key; Supabase, Fly app, GitHub repo, Anthropic key; DM secrets to Claude's operator | CREAO booth (send the account email for the upgrade); Devpost team; Notion page | Cybersource signup **now**, then the Visa booth; Vercel team and 2 projects | — |
| **4:45–6:00** | Builds: monorepo, shared contracts, migrations, 4 ports + mocks, `/dev/inbound`, due_jobs poller, events + SSE, Fly/Vercel config, `.env.example`, `.gitignore`, CLAUDE.md, AGENTS.md, `pnpm sim:plan` | `scratch/photon/`: Socket.IO echo to own phone; assignment create/release; typing refresh; markRead; record whether name/avatar shows | Build **SquadTab Scout** in the CREAO UI by chatting → Create Agent; write the `tab` skill (SKILL.md + CLI) and install it; curl smoke tests: run with idempotencyKey (replay returns the same run), latency, credits per run | `scratch/cybs/`: auth→capture, auth→reverse, timeout reversal against apitest; capture-context call; Ed25519 keygen + sign/verify spike with `node:crypto` | — |
| **6:00** | Foundation pushed and deployed (Fly + both Vercel); `pnpm sim:plan` green on mocks | pull | pull | pull | **F: foundation** |
| 6:00–6:45 | On call for foundation fixes | Real `PhotonMessaging` + consumer; JOIN through `route()` on a real phone by 7:15 | `/agent/*` live + final skill; Scout calls `tab ping` from an API run (CreaoPlanner 6:35–7:15, webhook/poll 7:15–7:45) | Venue Cybersource service; Microform page on the **production** Vercel URL | — |
| **6:45** | | | | | **Go/no-go:** booth answers in hand; Photon echo on a real phone; Scout returns valid options via the CLI (else result.text); Microform works on a phone (else a labelled sandbox test-card button); voice go/no-go |
| 6:45–11:00 | | Join → delegates (budget, prefs, ballot) → state machine → templates → holdGate call | Compose/filter/score/pickWinner with unit tests; join page; console skeleton (lanes, CREAO lane) | Orders/shares/pay links; 7 pay-page states; COF flags; capture-all/reverse-all; TAP verifier with 6 steps; agent-side signer + VenuePort | — |
| **11:00 PM** | | | | | **Checkpoint 1:** end to end on 2 real phones: join → cached options → ballot → sandbox hold → TAP commit → capture. If red, all 3 swarm it and no stretch work starts |
| 11 PM–4 AM | | Decline/deadline paths, re-ping ladder, card-number intercept, receipt DMs, Reset/Replay, seat release | Real Scout in the loop; Concierge; X-ray; TAP panel UI; counters; `privacy.e2e.test.ts`; voice (if go, hard stop at 2 AM) | Consent digest; tamper/replay/expired/wrong-tag; mock key directory; timeout-reversal sweep; NEEDS_ATTENTION path | — |
| **4:00 AM** | | | | | **Checkpoint 2:** 4 phones (≥1 not a team phone), 3 clean runs in a row, Reset works |
| 4–7 AM | | Copy polish; agent avatar | PNG cards (stretch); README; Devpost text | Pay-page polish; OG image | Rests: C 4:00–5:30, A 5:00–6:30, B 5:30–7:00. Stretch order: threadId re-roll → refund → plan page |
| **7:00 AM** | | | | | **FEATURE FREEZE** (bug fixes only) |
| 7–9:30 | | Drives recordings | Records the 2–3 min video and backup clips; README with both run links and both appIds | Verifies ledger and TAP shots | **Devpost draft submitted by 9:30** |
| 9:30–11:30 | | Table demo ×5, stage ×5, Q&A drill; Reset before and `/ops/release-seats` after each judge | Record backup clips | | |
| **11:30** | | | | | **No deploys after 11:30** |
| **11:45** | | | | | **Final Devpost submit** (12:00 code stop) |

---

## 14. Cut order and never-cut list

**Cut in this order if behind:**
1. Plan page.
2. Refund ("Sam can't make it").
3. threadId re-roll.
4. Voice.
5. PNG cards (use text).
6. Concierge Notion via connector (use code).
7. Concierge entirely (Notion from code; README links one Scout run only).
8. Delegate free-text ballots (use "1/2/3").
9. Budget parse (use tier replies).

**Never cut:**
- Judge self-join.
- Private filter + `privacy.e2e.test.ts`.
- holdGate.
- All-or-nothing holds.
- Decline releases all.
- TAP verify + tamper.
- Scout live run.
- Console ledger.
- Video.

---

## 15. Demo scripts

**Rules:**
- The phone is the hero; the console is the evidence.
- Use cellular or a hotspot, never venue Wi-Fi.
- Before each judge: Reset, pre-warm, 3 team phones in VOTING-ready state.
- The demo seed must contain cached bundles with at least 3 surviving at a $30 cap. Seeding is how the judge's cap changes the shortlist.

### Table version (4–5 min)

| t | Beat | Who | Proof on screen |
|---|---|---|---|
| 0:00 | Press "Start live Scout". Say: "CREAO is researching right now; the options you'll see come from a run that finished earlier." | B | CREAO lane: progress lines from inside the sandbox |
| 0:20 | Zelle hook, then thesis | A | — |
| 0:45 | The judge scans the QR → `/j/4821` → phone + first name → Text SquadTab → `JOIN 4821` → SquadTab asks for a max → the judge texts "honestly 30 tops tonight" → "Just between us: aim ~$30, never over $30." → prefs. The shortlist on the 3 team phones refreshes ("the group changed"), with no reason given. | judge, A | Lanes: judge lane 🔒; shortlist panel v1→v2 |
| 1:45 | The judge replies "2, but not if it ends after 10" → everyone gets "4 of 4 voted" → `T_WINNER` | judge | vote.tally |
| 2:30 | Pay link → Microform → 4111… → "Held $30.00" → team lanes (pre-held or one-tap) → TAP ✓ (6 steps) → all lanes CAPTURED; Concierge itinerary link lands | judge, C | Ledger with real Cybersource IDs; TAP panel; counters |
| 3:30 | Press **Tamper**: rejected at step 6 (digest), nothing captured. Reset; a team phone texts "I'm out" → all lanes RELEASED, every DM reads "Nobody was charged; your pending authorization was released." | C | tap.verify rejected; ledger RELEASED |
| 4:15 | The judge texts "what's Sam's budget?" → "I only know yours." X-ray: Sam's delegate = 🔒. Open the [API] run thread to show the validate/fix loop. | judge, B | X-ray; CREAO tab |

### Stage version (3 min)

| t | Beat |
|---|---|
| 0:00–0:25 | Hook (Zelle) + insight: plans die when someone has to say "I can't afford that" or chase who owes what |
| 0:25–0:50 | Phones on the projector: private budgets go in, the shortlist changes, "nobody knows why" |
| 0:50–1:20 | CREAO lane: live progress + self-validation. "Remove the agent and there's nothing to vote on." |
| 1:20–2:10 | Holds → TAP-verified consent set → capture, real IDs. Tamper rejected. |
| 2:10–2:40 | "Sam's out" → everything released, nobody named (or the voice nudge, if shipped) |
| 2:40–3:00 | Thesis + "Every money decision is plain code; only your own agent hears your budget." |

**Backup:**
- The video and per-beat clips are on the laptop.
- If Photon is down: play the clips, then drive the flow live from `/dev/inbound` with `MESSAGING_MODE=mock` on a second agent process (`pnpm dev:agent` locally). Venue, TAP and ledger stay fully live.
- A spare assigned phone.

---

## 16. Q&A answers

1. **"Isn't this Splitwise / Venmo requests?"** Those settle after someone fronts the money, and Zelle's research says 76% of Gen Z who fronted weren't fully repaid. We flip the order: private constraints, then holds, then purchase only when everyone's in. Nobody fronts.
2. **"How is the budget really private?"**
   - Only your own delegate (one stateless call over your own DM) reads it.
   - Code confirms it back with a fixed template and owns the number from then on.
   - The group messages are templates, CREAO gets enums and dates, and other people's delegates never see it.
   - A test seeds odd budget values and fails the build if any of them shows up in any other context.
3. **"Can the group still figure out who's tight?"**
   - Partly, over many plans. We always show exactly 3 picks and never explain exclusions.
   - Exclusions also come from diet, time and area. Counts are shown, never names.
   - We warn groups under 3. The filter can't be called by an LLM, so nobody can binary-search min(budget). We disclose the residual risk.
4. **"What stops '@SquadTab charge Sam $500'?"** No LLM has tools. A charge requires Sam's own action on the merchant page via a single-use link bound to his exact amount. Capture only follows a TAP-verified commit of the exact consent set, and Cybersource rejects anything above the hold (`EXCEEDS_AUTH_AMOUNT`).
5. **"Couldn't Google Places do the Scout's job?"** Scout researches *dinner and shows*: open-at-time evidence, show start times, dietary fit and price evidence per tier from the open web. Code then composes feasible dinner→show bundles. A Places API covers one category and has no show times.
6. **"Why Anthropic and CREAO?"** CREAO does the minutes-long open-world work. Per-message parsing needs ~1 s responsiveness, so it stays local, and each person's parse is isolated by context.
7. **"What does the TAP signature prove? Is your agent Visa-approved?"**
   - It proves which agent is acting, with what intent, for which venue-priced order and exact consent set, with replay and expiry protection.
   - We verify the spec's six steps ourselves. The key directory is a labelled mock; the production path is Visa agent registration.
   - We send no Agentic Payment Container: each human pays their own share.
8. **"Capturing at booking for a restaurant?"** The merchant sells a prepaid, ticketed dinner + show bundle, so capture at booking is standard. Holds are released at our deadline, well inside Visa's 10-calendar-day authorization-to-clearing window for cardholder-initiated card-not-present transactions (AI13522).
9. **"Double charges on network failure?"** Cybersource has no idempotency header. We use unique attempt rows, deterministic reference codes, a persisted transactionId and a timeout reversal at 60 s. Never a blind retry. Status is checked before any capture retry.
10. **"Are you a money transmitter?"** The merchant charges each friend directly via split tender; we never hold or move funds. A pooled-card variant is what would raise that question. (Not legal advice.)
11. **"Why DMs, not the group chat?"** Money talk only works in private. The group gets only what everyone may see. (Also true: group chats need Photon's paid dedicated line.)
12. **"Why this scoring?"** Maximizing the product of satisfaction means nobody gets a zero, without letting one picky person dominate. A comfort factor nudges toward everyone's target in code only.
13. **"Prior art: Sunday (TreeHacks 2026)?"** Sunday takes a public group budget inside the group chat. We take sealed constraints in private and add an all-or-nothing assurance contract.
14. **"Business model?"** Merchant side: guaranteed group conversion, so a fee per committed group booking. This is a hypothesis, not validated.
15. **"Whose merchant account is this?"** (Visa)
    - The storefront is ours: SquadTab Partner Venue, a demo merchant of record.
    - Processing runs on Cybersource's published sample test merchant (`testrest`). It is shared and test-only, so we send test cards and placeholder billing.
    - Our own sandbox merchant fails at a Cybersource-side processor config (reason 150). Say "waiting on Cybersource" only if the support request was sent.
    - In production the partner venue brings its own merchant account. No Business Center on the shared account: show `check-share.ts` (the TSS lookup) instead.
16. **"Why not just simulate?"** (Visa)
    - We have a labelled simulation as backup.
    - Real sandbox calls show what a mock can't: holds, capture and reversal states, the timeout reversal of an unknown auth, and Microform keeping card data off our servers.
    - It proves integration, not settlement.
    - Quote "Visa said simulation is fine" only if a teammate heard it directly.

---

## 17. Booth questions (by 6:45 PM; record answers in §19)

- **Photon:**
  - How do we enter the iMessage and Voice prizes (they're not on Devpost)? Can one team win both?
  - Does `@photon-ai/api` count as "built on Photon 2.0" (the brief links spectrum-ts)?
  - Is the shared-line pool safe for about 15 judge assignments Sunday?
  - Do the agent-profile name and avatar show on shared lines?
  - Do hackathon credits cover an SMS number for voice?
- **CREAO:**
  - Can we enter only one track? (We assume Disruptor.)
  - Do Secrets and GitHub-installed skills load inside API-triggered runs?
  - Can the README share link be a run we choose?
  - Credits per research run, and a top-up for rehearsals?
  - Can Notion page creation run unattended in API runs?
- **Visa:**
  - Is a labelled mock key directory acceptable?
  - Are `@method` + `content-digest` acceptable as TAP extensions, and is our tag usage right?
  - Is "N cardholder-initiated auths captured all-or-nothing at one merchant of record" the pattern you'd recommend?
  - Do judges weight real Cybersource sandbox transactions?
  - Sandbox activation time?
- **Organizers / Devpost:**
  - Official Applied Intelligence track text?
  - Requirements for Paper, Intuit and MLH ElevenLabs?
  - Can Devpost submissions be edited after a first submit, before noon?

---

## 18. Integration contracts: who calls whom

| Caller → callee | Transport / auth | Contract | Owners |
|---|---|---|---|
| iPhone → Photon → agent | Socket.IO `delivery` (Bearer pho_sk_), cursor `startSeq` | `message.received` → `InboundEvent` | A |
| agent → Photon | REST `sendMessage` / `setSpaceTyping` / `markMessageRead` / assignments (Bearer pho_sk_, idempotency keys) | §10 | A |
| web `/j/[code]` → agent | `POST /join` (CORS WEB_ORIGIN, rate-limited per IP) | `{code, phone_e164 (z.e164), first_name, budget_usd?:{target, hard_max?}, consent:true}` → 200 `{assigned_number, sms_href, join_text}` \| 404 not_found \| 409 plan_closed \| 422 invalid \| 429 \| 503 capacity | B ↔ A |
| web `/` → agent | `POST /plans` | `{title, area, date, time_start, time_end, party_target, organizer:{phone_e164, first_name}}` → `{code, join_url, qr_svg}` | B ↔ A |
| web `/console` → agent | `GET /events?k=CONSOLE_KEY` SSE (`Last-Event-ID` replay) + `GET /events/snapshot?k=` → `{ last_id: number, events: { id: number, data: SseEvent }[] }` (last 500; foundation builds both) | `SseEvent` | B ↔ A |
| console ops → agent | `POST /ops/{reset\|replay\|tap-test\|live-scout\|release-seats}` (Bearer OPERATOR_KEY) | reset: cancel every plan in a non-terminal state (COLLECTING…CANCELLING) (venue cancel → reverse holds, `cancelResearch`, no DMs), free `DEMO_CODE`, `seedDemo()` (new plan row, so a fresh `plans.ref`); replay: reset, then feed `fixtures/demo-script.json` through `route()`; tap-test `{kind}`: C's `runTapTest`; live-scout: B's `startLiveScoutDemo()`; release-seats → `{ok, released}`. All Bearer OPERATOR_KEY; CORS preflight for `Authorization`. | A routes; B UI; C tap-test |
| agent → CREAO | `POST /api/v1/runs`, `GET /api/v1/runs/{id}`, cancel, artifact download (Bearer capi_) | `ResearchBrief`/`ConciergeInput` as inputs; `CreaoRun` | B |
| CREAO → agent | `POST /creao/hook/:CREAO_HOOK_SECRET` (unsigned → re-fetch) | `{runId,…}` → always 200 within 1 s | B |
| CREAO sandbox `tab` CLI → agent | `/agent/*` (Bearer TAB_AGENT_TOKEN, active-run check) | §8 table | B |
| agent → Anthropic | `messages.parse` (no tools) | delegate schemas §8 | A (adapter + delegates), B (rate/repair prompts) |
| agent → venue | TAP-signed HTTPS: `GET /availability/{key}`, `POST /orders`, `GET /orders/{id}`, `POST /checkout/{id}`, `POST /orders/{id}/cancel` | `CreateOrderRequest/Response`, `OrderStatus`, `ConsentSet`→`CommitResult`; cancel body `{"reason": string}`, signed agent-payer-auth with content-digest | C (both sides), A (calls) |
| venue → agent | `POST /venue/hook`, headers `X-Tab-Timestamp`, `X-Tab-Signature: sha256=<hex HMAC(VENUE_HOOK_SECRET, ts + "." + body)>`, reject if skew >300 s; outbox retry | `VenueEvent` | C → A |
| agent due_jobs → venue | `POST /ops/sweep` every 30 s (Bearer VENUE_OPS_KEY) | → `{ok, timeout_reversed, expired_cancelled, outbox_delivered, nonces_purged}`: timeout reversals (AUTH_UNKNOWN >60 s), expired-deadline reversals, stuck REVERSING, outbox redelivery, nonce purge | A ↔ C |
| phone browser → venue | `GET /pay/[token]` (server-rendered, mints capture context); `POST /api/pay/[token]/authorize` | `{transientTokenJwt?, save_card, bill_to}` → page state | C |
| venue → Cybersource | SDK, JWT shared secret | §10 | C |
| verifier → key dir | in-process read of `TAP_KEY_DIRECTORY_JSON`; `GET /keys/[keyid]` publishes the same JWK for judges (labelled "mock Visa key directory") | JWK | C |

---

## 19. UNVERIFIED register: smoke test, then record the result here

| Item | Smoke test | Owner | Result |
|---|---|---|---|
| Photon prize entry and which SDK counts | Booth | A | |
| Agent name/avatar visible on a shared line | `agentProfile.update` + avatar; text from a team phone; look | A | |
| Typing refresh interval | Send typing every 5 s for 60 s; observe the indicator | A | |
| iOS `sms:` prefilled body | Tap the link on 2 iPhones | B | |
| Link rich previews to recipients | Send pay link after 3 exchanges | A | |
| CREAO Secrets + GitHub skill inside API runs | API run of Scout with a `tab ping` instruction → `/agent/ping` hit in logs | B | |
| `idempotencyKey` replay / `threadId` on the hackathon account | Same key twice → same run id | B | |
| CREAO run latency + credits/run | 3 timed runs | B | |
| CREAO GET-run response field names | Log the raw JSON once; adjust `CreaoRun` | B | |
| Python 3 in the CREAO sandbox | Ask in chat: `python3 --version` | B | |
| Notion page create in an unattended run | Concierge test run | B | |
| Cybersource sandbox activation time | — | C | Activated Sat, but **every auth fails** on `lahacksshopexp_1792286686`: 502 SERVER_ERROR; BC reason 150 `usd_outlet_id, usd_terminal_id` on fdiglobal (Cybersource-side). → `testrest` primary, mock backup (C plan §0). Support request sent: [time / link] |
| COF flags accepted (`credentialStoredOnFile`, `type:"customer"` + `storedCredentialUsed`) | Scratch auth with each | C | ✓ testrest: TOKEN_CREATE returns customer + paymentInstrument ids; one-tap 201 AUTHORIZED |
| `merchantDescriptor` rendering | Check the response / Business Center | C | Accepted on testrest; rendering unverifiable (no Business Center) |
| Microform on the Vercel production origin; localhost exception | Load `/pay/test` on a phone | C | `http://localhost` ✓ and `https://*.vercel.app` ✓ as `targetOrigins`; `http://127.0.0.1` and paths → 400. Real browser token → AUTHORIZED (throwaway page). Real `/pay` route on Vercel: **open** (C §0.4 B) |
| Microform JS API (`new Flex(cc)`, `microform.createField`, `createToken`) | Cybersource developer MCP → code sample | C | ✓ live in a browser; v2 token payload has card at `content.paymentInformation.card.number` (no `data`) |
| `cybersource-rest-client` bundling in Next route handlers (may need `serverExternalPackages`) | `next build` on Vercel | C | |
| Required `billTo` fields in sandbox | Auth with name + ZIP + email only | C | `administrativeArea` required (S1); `live.ts` sends placeholders |
| testrest auth scheme | Live auth with C's unchanged config | C | ✓ JWT `SHARED_SECRET` works (no P12); `http_signature` also works, not used |
| 2nd reversal / 2nd capture reason | Repeat the call | C | 400 `MISSING_AUTH` for both (not `AUTH_ALREADY_REVERSED`) → fix C1 |
| Timeout reversal: never-sent `transactionId` | `mitReversal` with an unused id | C | 400 `INVALID_DATA`; known id → 201 REVERSED → fix C2 |
| 2nd timeout reversal of the same `transactionId` | `cybs-smoke.ts` (C10) | C | |
| `DUPLICATE_REQUEST` scope | Same code ± same transactionId | C | Keyed on `transactionId` (60 days); a repeated `code` re-authorizes |
| Cross-merchant transient token | Team context → testrest auth | C | 400 `INVALID_DATA` on `tokenInformation.jti` → flip all CYBS_* together, then fresh links |
| TSS lookup lag | `getTransaction` right after auth | C | 404 at ~1–2 s, 200 at ~3–4 s |
| Vercel redeploy time for a `CYBS_MODE` flip | Timed flip (C §0.4 C) | C | |
| Refund vs void on a same-day sandbox capture (stretch) | Scratch | C | |
| Supavisor login with custom roles | psql with `tab_agent.<ref>` | A | |
| LA sales-tax rate for `TAX` (0.1025 per L-1037) | CDTFA address lookup, 325 Westwood Plaza | B | |
| Applied Intelligence track text | live.lahacks.com/tracks | B | |
