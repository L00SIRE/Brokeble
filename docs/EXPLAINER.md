# SquadTab: the explainer

A plain-language guide for teammates who need to demo SquadTab and answer judge questions with confidence. It summarizes `docs/PLAN.md` and `docs/research/sponsor-excellence.md`. If anything here disagrees with those files, they win.

---

## 1. SquadTab in one minute

**The problem.** Group plans die at two awkward moments:
1. Someone has to say "I can't afford that" in front of everyone.
2. Someone fronts the money and then has to chase friends to get paid back.

The impact hook, word for word: *"According to Zelle research (June 2026), 76% of Gen Z consumers who have fronted money for a group expense, like a trip or event, say they were not fully repaid."* (Same research: 20% have cancelled plans, muted or ignored group chats to avoid repayment.) Always cite it as "Zelle research".

**The insight.** Fix both moments together:
- Everyone tells SquadTab their budget **privately**, and SquadTab only shows plans that fit everyone, without ever saying whose budget ruled something out.
- **Nobody fronts money.** Each person's card is held for their own share, and the purchase only goes through once everyone is in.

**The lines to memorize.**
- Thesis: *"Say no without saying why. Nobody pays until everyone's in."*
- Pitch: *"SquadTab is the friend who knows everyone's budget and tells no one. It finds the plan you can all afford, and nobody pays until everyone's in."*
- Product: *"SquadTab never joins your group chat, on purpose. Money talk only works in private."*
- Privacy (the only privacy claim we make): *"Only your own agent hears your budget. CREAO, the group messages, and everyone else's agent never get it, and every money decision is plain code."*

---

## 2. The user's journey, step by step

Imagine you are a judge (or a friend invited to "dinner + show").

1. **Join.** You scan a QR code, which opens a join page. You enter your phone number and first name (a budget field is optional), tap "Text SquadTab", and send `JOIN 4821`. You are now in a private iMessage DM with SquadTab, usually within about a minute. No app to install.
2. **Private budget.** SquadTab asks for your max. You reply naturally, e.g. "honestly 30 tops tonight". SquadTab confirms with a fixed message: *"Just between us: aim ~$30, never over $30. Text 'change budget' anytime."* If SquadTab can't understand you, it offers simple choices instead ("Reply 1: under $25, 2: $25–50…").
3. **Preferences.** SquadTab asks about diet and vibe. These never include money.
4. **Research (CREAO).** Once enough people have joined, SquadTab's research agent on CREAO, called **Scout**, searches the open web for real dinner spots and shows that fit the area, date, time and dietary needs. It never sees names, phone numbers or budgets. This takes minutes; meanwhile you see a typing indicator, and at most one "still looking" text.
5. **Fair shortlist.** Plain code pairs dinners with shows that line up in time and place, throws out anything over **anyone's** budget, and picks 3 diverse options that are fair to the whole group. When you joined with a $30 cap, the shortlist on everyone else's phone quietly changed, with no reason given.
6. **Private vote.** You reply "2", or even "2, but not if it ends after 10". Everyone sees only a count ("4 of 4 voted"), never who voted for what. The winner is announced.
7. **Hold.** You get a pay link to the merchant's page. You enter a card once (the test card in the demo). Your card is **held** for your share, not charged. SquadTab texts *"Held $30.00 on Visa ••1111. Not charged yet."* and everyone sees "3 of 4 are in".
8. **Everyone in → booked.** When the last person's hold lands, SquadTab's agent sends a signed request to the merchant to commit exactly the set of holds everyone agreed to. The merchant checks it and charges everyone at once. Then **Concierge**, the second CREAO agent, sends an itinerary link (plus calendar file and Notion page) to each DM.

**If someone drops out.** One person texts "I'm out" (or says no, or misses the deadline). Every hold is released and every DM reads: *"Plan cancelled. Nobody was charged; your pending authorization was released."* Nobody is named. Before the deadline, people who haven't paid get a private reminder.

---

## 3. The big parts and how they talk

