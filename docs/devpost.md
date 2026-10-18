<!--
DEVPOST FORM CHECKLIST (this comment does not render; don't paste it)

Prizes to tick:
  [ ] Applied Intelligence (main track) + Overall
  [ ] Visa "The Future of Shopping"
  [ ] CREAO Best AI-First Disruptor
  [ ] Paper Best Designed Hack
  [ ] MLH Best Domain (GoDaddy Registry): only if a domain is registered and live
  [ ] MLH Commit Fellowship: opt in, then fill the supplemental form
  Photon iMessage is NOT on Devpost. Enter at the Photon booth, and show them the live line and this repo.

Fields:
  [ ] Project name: SquadTab
  [ ] Tagline: The friend who knows everyone's budget and tells no one.
  [ ] About the project: everything below this comment (Markdown, LaTeX kept)
  [ ] Built with: copy the "Built with" list
  [ ] Try it out links: GitHub, live web, partner venue, Paper file
  [ ] Video: unlisted YouTube link -> replace [DEMO VIDEO]
  [ ] Repo: https://github.com/L00SIRE/SquadTab (check it is PUBLIC)
  [ ] Gallery: upload in the order of the "Gallery" checklist at the end
  [ ] Thumbnail: paper\00-thumbnail-3x2.png
  [ ] Team: add all teammates to the submission

Math: Devpost renders $$...$$ display blocks; its inline syntax is \\( ... \\), so a single "$" (as in "$42") stays plain text. Check the preview once after pasting.
  (Source: help.devpost.com/article/193-markdown-tips)

Placeholders to replace before submitting: [DEMO VIDEO], [DOMAIN], [PAPER SHARE LINK]
  (Paper: enable link sharing on the "SquadTab" file in Paper Desktop first; then the file URL below works.)
Banned phrases (never paste): "$0 instantly", "Visa-verified agent", "agents negotiate".
-->

**Track:** Applied Intelligence (plus Overall). **Company challenges:** Photon iMessage · CREAO AI-First Disruptor · Visa "The Future of Shopping" · Paper Best Designed Hack · MLH Best Domain (GoDaddy Registry) · MLH Commit Fellowship. How SquadTab applies to each one is in "How SquadTab meets each challenge" below. Code: https://github.com/L00SIRE/SquadTab · Demo video: [DEMO VIDEO]

> **SquadTab is the friend who knows everyone's budget and tells no one.** Say no without saying why. Nobody pays until everyone's in.

## 💡 Inspiration

Group plans die at two awkward moments. Someone has to say "I can't afford that" in front of everyone, or someone fronts the money and then chases friends to get paid back. According to Zelle research (June 2026), 76% of Gen Z consumers who have fronted money for a group expense, like a trip or event, say they were not fully repaid.

## 🎟️ What it does

1. The organizer starts a plan and pastes one link into the group chat.
2. Each friend then talks to SquadTab in a **private iMessage DM**. SquadTab never joins the group chat, on purpose: money talk only works in private.
3. A private delegate per friend takes their budget and confirms it back: "Got it. Just between us: aim ~$350, never over $385." Nobody else ever sees it.
4. **SquadTab Scout**, our CREAO research agent, finds real dinner spots and shows that are open that night.
5. Plain code pairs them, drops anything over anyone's cap, and picks three options that fit the whole group. It never says whose budget ruled something out.
6. Friends vote privately. Each person authorizes only their own share as a card **hold** on the partner venue's pay page.
7. The purchase is captured only when every share is held. If anyone drops, every hold is released, and the group reads: "Nobody was charged; your pending authorization was released."
8. After booking, **SquadTab Concierge** (our second CREAO agent) builds the itinerary and a calendar file.

Our only privacy claim: only your own agent hears your budget. CREAO, the group messages and everyone else's agent never get it, and every money decision is plain code.

## 🧮 How we built it: the math

### 1. One price, computed by the merchant

Every friend pays the same all-in price per person, rounded up to a whole dollar. With dinner estimate d, show estimate s, tax τ = 0.1025 and tip θ = 0.18:

$$P = \left\lceil\, d\,(1+\tau+\theta) + s\,(1+\tau) \,\right\rceil \qquad T = n \cdot P$$

The venue computes P and the total T itself. No amount is ever accepted from a model or from a request body.

### 2. A private filter no model can call

Each friend i has a private target tᵢ and an optional hard max hᵢ. Their effective cap is cᵢ = hᵢ if they gave one, otherwise round(1.1 · tᵢ). A bundle b survives only if

$$P_b \le \min_i c_i$$

It's a single comparison inside a pipeline step, not a tool. That blocks the attack where someone keeps asking an AI "would 41 work? 39?" to binary-search a friend's budget.

### 3. Fair, not loudest-wins

Each friend's delegate rates each bundle, rᵢ,b between 0.05 and 1. Price comfort drops gently once a bundle passes someone's target:

$$\kappa_i(P) = \begin{cases} 1 & P \le t_i \\ \max\!\left(0.6,\; 1 - 0.4\,\dfrac{P - t_i}{\max(1,\; c_i - t_i)}\right) & P > t_i \end{cases}$$

A bundle's group score is

$$W(b) = \sum_{i=1}^{n} \ln\!\big(r_{i,b}\cdot \kappa_i(P_b)\big)$$

Summing logs is the same as multiplying everyone's satisfaction, so no single person can be sacrificed to make the rest happier. We shortlist the top three bundles by W, with no two sharing a dinner or a show, so the group gets three real choices. The winner is the most-approved bundle in the private vote, with ties broken by W, then by price.

### 4. All or nothing, provably

Each friend i places their own authorization aᵢ with capture turned off. The merchant captures only when all of this holds:

$$\text{TAP}_{\text{valid}} \;\wedge\; \forall i:\ \text{status}_i = \text{AUTHORIZED} \;\wedge\; \sum_i a_i = T \;\wedge\; \text{body} = \text{canon}(\text{DB})$$

Otherwise nothing is captured. On "I'm out" or at the deadline, every aᵢ is reversed.

### 5. The Visa Trusted Agent Protocol commit

The agent signs an RFC 9421 signature base covering the method, host, path and a digest of the deal. The merchant checks six steps in order: tag, fields, time window, nonce, key, signature. The time window is

$$\text{created} \le \text{now} + 5\,\text{s} \qquad \text{expires} > \text{now} \qquad \text{expires} - \text{created} \le 480\,\text{s}$$

The body digest is

$$D = \text{SHA-256}\big(\text{canon}(\text{order},\; T,\; \{(\text{share}_i,\ \text{authId}_i,\ a_i)\})\big)$$

and the merchant recomputes it from **its own database**. Change one share by a single dollar after signing and D no longer matches, so step 6 fails and nothing is captured. Every nonce works once, and pay links are 128-bit single-use tokens, so a random guess succeeds with probability

$$2^{-128}$$

## 🛠️ How we built it: the stack

TypeScript throughout.

- **Agent backend:** Hono on Fly.io. It holds the private delegates: Claude Haiku 5.5 parses each person's budget, preferences and ballot, and Claude Sonnet 5.5 rates bundles for that one person. **No model has tools**, and there is no group-coordinator model. The backend also holds the plan state machine, the fixed message templates (every money and privacy message is a template sent through one function, never model-written) and the pure-code compose, filter, score and pick steps.
- **Messaging:** Photon 2.0 Beta (`@photon-ai/api`), live on iMessage shared lines, with the Socket.IO event stream and a persisted replay cursor.
- **Research:** two CREAO agents, extended with our own `tab` skill and CLI (details below).
- **Partner venue:** Next.js on Vercel. It prices every order itself, hosts the Cybersource Microform v2 pay page (card fields in hosted iframes, saved cards through TMS) and verifies the agent's signed commit.
- **Web:** Next.js on Vercel. The create and join pages and the Trust Console over SSE: live lanes per friend, budgets shown only as a lock, the CREAO lane, the TAP panel and the ledger.
- **Data:** Supabase Postgres, with separate schemas and roles for the agent and the venue.
- **Tests:** 1,500+ automated tests (Vitest), including a value-specific privacy e2e that seeds odd budgets ($31.17, $47.29, …) and fails the build if any appears outside its owner's delegate and DM, the TAP verifier, and state-machine race tests.

## 🏆 How SquadTab meets each challenge

### Applied Intelligence (main track)

SquadTab uses AI where it is strong: understanding a person's natural-language budget and taste, and researching the open world. It keeps AI out where it must not be trusted. No LLM has tools, there is no group-coordinator LLM, the fair filter is a pipeline step no model can call, and every number that moves money comes from code and the venue's database. Privacy is enforced by context isolation and a build-failing test, not by a prompt.

### Photon: build a messaging agent on Photon 2.0

Built on **Photon 2.0 Beta** (`@photon-ai/api` 0.5.0) and **live on iMessage** through Photon's shared lines. Judges can text it from their own phones today.

- **Vision (hybrid intelligence):** a private delegate per friend, a code mechanism between them, and humans keep the final yes. The DM is the product: no app, no new group app, nothing to install.
- **Craft (cohesive, responsive):** typing indicator during long research runs, mark-as-read, an idempotency key on every send, and a persisted Socket.IO replay cursor so no message is lost across restarts. On production, a message reached a team phone in 2.2 s, and replies take about 1–4 s.
- **Depth (real-world context and edge cases):** the shared-line rules (the user texts first, DM-only, no threaded replies) shaped the whole private-DM design. Replies stay truthful at the edges: "I'm out" after booking gets an honest too-late reply, and a budget-blocked plan asks for a recovery instead of failing silently. The plan state machine is race-tested.
- **Traction (real users tomorrow):** it runs on real phones over plain iMessage, end to end, including a real card hold and capture in the payment sandbox from a team phone.

### CREAO: Best AI-First Disruptor ("remove the agent, and the product stops working")

Remove the agent and SquadTab has nothing to vote on. **Scout** produces every option the group votes on, and **Concierge** produces the itinerary and calendar file after checkout. The app runs on the agents' output, end to end.

| Agent | Agent ID | Run share link |
|---|---|---|
| SquadTab Scout | `1b834601-b727-40aa-b80d-7e7d1c0cabe0` | https://agent.creao.ai/share/12ea3fa0f9699dabe5175e2cb6eadc28 |
| SquadTab Concierge | `465a1d2e-a46f-496c-adea-fc471a396a6c` | https://agent.creao.ai/share/6d95ca9660e15924b0f91c5e19e19894 |

- **API Trigger + webhooks:** runs start through the API with an idempotency key. Webhooks are unsigned, so each one only triggers a re-fetch of the run, backed by a 15 s poll. Nothing holds a request open while a run takes minutes; the console shows progress.
- **Our own tools:** the `tab` skill and python3 CLI, saved with both agents (https://github.com/L00SIRE/SquadTab/tree/main/skills/tab). It streams progress into our console, validates the agent's output against our schema in a fix loop (up to 5 rounds) and submits.
- **Real output:** live Scout runs returned 12 real dinners and 12 real shows with dated showtimes, and Concierge returned an itinerary and a correct calendar file.
- **See it run:** the run share links above, plus the Trust Console's CREAO lane in the demo, where `tab progress` lines stream in during a run and each run is labelled live or cached.
- **Honest fallback:** on a timeout we fall back to a real earlier Scout snapshot, and the console labels every run live or cached.
- **Keys stay on the server:** CREAO only ever sees a research brief (enums, area, date, times, party size). Our account key stays on our backend, and CREAO Secrets hold only a narrow agent token and our API address.

### Visa: The Future of Shopping, Powered by AI, Secured by Visa

Agent shopping today is one person, one card. Groups are the unsolved case: private budgets, and a purchase that only goes through if all N agree. SquadTab covers **discovery** (CREAO), **decision-making** (private ballot, fair shortlist), **personalization** (private caps), **checkout and payments** (split holds plus a signed commit) and **post-purchase** (itinerary, calendar).

- **Innovation (25%):** a group purchase becomes an assurance contract at the merchant of record: N cardholder-initiated authorizations plus one identified agent that can commit only the exact consent set. Nobody fronts and nobody chases.
- **User experience (25%):** each friend pays only their own share, in a DM, as a hold rather than a charge. Amber means held, green means captured, and there is no red: a drop-out is the promise working, not an error.
- **Technical execution (20%):** real Cybersource sandbox authorization (`capture:false`), capture, reversal and timeout reversal. Cybersource has no idempotency header, so exactly-once is designed: unique `(share, op, attempt)` records, deterministic reference codes, persisted transaction ids and no blind authorization retries. Plus our own Ed25519 RFC 9421 signer for the Trusted Agent Protocol and a six-step verifier at the merchant (math section 5).
- **Commerce impact (15%):** group spending that dies in the chat today becomes a booked table and four tickets. A merchant gets a booking with every share authorized up front. These are design properties, not measured results.
- **Trust and responsibility (15%):** card data lives only inside Microform iframes; credentials live only in the venue app; budgets never leave their owner's delegate. The console's Tamper, Replay, Expired and Wrong-tag buttons are each rejected by the merchant, and nothing is captured. Every mock and sandbox is labelled on screen (see "What is real" below).
- **Verified on the sandbox:** real holds and captures (a team phone test captured $137), all six TAP verification steps passing on a real commit, the tamper and replay rejections, and releases.

### Paper: Best Designed Hack

Paper file **"SquadTab"**: https://app.paper.design/file/01M57RY01PHZA13NV3SS3NQN5N ([PAPER SHARE LINK] if that link asks for access)

Our design system is called **Signal**. SquadTab works like a traffic signal for a group plan, and the plan is a ticket.

**1. Design fundamentals (hierarchy, legibility, consistency, contrast)**
- **Hierarchy:** the ticket is the hero, and its price, "$42 each", is the largest thing on every screen. The stub is the single action: on desktop it's the QR to start on your iPhone, and on a phone it's the first line of the conversation.
- **Legibility:** three typefaces with fixed jobs: Funnel Display, Funnel Sans and Martian Mono (for amounts and codes). The Trust Console is built to be read from five metres on a projector.
- **Consistency:** one design system, 30 tokens in Paper identical to our production `globals.css`, shared by the web app and the partner venue's pay page.
- **Contrast:** measured, not eyeballed. 38 state color pairs, 0 failing WCAG; ink on sodium amber `#FFB224` is 10.69:1. States also differ by shape (solid, outline, dashed), never by color alone.

**2. Ease of use**
- Nothing to install: the interface is an iMessage DM, so we designed the words as carefully as the screens. One phone field to start; friends join with any text.
- Three states anyone already knows from a traffic light: amber is held, green is captured. **There is no red.** A drop-out releases every hold; that is the promise working, not an error. The pay page's bad state is a dashed ink border, not red.

**3. Personal craft and character (not AI-generated)**
- **The 42:** the price is digit-art made of tiny re-rolling private numbers that never resolve into anyone's budget. Each friend's hold freezes their quarter, and capture lights the mark and tears the stub. "The price is $42 each, and it's made of tiny digits that never stop changing. Those are everyone's private budgets. You'll never read one."
- **Why amber:** sodium-vapor streetlight amber is the color of going out at 1 a.m., and in signaling it already means hold.
- **Written anti-AI rules:** no gradients, glows, pills, bento grids, emoji or stock icon sets. Our icons are 7×7 dot glyphs drawn from the same geometry as the code (the lock is the one hand-drawn exception). Sentences beat boxes.
- **Process:** we critiqued our own designs (14 findings, each with what changed and where it is verified), then ran a second review and fixed every P0 before submitting.

**The design process, page by page in Paper:**

| Page | What's on it |
|---|---|
| 00 Cover | The hero ticket at 3 of 4 held and booked, a Read me for judges, and the Devpost thumbnail |
| 00b Signature: the 42 | The 42's four looks (dim, held, lit, ghost), quarters per friend, density classes, the 21 s timeline, production frames |
| 01 Foundations | Palette with measured contrast, type, the state language (lamp, chip, rail, amount, feed), grounds, and "Why amber" |
| 02 Components | Buttons and inputs in every state, the dot icons, the wordmark, ticket parts |
| 03 Web | Phone screens: start, organizer plan-ready, join, you're in |
| 04 The conversation | Three iMessage threads (booked, someone drops, too late to drop) as annotated scripts, with real template copy and template ids |
| 05 Pay page | Ten states of the venue's hold page plus an anatomy board, rebuilt from the shipped code |
| 06 Trust console | The projector screen held, booked and released |
| 07 Process | Critique to fix, the rules, decisions with evidence, accessibility |
| 08 Shipped | Live production captures beside the designs, a motion filmstrip of the live loop, and the real iMessage test with private data redacted |

We designed in Paper alongside our coding agents: the tokens come straight from the code, and the pay page was rebuilt from the shipped commit. Every screen in Paper shipped. Paper leads the code in two small places: the pay page's "booked" state should be go green, not amber, and a busy button should stay at full strength instead of dimming. The Process page lists the booked colour as still open. The gallery GIFs are the live site, not mockups.

### MLH Best Domain (GoDaddy Registry)

[DOMAIN] redirects to the live web app.

### MLH Commit Fellowship

SquadTab is live on iMessage today: join, private budget, CREAO research, a fair shortlist, private voting, per-person card holds on the Cybersource sandbox, a signed commit verified by the merchant, and capture at 4 of 4 or release for everyone, with 1,500+ automated tests. Our next 30 days: run it with 10 real friend groups and measure plans started vs booked, fix the top drop-off step, get one real venue to accept SquadTab checkout, and apply for Visa agent registration.

## 🐛 Side quest: we found a bug in our payment sandbox, and Cybersource acted on it

Our own Cybersource sandbox merchant failed **every** authorization: reason 150 on processor `fdiglobal`, because the merchant's USD outlet and terminal IDs were missing. We root-caused it from the processor records, reported it to Cybersource, and switched the demo to Cybersource's public test merchant (`testrest`) by changing environment variables only, with no code change.

Cybersource Level II support replied at 8:20 AM on Sunday that they had updated the outlet and terminal IDs. Our retest from 8:40 to 9:10 AM still fails, but the error now names only `usd_outlet_id`, so the fix is partial. **The case is still open.** The demo runs on the public test merchant, where holds, captures, TAP commits and releases all work.

## 🧱 Challenges

- Our own Cybersource sandbox merchant fails every authorization because of a processor setup gap on Cybersource's side (see the side quest). The support case is open and partially fixed; we run on the public test merchant and keep a labelled simulation mode as a backup.
- Photon's shared lines are DM-only, reject threaded replies and require the user to text first. That shaped the whole private-DM design.
- Cybersource has no idempotency header, so exactly-once had to be designed: attempt records, deterministic references, timeout reversal.
- CREAO webhooks are unsigned, so every webhook only triggers a re-fetch of the run.

## 🥇 Accomplishments

- Privacy by context isolation, enforced by a build-failing test rather than by prompts.
- An all-or-nothing capture that happens exactly once, even under races.
- Our own TAP signer and verifier, with live rejection demos.
- A CREAO agent that validates and fixes its own output before submitting.
- A design system with a point of view, measured for contrast, critiqued and revised before it shipped.

## 📚 What we learned

Money talk is a privacy problem first. Keeping each budget inside one isolated model call and one database table, with code owning every number, made the privacy claim small enough to test.

## 🔭 What's next

- **Trips and gifts:** the same all-or-nothing hold for group trips and group gifts.
- **Standing group limits:** a group sets its usual range once.
- **Quiet cover:** a friend can anonymously ask the group to cover them this time.
- **The venue side:** partner merchants integrate SquadTab checkout directly.
- **Browser Use:** read-only availability checks before a plan is shortlisted.
- **Visa:** agent registration in place of the mock key directory, and Visa Intelligent Commerce agentic tokens.

## ✅ What is real, mock, sandbox and not built

**Real**
- Private iMessage DMs on Photon 2.0, each with its own Claude delegate that sees only that person's data.
- Cybersource API calls: authorization with `capture:false`, capture, reversal and timeout reversal, with capture only after every share is held.
- Card entry in Cybersource's hosted Microform fields; card numbers never touch SquadTab servers.
- Our own Ed25519 / RFC 9421 signer and six-step verifier, with the commit bound to the exact consent set.
- Live option research (Scout) and itinerary (Concierge) on CREAO.
- A build-failing privacy test.

**Mock (labelled on screen)**
- The Trusted Agent Protocol key directory ("Key directory: mock"). Production would use Visa's.
- The merchant: "SquadTab Partner Venue (sandbox merchant of record)" is our demo merchant selling a prepaid, ticketed bundle, not a real business.
- A simulation mode exists only as a backup and is marked "Simulated" on the pay page and ledger.

**Sandbox**
- All payments run on the Cybersource sandbox's public test merchant (`testrest`), with test cards only and no real money.
- Our own sandbox merchant is still blocked (reason 150). The Cybersource support case is open and partially fixed.

**Not built**
- Visa Intelligent Commerce agentic payment tokens, an Agentic Payment Container (each human pays their own share instead), Visa Payment Passkey, 3-D Secure, Visa agent registration, refunds after capture, and any real merchant integration or production credentials.

## 🔗 Links

- GitHub: https://github.com/L00SIRE/SquadTab
- Live web: [DOMAIN] (also https://tab-web-ten.vercel.app)
- Partner venue (Cybersource sandbox, public test merchant): https://squadtab-venue.vercel.app
- Agent backend: https://tab-agent.fly.dev
- Paper file: https://app.paper.design/file/01M57RY01PHZA13NV3SS3NQN5N ([PAPER SHARE LINK])
- CREAO Scout run: https://agent.creao.ai/share/12ea3fa0f9699dabe5175e2cb6eadc28
- CREAO Concierge run: https://agent.creao.ai/share/6d95ca9660e15924b0f91c5e19e19894
- Demo video: [DEMO VIDEO]

## 🧰 Built with

TypeScript, Node.js 22, Hono, Next.js 16, React, Tailwind CSS 4, Supabase Postgres, Fly.io, Vercel, Photon 2.0 Beta (`@photon-ai/api`), CREAO (agent.creao.ai), Anthropic Claude (Haiku 5.5, Sonnet 5.5), Cybersource (Microform v2, TMS, REST), Visa Trusted Agent Protocol, Paper, Zod, Vitest.

<!--
GALLERY CHECKLIST (upload in this order; don't paste this comment)
Folder: C:\Users\chris\Downloads\squadtab-devpost\
Check the upload hint on the form for type and size limits; every GIF is 5 MB or less.
Never upload the raw "WhatsApp Image *.jpeg" files: they show phone numbers and a live pay token.

  [ ]  1. paper\00-thumbnail-3x2.png                     (also the project thumbnail)
  [ ]  2. 42-closeup.gif                                 (the live price mark, 21 s loop)
  [ ]  3. landing-desktop.gif                            (live hero loop)
  [ ]  4. paper\02-cover-3of4-held.png, paper\03-cover-booked.png
  [ ]  5. paper\04-live-imessage-redacted.png            (or a shot from redacted\)
  [ ]  6. paper\05-console-3of4-held.png  (optional: 05b-console-booked.png, 05c-console-released.png)
  [ ]  7. pay-state-live.png or paper\06-pay-anatomy.png, and venue-demo.gif (caption it "scripted walkthrough")
  [ ]  8. paper\07-thread-booked.png  (optional: 07b-thread-someone-drops.png)
  [ ]  9. paper\08-state-language.png, paper\08b-palette.png
  [ ] 10. paper\09-critique-to-fix.png
  [ ] 11. Live · Motion filmstrip (export it from Paper page 08 Shipped, or use paper\01b-signature-21-seconds.png, or the 42\01-dim.png ... 06-all-released.png frames)
  Optional: paper\10-read-me.png, landing-phone.gif, venue-demo-still-1-hold.png / -2-tap-capture.png / -3-tamper-rejected.png

Demo video: if there's no time to edit, show the live phone demo first, then 42-closeup.mp4 (about 10 s) at the end.
-->

## username for fetch.ai
Christian(user handle): user-0e73be43
Suman (user handle): user-88d6e8bd
