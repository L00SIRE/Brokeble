# SquadTab: what was built, changed and verified

*Plain-language summary, Sun Oct 18 2026, about 7 AM. The detailed evidence is in `docs/VERIFICATION.md`, and the two-phone test is in `docs/TEST-GUIDE.md`.*

## What's live
| Piece | URL | State |
|---|---|---|
| Web (landing, invite, console) | https://tab-web-ten.vercel.app | New ticket design and chat-first flow |
| Agent backend | https://tab-agent.fly.dev | Latest build; Photon, Claude, CREAO and the venue all live; one machine |
| Venue (payments) | https://squadtab-venue.vercel.app | On your Vercel, Cybersource **testrest** sandbox, writable database, TAP keys matched to the agent |
| Code | github.com/L00SIRE/SquadTab (`main`) | Everything pushed; no Claude attribution on commits since you asked |

## The product in one line
SquadTab is the friend who knows everyone's budget and tells no one. It finds a plan the whole group can afford, and nobody pays until everyone's in.

## What was built tonight (in order)
1. **Plans:** the master plan, one plan per teammate, the explainer and the standard names, all researched and checked by agents.
2. **Foundation:** the monorepo, shared contracts, database, the stand-in versions of every part, and deploy config.
3. **Plans A + B** (25 parallel builders): Photon messaging, private Claude delegates, the plan state machine, ballots, holds, commit and cancel, the CREAO client, the `tab` CLI skill, decision logic (fair shortlist), the web pages and the console.
4. **Natural conversation:** every free-form text gets a Claude reply from your *own* delegate, which sees only your data. Money and privacy messages stay as fixed templates.
5. **The new UI and chat-first flow** (22 agents in a separate worktree, then merged):
   - **Design:** the yellow and black ticket, a "$42" drawn in animated digits that lights up per hold, the Funnel and Martian Mono fonts, a redesigned Trust Console.
   - **Flow:** one phone field; the organizer starts by texting; friends join with any text; invites go through the share sheet; the QR code appears only on desktop.

## Real bugs found and fixed
- **Photon rejected every reply.** Shared lines don't support threaded replies, so threading is off now.
- **Every CREAO run read as "timed out".** CREAO returns some fields as null; it's fixed and confirmed on live runs.
- **The privacy guard had gaps.** A reply can now only contain numbers you typed yourself, so there's no way to fish for someone else's budget.
- **Friends couldn't join by texting** after the merge (two fixes broke each other). Fixed, with a database test.
- **Races:** commit vs cancel, double commit and duplicate payments now charge exactly once.
- **The venue database was read-only.** Supabase's transaction pooler (port 6543) connects read-only; the venue now uses the session pooler (port 5432).
- **The TAP keys didn't match** between the agent and your teammate's venue, which would have rejected every purchase. The new venue derives its key from the agent's own key.
- **Fly deploys failed from this laptop** because Fly's API breaks over IPv6 on this network. Deploys now go through a local IPv4 proxy (`scratch/tools/v4proxy.mjs`).

## Verified per sponsor
- **Photon:** a real message reached a team phone in 2.2 s; duplicates are de-duplicated; the message stream resumes after deploys; replies take 1–4 s; typing indicators and read receipts work.
- **CREAO:** 3 real runs through the backend. Scout returned 12 real dinners and 12 real shows with showtimes; Concierge returned an itinerary and calendar file. The CLI validate, fix and submit loop works, and the demo's backup research is real Scout output. Share link: https://agent.creao.ai/share/12ea3fa0f9699dabe5175e2cb6eadc28
- **Visa:**
  - Every Cybersource operation works on testrest: hold, saved card, one-tap, charge, release, timeout release.
  - Real card entry in a browser works.
  - Charges happen **only after every hold**.
  - The TAP signed-request suite passes 27 of 27 attacks, including tamper and replay.
- **Main track:**
  - The full flow reached "booked" many times on real services.
  - Privacy: 53 recorded Claude calls, no leaks; injection attempts were refused.
  - Security: every protected route is locked; no secrets anywhere; SQL is parameterized.
  - Crash recovery works at every stage.
  - About 1,450 automated tests pass.

