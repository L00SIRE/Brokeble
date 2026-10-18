# LA Hacks AI Hackathon (Fall 2026) battle plan: private-budget group planner with all-or-nothing holds

**Date:** Sat 2026-10-17. Hacking runs **12:00 PM today to 12:00 PM Sun**, 24 hours, and late submissions are not accepted.
**Precedence:** where the researchers disagree, the verification ledger wins. Anything marked **UNVERIFIED** has no primary source yet and needs a booth or a live test.

---

## 0. The six decisions to make now

1. **The pre-noon "foundation" is accounts, keys, sandboxes, booth questions and this plan. No code before 12:00 PM** [FAQ: "All coding and building must occur during the hackathon. Ideation and planning before the hackathon is allowed."]. Creating CREAO agents counts as building, so it also waits until noon.
2. **Photon topology:** by default the agent talks to each person in a private DM and the backend holds the shared group state. This works on the free shared lines. Add group-chat features only if the Photon booth gives you a dedicated line. Shared lines can't do group chats or send the first message [PH-B, PH-PB, PH-T].
3. **Money flow:** the demo venue is the merchant of record. Each friend's hold is a separate Cybersource authorization at the venue. The agent's TAP-signed "commit" request makes the venue capture every hold, and a decline or missed deadline makes it reverse every hold. The platform never holds funds [TAP-SPEC, CYBS-SPEC, CFR].
4. **Deadlines live in our own Postgres, not CREAO.** CREAO scheduled runs are recurring jobs set up in the UI, at least 5 minutes apart [CR-SCH].
5. **CREAO is the research and itinerary engine**, so the product doesn't work without it. Target AI-First Disruptor ($2,000) first and Team Empowerment ($500) second if the booth allows both.
6. **Aim for an overall prize ($2,000 / $1,500 / $1,000), not the track prize.** The Applied Intelligence prize is a mini projector, and overall winners don't also get a main-track prize [DP, FAQ].

---

## 1. Verdict on the original plan

| # | Item in original plan | Verdict | Fix | Source |
|---|---|---|---|---|
| 1 | Event shape (implied 36h, spring) | **Wrong** | 24h: Sat 12 PM to Sun 12 PM, no grace period, no sleeping area or showers. Judging Sun: Round 1 science fair 12:30–2 PM (4–5 min per judge); Round 2 top 5 give a 3 min pitch plus 5 min Q&A. Event ends about 4 PM. | FAQ, DP |
| 2 | "Set up whole foundation first" | **Correct only as planning** | Before noon: accounts, keys, sandbox signups, contracts on paper. At noon, Person A builds the code foundation in hours 0–3 (§6). | FAQ |
| 3 | Applied Intelligence main track | **Partially correct** | Track exists (prize: Mini Projector). Official track text is **UNVERIFIED**; read live.lahacks.com/tracks while logged in. You must pick exactly one main track. | DP, FAQ |
| 4 | Photon "very strong fit" | **Correct on concept, entry path UNVERIFIED** | The track asks for "agents that join human-to-human conversations" and "multi-agent systems that collaborate with humans". Photon is **not** on the Devpost (0 hits), so ask the booth how to enter. | PH-T, DP |
| 5 | Visa words: intuitive, personalized, frictionless, secure, trusted | **Partially correct** | intuitive, personalize, trusted and secure all appear; "frictionless" doesn't, so say **"seamless"**. "Manage budgets" is in the prompt word for word, so use it. Commerce Impact (15%) is missing from the plan. | VISA-T, ledger |
| 6 | CREAO Team Empowerment + ask about Disruptor | **Partially correct** | Three separate Devpost prizes. Whether one project can enter more than one CREAO sub-track is **UNVERIFIED**. As planned, CREAO is a replaceable side tool, which scores badly on "AI as foundation" (30%) and "Depth on CREAO" (25%). Make it core (§2). | CR-T, DP, ledger |
| 7 | "One Photon number in everyone's DMs and the group chat" | **Wrong** | Shared lines: "A shared assignment supports direct conversations, not group chats". The number "may differ across recipients". Group chats need a dedicated line (Business plan, $250/line/month). | PH-B, PH-RT, PH-PB, PH-T |
| 8 | Kickoff by @mention in the group | **Wrong (shared line)** | Kickoff is a DM to the agent from the organizer. Friends join with a link and a code (§3). | PH-B |
| 9 | "Agent DMs each person" for intake | **Wrong** | "A shared line cannot send an unsolicited first message." Each person needs an assignment and must text the agent first. | PH-B, PH-API |
| 10 | "Turn on mention gating" | **Wrong** | Not a platform feature: "mention" appears 0 times in the beta OpenAPI. Drop it. With a dedicated line it would have to be our own code. | PH-API |
| 11 | Per-person memory keyed by phone | **Correct** | Key on `sentBy.handle` (E.164). Always reply with `senderId = receivedBy.id` and the inbound `space.id`, because the agent number can differ per person. | PH-B |
| 12 | Affordability filter in plain code, not an LLM | **Correct (keep, core IP)** | Add a test asserting that no budget value appears in any serialized LLM or CREAO payload. | architecture |
| 13 | Budgets "never shown to the LLM" | **Partially correct** | Breaks as soon as someone types "my budget is $40" in a DM. Collect budgets on a web form only, and catch `$`/number patterns before any LLM call. | architecture |
| 14 | Send CREAO "the per-person price ceiling" | **Wrong (privacy leak)** | The ceiling that fits everyone is min(budgets), which is exactly the tightest person's budget. Send CREAO no budget data; ask for a fixed spread of price points (§3). | architecture, strategy |
| 15 | CREAO Planner via API Trigger returns structured options | **Partially correct** | Runs are async and take minutes. There is **no structured-output feature**, so prompt for strict JSON, validate with zod, repair once, then fall back to a cached set. | CR-API, CR-AG |
| 16 | "Finding options, about 2 minutes" | **UNVERIFIED** | Browser Use runs take "typically a few minutes" with a 15-minute cap. Measure it. Show progress with typing and `text.update`, and pre-warm before demos. | CR-BU |
| 17 | Browser Use for restaurant and event research | **Risky** | The docs send open-web research to built-in search. Browser Use inside API-triggered runs is **UNVERIFIED**. Test both by 3 PM. | CR-BU, CREAO llms.txt |
| 18 | CREAO scheduled runs for vote and payment deadlines | **Wrong** | UI-only cron, at least 5 minutes apart, needs Pro Plus, no one-time schedules, no API. Deadlines go in the backend `due_jobs` table. Keep one honest recurring CREAO schedule for the Team Empowerment story. | CR-SCH |
| 19 | CREAO webhook back to backend | **Missing security** | Unsigned: only `X-Creao-Delivery-Id`, best-effort, up to 3 attempts. Treat it as a hint: random token in the path, then re-fetch the run with our key. Also poll. | CR-DEV webhooks |
| 20 | CREAO writes the Notion page | **UNVERIFIED** | The connector is documented only as "read and update pages, databases, and wikis". Test page creation in an API run (agent write mode must be **Auto**). Fallback: the agent updates a pre-created page. | CR-CON, CR-AG |
| 21 | Native iMessage poll in the group | **Wrong as designed** | No group on shared lines. Send each person a private poll in their DM (`SendPollContent`). Whether polls render in a shared-line DM is **UNVERIFIED**. iOS 26 needed (**UNVERIFIED**, secondary sources only). Fallback: "reply 1, 2 or 3". | PH-API, ledger |
| 22 | "Tell the agent privately if you dislike one" after a public poll | **Risky** | Overriding a public winner reveals that someone objected. Use private ballots and announce only the winner. | strategy |
| 23 | "Hosted Cybersource payment page (Microform or UC)" | **Partially correct** | Both are embedded components on **your** page. The capture context and the transient token each last 15 minutes, so create the context **when the page loads**, not when the DM is sent. Use Microform v2. | CYBS-MF |
| 24 | Auth places hold → capture by request ID → reversal | **Correct** | `POST /pts/v2/payments` with `capture:false`; `/payments/{id}/captures`; `/payments/{id}/reversals`. `{id}` is the payment id. | CYBS-SPEC, CYBS-REV |
| 25 | "Agent buys from venue … captures each hold" | **Wrong money flow** | Holds under the team's own merchant ID capture to the team, and nothing pays the venue. TAP moves no money. Make the venue the merchant of record (split tender). | TAP-SPEC, cybersource, tap |
| 26 | "Idempotency keys on every payment call" | **Wrong** | No idempotency header on `/pts/v2/payments`, captures or reversals. Use DB unique constraints, a deterministic `clientReferenceInformation.code` (15-minute DUPLICATE_REQUEST check), a persisted `transactionId`, and a timeout reversal. | CYBS-SPEC, CYBS-RC |
| 27 | "Delayed capture ~7 days" | **Wrong** | Visa AI13522 (effective 13 Apr 2024): cardholder-initiated card-not-present = **10 calendar days**, merchant-initiated = 5. We auto-release at our own deadline. Sandbox retention is **UNVERIFIED**. | VISA-AI13522 |
| 28 | Store only TMS tokens | **Correct** | `actionList:['TOKEN_CREATE']` on the first authorization. Tokens are stored by the venue (merchant), not the platform. | CYBS-SAMPLES |
| 29 | Approval links tied to phone + exact amount, expiring | **Correct** | Store the token hash server-side, single use, bound to share id + amount + plan version. The amount always comes from the DB, never from the URL or the LLM. | cybersource |
| 30 | Plan change → re-approve and reverse old hold | **Correct** | Incremental auth is limited to lodging and rental categories, so reverse and re-authorize. | CYBS docs |
| 31 | "Group message can never charge" | **Correct; enforce structurally** | The LLM has **no payment tools**. Money moves only on a cardholder action on the venue page or a deterministic state transition. | design |
| 32 | Card number in chat → refuse + secure link | **Correct; strengthen** | Luhn/regex check before the LLM and before logging. Deleting an inbound message via `message.delete` is **UNVERIFIED**. | photon |
| 33 | "Verify Photon HMAC on every webhook" | **Partially correct** | The beta signing scheme is undocumented. Use the **Socket.IO event stream** (Bearer auth, replay cursor), which needs no public endpoint and no HMAC. | PH-WS, PH-API |
| 34 | "Purchase request signed with TAP sample" | **Partially correct** | The minimum signature covers only `@authority` + `@path`, so it doesn't bind the amount. Tag is `agent-payer-auth` (not `agent-payment-auth`). The sample verifier is non-conformant: it guards `/product/` only, never checks the tag, uses a 1-hour nonce TTL, and its ports conflict. Write your own verifier. | TAP-SPEC, TAP-REPO, ledger |
| 35 | Production caveat (venue partnership, single-use card, licensed partner) | **Right direction, imprecise** | Lead with "the merchant charges each friend directly; we never hold funds". A pooled card is the part that raises money-transmission questions. | CFR, tap |
| 36 | "Group could infer the tightest budget over many plans" | **Correct; add mitigations** | See §3.3. | strategy |
| 37 | Stat "76% … never fully paid back … group trip" | **Wording wrong** | "According to Zelle research (June 2026), 76% of Gen Z who fronted money for a group expense say they were not fully repaid." | ZELLE |
| 38 | 3-minute demo | **Partially correct** | Only the top 5 get it. Everyone gets a 4–5 min table visit, repeated for several judges. A 2–3 min Devpost video is **required**. | FAQ, DP |
| 39 | 4 live phones, "the 5 of us" | **Risky** | 3 teammates. Borrow a 4th phone and invite the judge's phone. Make the script match the device count. | strategy |
| 40 | Backup video by 7 AM | **Correct, mandatory** | It doubles as the required Devpost video. | DP |
| 41 | Team split (A overloaded) | **Risky** | A holds Photon, intake, coordinator, filter, scoring and privacy, the whole critical path. Nobody owns deploy, demo reset or video. Rebalance (§6). | strategy |
| 42 | Missing: CREAO submission rules | **Missing** | Select the CREAO track(s) on Devpost, put the agent ID and a run share link in the README, and show the agent running in the demo. | CR-T |
| 43 | Missing: Devpost requirements | **Missing** | Description naming the track **and how the project applies to each company challenge**, a **public** GitHub repo, a 2–3 min video, and the full page. | DP |
| 44 | Missing: competition size | **Missing** | Devpost: invite-only, 144 participants (about 40–50 teams). Sponsor prizes are reachable. | DP |

