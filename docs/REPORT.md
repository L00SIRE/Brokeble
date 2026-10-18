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