## What's left for the team
1. **The two-phone test**, following `docs/TEST-GUIDE.md`.
2. **CREAO UI:** add "use the dinner and show exactly; never substitute" to Concierge's instructions.
3. **The demo video** (2–3 min). The venue's `/demo` page is a scripted walkthrough that helps with recording.
4. **Devpost:** submit with the main track, Overall, Visa and CREAO selected. The README needs the agent IDs and run share links. Ask the Photon booth how to enter their prize.
5. **Optional:** submit the Cybersource contact form about the reason-150 processor issue, so "we contacted support" is true.

## What to say to judges (honest framing)
- "Payments run on Cybersource's sandbox, on its public test merchant. Our own merchant's processor wasn't provisioned (reason 150)."
- "The signed agent request follows Visa's Trusted Agent Protocol spec. The key directory is a mock." Never say "Visa-verified".
- "The research runs live on CREAO. For the stage demo we use a pre-warmed run, and we say so."

## After the event
Unset `AGENT_API_ALLOW_TEST_REF`. Rotate `CONSOLE_KEY`, `TAB_AGENT_TOKEN` and the Supabase password.

## Production verification (after deploy)

*Sun Oct 18, about 7:40 AM. Seven test tracks ran against the live URLs. Some prod-changing steps were blocked by Claude Code's permission check: Reset, the live CREAO run, the venue payment test and reading Fly secrets. Those still need a human, and each item below says which.*

### Short answer
- **Web, agent API, security and Photon messaging pass on prod.**
- **The agent is on Fly release v8** (14:30Z), which includes the router fix `ff81394`. `/healthz` returns 200.
- **The two-phone test should work** once two things are done: Suman texts in once, and someone presses Reset just before the demo (see "Do before judging").
- **Not proven on prod yet:** a real testrest payment, a live CREAO Scout run, and Reset leading to VOTING with 3 picks. Each one takes a single human action, listed below.

### Per component
| Component | Passed on prod | Still open |
|---|---|---|
| **Web** (tab-web-ten) | Phone landing loads in 1.5 s with no errors and no sideways scroll. The hero animation plays. "Start in iMessage" is above the fold even on a short phone. Desktop shows the QR first, and the QR encodes the prod URL. The phone step returns the correct `sms:` link (assigned line plus the first text). `/status` polls every 2 s, and a reload resumes the seat. Invite pages, the edge states (cancelled, unknown, expired) and the OG images all render. CORS lets only the web origin through. | Low: the hero label "Can't make it" is clipped at phone width. It's cosmetic; the fix is to rename it "Dropped" in `apps/web/lib/motion/heroScript.ts:101` and update its test. |
| **Agent API** (tab-agent.fly.dev) | `/dev/*` is off (404). Every `/ops`, `/events` and `/agent` route returns 401 without the right key, and keys in the query string are refused. Hooks reject bad secrets and signatures. `/start`, `/status` and `/plans/:code` return exactly the documented fields and nothing private. Bad input gets a 422 that doesn't echo values. The rate limit kicks in after 10 per minute, and spoofed headers don't get around it. Logs contain no tokens, keys or phone numbers. | Demo code 4821 is CANCELLED on prod, left over from the old seed. Reset fixes it (below). |
| **Console** | Snapshot and live stream connect. The layout holds at 1920x1080. Budgets show as hidden and LOCKED, with no amounts anywhere. The ops buttons and the TAP "Break it" buttons are present. | Reset → VOTING with 3 real picks hasn't been run on this build (blocked). The TAP buttons return 409 until a plan has a venue order. That is expected and now in the runbook. Low: the X-ray listed only Christian on the old plan; re-check after Reset. |
| **Photon** | The consumer is subscribed and its cursor keeps up in real time. One prod test message reached Christian's phone in 1.7 s, and resending it with the same key didn't create a duplicate. Real replies take about 3.6 s from inbound text to handset and never use threaded replies. 2 of 25 seats are in use, both team phones. | Suman has no DM route, so messages to him are held. He needs to text in once (below). |
| **Venue / payments** (squadtab-venue) | The env validates. Unsigned requests get a 401. The pay page says "Cybersource sandbox", which means live testrest mode, and sends strict security headers. The venue's TAP public key matches the agent's private key. The old read-only sweep errors stopped after the redeploy. | **No payment ran on prod** (blocked). Also unconfirmed: whether the agent's `VENUE_BASE_URL` points at squadtab-venue (testrest) or the old tab-venue (simulated). The local `.env.fly` still says tab-venue. |
| **CREAO** | The agent runs with `planner: live`. The live-scout route and its debounce were checked in the code. | **Live Scout not run on prod** (blocked). |
| **Security / config** | All 28 Fly secrets that the agent's env schema requires are present. `WEB_ORIGIN` is correct. Prod and `.env.local` use the same database. No secrets in any web or venue JS bundle (a scan for the literal values found 0 hits), and none in git history. | Low, after the event: unset `AGENT_API_ALLOW_TEST_REF`, rotate the keys, and add `Referrer-Policy` and frame protection to `/console`. |