---

## 2. Track and prize strategy

### 2.1 What to enter

| Prize | Amount (verified) | Enter? | Requirement to meet visibly | Status |
|---|---|---|---|---|
| Overall 1st / 2nd / 3rd | $2,000 / $1,500 / $1,000 | **Primary target** | Main criteria: Technical Depth, Product Thinking & Impact, Execution & Polish, Originality & Insight (no weights given) | Verified [DP] |
| Main track: Applied Intelligence | Mini Projector | **Required (pick exactly one)** | Track text **UNVERIFIED**; read it before writing the Devpost | [DP, FAQ] |
| Visa: "The Future of Shopping: Powered by AI, Secured by Visa" | $2,000 cash, 1 winner | **Yes** | Innovation 25 / UX 25 / Technical Execution 20 / Commerce Impact 15 / Trust & Responsibility 15. No required Visa API stated (ask). | Verified [DP, VISA-T] |
| CREAO Best AI-First Disruptor | $2,000 | **Yes (priority CREAO entry)** | "Remove the agent, and the product stops working". Select the CREAO track; README has agent ID + run share link; demo shows the agent running. | [DP, CR-T] |
| CREAO Best Team Empowerment | $500 | **Yes, if the booth allows multiple CREAO entries** | "Agents as the connective tissue between people … without replacing anyone"; Notion, scheduled runs, webhook handoffs | Multi-entry **UNVERIFIED** |
| CREAO One-Person Company | $1,000 | No | Doesn't fit | — |
| Photon iMessage Track Winner / Runner-Up | $700 ($400 cash + $300 credits + interview fast-track) / $300 | **Yes** | "Built on Photon 2.0 and live on at least one Photon channel" | Source: photon.md only; **not on Devpost; entry path UNVERIFIED** |
| Photon Best Voice Agent | $400 ($300 cash + $100 credits) | Stretch only | Real calls on a Photon SMS number; "remembers the call when the conversation moves back to text"; outbound calls need a payment method on the org | [PH-T] |
| MLH Best Domain (GoDaddy Registry) | listed on Devpost | Cheap add-on | Requirements **UNVERIFIED** | [DP] |
| MLH ElevenLabs | listed | Only with the voice stretch | **UNVERIFIED** | [DP] |
| Paper Best Designed Hack | $1,500 / $1,000 / $500 | Optional | Requirements **UNVERIFIED**; enter only if requirements are checked and cheap | [DP] |
| Fetch.ai Agentverse, Gemini, Devin, Base44, others | various | **Skip** | Fetch needs Agentverse + ASI:One, which conflicts with the iMessage flow. We use Claude, not Gemini. | event researcher |

The Photon claim "we'll double your prize if you win with Photon's SDK" (weekly update, May 14 2026) is **UNVERIFIED** for this event; ask the booth.

### 2.2 Pitch thesis (use the same words everywhere)

> **"An assurance contract for the group chat."** Everyone's budget stays secret, nobody is charged unless everyone commits, and nobody fronts the money. One private agent per person, mediating between friends who can't comfortably talk about money in front of each other.

Lead with **secret constraints** and **all-or-nothing commitment**. Never open with "it plans your trip", because plain trip planners place in sponsor challenges, not overall (calibration from past LA Hacks/TreeHacks winners [strategy]).

### 2.3 How the product maps to each rubric

**LA Hacks main (overall)**

| Criterion | What we show |
|---|---|
| Technical Depth | Privacy boundary enforced in code (private_constraints read by one module, payload assertion test). Fair scoring with maximum Nash welfare. Hold/capture/reversal state machine with timeout reversal. TAP verifier that rejects replay and tampering. |
| Product Thinking & Impact | Zelle stat. "Nobody wants to say 'I can't afford that' in the group chat." Merchants get guaranteed group bookings. |
| Execution & Polish | Live on real iPhones, ledger dashboard, reset in seconds, works on cellular data. |
| Originality & Insight | Secret budgets plus all-or-nothing holds as a new primitive. Private DMs turned into a privacy feature. |

**Visa (weights in brackets)**

- **Innovation [25]:** an agent orchestrating split-tender, cardholder-approved authorizations, with a TAP-authenticated commit.
- **UX [25] ("intuitive, useful, and seamless"):** it all happens in iMessage, with one tap on a card page and no app.
- **Technical Execution [20]:** real Cybersource sandbox auth, capture and reversal; TMS tokens; Microform v2; a TAP verifier that follows the 6 spec steps.
- **Commerce Impact [15]:** the plan was missing this. Merchants get **guaranteed group conversion**: the booking only commits once every share is authorized. No single payer fronts the bill, so there are fewer abandoned group bookings and fewer "I never agreed to this" disputes, because every share is cardholder-approved.
- **Trust & Responsibility [15]:** card data never reaches chat, the LLM or our platform (it goes only into Cybersource iframes on the merchant page). Budgets never reach the LLM or CREAO. The LLM has no money tools. Holds auto-release. There is a live tamper and replay rejection.

**CREAO (30 / 25 / 20 / 15 / 10)**

- **AI as foundation [30]:** the Researcher agents produce every option and the Scribe agent produces the itinerary, the Notion plan and reminders. Without CREAO there are no options and no plan, and the pitch says so.
- **Depth [25]:** several saved agents called from our product through the API, run in parallel, with the realtime progress stream if the CLI API is available. We extend them with our own tools: venue availability through the signed TAP browse request.
- **Originality [20]:** not a chatbot wrapper. A multi-agent research pipeline feeding a privacy-preserving group decision.
- **Track fit [15]** and **Demo [10]:** show the CREAO run live view or run page during the demo and name what CREAO is doing.

**Photon (Vision / Craft / Depth / Traction)**

- **Vision:** "hybrid intelligence". One private agent per person, collaborating toward a shared goal, with the agent as confidential mediator.
- **Craft:** reaction tapback on every inbound message, typing indicator while CREAO runs, a status bubble edited in place (`text.update`), native polls.
- **Depth:** edge cases are handled: card-number intercept, dropouts, decline reverses everything, redelivery dedupe, link-suppression-aware onboarding.
- **Traction:** works on Photon's free tier today; judges can text it from their own phones.