```
 Judge's & friends' iPhones
          │  iMessage DMs (one private DM per person)
          ▼
   Photon 2.0 (iMessage lines)
          │  events in / messages out
          ▼
 ┌──────────────── SquadTab agent backend ─────────────────┐       ┌──────── CREAO ────────┐
 │ private delegates (one per person, isolated)       │──────▶│ SquadTab Scout (research)  │
 │ plan state machine · templates · fair-shortlist    │◀──────│ SquadTab Concierge (after  │
 │ code · holdGate · TAP signer                       │ `tab` │  booking: itinerary)  │
 └──────────────┬─────────────────────────┬───────────┘  CLI  └───────────────────────┘
                │ signed requests (TAP)   │ live event stream
                ▼                         ▼
 ┌──── SquadTab Partner Venue ────┐     ┌──── Trust Console ────┐
 │ sandbox merchant of record│     │ lanes, X-ray, CREAO,  │
 │ pay page (Microform)      │     │ TAP panel, ledger,    │
 │ TAP verifier              │     │ counters              │
 └────────────┬──────────────┘     └───────────────────────┘
              ▼
   Visa Cybersource (sandbox): hold, capture, release
```

- **iPhones + Photon.** Photon gives SquadTab a phone number on iMessage. People text SquadTab like a friend; Photon delivers their messages to our backend and sends SquadTab's replies back.
- **Agent backend.** The brain. It holds one *private delegate* per person (an AI call that reads only that person's messages), the plan's step-by-step state, all the fixed message templates, and the plain-code math that filters, scores and picks.
- **CREAO.** Where the open-world research happens. Scout finds every option the group votes on; Concierge writes the itinerary after booking. They report back to our backend through a small command-line tool we wrote (the `tab` CLI).
- **SquadTab Partner Venue.** Our demo merchant. It prices the order itself, hosts the pay page, checks the agent's signed requests, and talks to Cybersource. Card details and payment credentials live only here, never in the agent.
- **Cybersource (Visa).** The real payments sandbox that places holds, charges, and releases them.
- **Trust Console.** A screen for judges that shows, live, what is happening and proves the privacy and money claims (see section 6). The phone is the hero; the console is the evidence.

---

## 4. Key concepts, explained simply

### Private delegates (why budgets stay private)
Each person gets a **private delegate**: one AI call that only ever sees that person's own DM message (plus where they are in the flow). It turns "60ish, could stretch to 80" into a structured budget. From then on:
- Code confirms the budget back with a fixed template and **owns every number**.
- No one else's delegate, no CREAO input, no group message, log or console ever holds that budget.
- There is **no group AI** ("group coordinator"). Every message to the group is a fixed template plus Scout's short pitch text. An AI can't leak what it never received.
- No AI has tools: it cannot pay, sign, cancel, or run the filter.

Privacy is enforced by *context isolation* (what each AI can see), not by telling an AI "please don't share". A test seeds odd budget values ($31.17, $47.29…) and fails the build if any appears anywhere it shouldn't.

### Sealed constraints and the fair shortlist
**Sealed constraints** means each person submits their limits privately, like sealed bids, to a plain-code mechanism. Say "delegates submit sealed constraints to a mechanism", never "agents negotiate".

What "fair" means in plain words:
1. **Hard filter:** an option survives only if its all-in price per person (with tax and tip) fits **every** member's max, plus diet and time.
2. Each delegate rates the survivors for its own person, using preferences only.
3. Code picks 3 diverse options that maximize the group's *combined* happiness in a way where **nobody gets a zero and no single picky person dominates**. (The technical name is Nash welfare: maximize the product of satisfaction. Don't say it on stage unless asked.) A small code-only "comfort" nudge favors options closer to everyone's target.
4. The winner is the option with the most approvals; ties go to the fairest option.

The filter is a fixed pipeline step, not something an AI can call. That stops anyone from probing it over and over to work out the lowest budget.

### The all-or-nothing "assurance contract"
An **assurance contract** is a deal that only happens if everyone commits; otherwise nobody pays. Kickstarter is the familiar example. SquadTab applies it to a group purchase: if one person backs out, every hold is released.

### Hold vs capture vs release
- **Authorization hold:** the card is reserved for an amount, but not charged yet. You may see a "pending" item.
- **Capture:** the held amount is actually charged. SquadTab captures only when every share is held.
- **Release (reversal):** the hold is cancelled, so it is never charged. Say "released", never "$0 instantly": the bank decides when the pending item disappears from the statement.

### Split tender and merchant of record
- **Split tender:** one purchase paid by several cards, each paying its own share.
- **Merchant of record:** the business that legally sells and charges. In our demo, that is **"SquadTab Partner Venue (sandbox merchant of record)"**, selling a **prepaid, ticketed dinner + show bundle**, so charging at booking is normal. SquadTab itself never holds or moves money; the merchant charges each friend directly.

