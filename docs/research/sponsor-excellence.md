# Tab: sponsor excellence plan (Sat Oct 17, 4:05 PM → Sun 11:45 AM submit)

Authority order:
1. The user's pasted CREAO Tech Stack page, together with the local briefs.
2. The judge panel.
3. The researcher reports.

Anything marked UNVERIFIED must be smoke-tested or asked at the booth before anyone builds on it.

---

## 1. Final decisions

- **Channels.** iMessage DMs only, on free Photon 2.0 shared lines (`@photon-ai/api@0.5.0` + Socket.IO). Voice on a Photon SMS number via ElevenLabs is a gated stretch. No Slack: it is not a Photon channel ("coming later in 2026"). No Telegram: group support on 2.0 is undocumented and it would dilute the iMessage story. No SMS messaging: it needs 10DLC.
- **Framing.** Thesis: *"Say no without saying why. Nobody pays until everyone's in."* Pitch line: *"Tab is the friend who knows everyone's budget and tells no one. It finds the plan you can all afford, and nobody pays until everyone's in."* Product line: "Tab never joins your group chat, on purpose. Money talk only works in private."
- **Privacy and LLM boundary.** Isolation by context, not by instruction or regex.
  - Each friend has a **private delegate**: a stateless Anthropic call over that person's own DM only. It may read their budget ("60ish, could stretch to 80") into `{target_pp_cents, hard_max_pp_cents|null, confidence}`.
  - Code confirms the parsed budget back with a fixed template and owns every number from then on.
  - No other person's delegate, no CREAO input, no fan-out text, log or console ever holds that person's budget.
  - **No group-coordinator LLM.** Every group-facing message is a template plus Scout copy.
  - The filter is a pipeline step, never a tool an LLM can call.
  - Regex number-stripping is deleted. A value-specific payload test replaces it.
- **Primary CREAO track.** Best AI-First Disruptor ($2,000). Team Empowerment only if the booth explicitly allows a second CREAO track: creao.md says "Pick the track that fits" (singular).
- **Prizes to enter.**
  - Main track: Applied Intelligence. Its official text is UNVERIFIED; check live.lahacks.com/tracks.
  - Overall.
  - Visa.
  - CREAO Disruptor.
  - Photon iMessage. The entry mechanism is UNVERIFIED: it is not on Devpost, so ask the booth.
  - Only if voice ships: Photon Best Voice Agent and MLH Best Use of ElevenLabs.
  - Check requirements, and enter only if we already qualify as-is: Paper Best Designed Hack, Intuit.
  - Skip Base44, Cognition/Devin and Workday. They are another platform or another product (requirements UNVERIFIED, no pivot).

---

## 2. Per-sponsor plans

### 2.1 Photon (iMessage $700/$300; Voice $400 stretch)

| Requirement (photon.md) | How we exceed it | Where it shows |
|---|---|---|
| Built on Photon 2.0 | `@photon-ai/api@0.5.0` against `api.photon.codes/v1`, Socket.IO events with a persisted replay cursor. The brief's SDK link points at spectrum-ts (Stable): confirm at the booth which counts. | Photon lane on the console; app.beta.photon.codes dashboard in a second tab |
| Live on at least one Photon channel | Live iMessage DMs. Judges join from **their own phones**: assignments are created by API, and the free tier allows 25 seats, released with `DELETE …/assignments/{id}` after each judge. | Judge scans the QR code and is in a DM within about 60 s |
| Vision: hybrid intelligence | A private delegate per friend, a code mechanism between them, humans keep the final yes. Say "delegates submit sealed constraints to a mechanism", never "agents negotiate". | Context X-ray panel |
| Craft: responsive | Typing indicator within about 1 s, refreshed every ~5 s during multi-minute CREAO runs (interval tuned empirically). Mark-as-read on receipt. Threaded replies (`parentMessageId`). Agent profile "Tab" with avatar (visibility on shared lines UNVERIFIED). PNG option cards once the plain-text version works. | Judge's phone |
| Depth: edge cases | Shared-line rules handled: the user texts first, the number can differ per user, `SHARED_LINE_*` errors, idempotent sends keyed `reply:<inboundId>`, Socket.IO replay. Escalation ladder: re-ping at T-30m → voice at T-15m (if shipped) → release all holds at the deadline. | Decline/deadline beat |
| Traction: real users tomorrow | No app install and no group app; it works with the friend group you already have. | Judge onboarding |
| "Agent that remembers the call" (voice) | Stretch: an outbound ElevenLabs nudge to the last holdout with `dynamic_variables`. The HMAC-verified `post_call_transcription` webhook writes a one-line summary into that person's iMessage DM. Voice collects intent only; money moves only on a text YES. | Stage beat, if shipped |