### 2.4 Frontier moves per sponsor (pick in order; stop when time runs out)

**Photon**
1. A virtual group room over DMs: tallies ("3 of 4 have voted") fanned out to each DM, with no names attached to who is pending.
2. Private native polls in each DM, giving secret ballots that a group poll can't.
3. Live status bubble edited in place, plus typing indicator, plus acknowledgement tapbacks.
4. If the booth grants a dedicated line: the agent **creates** the group (`createOrGetSpace` with the dedicated agent listed first) and announces only the winner and the confirmation there. Private steps stay in DMs.
5. Stretch: voice call on the SMS number to the person who hasn't approved, with the call remembered when the conversation returns to text (Best Voice Agent).

**Visa**
1. Venue as merchant of record with split-tender authorizations.
2. TAP checkout bound to a venue-priced order (`/checkout/{orderId}`) plus `content-digest`.
3. Live negative tests on the verifier panel: replay, $42→$500 tamper, expired signature, unknown keyid.
4. Both TAP intents: `agent-browser-auth` on availability checks and `agent-payer-auth` on commit.
5. Stretch: per-person approval JWS inside TAP Agentic Payment Containers. One container per payer is our own extension; the spec defines one consumer per object.
6. **Biggest Visa-native upside, UNVERIFIED access:** the Cybersource SDK 0.0.84 spec includes `/icc/v1/*` Intelligent Commerce Connect endpoints: Visa Agent Registry (`POST /icc/v1/agents`, `/keys`, `/activate`, category `Trusted_Agent_Protocol`), merchant registry, and purchase-intent mandates (`/icc/v1/instructions`). They require MLE and JWT. Ask the Visa booth whether a hackathon sandbox merchant ID can call them. If yes, register our real TAP key in VARS instead of a mock directory. If not, put them on the "production path" slide.

**CREAO**
1. Parallel Researcher runs: dinner, show, and a backup set, each as its own run or conversation.
2. A Scribe agent that writes the Notion plan and itinerary and composes reminders.
3. Realtime NDJSON progress (`POST /v1/realtime/runs`, CLI API) piped into the chat status bubble and the admin dashboard.
4. One honest recurring scheduled run (for example a daily digest or reminder agent) for the Team Empowerment building block.
5. Stretch: per-person taste memory through CLI `conversation_id` continuity. This sends preferences and dietary needs to CREAO, never budgets; say that openly.

---

## 3. Revised product and flow

### 3.1 End-to-end flow (default: DM hub on shared lines)

| Step | What happens | Who/what |
|---|---|---|
| **0. Pre-demo** | The 4 demo phones have Photon shared-line assignments and have each sent the agent 3 or more messages (Apple marks a conversation trusted after 3 inbound messages [PH-DLV]). | A |
| **1. Kickoff** | The organizer DMs the agent: "plan dinner + a show Sat for 4 of us". The agent creates the plan, replies with code **4821** and a join link, and the organizer pastes the link into **their own existing human group chat**, so the agent never needs to be in it. | Photon DM, Plan COLLECTING |
| **2. Join + private constraints** | Each friend opens the join page (our web page) and enters their phone number, **private max per person**, dealbreakers and dietary needs. The backend creates the Photon assignment (`POST /platforms/imessage/assignments`) and shows a per-person `sms:` button with the assigned number and the body "JOIN 4821". The budget never touches iMessage, and the person texts first, which satisfies the shared-line rule. | Web join page, private_constraints |
| **3. Chat intake (no money)** | The agent replies text-only, since Apple suppresses links in early messages [PH-DLV]: "You're in. What are you craving? Anything you'd skip?" The LLM extracts preferences into a schema with **no money fields**. Any `$`/number pattern is stripped before the LLM sees the text. If someone types a budget, the agent answers from a template: "Keep that private, I've got it from your form." | Haiku 5.5, regex guard |
| **4. Research** | When everyone has joined, or the intake deadline passes, the backend triggers the CREAO Researchers with **group-level, non-budget** constraints: date window, area, party size, aggregate dietary tags without identities, cravings summary, and a **fixed price spread** (for example 4 options under $25pp, 4 at $25–50, 4 above $50). Each DM gets a typing indicator and a status bubble edited in place. Six-minute hard timeout, then cached options (labelled as cached in the logs). | CREAO, Plan RESEARCHING |
| **5. Filter + score** | Plain code drops options that fail any hard constraint (budget, dietary, dealbreakers, date, availability). Nash-welfare scoring (§3.4) picks a diverse shortlist of exactly 3. If fewer than 3 survive, there is one more research run with a coarse tier (residual leak, disclosed). | filter.ts, scorer.ts |
| **6. Private ballot** | Each person gets a **native poll in their DM** (`selectionMode:'multiple'`, "Which would you be happy with?") plus one private veto. The agent fans out "3 of 4 have voted", with no names. The winner is announced to everyone; tallies stay private. Fallback: "reply 1, 2, 3". | Plan VOTING |
| **7. Order at venue** | The agent sends a TAP `agent-payer-auth` signed `POST /orders` to the venue. The **venue prices the order** and creates N shares, each with a single-use pay link. | Plan ORDERING, venue |
| **8. Approve** | Each DM: "Your share is $42 for X at 7 PM Sat. This is a hold, charged only if everyone's in. Releases automatically by <time>." Link to the **venue's** pay page. On page load the venue creates the Microform capture context; the person enters their card (first time) or confirms (stored TMS token), and the venue places the authorization. Broadcast: "3 of 4 in", no names. | Plan APPROVING |
| **9. Commit** | A conditional UPDATE makes exactly one worker proceed once every share is AUTHORIZED. The agent sends a TAP-signed `POST /checkout/{orderId}`. The venue verifies the signature and checks that every share is authorized and the amounts sum to the order total, then **captures each hold**. Confirmation goes to each DM. The CREAO Scribe writes the Notion plan and itinerary. | Plan COMMITTING → CONFIRMED |
| **10. After** | A backend due job the day before triggers a Scribe/Reminder run, and the backend sends the text through Photon. The "my receipts" command is a stretch item. | due_jobs |

**If a dedicated line is granted:** the agent creates the group, posts the kickoff ack and the winner and confirmation there. Steps 2, 3, 6 and 8 stay in DMs; that is the privacy feature.

### 3.2 Failure flows

| Failure | Handling |
|---|---|
| Invitee never joins by intake deadline | Organizer gets a private DM: "2 of 4 joined. Go ahead with 2, or extend?" |
| CREAO slow, failed, or 402 (credits) | 6-minute timeout, then cached option set. Poll every 10–15 s as a fallback to the webhook. On 402, top up at the booth [CR-DEV]. |
| CREAO output not valid JSON | zod validation, one repair call, then cached set. |
| No option fits everyone | One retry asking for a coarse tier. If still none: "Couldn't find something that works for everyone. Try a different day or type?" Never say who or why. |
| Ballot tie or non-voters at deadline | Nash-welfare score breaks the tie. Non-voters count as indifferent. |
| Card declined at authorization | Share goes back to PENDING: "That card didn't go through, try another (nobody else sees this)." The deadline still applies. |
| Authorization times out (unknown outcome) | Share AUTH_UNKNOWN. **Never blind-retry.** Due job at +60 s calls `POST /pts/v2/reversals` with the persisted `transactionId` [CYBS-REV, timeout sample], then the person can try again. |
| Person taps Decline or misses the deadline | Optional GAP_OFFER (cut first): others are asked privately whether to cover. A coverer approves a **new** authorization for the extra amount; existing authorizations are never increased. Otherwise CANCELLING: venue reverses every AUTHORIZED share. DM: "Plan didn't come together; nobody was charged; all holds released." |
| Venue checkout fails or TAP verify fails | COMMITTING → CANCELLING, reverse all. Capture never happens before the booking succeeds. |
| A capture fails after commit | Check the transaction status (`GET /tss/v2/transactions/{id}`) **before** retrying. Persistent failure goes to a manual flag on the dashboard. Exact double-capture behaviour is **UNVERIFIED**. |
| Plan change after approvals | version+1, old order cancelled (reverse all), new order, re-approve. |
| Card number pasted in chat | Luhn regex runs before the LLM and before logging. The message is never stored; the agent sends a template reply: "Please delete that; use this secure page." |
| Photon redelivery or 429 | `inbound_events` dedupe (insert, do nothing on conflict). Outbound `idempotency-key = reply:<inboundId>:<n>`. Honor Retry-After. |
| Process restart mid-plan | Socket.IO resumes from the persisted `seq` cursor. due_jobs and the state machine resume from the DB. |

### 3.3 Privacy design and leakage mitigations

**Boundary:** `private_constraints` is read **only** by `filter.ts`. The LLM sees only objects built by `buildLlmContext(planId)`: preferences, already-filtered options, first names. CREAO sees only group-level non-budget constraints.

