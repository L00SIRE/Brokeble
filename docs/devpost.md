# Devpost text (paste into the submission)

Copy from here. Keep the banned phrases out (PLAN section 1): no "agents negotiate", "Nash welfare", "Visa-verified agent", "$0 instantly".

**Before pasting, fill in:** the demo video link (unlisted YouTube), and for the track field the official Applied Intelligence text from live.lahacks.com/tracks (UNVERIFIED; PLAN section 19). Prizes to select: main track (Applied Intelligence), Overall, Visa, CREAO Best AI-First Disruptor. Photon is not on Devpost; the entry path is open (PLAN section 19).

## Tagline

SquadTab is the friend who knows everyone's budget and tells no one.

## Inspiration / the problem

Group plans die at two awkward moments: someone has to say "I can't afford that" in front of everyone, or someone fronts the money and then chases friends to get paid back. According to Zelle research (June 2026), 76% of Gen Z consumers who have fronted money for a group expense, like a trip or event, say they were not fully repaid.

## What it does

Say no without saying why. Nobody pays until everyone's in.

Each friend joins from a link their organizer pastes into the group chat, and then talks to SquadTab in a **private iMessage DM** (SquadTab never joins the group chat, on purpose). A private delegate per friend takes their budget; SquadTab confirms it back with a fixed message and nobody else ever sees it. Our research agent on CREAO, **SquadTab Scout**, searches the open web for real dinner spots and shows that fit the area, date, time and dietary needs. Plain code pairs them, drops anything over anyone's cap, and picks three diverse options that work for the whole group without saying whose budget ruled something out. Friends vote privately, each person authorizes only their own share on a Cybersource Microform pay page, and the purchase is committed only when every share is held. If anyone drops out, every hold is released and the group reads: "Nobody was charged; your pending authorization was released." After booking, **SquadTab Concierge** (the second CREAO agent) produces the itinerary, a calendar file and a Notion page.

The only privacy claim we make: only your own agent hears your budget. CREAO, the group messages, and everyone else's agent never get it, and every money decision is plain code.

## Track: Applied Intelligence

