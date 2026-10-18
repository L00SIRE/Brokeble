# SquadTab

**SquadTab is the friend who knows everyone's budget and tells no one. It finds the plan you can all afford, and nobody pays until everyone's in.**

Thesis: *Say no without saying why. Nobody pays until everyone's in.*

Each friend DMs SquadTab privately on iMessage. A private delegate per person takes their budget, a CREAO research agent finds real dinner and show options, plain code keeps only the bundles that fit **everyone's** cap and picks a fair three, the group votes privately, and every friend authorizes only their own share. The purchase goes through only when every share is held. SquadTab never joins your group chat, on purpose: money talk only works in private.

> According to Zelle research (June 2026), 76% of Gen Z consumers who have fronted money for a group expense, like a trip or event, say they were not fully repaid.

## Built at LA Hacks AI 2026

LA Hacks AI Hackathon, UCLA, Oct 17-18, 2026. All code in this repo was written during the hackathon window (Sat Oct 17 12:00 PM to Sun Oct 18 12:00 PM PDT).

- Demo video: see the Devpost submission (link added there when uploaded).
- Live agent: https://tab-agent.fly.dev/healthz
- Live web (create a plan, join, Trust Console): https://tab-web-ten.vercel.app
- Live partner venue (sandbox merchant of record): https://tab-venue.vercel.app

## Architecture

```
 iPhones (friends + judge) -- iMessage DMs --> Photon 2.0 shared lines
                                                  | Socket.IO events in / REST sends out
                                                  v
 apps/agent (Hono, Node 22, Fly.io)
   private delegates (Anthropic, one per person, no tools) . plan state machine . templates
   decide/: compose, filter, score, pick (pure code)     money/: holdGate
   CREAO client (POST /runs, webhook re-fetch, 15 s poll)  /agent/* (tab CLI, Bearer token)
   TAP signer (Ed25519, RFC 9421) --> VenuePort
        |                       ^                          |
        | CREAO API             | tab CLI (progress,       | signed HTTPS (Visa TAP)
        v                       |  options, itinerary)     v
 CREAO: SquadTab Scout ---------+              apps/venue (Next.js, Vercel)
        SquadTab Concierge                      "SquadTab Partner Venue (sandbox merchant of record)"
                                                TAP verifier (6 steps), pay page (Microform), Cybersource
                                                          |
 apps/web (Next.js, Vercel): create plan, join,           v
 Trust Console (SSE, no budgets)               Visa Cybersource sandbox: hold, capture, release
```

Data lives in Supabase Postgres: schema `app` (agent role) and schema `venue` (venue role). Cybersource credentials, TMS tokens and card data exist only in `apps/venue`.

## Privacy and money invariants

Each has a test (`pnpm test`). Full table: `docs/PLAN.md` section 4.

1. Budgets live only in `app.private_constraints`, readable only by that person's own delegate, the filter/score step and `holdGate`.
2. A delegate sees only its own person's message plus that person's own state. There is no group-coordinator LLM.
3. No LLM ever has tools. The filter is a pipeline step, never a callable.
4. Money and privacy messages are fixed templates sent through one function (`notify`).
5. CREAO inputs are a `ResearchBrief` only: enums, area, date, times, party size. No names, phones, budgets or free text.
6. `app.events` and SSE never carry constraint values; the console shows delegates as a lock.
7. Cybersource credentials, TMS tokens and card data live only in `apps/venue`; card data only inside Microform iframes.
8. Amounts always come from the venue database via `priceBundle()`.
9. Capture happens only after a TAP-verified commit whose body equals the consent set rebuilt from the database, with every share authorized.
10. Cybersource has no idempotency header: unique `(share_id, op, attempt)`, deterministic reference codes, persisted transaction ids, timeout reversal, no blind retries of an auth.
11. Copy: we say "Nobody was charged; your pending authorization was released." We never say "$0 instantly" or "Visa-verified agent".
12. No secrets in git.

The value-specific privacy test (`privacy.e2e.test.ts`) seeds odd budgets ($31.17, $47.29, $63.43, $88.61 and others) and fails the build if any appears in another person's delegate call, a CREAO input, a fan-out text, `app.events`, SSE frames, logs or venue requests.

## CREAO

Two agents, both built on agent.creao.ai:

| Agent | Agent ID | Job |
|---|---|---|
| **SquadTab Scout** | `1b834601-b727-40aa-b80d-7e7d1c0cabe0` | Researches the open web for real dinner spots and shows (open-at-time evidence, show start times, dietary fit, price evidence). It produces **every option the group can vote on**. |
| **SquadTab Concierge** | `465a1d2e-a46f-496c-adea-fc471a396a6c` | Runs after booking: transit and parking, doors time, dress code, itinerary, calendar file and Notion page. |

- **Run share link (Scout, PII-free input):** https://agent.creao.ai/share/12ea3fa0f9699dabe5175e2cb6eadc28 (the agent validates its output against our schema, fixes it, and submits 12 accepted options).
- **Concierge:** later runs submit successfully (HTTP 201 on `/agent/itinerary`); see the console's CREAO lane and the `[API]` run thread on agent.creao.ai.
- **Our skill and CLI:** https://github.com/L00SIRE/SquadTab/tree/main/skills/tab (a python3 `tab` CLI: `ping`, `progress`, `schema`, `options validate|submit`, `itinerary submit`). It is saved with the agents and also published as a public SKILL.md.