| Leak vector | Mitigation |
|---|---|
| Budget typed into iMessage reaches the LLM | Budgets come only from the web form. Regex strips currency and number patterns before any LLM call. Template reply. |
| Ceiling sent to CREAO equals min(budget) | Send **no budget**; request a fixed price spread. If a fallback tier request is needed, its residual leak is disclosed. |
| Excluded option reveals that someone is tight | Never explain exclusions. Exclusions also come from dietary, availability, distance and rating, so a budget cause is deniable. Always show exactly 3. |
| Who hasn't approved or voted | Broadcast counts only ("3 of 4 in"), never names. |
| Public poll plus private veto | Private ballots; announce only the winner. |
| Small group (2 people) makes inference trivial | Warn the organizer when there are fewer than 3 people. |
| Logs or audit leak budgets or card data | pino `redact` on auth headers, budget fields and card patterns. audit_log stores budget-redacted data. |
| Dietary (health-adjacent) data sent to CREAO, Anthropic, Browser Use Cloud | Send aggregate tags without identities, no phone numbers or names to CREAO. Browser Use Cloud's policy allows use of submitted content; only public venue info goes there. CREAO data retention **UNVERIFIED**. |
| Inference across repeated plans | Disclose honestly in Q&A. Roadmap: differential-privacy-style noise on tiers. |
| Regression | A unit test serializes every LLM and CREAO request in an end-to-end run and asserts that no private_constraints value appears. `LLMPort` also throws at runtime if one does. |

**Demo it:** the admin "privacy panel" shows the exact JSON the LLM received (no budgets), side by side with a redacted private_constraints view.

### 3.4 Decision and scoring method

1. **Hard filters (plain code):** per-person `per_person_cents ≤ max_pp_cents` for **every** participant; dietary and dealbreakers; date and availability; private vetoes.
2. **Satisfaction:** the LLM (structured output) rates each surviving option 0–1 per person from that person's **preferences only**. Plain code clamps the scores to [ε, 1] with ε = 0.05.
3. **Shortlist:** the top 3 by **maximum Nash welfare** (sum of logs of satisfaction), with a diversity constraint (no two options of the same kind and price tier). Defensible because MNW has proven fairness properties (EF1, approximates the maximin share) and is less dominated by one picky person than pure maximin [MNW, SEP].
4. **Final pick:** the private approval ballot. An approved option sets that person's satisfaction to max(score, 0.8), an unapproved one to min(score, 0.3) (these numbers are our choice, tune them), then Nash welfare picks the winner.
5. **Explanation:** one privacy-safe line per pick ("fits everyone's dietary needs; closest to the most-requested cuisine"). Never mention price fit.

---

## 4. Architecture and full tech list

### 4.1 Topology

```
iPhones ⇄ Photon 2.0 beta (shared-line DMs)
             │  Socket.IO events (Bearer)          ▲ REST sendMessage / poll / typing / text.update
             ▼                                     │
┌──────────── platform (Fly app, always-on, Hono/Node 22) ────────────┐
│ photonConsumer → coordinator/stateMachine → filter → scorer          │
│ due_jobs poller (FOR UPDATE SKIP LOCKED)  · join page · /admin (SSE) │
│ PlannerPort → CREAO (runs + realtime; webhook = hint → re-fetch)     │
│ LLMPort → Anthropic (Haiku 5.5 / Sonnet 5.5, structured outputs)     │
│ VenuePort → TAP signer (Ed25519, agent-browser-auth / payer-auth)    │
└───────────────────────────────┬──────────────────────────────────────┘
                                │ HTTPS, RFC 9421 signed
┌──────────── venue (separate Fly app = merchant of record) ───────────┐
│ TAP verifier middleware (6 spec steps) · catalog · /orders · /pay/:t │
│ Microform v2 page · PaymentsService → Cybersource sandbox (JWT auth) │
│ mock key directory GET /keys/{keyid} (labelled "mock")               │
└──────────────────────────────────────────────────────────────────────┘
Supabase Postgres: schema `app` (platform), schema `venue` (venue). Platform holds NO Cybersource creds.
```

The two-app split makes "the merchant verifies the agent" a real network boundary and keeps all card handling and Cybersource credentials on the merchant side.

### 4.2 Stack with versions (npm, checked 2026-10-17 [NPM])

| Purpose | Package / service | Version |
|---|---|---|
| Runtime | Node.js | 22 LTS (local v22.20.0) |
| Run TS | tsx | 4.23.15 (no build step) |
| Type-check (optional) | typescript | pin **5.x/6.x**, not 7.0.2 |
| HTTP | hono, @hono/node-server | 4.13.13, 2.1.5 |
| Photon 2.0 | @photon-ai/api | **0.5.0 exact** (`--save-exact`; messaging methods only since 0.4.2, 2026-10-15) |
| Photon events | socket.io-client | 4.8.4 |
| Cybersource (venue) | cybersource-rest-client | 0.0.84; `authenticationType:'jwt', jwtKeyType:'SHARED_SECRET'` (HTTP Signature is deprecated) |
| LLM | @anthropic-ai/sdk | 0.135.0 |
| Schemas | zod | 4.6.7 |
| DB | postgres (porsager) | 3.4.9 |
| Logs | pino | 10.4.0 |
| RFC 9421 | http-message-sig | 0.3.0. **Spike in hour 1**: README read from main and 0.3.0 API unconfirmed. Fallback: hand-built signature base plus `node:crypto` Ed25519. **Don't use web-bot-auth@0.2.0** (hardcodes its tag). |
| JWS for approval tokens (stretch) | jose | pin at install (version not verified) |
| Notion fallback | @notionhq/client | 5.27.1. Notion API usage **UNVERIFIED** by any researcher; read the docs before use. |
| DB host | Supabase Postgres (free) | — |
| Hosting | Fly.io: platform with `auto_stop_machines="off"`, `auto_start_machines=true`, 1 machine; venue as a second app | [FLY] |
| CREAO | plain HTTPS (no SDK found) | — |

Skip: Next.js, Redis, pg-boss, spectrum-ts (unless the Photon booth says it counts as Photon 2.0), the 5-service TAP sample.

### 4.3 Accounts, keys and sandboxes: get them **before 12:00 PM**

Allowed before noon: signups, keys, sandbox activation, booth questions. Not allowed: code, repo scaffolding, building CREAO agents.

| Item | Owner | Notes |
|---|---|---|
| All 3 on one Devpost team at la-ai-hackathon-2026.devpost.com | all | Every member must be admitted and present Sunday |
| **Cybersource sandbox** (developer.cybersource.com/hello-world/sandbox) | C | **Start first.** Activation arrives by email with no published turnaround. Organization ID 6–25 chars, can't be renamed. Then in the Test Business Center: merchant ID plus REST shared-secret key ID and secret. |
| Photon 2.0 beta project | A | Dashboard URL conflict: photon.md says app.photon.codes/dashboard, docs say app.beta.photon.codes (ask). Project ID `pho_prj_…`. API key `pho_sk_…` with project:read, project:write, platforms:write (shown once). iMessage channel. Pre-assign the 3 team phones plus a borrowed 4th (free tier: 25 seats). |
| CREAO via the **hackathon registration link** | B | Upgraded account (scheduled runs, credits). Developer Console `cr_sk_` key (shown once); Console access on the hackathon account **UNVERIFIED**. Connect Notion via OAuth. Ask for a credit top-up. |
| Anthropic API key ($200 credits) | A | — |
| Supabase project | A | Connection string |
| Fly.io org + 2 empty apps (stable hostnames) | A | Needed for Microform `targetOrigins` and the CREAO public webhook |
| Notion workspace + "Plans" parent page | B | Shared with the CREAO connection |
| GitHub account ready; **create the public repo at 12:00** | A | Add `.env*` to `.gitignore` in the first commit |
| 4 iPhones on **iOS 26** (poll requirement, **UNVERIFIED**) with cellular data; USB cable to mirror one phone (QuickTime) | all | Not AirPlay |
| Visa TAP Product Terms skim | C | Governs copying sample code into a public repo; terms text **UNVERIFIED** |

### 4.4 Environment variables (server-side only; `fly secrets set`; commit `.env.example` with names only)

**platform:** `PUBLIC_BASE_URL, DATABASE_URL, PHOTON_API_KEY, PHOTON_PROJECT_ID, CREAO_API_KEY (cr_sk_), CREAO_RESEARCHER_AGENT_ID, CREAO_SCRIBE_AGENT_ID, CREAO_APP_KEY + CREAO_APP_ID (only if using the app-scoped capi_ path), CREAO_WEBHOOK_PATH_SECRET, ANTHROPIC_API_KEY, LINK_TOKEN_SECRET, TAP_AGENT_KEY_ID, TAP_AGENT_ED25519_PRIVATE_KEY, VENUE_BASE_URL, ADMIN_PASSWORD, LOG_LEVEL` (+ `NOTION_TOKEN, NOTION_PARENT_PAGE_ID` only for the fallback).

**venue:** `VENUE_PUBLIC_URL, DATABASE_URL, CYBS_MERCHANT_ID, CYBS_KEY_ID, CYBS_SECRET_KEY, CYBS_RUN_ENV=apitest.cybersource.com, TAP_TRUSTED_KEYS (JSON keyid→public JWK), SHARE_TOKEN_SECRET, ADMIN_PASSWORD`.

