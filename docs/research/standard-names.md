# Standardized names (from the consistency pass; PLAN.md is authoritative)

## Ownership
- **A:** `apps/agent/src/{photon,router,delegates,plan,notify,jobs,join,ops,money,repo,dev}`, `scripts/seedDemo.ts`, `fixtures/demo-*.json`, `packages/shared/src/templates.ts`, migration `004_pay_links`.
- **B:** `src/{creao,decide,agentApi,voice}`, `fixtures/cached-options/`, `apps/web`, `skills/tab`.
- **C:** `apps/venue`, `src/{tap,venueClient}`, `packages/shared/src/{tap,pricing}.ts`, migrations `005+_venue_*`.

## register.ts
- `src/index.ts` is foundation-owned, then frozen. It calls three register functions, each typed `(app, jobs) => void`:
  - `registerA` in `src/plan/register.ts`
  - `registerB` in `src/agentApi/register.ts`
  - `registerC` in `src/venueClient/register.ts`
- Owners mount their routes and due_jobs kinds only in their own `register.ts`. A mounts `/venue/hook` and `/ops/*` (including `/ops/tap-test`).

## Anthropic
- **One adapter:** A's `src/delegates/anthropicLLM.ts` (`AnthropicLLM`). It is created with `new Anthropic()`; each call is `messages.parse(body, { timeout, maxRetries })`.
- **B's prompts:** `src/decide/ratePrompt.ts` exports `RATE_SYSTEM`, `buildRateUserMessage(prefs, candidates)` and `REPAIR_SYSTEM`.
- **Call settings:**
  - rate: sonnet, 4096 max tokens, 30 s, 2 retries
  - repair: haiku, 12000 max tokens, 30 s, 2 retries
- **Low confidence:** a throw, a null result, or a stop reason of `refusal` or `max_tokens`.

## Contracts
- `RateCandidate` = `PublicBundle.extend({ index: 1..20 })`.
- `rateBundles(prefs, candidates: RateCandidate[])`.
- `consentFromOrder(o: OrderStatus) → ConsentSet` and `canonicalConsent(c) → string`, imported only via `@tab/shared/tap`.
- `@tab/shared` exports: `.`, `./private`, `./tap`, `./pricing`, `./templates`.

## B decide functions
- **Pure:** `compose`, `fitsPrefs`, `filter`, `effectiveHardMax`, `selectForRating`, `shortlist`, `pickWinner`, `resolveApprovals(parse, shortlist, planTimeStart)`.
- **Orchestrators** in `decide/score.ts`:
  - `computeShortlist(planId) → { from_count, survived_count, survivors, top3 }`
  - `computeWinner(planId, version)`
- The orchestrators compute only. A writes `app.bundles`, emits `shortlist` and does every fan-out.

## Hooks
- **A → B:** `startResearch`, `cancelResearch`, `startConciergeFor`, `startLiveScoutDemo`.
- **B → A:** `plan.onOptionsReady(planId)`, which enqueues `recompute:<planId>:options`.
- **Dropped:** `onResearchReady`, `onResearchFailed`, `runShortlist`, `runWinner`, `research.*` and the typing helper.

## notify
- Signature: `notify(userId, TemplateId, vars, { key, planId?, replyTo? })`.
- Keys come from `tplKey(planId, userId, templateId, version, suffix?)` or `replyKey(inboundId, n)`, both exported from `src/notify/notify.ts`.
- The `T_DECLINED_RETRY` key suffix is `:<VenueEvent.event_id>`.

## C venueClient
- `verifyVenueHook(rawBody, headers: Headers): VenueEvent | null`
- `callVenueSweep()`
- `runTapTest(kind, orderId)`
- `emitLedger(ev)` and `emitCounters()` in `venueClient/ledger.ts`
- `CommitPendingError`
- `VenuePort.commit` emits `tap.signed` and `tap.verify`.

## SSE
- `xray` events are partial lists; the console merges them by `name`.
  - B emits `scout_input:*` via `emitScoutXray`.
  - A emits `fanout` and `delegate:*`.
- The venue never emits `tap.verified`.
- `share.released{retry}` decides whether a retry link is sent.

## Endpoints
- `GET /events/snapshot?k=` → `{ last_id, events: { id, data }[] }` (the last 500 events).
- `/ops/*` uses CORS: `{ origin: WEB_ORIGIN, allowHeaders: ["Authorization", "Content-Type"], allowMethods: ["POST"] }`.
- `/join` returns one of: 200, 404 `not_found`, 409 `plan_closed`, 422 `invalid`, 429 `rate_limited`, or 503 when at capacity.
- `sweep` → `{ ok, timeout_reversed, expired_cancelled, outbox_delivered, nonces_purged }`.

## Env vars
- **New:**
  - `OWNER_DATABASE_URL` (migrations; local/CI only)
  - `TEST_DATABASE_URL`
  - `AGENT_API_ALLOW_TEST_REF`
  - `DEMO_TEAM=[{phone_e164, first_name}]`
  - `DEMO_CODE=4821`
  - `TYPING_REFRESH_MS=5000`
  - `VOICE_ENABLED` and the `ELEVENLABS_*` set
- **Changed:** `PAY_LINK_TTL_MIN=1440`, `TAX=0.1025`.
- **TAP `@authority`:** `new URL(VENUE_BASE_URL).host`. The agent no longer asserts `VENUE_PUBLIC_HOST`.

## DB
- `db/roles.sql` is run once via psql. It is not a migration and also sets default privileges. (`003_roles.sql` is gone.)
- Migrations: `001_app`, `002_venue`, `004_pay_links` (A), `005+_venue_*` (C). Apply them against `$OWNER_DATABASE_URL`.
- `payer_ref` = `hmacSha256Hex(PAYER_REF_SECRET, id).slice(0, 32)`.
- Pay links are stored in `app.pay_links`.
- **Seeding:** writes `research_runs.creao_run_id = NULL` and stores the fixture's run ID in `result.cached_from_run_id`.
- **Bundles** carry `survived` and `shortlist_rank`.
- **Plan state `SHOWCASE`:** used only for B's live-Scout showcase row.
- **due_jobs:**
  - `voice_nudge` uses key `voice:<planId>:<v>`.
  - `check_research_ready` uses key `<planId>:<researchRunId>`.
