# SquadTab: the explainer (what is built and deployed now)

A plain-language guide for any teammate who has to demo SquadTab at the table (4–5 minutes per judge, several judges) or on stage (3 minutes plus 5 minutes of Q&A), and answer sponsor judges. It describes the system **as built and deployed on Sunday morning**, not the original plan.

Sources, most authoritative first: `docs/REPORT.md`, `docs/VERIFICATION.md`, `docs/TEST-GUIDE.md`, `docs/design/ux-flow.md`, `docs/design/design-system.md`, `docs/research/sponsor-excellence.md`, `docs/PLAN.md`, `docs/plans/C-trust-commerce.md` §0, and the code. If this file disagrees with them, they win. Items marked **UNVERIFIED** or **NOT SHIPPED** must not be claimed.

**Quick reference**

| What | Where |
|---|---|
| Web (landing, invite, Trust Console) | https://tab-web-ten.vercel.app |
| Invite page for the demo plan | https://tab-web-ten.vercel.app/j/4821 |
| Trust Console | `https://tab-web-ten.vercel.app/console?k=<CONSOLE_KEY>&ops=1` (key from `.env.local`; never show it on screen or paste it in chat) |
| Agent backend (Fly) | https://tab-agent.fly.dev (`/healthz` returns 200) |
| Venue, i.e. the merchant and pay page (Vercel) | https://squadtab-venue.vercel.app |
| Code | github.com/L00SIRE/SquadTab (`main`) |
| CREAO Scout run share link | https://agent.creao.ai/share/12ea3fa0f9699dabe5175e2cb6eadc28 |
| CREAO agent IDs | Scout `1b834601-b727-40aa-b80d-7e7d1c0cabe0`, Concierge `465a1d2e-a46f-496c-adea-fc471a396a6c` |
| Test card | 4111 1111 1111 1111, any future expiry, CVC 123 |

---

## 1. The 30-second pitch

**Hook (verbatim, always cite it as "Zelle research"):**
> "According to Zelle research (June 2026), 76% of Gen Z consumers who have fronted money for a group expense, like a trip or event, say they were not fully repaid."

**The problem.** Group plans die at two awkward moments: someone has to say "I can't afford that" in front of everyone, or someone fronts the money and then chases friends to get paid back.

**The pitch:**
> "SquadTab is the friend who knows everyone's budget and tells no one. It finds the plan you can all afford, and nobody pays until everyone's in."

**Thesis:** *"Say no without saying why. Nobody pays until everyone's in."*

**30 seconds, said out loud:**
"Plans die when someone has to say 'I can't afford that', or when someone fronts the bill and never gets paid back. Zelle's research says 76% of Gen Z who fronted a group expense weren't fully repaid. SquadTab fixes both. You text it your budget privately in iMessage. A CREAO research agent finds real dinners and shows, plain code keeps only plans that fit everyone, and nobody learns whose budget ruled anything out. Then each person's card is only *held* for their own share, and the purchase goes through only when every hold is in. One person drops, every hold is released."

**The only privacy claim we make:** *"Only your own agent hears your budget. CREAO, the group messages, and everyone else's agent never get it, and every money decision is plain code."*

**Product line:** *"SquadTab never joins your group chat, on purpose. Money talk only works in private."*

---

## 2. The live demo, beat by beat

### Before every judge (2 minutes)

1. Use cellular data or a hotspot on the phones, never venue Wi-Fi. iMessage blue bubbles only.
2. Laptop: open the Trust Console with `&ops=1` and type the operator key into the ops field.
3. Open one pay page and check its header. It should read **"Cybersource sandbox · shared public test merchant"**. If it reads **"Simulated payments (no Cybersource call)"**, you are in mock mode. Then say "labelled simulation" all demo long (see section 9).
4. Press **Reset**, then **Confirm reset** within 3 s. The demo plan comes back at VOTING with 3 real picks in 4–9 s. Reset seeds the demo plan ("Dinner + show", Westwood / Sawtelle, starting 17:30) with the two team phones already in, and loads the cached real Scout results.
   - **Never press Reset while a judge is mid-flow.** It cancels every active plan, not just the demo.
5. If seats are filling up (more than about 18 of 25), press **Release untexted**. That frees only the seats of people who never texted. **Release seats** frees everyone outside the team, so use it only between rounds.
6. On the laptop, open https://tab-web-ten.vercel.app/j/4821. On desktop, that page's main element is a QR code, "Scan to join on your iPhone".

### Table version (4–5 min)