Never put any of these in CREAO Secrets, which are injected into every agent sandbox [CR secrets].

### 4.5 Data model

```sql
-- schema app (platform)
users(id, phone_e164 UNIQUE, photon_user_id, agent_sender_id, photon_space_id, display_name, created_at)
plans(id, code UNIQUE, organizer_id, state, version, title, event_window tstzrange, chosen_option_id,
      venue_order_id, deadlines jsonb, created_at)
participants(plan_id, user_id, status /*invited|joined|intake_done|voted|approved|declined*/, PRIMARY KEY(plan_id,user_id))
private_constraints(plan_id, user_id, max_pp_cents, dealbreakers text[], dietary text[])  -- ONLY filter.ts reads
preferences(plan_id, user_id, prefs jsonb)                       -- LLM-extracted, zero money fields
research_runs(id, plan_id, creao_run_id UNIQUE, conversation_id, status, started_at, result jsonb)
options(id, plan_id, run_id, name, kind, per_person_cents, venue_sku, url, tags text[], raw jsonb)
ballots(plan_id, user_id, approved_option_ids text[], veto_option_id, UNIQUE(plan_id,user_id))
due_jobs(id, plan_id, kind, due_at, done_at, attempts)          -- polled every 2s, FOR UPDATE SKIP LOCKED
inbound_events(event_id PRIMARY KEY, seq, received_at)          -- Photon + CREAO delivery dedupe
photon_cursor(id smallint PRIMARY KEY DEFAULT 1, seq bigint)
audit_log(id, at, actor, plan_id, type, data jsonb)             -- budgets redacted; SSE source for /admin

-- schema venue (merchant of record)
orders(id, plan_ref, version, status /*open|committing|captured|cancelling|cancelled*/, total_cents, items jsonb)
shares(id, order_id, payer_ref /*opaque*/, amount_cents, status, token_hash, expires_at, used_at)
customers(payer_ref PRIMARY KEY, cybs_customer_id, cybs_payment_instrument_id)   -- TMS tokens only
payment_ops(id, share_id, op /*auth|capture|reverse|timeout_reverse*/, attempt,
            client_ref_code UNIQUE, transaction_id UNIQUE, cybs_payment_id, status, response jsonb,
            UNIQUE(share_id, op, attempt))
tap_nonces(nonce PRIMARY KEY, seen_at)                          -- TTL ≥ 8 min
```

### 4.6 State machines

**Plan (platform):**
`COLLECTING → RESEARCHING → VOTING → ORDERING → APPROVING → COMMITTING → CONFIRMED`

- `RESEARCHING → (timeout 6 min) → cached options → VOTING`
- `RESEARCHING → NO_FIT → (one tier retry) → VOTING | CANCELLED`
- `APPROVING → (decline | approval deadline) → GAP_OFFER [cut-first] → CANCELLING → CANCELLED`
- `COMMITTING → (venue/TAP failure) → CANCELLING → CANCELLED`
- Any change → `version+1`, old order cancelled, back to `ORDERING`.

Every transition is a conditional update, for example:
`UPDATE plans SET state='committing', version=version+1 WHERE id=$1 AND state='approving' AND <all shares authorized> RETURNING id`. Only the caller that gets a row back acts. Each transition writes `audit_log` in the same transaction.

**Share (venue):**
`PENDING → AUTHORIZING → AUTHORIZED | DECLINED | AUTH_UNKNOWN`

- `DECLINED → PENDING` (retry with another card before the deadline)
- `AUTH_UNKNOWN → (60 s) → TIMEOUT_REVERSING → RELEASED`
- `AUTHORIZED → CAPTURING → CAPTURED`
- `AUTHORIZED → REVERSING → RELEASED`

### 4.7 Module interfaces (zod types in `packages/shared`; every port has a mock from hour 1)

```ts
interface MessagingPort {            // A — mock: POST /dev/inbound + console
  sendText(userId: string, text: string, opts?: { replyTo?: string }): Promise<void>;
  updateText(userId: string, msgId: string, text: string): Promise<void>;
  sendPoll(userId: string, q: string, opts: {id: string; text: string}[], mode: 'single'|'multiple'): Promise<string>;
  typing(userId: string): Promise<void>;
  react(userId: string, msgId: string, reaction: string): Promise<void>;
  broadcast(planId: string, text: string): Promise<void>;   // DM fan-out (or group if dedicated line)
  onInbound(h: (e: InboundEvent) => Promise<void>): void;    // e: text | poll.vote, deduped
}
interface PlannerPort {              // B — mock: fixtures/options.json after 5s
  startResearch(planId: string, req: ResearchRequest /* no budgets */): Promise<{ runIds: string[] }>;
  onProgress(h: (planId: string, msg: string) => void): void;
  onResult(h: (planId: string, options: Option[]) => Promise<void>): void;
  writePlan(planId: string, plan: ConfirmedPlan): Promise<{ notionUrl?: string; runId: string }>;
}
interface LLMPort {                  // A/B — mock: canned objects; throws if private value present
  extractPreferences(text: string): Promise<Preferences>;
  rateOptions(prefs: Preferences, options: PublicOption[]): Promise<Record<string, number>>;
  chatReply(ctx: LlmContext, text: string): Promise<string>;
}
interface VenuePort {                // C — mock: in-memory venue with fake holds
  checkAvailability(sku: string, when: string): Promise<boolean>;            // TAP agent-browser-auth
  createOrder(planRef: string, items: OrderItem[], payers: string[]): Promise<{ orderId: string; shares: {payerRef: string; amountCents: number; payUrl: string}[] }>; // agent-payer-auth
  getOrder(orderId: string): Promise<OrderStatus>;
  commit(orderId: string): Promise<CommitResult>;                            // agent-payer-auth → capture all
  cancel(orderId: string): Promise<void>;                                     // → reverse all
}
// pure, unit-tested (B): filter(options, constraints[]) → Option[] ; shortlist(options, scores) → Option[3] ; pickWinner(...)
```

### 4.8 CREAO integration specifics

- **Path:** the CLI API (`POST https://developer.creao.ai/v1/runs` with `{agent_id, input ≤256KB, conversation_id?, webhook_url}`, `cr_sk_`) for `conversation_id` continuity and `/v1/realtime/runs` NDJSON progress. Fallback: app-scoped `POST https://agent.creao.ai/api/v1/apps/{appId}/runs` with `{inputs, webhookUrl}` and `capi_`. Don't mix `input` and `inputs`.
- **Agents (built in the UI after 12:00):** `Researcher` (built-in search by default; Browser Use only if the 3 PM timing test passes), `Scribe` (Notion write, itinerary, reminder copy; write mode **Auto**). One recurring schedule (for example a daily digest) for the Team Empowerment story.
- **Output contract:** a single fenced JSON array of `{name, kind, per_person_cents, address, url, venue_sku?, tags, why}`, validated with zod, repaired once, then cached.
- **Webhook security:** `/creao/hook/:pathSecret`; dedupe on `X-Creao-Delivery-Id`; return 200 immediately; re-fetch `GET /v1/runs/{id}` with our key and act only on that. Poll every 10–15 s as well.
- **Limits:** 30 requests per account per minute across `/v1/*`, polling included. Check credits with `GET /v1/account/usage`.
- **README:** agent IDs plus at least one run share link.

### 4.9 Observability and demo dashboard (`/admin`, basic auth, SSE from `audit_log`)

Panels:
1. Plan timeline with state transitions.
2. **Privacy panel**: the last LLM payload JSON and the last CREAO input, next to redacted private_constraints.
3. CREAO runs: status, progress events, run link.
4. **Hold ledger**: per share PENDING → HELD → CAPTURED or RELEASED, with Cybersource payment ids.
5. **TAP verifier panel** on the venue: signature base string, each verification step ✓/✗, plus "tamper / replay / expire" buttons.
6. One-click **reset**: reverse any live sandbox holds, clear the plan, re-seed the demo group and cached options.

Logs: pino JSON with `plan_id`, hashed phone, Photon message id, CREAO runId and Cybersource payment id, with `redact` on secrets, card data and budgets.

### 4.10 LLM usage and cost (Anthropic pricing [ANT])

| Use | Model | Notes |
|---|---|---|
| Preference extraction from DMs | `claude-haiku-5-5` ($0.10 / $0.50 per MTok ≤100K prompt) | `client.messages.parse` + zod; schema has no money fields |
| Per-person option ratings, "why this" line, free-form chat replies | `claude-sonnet-5-5` ($2 / $10; cache hit $0.10) | Structured outputs. **No forced `tool_choice`** (400 on Sonnet/Opus 5.5) and no assistant prefill (400). Sonnet 5.5's default effort is high, so lower it if latency or cost matters. |
| All money and status messages | **Templates, no LLM** | Deterministic; privacy and correctness |

**Estimate for the weekend:**
- Haiku: 3,000 calls × 3K in / 300 out ≈ $0.90 + $0.45.
- Sonnet: 2,000 calls × 4K in / 500 out (thinking included) ≈ $16 + $10.
- Total about **$30**, under **$60** with a 2× buffer, against the **$200** credit. Prompt caching of the static system prompt lowers it further.
- CREAO runs spend CREAO credits, not Anthropic's.

### 4.11 Deployment rules