### TMS tokens and Microform (card numbers never touch us)
- **Microform** is Cybersource's secure card-entry field. It runs inside an iframe from Cybersource, so the card number goes straight to Cybersource, never to our servers.
- A **TMS token** (Token Management Service) is a stand-in for a saved card. After the first plan, paying is one tap using the token. Card data exists only inside Microform, and payment credentials only in the venue app.
- If someone pastes a card number into the chat, SquadTab catches it before any AI or log sees it and never stores it.

### Visa Trusted Agent Protocol (TAP)
TAP lets an AI agent **sign** its requests to a merchant, like a tamper-proof stamp.

What a signed agent request **proves**: which agent is acting, what it intends (browsing vs paying), for which venue-priced order and exact set of consents, and that the request is fresh and not a replay. Our verifier checks the spec's six steps itself: the right tag for the action, all required fields present, a timestamp window of at most 8 minutes, a nonce never used before, a known key, and a valid signature over the exact request body.

What it **doesn't** prove: that Visa approved our agent. Our key directory is a labelled **mock**; the production path is Visa agent registration. We send no Agentic Payment Container: each human pays their own share; the agent's signature only proves which consent set it may commit. Never say "Visa-verified".

**The consent digest.** The signed request includes a fingerprint (a hash) of the exact consent set: the order, the total, and each person's payment and amount. The venue rebuilds that set from its own database and checks the fingerprint matches.

**The tamper demo.** We press "Tamper", which changes one share by $1. The fingerprint no longer matches, the request is rejected at the last verification step, and nothing is captured. Similar buttons show replay, expired and wrong-tag rejections.

### holdGate
A safety check before any pay link is sent. If your share ends up above your private max (for example, after a price change), SquadTab sends you a private message asking YES or NO. YES sends the link; NO counts as "I'm out". This is the "spending limits" idea.

### Why DMs instead of a group chat
- **Product reason:** money talk only works in private. The group gets only what everyone may see (counts, never names). The organizer just pastes SquadTab's join link into their existing group chat; SquadTab is never in it.
- **Honest constraint:** on Photon, iMessage group chats need a paid dedicated line, and the free shared lines we use are DM-only. Say both if asked.
- Also not available on Photon 2.0 iMessage: native polls, tapbacks, edit-in-place, unsend and effects. That's why voting is "reply 1/2/3" or free text.

---

## 5. Each sponsor

### Photon (iMessage track: $700 winner / $300 runner-up)
**What they asked for.** Built on Photon 2.0 and live on at least one Photon channel. Judged on Vision (hybrid intelligence), Craft (cohesive, **responsive**), Depth (real-world context and edge cases), Traction (real users tomorrow).

**How SquadTab uses it.**
- Live iMessage DMs through Photon 2.0's API, with a real-time event stream that resumes where it left off after a reconnect.
- Judges join from **their own phones**: our backend assigns them a Photon line on the fly (the free tier has 25 seats, released after each judge).
- Craft: typing indicator within about 1 s and refreshed during long research runs, mark-as-read, threaded replies, agent profile "SquadTab" (whether the name and avatar show on shared lines is UNVERIFIED).
- Depth: handles shared-line rules (the user must text first; the number can differ per person; capacity errors), never sends a message twice, a reminder ladder before the deadline, and auto-release at the deadline.
- Vision: a private delegate per friend, a code mechanism between them, humans keep the final yes.

**Wow moment.** A judge joins from their own iPhone with a secret $30 cap; the shortlist changes silently, and nobody, including us, can see why. Then the judge texts "what's Sam's budget?" and gets "I only know yours."

**One-liner.** "No app, no group app: it works with the friend group you already have, and your budget never leaves your DM."