[Paste the official track text here, then answer it.] SquadTab applies AI where it is strong (parsing a person's natural-language budget and preferences, open-world research) and keeps it out where it must not be trusted: no LLM has tools, there is no group-coordinator LLM, the fair-shortlist filter is a pipeline step no model can call, and all money decisions are deterministic code.

## How it applies to each company challenge

**CREAO, Best AI-First Disruptor.** Two agents built on agent.creao.ai do the core work. Scout produces every option the group can vote on; remove it and SquadTab has nothing to vote on. Concierge produces the itinerary, calendar file and Notion page after checkout. We extended them with our own tool: the `tab` skill and CLI (https://github.com/L00SIRE/SquadTab/tree/main/skills/tab), saved with the agents, which stream live progress into our console, validate the agent's output against our schema in a fix loop (up to 5 rounds), and submit. Runs are started through the API with an idempotency key; the unsigned webhook is only a hint, so we re-fetch the run and also poll every 15 s. If a run times out, we fall back to options from a real earlier Scout snapshot or a code-built itinerary, and the console labels every run live or cached. CREAO only ever receives a research brief (enums, area, date, times, party size); our account key stays on our server and CREAO Secrets hold only a narrow agent token and our API address.
- Scout agent ID: `1b834601-b727-40aa-b80d-7e7d1c0cabe0`
- Concierge agent ID: `465a1d2e-a46f-496c-adea-fc471a396a6c`
- Scout run share link: https://agent.creao.ai/share/12ea3fa0f9699dabe5175e2cb6eadc28

**Visa, The Future of Shopping.** AI across the shopping journey: discovery (CREAO), decision (private ballot and fair shortlist), personalization (private caps), checkout and payments (split-tender holds plus a signed commit), and post-purchase (receipts, itinerary). A group purchase becomes an assurance contract at the merchant of record: N cardholder-initiated authorizations, and an identified agent that can commit only the exact consent set. We built our own Ed25519 RFC 9421 signer for the Visa Trusted Agent Protocol and a six-step verifier at the merchant (tag, fields, 8-minute window, single-use nonce, key, signature over a digest of the consent set rebuilt from the venue database). Honest notes: the merchant is our "SquadTab Partner Venue (sandbox merchant of record)" selling a prepaid, ticketed bundle; the TAP key directory is a labelled mock; we send no Agentic Payment Container. Payments are real Cybersource sandbox calls on Cybersource's published sample test merchant (testrest): shared, test cards only, no real money (our own sandbox merchant is blocked by a Cybersource-side processor setup error). A labelled simulation mode exists as a backup and is marked "Simulated" on the page and ledger. The console has live Tamper, replay, expired and wrong-tag buttons that are rejected with nothing captured.

**Photon, iMessage.** Built on Photon 2.0 (`@photon-ai/api` 0.5.0 plus the Socket.IO event stream with a persisted replay cursor), live on iMessage DMs through Photon's shared lines. Judges and friends use their own phones; no app to install and no new group app. Typing indicators during long research runs, mark-as-read, idempotent sends, and handling for the shared-line rules (the user texts first, capacity limits). Vision: a private delegate per friend, a code mechanism between them, and humans keep the final yes.

## How we built it

TypeScript throughout. A Hono backend on Fly.io holds the private delegates (Anthropic Claude Haiku 5.5 and Sonnet 5.5, never with tools), the plan state machine, the fixed message templates and the pure-code compose, filter, score and pick steps. A Next.js partner venue on Vercel prices every order itself, hosts the Microform pay page and verifies signed agent requests. A Next.js web app has the create and join pages and the Trust Console, which shows live lanes, a context X-ray (what each AI saw, with budgets always shown as a lock), the CREAO lane, the TAP panel and the ledger. Supabase Postgres has separate schemas and roles for the agent and the venue. A value-specific privacy test seeds odd budgets and fails the build if any leaks outside its owner's delegate and DM.

## Challenges

- Our own Cybersource sandbox merchant failed every authorization with a processor setup error (reason 150) on Cybersource's side; we moved to Cybersource's published sample merchant and kept a labelled simulation as a backup.
- Photon's free shared lines are DM-only, reject threaded replies, and require the user to text first, which shaped the whole private-DM design.
- Cybersource has no idempotency header, so we designed unique attempt records, deterministic reference codes and a timeout reversal instead of ever blind-retrying an authorization.
- CREAO webhooks are unsigned, so every webhook triggers a re-fetch of the run.

## Accomplishments

- Privacy by context isolation, enforced by a build-failing test, not by prompts.
- An all-or-nothing commit that happens exactly once, even under races.
- Our own TAP signer and verifier with live rejection demos.
- A CREAO agent that validates and fixes its own output before submitting.

## What we learned

Money talk is a privacy problem first. Keeping each person's budget inside one isolated model call and a database table, with code owning every number, made the privacy claim small enough to test.

## What's next

Partner merchants integrating SquadTab checkout, Visa agent registration instead of the mock key directory, group-aware plan types beyond dinner and a show, and a fee per committed group booking (a hypothesis, not validated).

## Built with

TypeScript, Node.js 22, Hono, Next.js 16, Tailwind CSS 4, Supabase Postgres, Fly.io, Vercel, Photon 2.0 (`@photon-ai/api`), CREAO (agent.creao.ai), Anthropic Claude (Haiku 5.5, Sonnet 5.5), Cybersource (Microform, TMS, REST), Visa Trusted Agent Protocol, Notion, Zod, Vitest.

## Links

- GitHub: https://github.com/L00SIRE/SquadTab
- Live web: https://tab-web-ten.vercel.app
- Demo video: [add the unlisted YouTube link]