- Both apps on Fly from hour 1. Microform `targetOrigins` = the venue's stable hostname, hardcoded server-side.
- Phones and the demo laptop use cellular or a phone hotspot, not venue Wi-Fi.
- **No deploys after 11:30 AM Sunday.**
- The platform runs as a single machine so the Socket.IO consumer and the due-job poller have exactly one owner.

---

## 5. Payments correctness

### 5.1 Exact Cybersource call sequence (venue service, sandbox `apitest.cybersource.com`, JWT auth)

0. **Pay page load** `GET /pay/:shareToken`: hash the token, check that it is unexpired and unused and bound to share id + amount + order version. Then `POST /microform/v2/sessions` with `{clientVersion:'v2', targetOrigins:[VENUE_PUBLIC_URL], allowedCardNetworks:['VISA','MASTERCARD','AMEX'], allowedPaymentTypes:['CARD']}`. Load the Microform JS from the capture context's `clientLibrary` with its `clientLibraryIntegrity`. The amount shown comes from the DB, and billTo fields are collected on the page.
1. **Before calling:** insert `payment_ops(op='auth', attempt=n, client_ref_code='<orderId>-<shareId>-<n>', transaction_id=<uuid>)` (unique) and set the share to AUTHORIZING.
2. **First-time card:** `POST /pts/v2/payments` with:
   - `clientReferenceInformation:{code, transactionId}`
   - `processingInformation:{capture:false, actionList:['TOKEN_CREATE'], actionTokenTypes:['customer','paymentInstrument']}`
   - `tokenInformation:{transientTokenJwt}`
   - `orderInformation:{amountDetails:{totalAmount:'42.00', currency:'USD'}, billTo:{…}}`
   Store `response.id` (payment id) and `tokenInformation.customer.id` / `paymentInstrument.id`.
   **Returning card:** the same call with `paymentInformation:{customer:{id}}` and no `TOKEN_CREATE`.
3. **Result:** AUTHORIZED → share AUTHORIZED. DECLINED → DECLINED. Timeout or unknown → AUTH_UNKNOWN, a due job at +60 s, then `POST /pts/v2/reversals` (`ReversalApi.mitReversal`) with the same `clientReferenceInformation.transactionId` and `reversalInformation.amountDetails.totalAmount`, or look it up via `/tss/v2/searches`. Only after that, a new attempt with n+1.
4. **Commit (after TAP verify plus the all-authorized check):** for each share, `POST /pts/v2/payments/{id}/captures` with `{clientReferenceInformation:{code}, orderInformation:{amountDetails:{totalAmount, currency}}}`. SDK: `CaptureApi.capturePayment(body, id)`, **body first**.
5. **Cancel:** for each AUTHORIZED share, `POST /pts/v2/payments/{id}/reversals` with `{clientReferenceInformation:{code}, reversalInformation:{amountDetails:{totalAmount, currency}, reason}}`. The amount must equal the authorized amount. Response status `REVERSED`. SDK: `ReversalApi.authReversal(id, body)`, **id first**. Wrap both in a typed service with named parameters.
6. **Known error codes:** `EXCEEDS_AUTH_AMOUNT` (capture above the hold), `AUTH_ALREADY_REVERSED`, `DUPLICATE_REQUEST` (same reference code within 15 minutes; whether it is on by default is **UNVERIFIED**).

**Test cards:** 4111 1111 1111 1111 and 4622 9431 2701 3705 (CVV 838), with any future expiry. The sandbox's only documented declines are invalid-data triggers, so the demo "decline" is the **user tapping Decline**, not an issuer decline [CYBS-TEST].

### 5.2 Hold, capture and reversal rules

- Authorize only after a cardholder action on the merchant page (cardholder-initiated card-not-present). The Visa authorization-to-clearing window is **10 calendar days** [VISA-AI13522]. Our approval deadline is far inside it (72 h in production, minutes in the demo), and holds auto-reverse at the deadline. How long the sandbox simulator keeps an authorization capturable is **UNVERIFIED**.
- **Book first, capture second.** Never capture before the commit succeeds, so a failure means reversals, never refunds.
- An authorized amount never changes. Covering a gap, or any change, means a new authorization plus a reversal of the old one.

### 5.3 Idempotency, as actually supported

- **Cybersource has no idempotency header** on payments, captures or reversals [CYBS-SPEC]. Use:
  1. DB unique `(share_id, op, attempt)` and unique reference codes;
  2. a deterministic `clientReferenceInformation.code` (15-minute DUPLICATE_REQUEST check);
  3. a persisted `transactionId` plus timeout reversal;
  4. status lookup before retrying a capture or reversal;
  5. conditional UPDATEs, so only one worker commits or cancels.
- **Photon:** `idempotency-key` header on every send (required), `reply:<inboundId>:<n>`.
- **CREAO:** dedupe on delivery id or runId.
- **Inbound:** `inbound_events` insert-or-ignore.

### 5.4 Token handling

- Card numbers exist only inside Cybersource Microform iframes on the venue origin. The transient token is used once, server-side, within 15 minutes.
- Only TMS customer and payment-instrument ids are stored, at the **venue** (merchant-scoped). The platform never sees card data or Cybersource credentials.
- Pay-link tokens: 128-bit random, SHA-256 hash stored, single use, expiry, bound to share + amount + order version.

### 5.5 TAP integration

- **Signer (platform):**
  - Ed25519 key.
  - `Signature-Input: sig1=("@method" "@authority" "@path" "content-digest");created=…;expires=…;keyid="…";alg="ed25519";nonce="…";tag="agent-payer-auth"`.
  - expires − created = 120 s (spec maximum 8 min).
  - `Content-Digest: sha-256=:<b64>:` (RFC 9530).
  - The spec's **minimum** is `@authority`, `@path`, created, keyid, expires, tag, alg, nonce. Adding `@method` and `content-digest` is **our extension; confirm with the Visa booth**.
  - **Independent of the extension, the order is bound because the path is `/checkout/{orderId}` and the venue priced that order server-side.**
  - `agent-browser-auth` on availability GETs.