**Showstoppers**
1. **A judge joins from their own iPhone** with a secret $30 cap. The shortlist changes silently and nobody, including the team, can see why.
2. **Red-team:** the judge texts "what's Sam's budget?" and gets back "I only know yours." The context X-ray shows Sam's lane as a lock icon.
3. (Stretch) **Tab calls the holdout**, then texts "Per our call: you're in if we start by 8. Reply YES to hold $58."

**Deliberately skipped**
- Native polls, tapbacks, edit-in-place, unsend and effects: they are not in the 2.0 iMessage content union (verified).
- Group chats: they need a dedicated line on the paid Business tier.
- spectrum-ts: unless the booth says Stable counts.
- Telegram and Slack: dilute the story; Slack isn't a channel.
- Prefilled `sms:` body as the only path: iOS behaviour is UNVERIFIED, so the code is also shown in plain text.

### 2.2 CREAO (Disruptor $2,000)

| Requirement | How we exceed it | Where it shows |
|---|---|---|
| At least one CREAO agent does the core work | **Tab Scout** produces every option the group can vote on. **Tab Concierge** writes the itinerary, a hosted .ics and the Notion plan after the commit. Code only filters, composes and scores. | "Remove the agent and Tab has nothing to vote on" (said out loud) |
| Built on agent.creao.ai | Both agents built by chatting, then Create Agent. The `tab` CLI is saved via Update Environment → Save to Agent. | [API] thread open in a second tab |
| README: run share link + agent ID | Share links to one Scout and one Concierge run, both seeded from a **PII-free** plan (the link exposes the full conversation, verified). Plus both appIds, the public skill repo and the exact API calls. | Devpost README |
| Show the agent running | A fresh Scout run starts at second 0 of every demo. Agent-posted `tab progress` lines stream into the console. A pre-warmed completed run is used for the flow, and we say so. | CREAO lane |
| Disruptor building blocks | API Trigger with webhook (re-fetch to verify) plus polling, `idempotencyKey`, `threadId` re-roll (stretch), artifacts. Our own tools (mode B: public SKILL.md repo plus saved CLI). Our services via Secrets (mode C: narrow `TAB_AGENT_TOKEN`). Notion connector. | Run chips: runId, status, elapsed time |
| Rubric: AI foundation 30 / Depth 25 | Agent self-validation: it writes options.json, runs `tab options validate`, fixes errors and runs `tab options submit`. This turns "no structured output" into visible depth. | Run thread shows the validate/fix loop |
| Keys on server; unsigned webhooks | The capi_ **account** key lives only in a Fly secret. Webhook at `/creao/hook/:pathSecret`; dedupe on runId and X-Creao-Delivery-Id; act only on `GET /api/v1/runs/{id}`; poll every 15 s; 6-minute timeout → cached options. | (Q&A) |
| Credits | Only the backend starts runs. Per-plan run cap. `idempotencyKey` per step. | (Q&A) |

**Answer to "couldn't Google Places do this?"** Scout researches *dinner and shows*. It returns open-at-time evidence URLs, show start times, dietary fit and price evidence per tier from the open web. Code then composes feasible dinner→show bundles. A Places API covers one category and has no show times. The pitch line: "CREAO does the open-world work; fast per-message parsing stays local for responsiveness."

**Showstoppers**
1. A live run's progress lines appear on our console from inside the CREAO sandbox: "Checking 9 Sawtelle spots open at 6:30…".
2. The run thread shows the agent failing our schema check, fixing it and submitting.
3. After the commit, Concierge drops the itinerary and Notion page into everyone's DM as a link.