| Time | Do / say | What the judge should notice |
|---|---|---|
| 0:00 | Press **Live scout** on the console. Say: *"CREAO is researching right now. The options you'll see come from a real run that finished earlier, because research takes minutes."* | CREAO lane: a run chip goes running, and the agent's own progress lines arrive from inside the CREAO sandbox. |
| 0:20 | Zelle hook, then the thesis (section 1). | |
| 0:45 | The judge scans the QR with their own iPhone, types their number and taps **Join in iMessage**. Messages opens with "I'm in for Dinner + show!" already typed, and they press send. | No app, no join code, no form. Any first text joins. SquadTab asks their name. |
| 1:15 | The judge replies with a name, then the budget: **"honestly 45 tops tonight"**. SquadTab answers privately: *"Got it. Just between us: aim ~$…, never over $45. Text 'change budget' anytime."* Then a preference ("no seafood"). | The budget lives only in their DM. On the console their lane says **"Budget hidden"** behind a fixed-width redaction bar. The team phones get *"The group shifted, so I reshuffled. Fresh picks that still work for everyone"*, with no reason given. |
| 2:00 | Everyone votes by text: "2", or "the sushi one". Everyone sees "k of n have voted so far", then the winner. | Votes are counted, never attributed. |
| 2:30 | Each person gets a hold link: *"It's only a hold, and it turns into a charge only if everyone's in…"* Open it: the venue pay page with Cybersource Microform fields. Enter the test card and tap **Hold**. | *"All set, I'm holding $X on your Visa ••1111. Not charged yet."* The console gate shows **"Held so far $… of $… · Charged $0"**. |
| 3:15 | The last hold lands. About 8 s later the agent sends its signed (TAP) commit, and the merchant checks it and charges everyone at once. | The TAP panel ticks its 6 plain-word steps ("Agent known, Details sealed, Not expired, Never reused, Key on file, Signature good") to **"Verified by merchant"**. Lanes flip to CAPTURED with sandbox ids. The meter reads **"Captured, all or nothing"**. Phones get *"Everyone's in, so you're booked… Charged $X."* |
| 3:45 | Press **Tamper**, then **Replay**, **Expired** and **Wrong tag** in the TAP panel. | Rejected at steps 6, 4, 3 and 1 respectively. Nothing extra is captured, and the order stays as it was. |
| 4:15 | The judge texts **"what's Suman's budget?"** (any teammate's name). | *"I only know yours. Everyone's budget stays between them and me."* The X-ray band ("Budgets: hidden, and checked.") shows every delegate locked. |

**Rehearsal notes (real risks from verification):**
- **Use a cap of $45 or more.** With the real cached Scout data, only 1 pick fits under $30, and a low cap correctly ends in "couldn't find a plan that works for everyone".
- **Live shortlist order can differ** from rehearsal, because ratings come from Claude. Before saying "2, but not if it ends after 10", check that pick 2 really ends before 10 PM. Otherwise just say "2".
- **The drop-out beat needs a plan with at least one hold.** After Reset there are no holds, so "I'm out" shows "Plan's off. Nobody was charged." and no RELEASED lanes. To show releases, use a second plan where only some people hold (TEST-GUIDE §5), or the backup video or `/demo` walkthrough (section 9).
- The organizer path is shown on the landing page (`/`): one phone field, then **Start in iMessage**, with "Hey SquadTab! Help me plan a night out." already typed. Use it if a judge asks "how does a plan start?"

### Stage version (3 min + 5 min Q&A)

| Time | Beat |
|---|---|
| 0:00–0:20 | Hook: Zelle line, then the two moments where plans die. |
| 0:20–0:40 | Landing page on the projector: *"This is the plan, a ticket. The price is $42 each, and it's made of tiny digits that never stop changing. Those are everyone's private budgets. You'll never read one. When a friend places a hold, their piece goes solid. Amber means held, not charged."* (This hero is a scripted animation with demo names, not live data. Say "here's the idea", not "here's a live plan".) |
| 0:40–1:10 | Phone mirrored: the budget goes in privately ("Just between us…"), the other phones get reshuffled picks, then *"what's Suman's budget?"* → *"I only know yours."* |
| 1:10–1:35 | Console CREAO lane: live Scout progress, then the run thread's validate/fix loop. *"Remove the agent and SquadTab has nothing to vote on."* |
| 1:35–2:20 | Holds go in. The gate reads "Charged $0" until the last one, then the signed commit, TAP 6/6, CAPTURED. Press Tamper: rejected, nothing captured. |
| 2:20–2:45 | Drop-out: one person out, every hold released, nobody named. Use the prepared second plan or the clip. Never Reset on stage. |
| 2:45–3:00 | *"Say no without saying why. Nobody pays until everyone's in. Every money decision is plain code; only your own agent hears your budget."* |

**The phone is the hero; the console is the evidence.** Judges remember the phone.

---

## 3. How it works

```
 Judge's / friends' iPhones ── one private iMessage DM each (the user texts first)
        │                                         ▲
        │  web: one phone field                   │ Photon 2.0 free shared lines
        ▼  (tab-web-ten.vercel.app)               │ (Socket.IO events in, REST sends out)
 ┌──────────────────────── SquadTab agent (Fly: tab-agent.fly.dev) ────────────────────────┐
 │ router → private Claude delegate per person (own data only) → reply guard               │
 │ plan state machine · fixed templates · fair shortlist (pure code) · holdGate            │
 │ durable jobs in Postgres · TAP signer (Ed25519)                                          │
 └───────┬──────────────────────────────┬───────────────────────────────┬──────────────────┘
         │ API Trigger + webhook/poll   │ TAP-signed HTTPS               │ live event stream (SSE)
         ▼                              ▼                                ▼
 CREAO (agent.creao.ai)          SquadTab Partner Venue           Trust Console (web)
  Scout: dinners + shows          (squadtab-venue.vercel.app)      lanes · gate · X-ray ·
  Concierge: itinerary + .ics     merchant of record · prices      CREAO lane · TAP panel ·
  `tab` CLI → /agent/* on the     orders · Microform pay page ·    ledger · counters
  agent (progress, options,       6-step TAP verifier
  itinerary)                              │
                                          ▼
                     Visa Cybersource sandbox (public "testrest" merchant):
                     hold (auth, capture:false) · saved-card token · capture · release
 Supabase Postgres: separate schemas and roles for the agent and the venue
```

- **Web app** (Next.js on Vercel). Asks for exactly one thing, your iPhone number, then opens Messages with your first text typed. After you text, the page becomes a live status page. It also hosts the invite page `/j/[code]` and the Trust Console.
- **Photon 2.0.** Gives each user a SquadTab number on iMessage through Photon's free shared lines. It delivers inbound texts to our backend over a resumable event stream, and sends our replies, typing indicators and read receipts.
- **Agent backend** (TypeScript, Hono, on Fly). The brain. It routes each text to that person's **private delegate** (Claude Haiku), runs the plan state machine, sends fixed templates for anything about money or privacy, and does all filtering, scoring and money decisions in plain code. Every side effect runs as a durable job in Postgres, so a crash resumes where it stopped.
- **CREAO.** Two saved agents. **Scout** researches real dinners and shows on the open web. **Concierge** writes the itinerary after booking. Both report back through our `tab` command-line skill, which validates their output before submitting.
- **SquadTab Partner Venue** (Next.js on Vercel). Our demo merchant of record. It prices every order itself, hosts the Microform pay page, verifies the agent's signed requests, and is the **only** place Cybersource credentials and card tokens exist.
- **Cybersource sandbox.** Real sandbox holds, captures and releases, on Cybersource's published public test merchant (section 6).
- **Trust Console.** A projector screen that proves the claims live: lanes per person, the all-or-nothing gate, the privacy X-ray, the CREAO lane, the TAP panel and the ledger.

---

## 4. Key concepts, explained simply

### Private delegates and context isolation
Each person gets their own **private delegate**: a Claude call that sees **only that person's own message plus their own state and public plan facts**. The budget parser turns "around 60, 90 tops" into a structured budget, and code confirms it back with a fixed template. From then on **code owns every number**. The chat replier (natural replies to free-form texts like "lol ok" or "what happens next?") is given no budget value at all.

Privacy is enforced by **what each model can see** (context isolation), not by asking a model to keep a secret. A model can't leak what it never received.

### Why there is no group chat and no group AI
- **Product reason:** money talk only works in private. The group sees only counts ("3 of 4 are in"), never names or amounts.
- **No group LLM.** Every message that goes to more than one person is a fixed template, plus Scout's short public pitch text. Generated text only ever goes to the one person whose delegate wrote it.
- **Platform reason (say it if asked):** Photon's free shared lines support DMs only. Group chats need a paid dedicated line.

### The reply guard
Before any generated reply is sent, code checks it. It blocks any dollar amount, anything card-like, any echoed internal label, and **any number that wasn't already in what that person's delegate was given** (their own text, plus public facts like times and counts). If the check fails, a fixed template goes out instead. The guard deliberately never compares against other people's budgets. If it did, "blocked vs sent" would itself leak a budget. This closed a real bug found in verification: asking "60 plus 2?" could have been used to fish for a number.

### Holds vs captures vs releases
- **Hold (authorization):** the card is reserved for your share but not charged. You may see a pending item.
- **Capture:** the hold becomes a charge. SquadTab captures **only when every share is held**.
- **Release (reversal):** the hold is cancelled and never charged. Say "released", never "$0 instantly" or "refunded". The bank decides when the pending item disappears.

### The assurance contract (all-or-nothing)
A deal that happens only if everyone commits, like Kickstarter. If one person says "I'm out", says NO, or misses the deadline, every hold is released: *"Plan's off. Nobody was charged; your pending authorization was released."* Nobody is named.

### Split tender and merchant of record
- **Split tender:** one purchase paid by several cards, each paying its own share.
- **Merchant of record:** the business that sells and charges. Ours is **"SquadTab Partner Venue (sandbox merchant of record)"**, selling a prepaid, ticketed dinner + show bundle, so charging at booking is normal. SquadTab itself never holds or moves money.

### TMS tokens and Microform
- **Microform** is Cybersource's hosted card field, in an iframe. The card number goes straight to Cybersource, and our server receives only a short-lived token.
- **TMS token:** Cybersource's saved-card token, created with the first hold, so the next plan is one tap.
- If someone pastes a card number into chat, a Luhn check catches it **before** any AI, database or log sees it.

### Visa Trusted Agent Protocol (TAP)
The agent **signs** its requests to the merchant (Ed25519, HTTP Message Signatures, RFC 9421). The commit request covers the exact consent set: the order, the total, and each person's authorization and amount. The venue rebuilds that set from its own database and runs 6 checks, stopping at the first failure:
1. **Tag:** the right intent for this route (browse vs pay).
2. **Params:** every required field is present.
3. **Timestamps:** not expired. We sign for 120 s; the maximum window is 8 min.
4. **Nonce:** never used before.
5. **Key:** the key id is in the directory.
6. **Signature:** valid over the exact request, with the body digest matching.

- **What it proves:** which agent is acting, what it intends, for which venue-priced order and exact consent set, and that the request is fresh and not replayed.
- **What it does NOT prove:** that Visa approved our agent. The key directory is a labelled **mock**; the production path is Visa agent registration. We send no Agentic Payment Container, because each human pays their own share.

### holdGate
A private check before any pay link goes out. If your share is above your private max (for example, after a price change), you get *"Just between us: your share would be $X, which is over the max you gave me. Reply YES to hold it anyway, or NO to sit this one out."* NO counts as "I'm out". This is the spending-limit idea.

### The fair shortlist
1. Code pairs dinners with shows that fit in time: the dinner open for at least 90 minutes, the show starting 90–150 minutes after the plan starts.
2. **Hard filter:** the all-in price per person (with LA tax 10.25% and an 18% dinner tip) must fit **every** member's max. If someone gave no max, it is their target + 10%. Diet and time must fit too.
3. Each person's delegate rates the survivors from **preferences only**.
4. Code picks 3 diverse bundles (no shared dinner or show) that maximize the group's combined satisfaction so that **nobody gets a zero and one picky person can't dominate**. The technical name is Nash welfare, the product of satisfactions; say it only if asked. A code-only "comfort" nudge favors prices nearer each person's target.
5. The winner is the most approvals, with ties going to the fairer option.

The filter is a fixed pipeline step, not a tool any AI can call, so nobody can probe it repeatedly to work out the lowest budget.

---

## 5. Per sponsor

### Photon (iMessage track: $700 winner, $300 runner-up)

**What they asked for:** built on Photon 2.0 and live on at least one Photon channel. Judged on Vision (hybrid intelligence), Craft (cohesive, **responsive**), Depth (real-world context and edge cases) and Traction (real users tomorrow).

**How we use it:**
- `@photon-ai/api` 0.5.0 against Photon 2.0, plus the Socket.IO event stream with a saved replay cursor. The stream resumes after deploys, and duplicate deliveries are dropped.
- Live iMessage DMs on free shared lines. A seat is assigned by API when someone enters their number, and each user may get a different SquadTab number (Photon's shared-line design).
- The shared-line rules shaped the product: **the user must text first** (hence the web hands off with the text pre-typed), **DMs only**, and **no threaded replies** (they return 409 `SPACE_NOT_SENDABLE`, so we never send them).
- Craft: read receipts and typing indicators on real traffic. Idempotent sends: resending with the same key returned the same message id and delivered nothing extra.

**Verified live:** a test message reached a team phone in 2.2 s. The first reply comes 1–3.9 s after the inbound text, with delivery to the handset in 1–5 s.

**Wow moment:** the judge joins from their **own** phone in three taps, types a secret cap, and the other phones' picks reshuffle with no reason. Then "what's Suman's budget?" → "I only know yours."

**One-liner:** *"No app, no new group app: it works with the friends you already text, and your budget never leaves your DM."*

**Hard questions:**
1. **"Is this really Photon 2.0?"** Yes: `@photon-ai/api` against the 2.0 API plus its event stream. The brief also links the spectrum-ts SDK; we use the 2.0 REST and event API directly.
2. **"Why not a group chat? Isn't that the natural place?"** On purpose: money talk only works in private, and the group sees only counts. It's also true that shared lines are DM-only; groups need a paid dedicated line. The organizer pastes our invite link into their existing group chat.
3. **"Why make users go through a web page first?"** A shared line can't send the first message; the user must text first. So the web asks for one field and opens Messages with the text typed. That's 3 interactions, the platform minimum.
4. **"Why no polls or tapbacks?"** They aren't in the 2.0 iMessage content types. Voting is "reply 1/2/3" or free text, parsed by that person's own delegate.
5. **"How responsive is it?"** Read receipt and typing right away; first reply 1–4 s on real traffic. During minutes-long research we keep typing alive and send at most one "Still on it!" text.
6. **"What happens on a reconnect or a duplicate event?"** Inbound events are de-duplicated by id, and the cursor is saved only after a successful handle. Sends carry idempotency keys, so a redelivery never double-texts.
7. **"What about capacity?"** The free tier has 25 seats. A full plan gets a clear "packed" message, and seats of people who never texted are released by an operator button.
8. **"Where's the hybrid intelligence?"** A private delegate per friend, a plain-code mechanism between them, and humans keep the final yes: votes, holds, and holdGate YES/NO.
9. **"Does the SquadTab name or avatar show on the shared line?"** UNVERIFIED. Don't claim it.

**Honest gaps:** no threaded replies or visible avatar; the long CREAO waits; the Photon prize entry path is still open (Photon isn't on Devpost; ask the booth). **Voice is NOT SHIPPED:** the code exists behind a flag that is off by default. Don't mention it unless asked.

### CREAO (Best AI-First Disruptor: $2,000)

**What they asked for:** at least one CREAO agent does the core work, built on agent.creao.ai; the README includes a run share link and the agent ID; show the agent running. The test: *"Remove the agent, and the product stops working."* Rubric: AI as foundation 30, Depth on CREAO 25, Originality 20, Track fit 15, Demo 10.

**How we use it:**
- **Scout** produces **every option the group can vote on**. Two runs go in parallel (dinner, show), returning real venues, prices, open-at-time or showtime evidence and dietary fit. Code only filters, composes and scores.
- **Concierge** runs **after** booking and produces the itinerary (logistics) and a calendar file, which we host and text to each DM.
- **API Trigger:** our backend starts runs over HTTPS with an idempotency key. The webhook is unsigned, so it's treated as a hint: we re-fetch the run and also poll every 15 s. Scout times out at 12 minutes and falls back to cached options.
- **The `tab` CLI skill** (in the repo at `skills/tab`, saved into the agents' environment):
  - Scout posts `tab progress` lines, which appear live on our console.
  - It writes its options, runs `tab options validate`, fixes errors (up to 5 rounds) and runs `tab options submit`.
  - A Concierge itinerary that swaps in different venues is rejected (422).
- **Secrets:** CREAO holds only a narrow, revocable `TAB_AGENT_TOKEN` (it reaches only `/agent/*`) and our API address. The CREAO account key stays on our server.
- **Privacy:** Scout's input is area, date, time, party size and anonymous diet tags. No names, phones or budgets.
- **Cached fallback:** a real Scout snapshot from today (runs ea61eeb8 and deee9e1f), not placeholder data. The console labels every run **live** or **cached**.

**Verified:** 3 real runs through production. Scout dinner took 3m19s (12 real Westwood/Sawtelle venues). Scout show took 9m55s (12 venues with dated showtimes). Concierge took 1m39s (real logistics, a correct .ics). We also fixed a real bug: CREAO returns some fields as null, which made every run read as "running" or "timed out". It is now parsed correctly, with live runs read as completed.

**Wow moment:** press **Live scout** and the agent's own progress lines stream onto our console from inside the CREAO sandbox. Then open the [API] run thread and show it failing our schema check, fixing it and submitting.

**One-liner:** *"CREAO does the open-world work; fast per-message parsing stays local for responsiveness. Remove the agent and SquadTab has nothing to vote on."*

**Hard questions:**
1. **"Is that run live?"** The run started on the console is live; watch its progress. The options in the flow come from a **pre-warmed real Scout run** that finished earlier, because runs take 3–10 minutes. The console badge says cached, and we say so.
2. **"Couldn't Google Places do this?"** Scout researches dinner **and** shows: showtimes, open-at-time evidence, dietary fit and price evidence from the open web. A Places API covers one category and has no show times.
3. **"Why Claude as well as CREAO?"** Per-message parsing needs about 1 s responsiveness and strict per-person isolation, so it stays local. CREAO does the minutes-long research.
4. **"How do you trust the agent's output?"** Our CLI validates against a schema in a fix loop before submitting. Our server validates again. If anything is unparseable, we fall back to cached options; we removed an LLM "repair" step because it invented venues.
5. **"Unsigned webhooks?"** The webhook only triggers a re-fetch of `GET /api/v1/runs/{id}`. We de-duplicate on run id and delivery id, and poll every 15 s.
6. **"What does CREAO know about users?"** A research brief with enums, area, date, times and party size. Nothing personal.
7. **"Duplicate runs, credits?"** Only the backend starts runs, each with a per-step idempotency key; replays returned the same run id. The live demo button is debounced to once per 3 minutes.
8. **"What if CREAO is down?"** Tested: bad app id, 5xx and hang/timeout all fell back cleanly to cached options or a code-built itinerary.
9. **"Notion page?"** Planned as a Concierge output; not verified live. Don't claim it.

**Honest gaps:** the pre-warmed run for the flow; a Concierge run that fell back may still be labelled "live" (open item); the team still needs to add "use the dinner and show exactly; never substitute" to Concierge's instructions in the CREAO UI.

### Visa / Cybersource ("The Future of Shopping": $2,000)

**What they asked for:** AI transforming stages of the shopping journey. Innovation 25, User Experience 25, Technical Execution 20, Commerce Impact 15, Trust & Responsibility 15.

**How we use it:**
- **Shopping stages:** discovery (CREAO) → decision (private vote, fair shortlist) → personalization (private caps) → checkout and payments (split-tender holds plus a signed commit) → post-purchase (receipt texts, itinerary).
- **Cybersource sandbox, all verified on testrest:**
  - hold (auth with `capture:false`) plus saved-card token creation (`TOKEN_CREATE`);
  - one-tap with a saved card;
  - capture, plus a double capture correctly refused;
  - release (reversal);
  - timeout reversal by transactionId, for a hold whose outcome is unknown;
  - transaction lookup (TSS);
  - Microform v2.
- **A real browser test:** cards typed into Microform were held; an invalid card was rejected in the browser before any call.
- **Charges only after every hold:** proven 3 independent ways (venue timestamps, event order, and a snapshot with one hold missing showing nothing captured). 12 auths and 12 captures, all 201.
- **TAP:** our own signer and 6-step verifier. A 27-case live attack suite passed: tamper, replay, expired, wrong tag, wrong authority, and 5 parallel replays with exactly 1 accepted. A validly signed but forged consent was rejected with no capture.
- **Trust:** holdGate, card data only in Microform, single-use amount-bound pay links, "released" wording, and "Key directory: mock" always shown.
- **Commerce impact:** counters from our own data only: groups booked all-or-nothing, $ fronted by any one person (always $0), holds released. No invented statistics.

**Wow moment:** the gate meter reads "Held so far $… · Charged $0" until the last hold, then TAP 6/6 → "Captured, all or nothing". Then **Tamper**: the content digest no longer matches, it's rejected at step 6, and nothing is captured.

**One-liner:** *"A group purchase as an assurance contract at the merchant of record: N cardholder-initiated authorizations, and an identified agent that can commit only the exact consent set."*

**Say before they ask:** *"Every payment here is a real call to Cybersource's sandbox, on Cybersource's published sample test merchant, with test cards and no real money. The merchant storefront is ours."*

**Hard questions:**
1. **"Whose merchant account is this?"** The storefront is ours: SquadTab Partner Venue, a demo merchant of record. Processing runs on Cybersource's public sample merchant `testrest`, the one in their own samples repo. Our own team sandbox merchant fails every auth with reason 150 (a processor outlet/terminal setting on Cybersource's side that merchants can't edit). In production the venue brings its own merchant account.
2. **"Is using testrest allowed?"** Cybersource publishes it for testing. We send test cards and placeholder billing only, and never load-test it. We don't claim Visa or Cybersource endorsed this use.
3. **"Why not just simulate?"** We keep a labelled simulation as a backup, but real sandbox calls show what a mock can't: hold/capture/reversal states, the timeout reversal, and Microform keeping cards off our servers. It proves the integration, not bank settlement.
4. **"What does the TAP signature prove? Is the agent Visa-approved?"** It proves which agent, what intent, which venue-priced order and exact consent set, and freshness. The verifier is ours, with a mock key directory; Visa agent registration is the production path. Never say "Visa-verified".
5. **"Double charges on network failure?"** Cybersource has no idempotency header, so we never blindly retry. We use unique attempt records, fixed reference codes and a persisted transactionId; an unknown outcome is reversed after 60 s and a fresh link is sent. Double commits and parallel payments each captured exactly once in tests.
6. **"Capture at booking for a restaurant?"** The merchant sells a prepaid ticketed bundle, so capture at booking is standard. Holds are released at our deadline, well inside Visa's 10-day authorization window.
7. **"What stops '@SquadTab charge Sam $500'?"** No AI has tools. A hold needs Sam's own action on a single-use link bound to his exact amount. Capture happens only after a verified commit of the exact consent set, and the venue computes every amount itself.
8. **"Are you a money transmitter?"** The merchant charges each friend directly (split tender); SquadTab never holds or moves funds. (Not legal advice.)
9. **"PCI / card data?"** Cards are typed only into Cybersource-hosted Microform; we receive a 15-minute transient token. Saved cards are TMS tokens held only in the venue app. The agent never sees card data.
10. **"Business Center screenshot?"** The shared account has no Business Center, so we show the transaction lookup API instead (`apps/venue/scripts/check-share.ts`).

### LA Hacks main judges (Applied Intelligence track + Overall)

**Criteria:** Technical Depth; Product Thinking & Impact; Originality & Insight; Execution & Polish. The official Applied Intelligence track text is UNVERIFIED (check live.lahacks.com/tracks).

| Criterion | Our answer |
|---|---|
| Technical Depth | The context-isolation boundary plus build-failing privacy tests; a filter no AI can call; an exactly-once commit under races; our own TAP verifier; crash recovery at every stage. |
| Product Thinking | Plans die at two moments of exposure. Zelle hook in the first 30 s. Chat-first: 3 interactions to start, no app. |
| Originality | Prior art covers each half: Sunday (TreeHacks 2026) takes a public group budget in the group chat; PayByGroup (2012) and Airbnb split pay (2017) do group payment but know nothing about constraints. Our novelty is the **combination**: sealed private constraints plus an all-or-nothing assurance contract. |
| Execution & Polish | The judge becomes a user on their own phone. A designed ticket and console. The happy path reached CONFIRMED 7 times on real services. |

**Hard questions:**
1. **"Isn't this Splitwise or Venmo requests?"** Those settle **after** someone fronts the money. We flip it: private limits, then holds, then purchase only when everyone's in. Nobody fronts.
2. **"How is the budget really private?"** Only your own delegate reads it; code owns the number; group messages are templates; CREAO gets enums. A test seeds odd budgets ($31.17, $47.29…) and fails the build if any appears outside its owner's delegate and DM.
3. **"Can the group still infer who's tight?"** Partly, over many plans. We always show 3 picks, never explain exclusions (diet, time and area also exclude), show counts not names, and no AI can probe the filter. We disclose the residual risk.
4. **"Where's the AI, if code makes the decisions?"** AI does what it's good at: understanding each person's messy text, open-world research, and ratings from preferences. Code does what must be trusted: money, privacy and fairness.
5. **"Prompt injection?"** The delegates have no tools, and a reply can only contain numbers the person's own delegate was given. Injection, role-play and obfuscated-name probes all got "I only know yours."
6. **"Business model?"** Merchant side: guaranteed group conversion, so a fee per committed group booking. This is a hypothesis, not validated.
7. **"What was built this weekend?"** All of it, from the first commit Saturday 2:53 PM to the final report Sunday morning.

---

## 6. Honest limits, and how to say them

| Limit | How to say it |
|---|---|
| **Public testrest merchant** | "Real Cybersource sandbox calls on Cybersource's published sample test merchant. It's shared and test-only. Our own merchant's processor wasn't provisioned (reason 150)." Never say "our merchant account", "Visa-provided" or "approved". |
| **Cybersource support contact** | Say "we contacted Cybersource support" **only if the contact form was actually sent**. As of the final report it was an optional open item. Otherwise say "it's a Cybersource-side setting we can't change." |
| **Pre-warmed CREAO run** | "The run you see starting is live. The options in this flow come from a real run that finished earlier, because research takes minutes. The console labels it cached." |
| **Mock key directory** | "The signature and the six checks are real; the key directory is a labelled mock. Production is Visa agent registration." |
| **Shared lines, no group chat** | "DM-only on purpose. Also, free shared lines can't do groups, can't text first, and reject threaded replies." |
| **Regulatory framing** | "The merchant charges each friend directly; we never hold funds. Not legal advice." |
| **Simulation mode** | If the pay page says "Simulated payments", say "this run is our labelled simulation; the TAP check and all-or-nothing logic are the same code, and only the processor call is stubbed." |
| **Business model** | "A hypothesis, not validated." |
| **Not shipped or unverified** | Voice (off), the Notion page, avatar visibility on shared lines, and the official track text. Don't claim any of them. |

Known rough edges from the verification ledger (they may have been fixed since; don't volunteer them, and answer honestly if seen):
- The vote tally goes to the whole group after every vote.
- The picks text can say "found 3 plans" when there are fewer.
- Only one "still looking" text is sent during a slow live Scout.

---

## 7. Technical depth talking points

- **Exactly-once commit.** The last hold moves the plan `APPROVING → COMMITTING` with a conditional SQL UPDATE, and only the one worker that gets a row back proceeds. Commit vs cancel, double commits, parallel payments and duplicate hooks each captured **exactly once** in tests.
- **Idempotency everywhere:**
  - Photon: inbound de-duplicated by event id, deterministic outbound keys.
  - CREAO: idempotency keys, plus de-duplication on run id and delivery id.
  - Cybersource: no idempotency header, so unique `(share, op, attempt)` rows, deterministic reference codes, a persisted transactionId and a timeout reversal. Never a blind retry.
  - Venue hook: HMAC-signed with timestamp skew checks, and outbox redelivery until the agent returns 200.
- **Crash recovery.** State and side effects live in Postgres as durable jobs. The agent recovered from a kill at every stage, including mid-COMMITTING, and survived a 16 s database outage, including the LISTEN re-subscribe. A plan can never get stuck in ORDERING: it cancels on a permanent 4xx or after 8 attempts.
- **The all-or-nothing gate.** The venue captures only if every share is AUTHORIZED, the shares sum to the total, and the signed body equals the consent set rebuilt from its own DB. Amounts always come from the venue's DB, never from URLs or model output.
- **Privacy tests (they fail the build):**
  - P1: an import and SQL allowlist; only 5 files can touch budgets.
  - P3: only the notify module can send messages.
  - P5: no recorded model request contains `tools`.
  - P7: odd seeded budgets must appear only in their owner's delegate calls and DMs.
  - P8: the SSE event schema has no budget fields.
  - Live: a recording proxy captured **53 Claude calls and 1,436 artifacts with no leaks**. Card numbers never reached the model, the DB, SSE or logs.
- **Security.** Every protected route returns 401/404 in prod and `/dev/*` is off. CORS allows only the web origin, and the rate limit can't be bypassed by spoofing the IP. SQL is parameterized. The itinerary page escapes everything and has a strict CSP. There are no secrets in git, bundles or logs.
- **Tests.** About **1,450 automated tests** pass (final report). An itemized earlier run: agent 754, venue 75 (real Postgres), shared 62, web 85; privacy suites 16 of 16; typecheck clean. Evidence: `docs/VERIFICATION.md`.
- **Models.** Claude Haiku 5.5 for delegates and replies (fast, per person), and Claude Sonnet 5.5 for per-person ratings. No model call ever has tools.

---

## 8. Words to use and avoid on stage

| Avoid (unless a judge asks) | Say instead |
|---|---|
| "agents negotiate", "advocates", "multi-agent negotiation" | "a private delegate per friend", "sealed constraints", "a plain-code mechanism" |
| "Nash welfare" | "a fair pick where nobody gets a zero" |
| "RFC 9421" | "a signed agent request (Visa Trusted Agent Protocol)" |
| "Visa-verified", "Visa-approved" | "verified by the merchant; mock key directory" |
| "$0 instantly", "refunded" (for a hold) | "released"; "Nobody was charged; your pending authorization was released." |
| "charged" (before capture) | "held" |
| "no budget ever enters any AI" | "Only your own agent hears your budget." |
| "our merchant account" | "Cybersource's public sandbox test merchant; the storefront is ours" |
| "live CREAO results" (for the flow) | "a real run that finished earlier, while a live one streams" |
| A real restaurant as the merchant | "SquadTab Partner Venue (sandbox merchant of record)" |
| Voice, Notion, avatar | Don't mention them; they're not shipped or not verified. |

---

## 9. If something breaks during the demo

In this order:

1. **Retry once.** Between judges, Reset and run it again.
2. **No reply to a text.** Check it's a blue bubble, sent to **your own** SquadTab number (each phone has its own line), and that you're on cellular. Send again. If it's still silent, check `fly logs -a tab-agent`.
3. **"Couldn't find a plan that works for everyone".** The cap was too low. Use $45 or more. This is correct behaviour, so say so.
4. **CREAO slow or failing.** Reset always uses the cached real Scout results. A real plan falls back to cached options after 12 minutes. The console labels it cached.
5. **Cybersource flaky** (2 failures in 10 minutes, or one 401/403/429). Finish or cancel the plan, then at a plan boundary set `CYBS_MODE=mock` on the venue's Vercel project and redeploy. Send fresh links. The page then says "Simulated payments" and ledger ids read `SIM`. Say: *"This run is our labelled simulation; the TAP verification and the all-or-nothing logic are the same code. Here are real sandbox ids from rehearsal."* Never flip back during a judge session. To flip back later: `CYBS_MODE=live`, redeploy, `delete from venue.customers;`, then run `cybs-smoke.ts`.
6. **Photon down.** Play the backup video (2–3 min). The venue's `/demo` page (https://squadtab-venue.vercel.app/demo) is a scripted walkthrough with the real template copy and pay page (no DB or Cybersource calls), so label it as a walkthrough. For a live payments proof without phones: run `pnpm demo` in `apps/venue` locally (real sandbox holds, TAP 6/6, tamper, wrong tag, expired, release).
7. **Console looks wrong.** Reload it; the event stream recovers after an agent restart. Never press Reset mid-judge.

**After the event:** unset `AGENT_API_ALLOW_TEST_REF`, and rotate `CONSOLE_KEY`, `TAB_AGENT_TOKEN` and the Supabase password.