How the product uses CREAO:

- Our agent starts runs with `POST https://agent.creao.ai/api/v1/runs {appId, inputs, webhookUrl, idempotencyKey}`. The idempotency key makes retries safe.
- Webhooks are unsigned, so the webhook at `/creao/hook/:secret` is only a hint: we dedupe, then **re-fetch `GET /runs/{id}`** and act on that. We also poll every 15 s.
- Timeouts: Scout 6 min, Concierge 10 min. On timeout or failure the plan continues with options from a real earlier Scout snapshot (Scout) or a code-built itinerary (Concierge). The console labels every run **live** or **cached**, and we say so out loud in the demo.
- Inside the run, the agent writes `options.json`, runs `tab options validate`, fixes the exact reported paths (up to 5 rounds), then runs `tab options submit`. Progress lines posted with `tab progress` stream into the console's CREAO lane.
- Privacy: CREAO receives only a `ResearchBrief` (enums, area, date, times, party size). The account `capi_` key stays on our server. CREAO Secrets hold only `TAB_API_BASE` and a narrow `TAB_AGENT_TOKEN` that can reach three endpoints (progress, options, itinerary).

*Remove Scout and SquadTab has nothing to vote on; remove Concierge and there is no plan or calendar after checkout.*

## Sponsors

### Photon (iMessage)

Built on Photon 2.0 Beta: `@photon-ai/api@0.5.0` for REST plus Socket.IO events with a persisted replay cursor. Live iMessage DMs on Photon's free shared lines, so the user always texts first. We reply with the inbound space and sender ids and an idempotency key on every send, mark messages read, and keep the typing indicator going during long research runs. Judges join from their own phones via a web join page, and the backend assigns them a line. We use plain text only: no polls, tapbacks, edits or effects (not available in the 2.0 iMessage content union), and no threaded replies (shared lines reject them).

### Visa (Cybersource and Trusted Agent Protocol)

A group purchase as an assurance contract at the merchant of record: N cardholder-initiated authorizations, and an identified agent that can commit only the exact consent set.

- The merchant is **"SquadTab Partner Venue (sandbox merchant of record)"**, selling a prepaid, ticketed dinner + show bundle. CREAO finds real options; partner merchants integrate SquadTab checkout; this demo merchant is ours. No real business's name is used on the pay page.
- Payments are real Cybersource sandbox calls (authorization with `capture:false` and token creation, capture, reversal, timeout reversal) made on **Cybersource's published sample test merchant (`testrest`)**: shared, test cards only, no real money. Our own sandbox merchant is blocked by a processor setup error on Cybersource's side (reason 150). The venue also has a labelled simulation mode (`CYBS_MODE=mock`); when it is on, the pay page and ledger say "Simulated". This is not our merchant account and not provided or approved by Visa.
- Card data exists only inside Cybersource Microform iframes.
- Our own Ed25519 RFC 9421 signer and a six-step TAP verifier (right tag for the route, required fields, 8-minute window, single-use nonce, known key, valid signature over the request with a content digest of the consent set rebuilt from the venue database). The key directory is a labelled **mock**; Visa agent registration is the production path. We send no Agentic Payment Container: each human pays their own share.
- `holdGate`: a share above your private max needs your private yes before a pay link is sent.
- The Trust Console has live Tamper, replay, expired and wrong-tag buttons; each is rejected and nothing is captured.

### CREAO

See the CREAO section above.

## Run it locally

Requirements: Node >= 22.12, pnpm 10.21.0.

```bash
pnpm install
cp .env.example .env.local   # fill in keys; mock modes work without any
pnpm dev                     # agent :8080, web :3000, venue :3001 (mock modes by default)
pnpm sim:plan                # a full mocked plan through POST /dev/inbound
pnpm test                    # vitest across packages (includes the privacy, TAP and race tests)
pnpm typecheck
```

`pnpm db:migrate` applies `db/migrations/*.sql` to a Postgres database; `pnpm seed:demo` creates the demo plan with cached options.

## Repo layout

- `apps/agent`: Hono backend (Photon, router, delegates, plan state machine, CREAO, TAP signer, jobs).
- `apps/venue`: Next.js partner venue (pay page, TAP verifier, Cybersource).
- `apps/web`: Next.js create/join pages and the Trust Console.
- `packages/shared`: zod contracts, templates, pricing, TAP helpers.
- `skills/tab`: the `tab` CLI and schemas used inside CREAO runs.
- `db`: migrations and roles.
- `docs`: `PLAN.md` (master plan), `EXPLAINER.md`, per-owner plans, research, `devpost.md`.

## Team

Built by the SquadTab team at LA Hacks AI 2026: [@cibarbia05](https://github.com/cibarbia05), [@L00SIRE](https://github.com/L00SIRE) and a third teammate who owns the venue and payments.