**Deliberately skipped**
- Browser Use: unverified in API runs, slow and metered.
- Concierge on the critical path (venue quotes from an agent would be theater).
- Agent-to-agent calls and /workflow: latency and credits.
- Scheduled runs and a Watcher agent: they only serve Team Empowerment.
- The developer.creao.ai/cr_sk_ path: the hackathon page specifies agent.creao.ai/api/v1 with capi_.

### 2.3 Visa ($2,000)

| Requirement (visa.md) | How we exceed it | Where it shows |
|---|---|---|
| Transform shopping stages | Five stages end to end: discovery (CREAO), decision (private ballot + Nash shortlist), personalization (private caps), checkout/payments (split-tender authorizations + TAP commit), post-purchase (receipt DMs; refund as a stretch). | Whole demo |
| Innovation 25 | A group purchase as an assurance contract at the merchant of record. N cardholder-initiated authorizations; an identified agent can commit **only the exact consent set**. | TAP panel |
| UX 25 | Everything in iMessage. One Microform page for the first card; later plans are one tap (TMS token + correct COF flags). Seven designed pay-page states. | Judge pays with the test card |
| Tech 20 | Real Cybersource sandbox calls: authorization with `capture:false` + TOKEN_CREATE, capture, reversal, timeout reversal by transactionId. Our own RFC 9421 Ed25519 signer and 6-step verifier: strict 8-minute window, nonce store, `content-digest` over `{orderId,total,sorted[{shareId,cybsPaymentId,amount}]}` recomputed from the venue DB. | Ledger with real IDs |
| Commerce Impact 15 | Three live merchant counters from our own data: groups converted all-or-nothing, $ fronted by any individual ($0), holds released on failed plans. No invented statistics. | Console |
| Trust 15 | **holdGate:** a share above a person's hard_max needs a private yes (the "spending limits" idea). Card data only in Microform iframes. Single-use, amount-bound pay links. Live tamper, replay, expired and wrong-tag rejections. Key directory labelled "mock". "Released" wording. | Tamper button; holdGate DM |

**Merchant honesty (required):**
- The demo merchant is **"Tab Partner Venue (sandbox merchant of record)"**. It sells a **prepaid, ticketed dinner + show bundle**, so capture at booking is normal practice.
- Never put a real restaurant's name or brand on the pay page.
- Pitch: "CREAO finds real options; partner merchants integrate Tab checkout; this demo merchant is ours."

**TAP tags (our interpretation; confirm at the booth):**
- `agent-browser-auth` on the venue availability and price GET.
- `agent-payer-auth` on `POST /orders` and `POST /checkout/{orderId}`.
- Say explicitly: "We send no Agentic Payment Container. Each human pays their own share. The agent's signature only proves which consent set it may commit."

**Showstoppers**
1. Ledger lanes go HELD → TAP ✓ → CAPTURED, with real Cybersource IDs.
2. **Tamper:** change one share by $1. The content-digest no longer matches, the request is rejected and nothing is captured.
3. **One "I'm out":** every lane goes RELEASED, and each DM reads "Plan cancelled. Nobody was charged; your pending authorization was released." Nobody is named.

**Deliberately skipped**
- ICC/VARS, 3DS, Decision Manager, network tokens, Unified Checkout and Click to Pay: gated or pilot. They go on a "production path" slide.
- Loyalty: cosmetic.
- "$0 instantly" wording: the issuer controls when the pending item disappears.

### 2.4 Main track (Applied Intelligence, UNVERIFIED text) and Overall