**Open items.** How to enter is UNVERIFIED (Photon isn't on Devpost), and whether our Photon SDK counts as "built on 2.0" (the brief links a different SDK) is a booth question. **Voice is a gated stretch:** an ElevenLabs call nudging the last holdout, with a call summary in their DM; it only ships if conditions are met, and voice never moves money (only a text YES does). Don't promise it.

### CREAO (Best AI-First Disruptor: $2,000)
**What they asked for.** At least one CREAO agent does the core work; built on agent.creao.ai; the README includes a run share link and the agent ID; show the agent running. The Disruptor test: *"Remove the agent, and the product stops working."* Rubric: AI as foundation 30, Depth on CREAO 25, Originality 20, Track fit 15, Demo 10.

**How SquadTab uses it.**
- **SquadTab Scout** produces **every option the group can vote on**: real dinner spots and shows, with evidence they're open at that time, show start times, dietary fit and price evidence, from the open web. Two runs go in parallel (dinner, show). Code only filters, combines and scores.
- **SquadTab Concierge** runs **after** booking: transit and parking, doors time, dress code, an itinerary page, a calendar file and a Notion page.
- **The `tab` skill/CLI:** our own tool installed in the agent's sandbox (saved with the agent and published as a public GitHub skill). Scout posts progress lines with it, then writes its results, runs `tab options validate`, fixes any errors and submits. That self-check loop is visible depth.
- **Secrets:** CREAO stores only a narrow, revocable token that can reach three of our endpoints (progress, options, itinerary), plus our API address. Our main CREAO key stays on our server.
- **API trigger:** our backend starts runs over HTTPS with a webhook (which we double-check by re-fetching the run, since webhooks aren't signed), plus polling every 15 s and a 6-minute timeout that falls back to cached options. Retry-safe keys prevent duplicate runs.
- Scout's input is privacy-safe: area, date, time, party size and anonymous diet tags only.

**Wow moment.** A fresh Scout run starts at second 0; its progress lines appear on our console from inside the CREAO sandbox. Then open the run thread to show the agent failing our schema check, fixing it, and submitting.

**One-liner.** *"CREAO does the open-world work; fast per-message parsing stays local for responsiveness. Remove the agent and SquadTab has nothing to vote on."*

**Honest note.** Runs take minutes, so the demo flow uses a pre-warmed run that finished earlier, and we say so out loud while the live run streams.

### Visa / Cybersource ("The Future of Shopping": $2,000)
**What they asked for.** Show AI transforming stages of the shopping journey. Judged on Innovation 25, User Experience 25, Technical Execution 20, Commerce Impact 15, Trust & Responsibility 15.

**How SquadTab uses it.**
- **Shopping stages, end to end:** discovery (CREAO) → decision (private ballot, fair shortlist) → personalization (private caps) → checkout and payments (split-tender holds + signed commit) → post-purchase (receipt DMs, itinerary).
- **Innovation:** a group purchase as an assurance contract at the merchant of record. Each person authorizes their own share, and an identified agent can commit **only the exact consent set**.
- **UX:** everything in iMessage; one Microform page for the first card, one tap after that; seven designed pay-page states.
- **Technical:** real Cybersource sandbox calls (hold with saved-card token creation, capture, release, and a safety release when a hold's outcome is unknown), plus our own TAP signer and six-step verifier.
- **Commerce impact:** three live counters from our own data only: groups converted all-or-nothing, dollars fronted by any individual (always $0), holds released on failed plans. No invented stats.
- **Trust:** holdGate, card data only in Microform, single-use pay links bound to an exact amount, live tamper/replay/expired/wrong-tag rejections, a key directory labelled "mock", and "released" wording.

**Wow moment.** Ledger lanes go HELD → TAP ✓ → CAPTURED with real Cybersource IDs. Then Tamper: rejected, nothing captured. Then one "I'm out": every lane goes RELEASED.

**One-liner.** *"A group purchase as an assurance contract at the merchant of record. N cardholder-initiated authorizations, and an identified agent that can commit only the exact consent set."*

**Merchant honesty (always say it).** "CREAO finds real options; partner merchants integrate SquadTab checkout; this demo merchant is ours." Never put a real restaurant's name on the pay page.

**Which Cybersource account (changed Sat night).**
- **What broke:** our own sandbox merchant can't authorize anything. Cybersource reports a processor setup problem on its side (reason 150) that we can't fix ourselves.
- **What we use now:** payments run on **Cybersource's published sample test merchant ("testrest")**, which Cybersource puts in its own code samples. We still make real sandbox calls (hold, charge, release, and real Microform), but the account is **shared and public**.
- **Rules on the shared account:**
  - test cards only (4111 1111 1111 1111);
  - made-up names;
  - placeholder billing details;
  - no Business Center, so we show the transaction lookup instead.
- **Backup:** a **labelled simulation** (one setting on the merchant app). It keeps the same pay page, signed commit and all-or-nothing logic; only the call to Cybersource is stubbed. The page and ledger then say "Simulated" and "SIM". A Visa rep told us Visa can't give hackathon teams sandbox access and said to feel free to simulate.
- **Never claim** this is our merchant account, that Visa provided it, or that anyone approved it. Details: C plan §0.

### LA Hacks main judging (Applied Intelligence track + Overall)
The criteria and our answer to each:
- **Technical Depth:** the context-isolation boundary; the filter as a step no AI can call; a commit that happens exactly once even under races; our own TAP verifier.
- **Product Thinking & Impact:** plans die at two moments of exposure (saying what you can afford, chasing who owes what). Zelle hook in the first 30 seconds.
- **Originality & Insight:** prior art exists for each half: Sunday (TreeHacks 2026) is an iMessage planner that takes a public group budget inside the group chat; PayByGroup (2012) and Airbnb split pay (2017) do group payment but know nothing about constraints. SquadTab's novelty is the **combination**: sealed constraints plus an assurance contract.
- **Execution & Polish:** the judge becomes a user; zero failed beats.

The official Applied Intelligence track text is UNVERIFIED (check live.lahacks.com/tracks).

---

## 6. The Trust Console: what each panel proves

| Panel | What it shows | What it proves |
|---|---|---|
| **People lanes** | One lane per first name, moving Invited → … → HELD → CAPTURED or RELEASED, with share amount and short Cybersource ID. Budget shown only as 🔒. | Real money states, real sandbox IDs, and no budgets on screen. |
| **Shortlist + Context X-ray** | "CREAO found N → plain-code filter kept M", the 3 picks, and tiles for each context: Scout's input, the group fan-out text, and each delegate as a 🔒. | Exactly what each AI and message saw. No budget appears in any shared context. |
| **CREAO lane** | Run chips (run ID, status, elapsed time, live or cached badge, "Open run" link) and the agent's own progress lines. | The CREAO agent is really running and doing the core work, and we are honest about cached results. |
| **TAP panel** | The six verification checks turning ✓, or the step where a tampered, replayed, expired or wrong-tag request was rejected. | The agent can commit only the exact consent set, and the merchant really checks. |
| **Ledger + counters** | Money events plus the three merchant counters. | All-or-nothing works; nobody fronts money. |
| **Header stepper** | Gather → Research → Vote → Hold → Book. | Where the plan is right now. |

Keep the console as backup evidence. Judges remember the phone.

---

## 7. Demo cheat sheet

**Rules:** the phone is the hero, the console is the evidence. Cellular or hotspot only, never venue Wi-Fi. Before each judge: Reset, pre-warm, 3 team phones ready to vote.

### Table version (4–5 min)

| Time | Beat | Say / show |
|---|---|---|
| 0:00 | Press "Start live Scout". | "CREAO is researching right now; the options you'll see come from a run that finished earlier." Point at progress lines. |
| 0:20 | Hook. | Zelle line, then the thesis. |
| 0:45 | Judge scans QR, joins, texts "honestly 30 tops tonight". | SquadTab: "Just between us: aim ~$30, never over $30." The 3 team phones get fresh picks with no reason given. |
| 1:45 | Judge replies "2, but not if it ends after 10". | Everyone gets "4 of 4 voted", then the winner. |
| 2:30 | Pay link → Microform → test card. | "Held $30.00". Team lanes follow, TAP ✓ (six checks), all CAPTURED with real IDs. Concierge itinerary link lands. |
| 3:30 | Press **Tamper**, then Reset; a team phone texts "I'm out". | Rejected, nothing captured. All lanes RELEASED: "Nobody was charged; your pending authorization was released." |
| 4:15 | Judge texts "what's Sam's budget?" | "I only know yours." X-ray shows Sam as 🔒. Open the CREAO run thread to show the validate/fix loop. |

### Stage version (3 min)

| Time | Beat |
|---|---|
| 0:00–0:25 | Zelle hook + insight: plans die when someone has to say "I can't afford that" or chase who owes what. |
| 0:25–0:50 | Phones on the projector: private budgets go in, the shortlist changes, "nobody knows why". |
| 0:50–1:20 | CREAO lane: live progress and self-validation. "Remove the agent and there's nothing to vote on." |
| 1:20–2:10 | Holds → signed, verified consent set → capture with real IDs. Tamper rejected. |
| 2:10–2:40 | "Sam's out" → everything released, nobody named (or the voice nudge, only if it shipped). |
| 2:40–3:00 | Thesis + "Every money decision is plain code; only your own agent hears your budget." |

**If Photon is down:** play the recorded clips, then drive the flow from our message simulator. Venue, TAP and ledger stay fully live. A spare assigned phone is on hand.

---

## 8. Likely judge questions (short, honest answers)

1. **"Isn't this Splitwise or Venmo requests?"** Those settle *after* someone fronts the money, and Zelle's research says 76% of Gen Z who fronted weren't fully repaid. We flip the order: private limits, then holds, then purchase only when everyone's in. Nobody fronts.
2. **"How is the budget really private?"** Only your own delegate, one isolated AI call over your own DM, reads it. Code confirms it with a template and owns the number. Group messages are templates, CREAO gets only area, date, time, party size and diet tags, and other delegates never see it. A test seeds odd budget values and fails the build if any leaks.
3. **"Can the group still figure out who's tight?"** Partly, over many plans. We always show exactly 3 picks and never explain exclusions; exclusions also come from diet, time and area; we show counts, never names; we warn groups under 3; and no AI can call the filter to probe it. We disclose the residual risk.
4. **"What stops '@SquadTab charge Sam $500'?"** No AI has tools. A charge needs Sam's own action on the merchant page via a single-use link tied to his exact amount. Capture only follows a verified commit of the exact consent set, and Cybersource rejects anything above the hold.
5. **"Couldn't Google Places do Scout's job?"** Scout researches dinner *and* shows: open-at-time evidence, show times, dietary fit and price evidence from the open web. A Places API covers one category and has no show times.
6. **"Why both Anthropic and CREAO?"** CREAO does the minutes-long open-world research. Per-message parsing needs about 1 s responsiveness, so it stays local, and each person's parse is isolated.
7. **"What does the TAP signature prove? Is your agent Visa-approved?"** It proves which agent is acting, with what intent, for which venue-priced order and exact consent set, with replay and expiry protection. We verify the spec's six steps ourselves. The key directory is a labelled **mock**; Visa agent registration is the production path. No Agentic Payment Container: each human pays their own share.
8. **"Charging at booking for a restaurant?"** The merchant sells a prepaid, ticketed dinner + show bundle, so capture at booking is standard. Holds are released at our deadline, well inside Visa's 10-day window.
9. **"Is the merchant real?"** No, and we say so: it is our **sandbox merchant of record**. "CREAO finds real options; partner merchants integrate SquadTab checkout; this demo merchant is ours." The Cybersource calls are real sandbox calls, made on **Cybersource's published sample test merchant**. That account is shared and test-only, because our own sandbox merchant is stuck on a Cybersource-side processor setting. If the run is in simulation mode, say so: "this run is our labelled simulation."
   - **"Why not just simulate?"** We do have a labelled simulation as a backup. But real sandbox calls show the hold, charge and release behaviour, and that card numbers stay inside Cybersource's form. A mock can't show either. It proves the integration, not real-bank settlement.
10. **"Is that CREAO run live?"** A fresh run really starts at the beginning of the demo, and you can watch its progress. The options in the flow come from a **pre-warmed run** that finished earlier, because runs take minutes. We say so up front.
11. **"Double charges on a network failure?"** Cybersource has no built-in retry key, so we never blindly retry: unique attempt records, fixed reference codes, and if a hold's outcome is unknown we release it after 60 s and send a fresh link. We check status before any capture retry.
12. **"Are you a money transmitter?"** The merchant charges each friend directly via split tender; we never hold or move funds. A pooled-card version is what would raise that question. (Not legal advice.)
13. **"Why DMs, not the group chat?"** Money talk only works in private. (Also true: Photon group chats need a paid dedicated line.)
14. **"Business model?"** Merchant side: guaranteed group conversion, so a fee per committed group booking. This is a hypothesis, not validated.

---

## 9. Words to use and words to avoid on stage

| Avoid (unless a judge asks) | Say instead |
|---|---|
| "agents negotiate", "advocates", "multi-agent negotiation" | "private delegate per friend", "sealed constraints", "plain-code mechanism" |
| "Nash welfare" | "a fair pick where nobody gets a zero" |
| "RFC 9421" | "signed agent request (Visa Trusted Agent Protocol)" |
| "Visa-verified agent", "Visa-approved" | "signed and verified by the merchant; mock key directory" |
| "$0 instantly", "refunded" (for a cancelled hold) | "released", "Nobody was charged; your pending authorization was released." |
| "charged" (before capture) | "held" |
| "no budget ever enters any AI" | "Only your own agent hears your budget." |
| A real restaurant's name for the merchant | "SquadTab Partner Venue (sandbox merchant of record)" |
| "live CREAO results" (for the flow) | "a run that finished earlier, while a live one streams" |
| Promising voice | Mention it only if it shipped. |