- **Verifier (venue middleware, the spec's 6 steps):**
  1. tag ∈ {agent-browser-auth, agent-payer-auth}, and the right one for the route;
  2. all required params present;
  3. created ≤ now < expires and expires − created ≤ 480 s;
  4. nonce not seen in the last 8 min (`tap_nonces`);
  5. key lookup by keyid;
  6. rebuild the signature base and verify (plus recompute the Content-Digest).
  Then the business checks: every share AUTHORIZED and the amounts sum to `total_cents`.
- **Key directory:** `GET /keys/{keyid}` returning a JWK, labelled on screen "**mock Visa key directory**". Optionally also `/.well-known/http-message-signatures-directory` (Web Bot Auth) [WBA]. Upgrade path: VARS registration via `/icc/v1/agents` if the sandbox allows (**UNVERIFIED**).
- **Use the Visa sample as reference only.** Its proxy guards `/product/` only, doesn't check the tag, uses a 1-hour nonce TTL, has conflicting ports (registry hardcoded to 9002), and its merchant-backend regex (`sig1`) can't parse the agent's `sig2` [TAP-REPO, ledger].
- **Wording:** "TAP proves to the merchant **which agent** is acting and with what intent; each human's consent is their own cardholder-initiated authorization." Never "Visa-approved agent".

### 5.6 Regulatory framing for Q&A (not legal advice)

> "The merchant charges each friend directly through split tender: N cardholder-approved authorizations on one order. We never hold or move funds; we orchestrate consent. That's deliberate. FinCEN's definition excludes a payment processor that facilitates purchases of goods or services through a clearance and settlement system by agreement with the seller (31 CFR 1010.100(ff)(5)(ii)(B)). A pooled-card variant, where friends fund one card that pays a third party, is exactly what raises money-transmission questions. We would only do that through a licensed issuing partner, and state law would need analysis we haven't done."

Production path: Visa Intelligent Commerce (`/icc/v1` purchase-intent mandates and agentic tokens; pilot, access gated) replaces the per-share card page.

---

## 6. Team split, timeline and scope

### 6.1 Owners

| Person | Owns | Also owns |
|---|---|---|
| **A: Conversation and platform lead** | **Code foundation (hours 0–3)**: repo, migrations, ports with mocks, Fly deploy, Socket.IO consumer. Photon I/O (assignments, join page, DMs, polls, broadcast). State machine, due_jobs, LLM intake with the privacy guard. | Demo phones, reset script, live demo driver |
| **B: Intelligence lead** | CREAO agents (Researcher, Scribe, schedule), PlannerPort (runs, realtime, webhook re-fetch), option schema and validation, **filter + Nash scorer as pure functions with tests**, Notion. | README (CREAO agent ID and run link), Devpost text, **video (from 6 AM)** |
| **C: Trust and commerce lead** | Venue app: catalog, orders and shares, Microform pay page, Cybersource auth/capture/reversal/timeout reversal, **TAP signer and verifier (both sides, one shared format)**, key directory, ledger and TAP panels. | Security and Visa part of the pitch, Q&A on payments and regulation |

**Interfaces agreed at 12:30 PM (20 minutes, written into `packages/shared`):** `ResearchRequest`, `Option`, `PublicOption`, `Preferences`, `Shortlist`, `Ballot`, `OrderItem`, `Share`/`OrderStatus`, `CommitResult`, `InboundEvent`, the TAP header format (§5.5), and the `/admin` SSE event shape.

**Foundation contents (A, hours 0–3):**
- pnpm monorepo `apps/platform`, `apps/venue`, `packages/shared`;
- SQL migrations (§4.5);
- all 4 ports with mocks;
- `/dev/inbound` simulator;
- due_jobs poller;
- audit_log plus a bare `/admin` SSE page;
- both apps deployed on Fly with secrets;
- Socket.IO consumer echoing "pong" to one real phone;
- `.env.example` and `.gitignore`.

B and C build against the mocks from hour 1.

### 6.2 Timeline (PDT)

| Time | A | B | C | Gate |
|---|---|---|---|---|
| **Now–12:00** | Photon project, key, assignments; Anthropic, Supabase, Fly accounts | CREAO hackathon signup, cr_sk_, Notion connect, credit top-up request | **Cybersource sandbox signup**, key creation, skim TAP terms | All: booth questions (§8), Devpost team. **No code.** |
| 12:00–12:30 | Repo plus skeleton | Build Researcher agent in UI | Cybersource SDK auth→reverse with test card (JWT) | — |
| 12:30–12:50 | **All: contracts session** | | | — |
| 12:50–15:00 | Migrations, ports and mocks, Fly deploy, Socket.IO echo; Photon DM poll send and vote test | CREAO API smoke tests: (1) run returning JSON; (2) Notion page create in API run; (3) time search vs Browser Use ×3 | Microform page on venue origin, TOKEN_CREATE auth, capture; TAP keygen, sign/verify spike (http-message-sig vs hand-built) | — |
| **15:00** | | | | **Go/no-go:** dedicated line? polls in DM? Notion via connector or fallback? Browser Use or search? CLI or app-scoped CREAO? Microform OK? |
| 15:00–20:00 | Join page, intake with guard, state machine, ballots, broadcast, status bubble | PlannerPort real (webhook, poll, re-fetch), zod and repair, filter and scorer with unit tests, Scribe agent | Orders, shares, pay links, commit and cancel endpoints, verifier middleware, ledger panel | — |
| **20:00** | | | | **Checkpoint:** E2E on 2 real phones: join → DM intake → cached options → ballot → real sandbox hold → TAP commit → capture |
| 20:00–02:00 | Due jobs (intake, ballot, approval deadlines), dedupe, card-number intercept | Real CREAO in the loop, realtime progress, Notion write, recurring schedule | Timeout reversal path, cancel→reverse-all, TAP negative tests, verifier panel, key directory | — |
| **02:00** | | | | **Checkpoint:** full real flow on 4 phones, 3 clean runs in a row |
| 02:00–06:00 | Reset script, copy polish, privacy assertion test | Privacy panel, README draft, Devpost draft | Hardening, error copy, stretch only if green | Staggered 2 h rest windows (no sleeping area; whether you can leave to sleep is **UNVERIFIED**) |
| **06:00** | **FEATURE FREEZE** | | | Bug fixes only from here |
| 06:00–08:00 | Drive the recordings | **Record the 2–3 min Devpost video** and backup segments | Verify ledger and TAP shots | — |
| 08:00–09:00 | | Devpost complete; **submit a full draft by 09:00** | | Track + Visa + CREAO (+ Photon if on Devpost) selected |
| 09:00–11:00 | Rehearse the table version ×5 and the stage version ×5; Q&A drill | | | — |
| **11:00** | | | | **Final submit.** 11:30 no deploys. 12:00 code stop. 12:30 Round 1 |

### 6.3 Cut list (cut in this order if behind)

1. GAP_OFFER ("cover the gap"): just reverse all.
2. Notion via connector: confirmation card in chat, or the Scribe updates a pre-created page.
3. Recurring CREAO schedule, and the day-before reminder.
4. `content-digest` extension: keep the path-bound `/checkout/{orderId}`.
5. Browser Use: built-in search over the area or a curated venue list.
6. Native polls: "reply 1/2/3".
7. CREAO realtime stream: polling plus a status bubble.

**Never cut:** private budget filter, privacy assertion test, all-or-nothing holds, decline reverses all, TAP verify on commit, the dashboard ledger, the video.

### 6.4 Stretch list (only after the 02:00 checkpoint is green)

- Per-person approval JWS inside TAP Payment Containers.
- VARS registration via `/icc/v1` (only if the booth enables it).
- Photon voice escalation on the SMS number (Best Voice Agent, ElevenLabs).
- Per-person CREAO taste memory (`conversation_id`).
- "What do you know about me?" privacy DM command.
- "My receipts" command.
- Dedicated-line group mode (if granted).
- Unified Checkout with Click to Pay (only if enabled on the sandbox merchant ID).

---

## 7. Demo scripts, backup and Q&A

### 7.1 Round 1 table (4–5 min per judge, several judges)

Setup: one mirrored phone on the left of the laptop screen, `/admin` on the right. A CREAO run is **pre-warmed** before the judge arrives (say so).

- **0:00–0:20 Hook:** "According to Zelle research, 76% of Gen Z who fronted money for a group expense say they weren't fully repaid. And nobody wants to say 'I can't afford that' in the group chat."
- **0:20–1:10 Judge plays:** the judge scans the QR, enters their number and a **private $30 budget** on the join page, and texts JOIN. Their DM lights up. The shortlist on the team phones changes with no explanation. Point at the privacy panel: "This is everything the LLM saw: no budgets."
- **1:10–1:40 Ballot:** private poll on each phone, the winner is announced, and "here's the CREAO run that found these" (run page).
- **1:40–2:40 Money:** "Your share is $42, hold only." The judge pays with test card 4111…, the ledger shows 4 HELD, the TAP verifier panel shows ✓, and all 4 flip to CAPTURED.
- **2:40–3:20 Trust:** reset. Someone taps Decline and every hold is RELEASED. Then the tamper button: $42→$500 is rejected (digest), and replay is rejected (nonce).
- **3:20+:** Q&A.

### 7.2 Round 2 stage (3 min plus 5 min Q&A)

- **0:00–0:15** Hook (stat plus the "can't afford that" line).
- **0:15–0:35** Thesis: "An assurance contract for the group chat: secret budgets, nobody pays unless everyone's in, nobody fronts the money."
- **0:35–1:20** Kickoff by DM, friends join via the link in their existing group chat, a private budget on one phone, and the privacy panel. "Planner ran on CREAO; we kicked it off before we started talking. Here's the run."
- **1:20–1:45** Private ballots, then the winner announced in every DM.
- **1:45–2:30** "Approve your $42" on 4 phones. The ledger shows HELD, the TAP-verified commit, then CAPTURED. "The venue charged each friend directly; we never touched the money."
- **2:30–2:50** Rewind: one declines, every hold is released, nobody was charged.
- **2:50–3:00** "Photon for presence, CREAO for the brain, Visa rails for trust. Every money decision is plain code; the AI never sees your budget."

### 7.3 Backup plan

- The Devpost video on the laptop, plus clips per beat (join, ballot, ledger flip, decline, tamper).
- Cached options are always ready. Phones run on cellular.
- If Photon is down: play the clips and drive the venue and ledger live from `/dev/inbound` (mock messaging). The payments and TAP part stays fully live.
- Pre-assigned spare phone.

### 7.4 Top judge questions

1. **"Isn't this Splitwise or Venmo requests?"**
   Those settle after someone fronts the money; 76% of Gen Z who fronted say they weren't fully repaid. We change the order: consent and holds first, purchase only when everyone is in, and budgets stay secret.
2. **"What stops the agent, or someone typing '@agent charge Sam $500', from charging people?"**
   The LLM has no payment tools at all. A charge requires that person's own action on the merchant page, through a single-use link bound to their exact amount. Capture only happens after a TAP-verified commit and only up to the authorized amount; Cybersource rejects anything above it (EXCEEDS_AUTH_AMOUNT).
3. **"How is the budget really private?"**
   It's entered on a web form, never in chat. Only one module reads it. A test fails the build if any budget value appears in an LLM or CREAO payload, and the privacy panel shows the exact LLM input.
4. **"Can the group still figure out who's broke?"**
   Partly, over many plans. We show a fixed 3 options, give no exclusion reasons, exclude for several reasons besides price, show counts but never names of who's pending, and warn for groups under 3. We disclose the residual risk.
5. **"Are you a money transmitter?"**
   No funds touch us. The merchant charges each friend directly via split tender; §5.6. Not legal advice.
6. **"How long can holds sit?"**
   Visa's rules (AI13522, April 2024) allow 10 calendar days for cardholder-initiated card-not-present transactions. We auto-release at our own deadline, well inside that.
7. **"What does the TAP signature actually prove? Is your agent Visa-approved?"**
   It proves which agent is acting and for which venue-priced order, with replay and expiry protection. We verify all six spec steps ourselves. The key directory is a labelled mock. VARS registration via Cybersource's `/icc/v1` is the production path.
8. **"What happens on network failures, and can you double-charge?"**
   Cybersource has no idempotency header on payments, so idempotency comes from the DB: unique attempt rows and deterministic reference codes. An unknown outcome triggers a timeout reversal by transactionId after 60 s, never a blind retry.
9. **"What does CREAO do? Remove it and what breaks?"**
   Every option and the itinerary come from CREAO Researcher and Scribe agents. Without them there is nothing to vote on and no plan. Our code only filters, scores and handles money.
10. **"Why DMs instead of a group chat?"**
    Talking about money only works in private. The agent is the confidential mediator, and the group gets only what everyone may see. (Also true: group chat needs Photon's dedicated line.)
11. **"Why Nash welfare?"**
    Maximizing the product of satisfaction means nobody gets a zero, without letting one picky person dominate the way maximin does. It has proven fairness guarantees.
12. **"Business model?"**
    The merchant side: guaranteed group conversion, so a fee per committed group booking. **This is a pitch hypothesis, not validated.**

---

## 8. Questions for the booths and organizers on day one

**Photon booth or Discord (ask first):**
1. Can hackathon teams get a dedicated iMessage line or Business plan for the weekend, so the agent can be in group chats?
2. How is the Photon prize entered? It is not on the Devpost.
3. Does spectrum-ts (Stable) count as "built on Photon 2.0", or must we use `@photon-ai/api` beta?
4. Do native polls render in shared-line direct Spaces, and is iOS 26 required?
5. What is the beta webhook signature header and algorithm, and is Socket.IO delivery fine?
6. Beta rate limits?
7. Which dashboard URL is correct: app.photon.codes or app.beta.photon.codes?
8. Can seats be created and released quickly for judges' phones?
9. Can `message.delete` remove an **inbound** message (a pasted card number)?
10. Does the "we'll double your prize" offer apply here?

**CREAO booth:**
1. Can one project be judged for both Disruptor and Team Empowerment?
2. Do the Notion connector (page **create**) and Browser Use work in API-triggered runs?
3. Typical run latency, and the concurrent-run limit?
4. Any API for one-time schedules?
5. Any webhook signing option?
6. Which plan tier the hackathon account maps to, and whether it includes Developer Console `cr_sk_` and realtime runs?
7. Can the 30 requests/min limit be raised?
8. Where do CREAO judges evaluate projects (at the table?), and will they open the README links?
9. Does the app-scoped trigger accept a thread or conversation field?

**Visa booth:**
1. Does a fresh Cybersource sandbox have TMS, Microform v2 and Unified Checkout enabled, and how fast is activation?
2. **Can a hackathon sandbox merchant ID call `/icc/v1` (VARS agent and key registration, purchase intents)?** Any test merchant IDs?
3. Is a test TAP key directory available?
4. Is adding `@method` and `content-digest` to TAP's covered components acceptable, and is N Payment Containers acceptable for split tender?
5. Do the TAP Product Terms allow sample-derived code in a public repo?
6. Do judges expect a specific Visa API, or is Cybersource plus TAP the intended stack?
7. How long do sandbox authorizations stay capturable?
8. Is the 15-minute DUPLICATE_REQUEST check on by default?

**LA Hacks organizers:**
1. Official text of the Applied Intelligence track (and the other two main tracks).
2. Can the whole team step away to rest off-site overnight?
3. Table power, cellular or hotspot policy, and whether we can mirror to a monitor.
4. Must all 3 be at the table for the whole 12:30–2 PM window?
5. Requirements for MLH Best Domain, Paper Best Designed Hack and Commit Fellowship.
6. Can Devpost submissions be edited before 12 PM after a first submit?

---

## 9. Sources

**Event**
- [FAQ] `C:\Users\chris\orca\projects\la-hacks\hackathon-context\lahacks.md` (user-provided Hacker FAQ)
- [DP] https://la-ai-hackathon-2026.devpost.com/ (curl with a browser User-Agent, HTTP 200; WebFetch is blocked by the WAF)
- [DPR] https://la-ai-hackathon-2026.devpost.com/rules (stale April text)
- https://innovationlab.fetch.ai/events/hackathons/la-hacks-ai-hackathon-2026/hackpack

**Photon**
- [PH-T] `C:\Users\chris\orca\projects\la-hacks\hackathon-context\photon.md`
- [PH-B] https://photon.codes/docs/beta/get-started/imessage.md
- [PH-PB] https://photon.codes/docs/beta/plans-and-billing.md
- [PH-API] https://api.photon.codes/openapi.json
- [PH-WS] https://photon.codes/docs/beta/websocket/connect.md , /events.md , /cursors.md
- [PH-RT] https://photon.codes/docs/spectrum-ts/providers/imessage/connection-and-routing.md
- [PH-DLV] https://photon.codes/docs/best-practices/imessage-deliverability.md
- https://photon.codes/docs/webhooks/verifying-signatures.md (Stable only)
- https://github.com/photon-hq/api/blob/main/CHANGELOG.md
- https://photon.codes/weekly-update/may-14-2026 (prize-doubling claim, unverified)

**CREAO**
- [CR-T] `C:\Users\chris\orca\projects\la-hacks\hackathon-context\creao.md`
- [CR-API] https://docs.creao.ai/pro/api-trigger
- [CR-DEV] https://docs.creao.ai/developer-api/overview , /runs/create-async-run , /runs/get-run-status , /webhooks , /rate-limits , /conversations , /supported-models , /errors
- [CR-SCH] https://docs.creao.ai/features/scheduled-runs
- [CR-AG] https://docs.creao.ai/features/agents
- [CR-BU] https://docs.creao.ai/features/browser-use
- [CR-CON] https://docs.creao.ai/features/skills-and-connectors
- https://docs.creao.ai/features/secrets , /faq , /community-and-updates/changelog , /llms.txt

**Visa / Cybersource / TAP**
- [VISA-T] `C:\Users\chris\orca\projects\la-hacks\hackathon-context\visa.md`
- [CYBS-SPEC] https://raw.githubusercontent.com/CyberSource/cybersource-rest-client-node/master/generator/cybersource-rest-spec.json
- [CYBS-README] https://raw.githubusercontent.com/CyberSource/cybersource-rest-client-node/master/README.md
- [CYBS-SAMPLES] https://github.com/CyberSource/cybersource-rest-samples-node (capture-payment.js, process-authorization-reversal.js, timeout-reversal.js, payment-with-flex-token-create-permanent-tms-token.js, authorization-with-customer-token-id.js, generate-capture-context-accept-card.js)
- [CYBS-REV] https://developer.cybersource.com/docs/cybs/en-us/payments/developer/all/rest/payments/ReversingAuth.html
- [CYBS-RC] https://developer.cybersource.com/content/dam/cybsdeveloper2021/responsecode.json
- [CYBS-MF] https://developer.cybersource.com/docs/cybs/en-us/digital-accept-flex/developer/all/rest/digital-accept-flex/microform-integ-v2/micro-getting-started-pay-card/micro-getting-started-pay-card-ss-setup/creating-server-side-context-v2-card.html (+ transient-token-time-limit-pay-card.html)
- https://developer.cybersource.com/docs/cybs/en-us/digital-accept-flex/developer/all/rest/digital-accept-flex/da-payments/da-auth-token-create-tms-task.html
- [CYBS-TEST] https://developer.cybersource.com/hello-world/testing-guide.md
- https://developer.cybersource.com/hello-world/sandbox.html
- [VISA-AI13522] https://corporate.review.visa.com/content/dam/VCOM/regional/na/us/support-legal/documents/authorization-framework-will-be-updated-to-simplify-authorization-processing-time-frames.pdf
- [TAP-SPEC] https://developer.visa.com/docs/trusted-agent-protocol/trusted-agent-protocol-specifications
- [TAP-REPO] https://github.com/visa/trusted-agent-protocol (cdn-proxy/server.js, tap-agent/agent_app.py, merchant-backend/app/security/signature_verification.py, agent-registry/main.py, LICENSE.md)
- [HMS] https://raw.githubusercontent.com/cloudflare/web-bot-auth/main/packages/http-message-sig/README.md ; https://registry.npmjs.org/http-message-sig
- [WBA] https://developers.cloudflare.com/bots/reference/bot-verification/web-bot-auth/ ; https://blog.cloudflare.com/secure-agentic-commerce/
- https://developer.visaacceptance.com/docs/vas/en-us/intelligent-commerce/developer/all/rest/intelligent-commerce.html
- [CFR] https://www.law.cornell.edu/cfr/text/31/1010.100
- https://docs.lithic.com/docs/cards (pooled-card production fallback only)

**Other**
- [ZELLE] https://www.zelle.com/press-releases/new-zelle-research-group-chat-lit-settling-another-story
- [ANT] https://platform.claude.com/docs/en/docs/about-claude/pricing
- [NPM] registry.npmjs.org (versions checked 2026-10-17)
- [FLY] docs.fly.io/reference/configuration ; docs.fly.io/apps/autostop-autostart
- [PG] https://www.postgresql.org/docs/current/sql-select.html (FOR UPDATE SKIP LOCKED)
- [MNW] https://www.cs.toronto.edu/~nisarg/papers/mnw.pdf
- [SEP] https://plato.stanford.edu/entries/social-choice/
- Past-winner calibration: https://la-hacks-2025.devpost.com/project-gallery ; https://treehacks-2026.devpost.com/project-gallery