| Requirement | How we meet it | Where it shows |
|---|---|---|
| Devpost with the track and challenges selected, public repo, 2–3 min video, whole team in person | Draft submitted by 9:30 AM, final by 11:45. The video doubles as the backup demo. | — |
| Technical Depth | Context-isolation boundary; filter as a non-callable step (blocks binary-search attacks on min(budget)); exactly-once commit state machine; TAP verifier. | Q&A |
| Product Thinking & Impact | Plans die at two moments of exposure: saying what you can afford, and chasing who owes what. Zelle hook, verbatim (June 30, 2026, Accelerant Research with Early Warning Services): "76% of Gen Z consumers who have fronted money for a group expense, like a trip or event, say they were not fully repaid" and "20% … have canceled plans, muted or ignored group chats to avoid repayment." Cite it as "Zelle research". | First 30 s |
| Originality & Insight | Pre-empt the prior art. Sunday (TreeHacks 2026) takes a public group budget; PayByGroup (2012) and Airbnb split pay (2017) know nothing about constraints. Tab combines sealed constraints with the assurance contract. | Q&A |
| Execution & Polish | Everything above works three times in a row by 4 AM; scope is cut before polish. | Every demo |

**Showstoppers**
- The insight in 30 seconds.
- The judge becomes a user.
- Zero failed beats.

**Skipped:** dense vocabulary on stage. No "Nash welfare", "RFC 9421" or "advocates" unless asked.

---

## 3. Architecture deltas vs `i-need-you-to-misty-gizmo.md`

**Changes**
1. **§1 row 1:** drop "ask for a dedicated line / group announcements" and the group-space path entirely.
2. **§1 row 3 and §3 step 6:** native DM poll → option list or PNG cards plus "reply 1/2/3", or free text ("the sushi one, but not after 9") parsed by the person's delegate into zod `{approvals[], constraints[]}`. Low confidence → one clarifying question.
3. **§1 row 5, §3 step 3, line 6:** regex stripping and form-only budgets → private delegate with a budget object written only to `private_constraints`.
   - Template confirmation: "Just between us: aim ~$60, never over $80. Text 'change budget' anytime."
   - Fallback is tier replies (1–4 mapped to a fixed hard_max in code).
   - The budget field on the join page becomes optional.
4. **§3 step 4:** remove the "status bubble edited in place". Live progress shows on the console; DMs get typing refresh and at most one "still looking…" text after 90 s.
5. **§3 step 5, scoring:**
   - Two parallel Scout runs (dinner, show).
   - Code composes bundles: dinner open at T, show start in [T+1.5h, T+2.5h], same area.
   - Hard filter: all-in per person = price × (1+tax) + tip ≤ every member's hard_max. Tax and tip are config values; the LA rate is UNVERIFIED, so confirm it.
   - Each delegate rates the surviving bundles for its own person (prefs only).
   - Code picks 3 diverse bundles by Nash welfare, with a code-only comfort factor against target.
   - The winner is the most approvals, ties broken by Nash.
6. **§3 step 8:** add **holdGate** before any pay link is sent: share ≤ hard_max, or a private yes.
7. **§3 step 9:** Researcher + Scribe → **Scout + Concierge**. Concierge runs only *after* the commit, asynchronously. The itinerary is hosted by us, because artifact URLs need auth (`GET /api/v1/runs/{id}/artifacts/download`). The .ics is a hosted URL, not an iMessage attachment (non-image attachments UNVERIFIED). Fallback: `@notionhq/client` from code.
8. **§4 pay page:** "Otherwise $0" → "Charged only if everyone's in. Otherwise your hold is released." The merchant is labelled "Tab Partner Venue (sandbox)". The product is a prepaid ticketed bundle.
9. **§4 console:** the privacy panel becomes a per-context **Context X-ray** (Scout input, fan-out text, each delegate shown as a 🔒). Add three merchant counters, a delivery-lifecycle lane (accepted/dispatched/delivered/failed) and an "Open run" link.
10. **§5 CREAO client:** base `https://agent.creao.ai`, `POST /api/v1/runs` with appId in the body (fallback `POST /api/v1/apps/{appId}/runs`), capi_ account key. Env: `CREAO_API_KEY`, `CREAO_SCOUT_APP_ID`, `CREAO_CONCIERGE_APP_ID`, `CREAO_HOOK_SECRET`, `TAB_AGENT_TOKEN` (also stored in CREAO Secrets).
11. **Cybersource:**
    - First authorization: `initiator.credentialStoredOnFile=true`.
    - Token-based authorizations: `initiator.type=customer` and `storedCredentialUsed=true`. Verify the exact paths with the Cybersource MCP or samples first.
    - Set `merchantDescriptor`.