### Per sponsor
- **Photon: passes on prod.** Real delivery, no duplicates, a real-time consumer and no threaded replies are all confirmed. The only open item is Suman's first text.
- **Main track / Overall: web, API, privacy and security pass on prod.** Running the full flow on prod still depends on the Reset and payment items below.
- **Visa (Cybersource + TAP): partly verified on prod.** Venue config, live mode and the TAP key match are confirmed. A real hold, capture and release, and the TAP rejection demo, have **not** run on prod yet. They passed earlier against the same venue (see "Verified per sponsor" above).
- **CREAO: not re-verified on prod.** The earlier live runs and the share link still stand. One live Scout run on prod is left to do.

### What was fixed during this pass
- **Runbook:** with `DEMO_TIMERS` on, a reset demo plan closes its own vote after 5 minutes even with zero votes, then texts the team. `docs/TEST-GUIDE.md` §6 and `docs/VERIFICATION.md` §5 now say to press Reset at most 4 minutes before a judge, and to press it again if the console shows ORDERING or APPROVING. They also say the TAP buttons need an order first.
- **Agent behind main:** a teammate already redeployed it (v8, 14:30Z).
- **Stale team test plans** (3849, 1490) were cancelled, so no plan is mid-flow and Reset is now safe.

### Do before judging (human steps, in order)
1. **Check which venue the agent calls.** Run `HTTPS_PROXY=http://127.0.0.1:8899 fly ssh console -a tab-agent -C 'printenv VENUE_BASE_URL'`. It must print `https://squadtab-venue.vercel.app`. If it doesn't, run `HTTPS_PROXY=http://127.0.0.1:8899 fly secrets set -a tab-agent VENUE_BASE_URL=https://squadtab-venue.vercel.app` while no plan is running (this restarts the machine), then fix that line in `apps/agent/.env.fly`. **If you skip this, judge payments may be simulated instead of going through testrest.**
2. **Suman texts `help`** from +1 413 234 2414 to (628) 998-8199 (blue bubble). He should get a reply within about 5 s.
3. **Run the two-phone test** in `docs/TEST-GUIDE.md`. When the first pay link arrives, check that its host is `squadtab-venue.vercel.app` and that the card fields render. The test then covers the prod payment check as well.
4. **Optional: one live CREAO run.** Run `node --dns-result-order=ipv4first scratch/prod/creao/live.mjs` with Fly logs running alongside, as the script describes. It passes if the status is `completed`, the source is `live` and the run takes under 12 minutes.
5. **For each judge:** press Reset on the console (`/console?k=…&ops=1`, Reset, then Confirm within 3 s) **no more than 4 minutes before** they join. Check that `https://tab-agent.fly.dev/plans/4821` shows `open`, today's date and 5:30 PM, and that the console reaches VOTING with real picks (for example Tatsu Ramen Sawtelle or Laemmle Royal). Use the TAP "Break it" buttons only after the plan reaches APPROVING or CAPTURED. Afterwards, run `POST /ops/release-untexted`.

### Will the two-phone test work?
**Very likely, yes.** Every piece the guide uses checked out on prod: the landing, the `sms:` handoff, status polling, invites, Photon delivery, auth and privacy. The two real risks are Suman's missing DM route (step 2 fixes it) and the venue URL (step 1 confirms it). Payment is the one step this pass didn't exercise on prod, so watch the first pay link closely.

### Known non-blocking issues (fix after the event)
- TAP Replay on an OPEN, fully held order returns 500 instead of 409, because `apps/agent/src/ops/routes.ts` has no try/catch around `runTapTest`.
- Real chat plans stored odd times (a 5:00 AM brunch). Not verified; it may just be what the tester typed. In demos, give an explicit time like "6:30pm".
- The clipped hero label (see Web above).