12. **TAP:** enforce created→expires ≤ 8 min (the spec's own sample shows 60 min). 8-minute nonce store. `@method` and `content-digest` are added as our declared extension.

**Removed as overengineering:**
- Group-coordinator LLM.
- Regex number guard and the runtime outbound budget matcher.
- Recurring CREAO schedule and Watcher agent.
- Browser Use.
- CREAO realtime stream and the cr_sk_ path.
- Concierge venue-quote calls.
- Team Empowerment work.
- Loyalty.
- Read-only Plan page (moved to the stretch list).
- "Cover the gap".
- Slack and Telegram.
- The spectrum-ts swap, unless the booth says otherwise. `MessagingPort` stays; it is cheap.

---

## 4. CREAO agent definitions

### Tab Scout (saved agent; appId → `CREAO_SCOUT_APP_ID`)

- **Inputs** (form text fields):
  - `plan_ref`: opaque UUID.
  - `category`: dropdown, `dinner|show`.
  - `brief`: JSON string with area, date, time_window, party_size, aggregate dietary tags (no identities), vibe keywords, `price_tiers:["<$25","$25-50","$50+"]` per person, `count_per_tier:4`.
  - **No names, phone numbers or budgets.**
- **Instructions summary:**
  - Research real, currently operating options with web search and fetch. For each: name, address, URL, est_low/high per person, open-at-time or showtime evidence URL, dietary fit, one-line pitch.
  - Call `tab progress <plan_ref> "<step>"` at each step.
  - Write options.json and loop `tab options validate` until it passes, then `tab options submit`. Print the same JSON as the final message.
  - Never ask questions, never save memories, never contact venues, never print environment variables.
- **Tools, skills and secrets:**
  - Built-in web search and fetch.
  - The public GitHub skill `tab` (SKILL.md plus a stdlib-only Python CLI with the bundled schema), also saved into the environment.
  - Secrets `TAB_API_BASE` and `TAB_AGENT_TOKEN`. The token is revocable and bound to a plan_ref with an active run. It can only reach `POST /agent/progress`, `POST /agent/options` and `POST /agent/itinerary`.
  - Use a dedicated hackathon CREAO account, because Secrets are account-wide.
- **Outputs:** options submitted via the CLI (primary), plus `result.text` JSON (fallback, zod-validated with one repair attempt).
- **API calls:**
  - `POST /api/v1/runs {appId, inputs:{plan_ref,category,brief}, webhookUrl:"https://<agent>/creao/hook/<secret>", idempotencyKey:"plan-<id>-scout-<cat>-r<n>"}`, twice in parallel.
  - `GET /api/v1/runs/{id}`: on each webhook, and as a 15 s poll.
  - `POST /api/v1/runs/{id}/cancel` when a plan is cancelled.
  - Stretch: on "none of these", the same Scout with `threadId` and "propose 4 new, avoid repeats".

### Tab Concierge (saved agent; appId → `CREAO_CONCIERGE_APP_ID`)

- **Inputs:** `plan_ref`, plus `itinerary` (JSON string: the winning bundle's names, addresses and times, party_size, area; no person data).
- **Instructions summary:**
  - Research the logistics: transit and parking, doors time, dress code, what to know.
  - Produce an `itinerary.html` artifact and the plan.ics content.
  - Create a Notion page under the "Tab Plans" parent (write setting **Auto**).
  - Post progress, then run `tab itinerary submit`. Never pay, sign or contact anyone. No memories.
- **Tools:** web search and fetch, the Notion connector, the `tab` skill, the same Secrets.
- **Outputs:** the itinerary JSON and HTML via the CLI, artifacts, and the Notion URL.
- **API calls:** `POST /api/v1/runs {appId, inputs, webhookUrl, idempotencyKey:"plan-<id>-concierge"}` after the commit; re-fetch and poll as for Scout; download artifacts through the authorized download route.

---

## 5. Build order (3 people)

**Owners**
- **A, platform and conversation:** Photon, join, delegates, state machine, ballots, due_jobs, templates, holdGate call, Reset/Replay. Drives the live demo.
- **B, intelligence and experience:** the CREAO agents, `tab` skill/CLI and client; the filter, compose and Nash pure functions; join page and console UI; README, Devpost and video; voice if it is a go.
- **C, trust and commerce:** the venue app, Cybersource, the Microform pay page, orders/shares/pay links, TAP signer and verifier, consent digest, TAP panel. Leads the Visa pitch.

| Time | Work / gate |
|---|---|
| **4:05–4:35 PM** | C signs up for the Cybersource sandbox at 4:05 (activation time UNVERIFIED), then goes to the Visa booth. A goes to the Photon booth; B to the CREAO booth (send the account email for the Pro Plus upgrade). Create accounts: Photon beta dashboard, CREAO, Anthropic, Supabase, Fly, Vercel, Devpost team. |
| 4:35–4:55 | Contracts: zod types (Option, Bundle, Ballot, PrivateConstraints importable only by delegate, filter and holdGate), TAP header plus consent-body format, SSE event shape. |
| 4:55–6:45 | **A:** monorepo, migrations, Fly deploy, Photon Socket.IO echo on a real phone; assignment create/delete; typing and read; one test send each of poll, reaction and text.update to record whether UNSUPPORTED_CONTENT comes back. **B:** build Scout plus the `tab` skill repo. Smoke tests: idempotencyKey replay, Secrets and skill inside an API run, webhook to the Fly URL, latency, credits per run. **C:** auth→capture, auth→reverse and timeout-reversal script against apitest; Microform v2 on the HTTPS origin; Ed25519 signature-base spike. |
| **6:45 PM go/no-go** | Booth answers in hand. Photon echo works. Scout returns valid options via the CLI (else fall back to result.text). Microform works on a phone (else a labelled sandbox test-card button as a degraded path). Voice is a go only if a card is on Photon **and** B is on schedule. |
| 6:45–11:00 | **A:** join → delegate (budget parse, template confirmation, prefs, ratings, ballot parse) → state machine → templates. **B:** CREAO client (webhook re-fetch, poll), filter/compose/Nash with unit tests, join page, console skeleton. **C:** orders and shares, pay page with 7 states, COF flags, capture-all/reverse-all, TAP verifier with 6 steps. |
| **11:00 PM checkpoint** | End to end on 2 real phones: join → cached options → ballot → sandbox hold → TAP commit → capture. If it fails, all three swarm it; no stretch work starts. |
| 11 PM–4 AM | **A:** decline and deadline paths, due_jobs ladder, holdGate DM, card-number Luhn intercept, receipt DMs. **B:** real Scout in the loop, Concierge, console lanes, X-ray, CREAO lane, merchant counters, payload privacy test. **C:** consent digest, tamper/replay/expired/wrong-tag buttons, mock key directory, timeout reversal wired in. **Voice (B, if go):** ElevenLabs inbound per cookbook, then outbound plus transcript → DM. Hard stop for voice at 2 AM if the SIP echo call fails. |
| **4:00 AM checkpoint** | 4 phones, at least one not a team phone, 3 clean runs in a row. Reset/Replay works. |
| 4–7 AM | Polish (copy, PNG option cards, avatar). Stretch in order: threadId re-roll → "Sam can't make it" refund (test void vs refund first) → Plan page. Staggered 90-minute rests: C at 4:00, A at 5:00, B at 5:30. |
| **7:00 AM** | **Feature freeze.** |
| 7–9:30 | B records the 2–3 min video and backup clips. README with both run share links, both agent IDs and the skill repo. **Devpost draft submitted by 9:30** (main track, Visa, CREAO Disruptor; Photon and others per the booth). |
| 9:30–11:30 | Table version ×5, stage version ×5, Q&A drill. Release judge-test assignments. **No deploys after 11:30. Final submit by 11:45.** |

**Cut order if behind:**
1. Plan page
2. Refund
3. threadId re-roll
4. Voice
5. PNG cards (use text)
6. Concierge Notion via connector (use code)
7. Concierge entirely (Notion from code; README links one Scout run only)
8. Delegate free-text ballots (use "1/2/3")
9. Budget parse (use tier replies)

**Never cut:** judge self-join, private filter plus payload test, holdGate, all-or-nothing holds, decline releases all, TAP verify plus tamper, Scout live run, console ledger, video.

---

## 6. Demo beats

The phone is the hero; the console is the evidence. Mobile data or a hotspot only.

### Table version (4–5 min)

1. **0:00** Start a live Scout run. "CREAO is researching right now; the options you'll see come from a run that finished 3 minutes ago." Point to progress lines arriving in the CREAO lane.
2. **0:20** The insight and the Zelle line.
3. **0:45** The judge scans the QR code, enters a phone number, taps Text Tab and texts "60ish, never over 30 tonight". Tab confirms: "Just between us…" The shortlist on the 3 team phones changes silently.
4. **1:45** The judge replies "2, but not if it ends after 10". Every phone gets "4 of 4 voted", the winner is announced.
5. **2:30** Pay link → Microform → test card. The judge's lane shows HELD with a real Cybersource ID. The other lanes, pre-held, follow. TAP panel ✓. CAPTURED. Concierge itinerary link lands in the DMs.
6. **3:30** Press **Tamper**: rejected, nothing captured. Reset; a team phone texts "I'm out"; all lanes RELEASED; "Nobody was charged."
7. **4:15** The judge texts "what's Sam's budget?" → "I only know yours." X-ray: Sam = 🔒. Open the [API] run thread to show the validate/fix loop.
8. (Voice, if shipped) An ElevenLabs call rings a team phone and the summary appears in its DM.

### Stage version (3 min)

1. **0:00–0:25** Hook and insight.
2. **0:25–0:50** Phones on the projector: private budgets go in, the shortlist changes, "nobody knows why".
3. **0:50–1:20** CREAO lane: live progress from the sandbox and the self-validation. "Remove the agent and there's nothing to vote on."
4. **1:20–2:10** Holds → TAP-verified consent set → capture, with real IDs. Tamper rejected.
5. **2:10–2:40** "Sam's out" → all released. Or the voice nudge with call memory, if shipped.
6. **2:40–3:00** Thesis line plus "every money decision is plain code; only your own agent hears your budget."

---

## 7. Booth questions still worth asking (by 6:45 PM)

**Photon**
- How do we enter the iMessage and Voice prizes, given they aren't on Devpost? Can one team win both?
- Does `@photon-ai/api` count as "built on 2.0" (the brief links spectrum-ts)?
- Is the shared-line pool safe for about 15 judge assignments on Sunday?
- Do the agent profile name and avatar show on shared lines?
- Do hackathon credits cover an SMS number for voice (no 10DLC needed for voice)?

**CREAO**
- Can we enter only one track? (We assume Disruptor.)
- Do Secrets and GitHub-installed skills load inside API-triggered runs?
- Can the README share link be a run we choose?
- Credits per research run, and a top-up for rehearsals?
- Can Notion page creation run in unattended API runs?

**Visa**
- Is a labelled mock key directory acceptable?
- Are `@method` and `content-digest` acceptable as TAP extensions, and is our tag usage right?
- Is N cardholder-initiated authorizations captured all-or-nothing at one merchant of record the pattern you'd recommend?
- Do judges weight real Cybersource sandbox transactions over other Visa APIs?

**Organizers / Devpost**
- What is the official text of the Applied Intelligence track?
- What are the requirements for Paper Best Designed Hack and Intuit? Enter only if we already qualify.

**Still UNVERIFIED (smoke-test, don't assume):**
- Whether polls and reactions get rejected on shared lines.
- Whether URL rich previews render on the recipient's phone.
- The typing-refresh interval.
- How the iOS `sms:` prefilled body behaves.
- Whether `threadId` and `idempotencyKey` are live on hackathon accounts.
- CREAO run latency and credit cost.
- Refund vs void on a same-day sandbox capture.
- Whether `merchantDescriptor` renders.
- Cybersource sandbox activation time.
- ElevenLabs free-tier SIP limits.
- The LA sales tax rate.