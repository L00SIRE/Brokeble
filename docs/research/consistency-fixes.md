# Cross-document consistency check: PLAN.md, CLAUDE.md, AGENTS.md, A, B and C

Read-only pass; no files were written. Each item names the doc, the exact text to replace (or the place to insert), the replacement, and the reason. Where PLAN and a teammate plan disagreed, the more verified version won and both docs are fixed to match. "CLAUDE/AGENTS" means: apply the same edit to both files.

Checked in this pass:
- **Context7 `/anthropics/anthropic-sdk-typescript`:** per-request `RequestOptions` `{timeout, maxRetries}` passed as the second argument to `messages.create`.
- **Context7 `/honojs/website`:** `cors({ origin, allowHeaders, allowMethods })`.
- **Postgres:** `ALTER DEFAULT PRIVILEGES` is standard Postgres. Supabase-specific behaviour is still covered by the existing Supavisor smoke test.

---

## Issues

### 1. Nobody owns `src/repo/`, `src/money/`, `src/dev/`, or `apps/agent/src/index.ts` after the foundation lands
A claims repo/ and money/ in a chat post. C already lists them as A's. B asks "the foundation owner" to edit `index.ts`, but the foundation is Claude, not a teammate.

**Fix:** A owns repo/, money/ and dev/. The foundation pre-wires one `register.ts` per owner, so nobody edits `index.ts`.

- **PLAN §5**
  - Replace `│  ├─ agent/            # A owns src/{photon,router,delegates,plan,notify,jobs,join,ops}; B owns src/{creao,decide,agentApi}; C owns src/{tap,venueClient}`
  - With `│  ├─ agent/            # A owns src/{photon,router,delegates,plan,notify,jobs,join,ops,money,repo,dev}, scripts/seedDemo.ts, fixtures/demo-*.json; B owns src/{creao,decide,agentApi,voice}, fixtures/cached-options/; C owns src/{tap,venueClient}. src/index.ts (foundation, then frozen) calls registerA (src/plan/register.ts), registerB (src/agentApi/register.ts), registerC (src/venueClient/register.ts); each owner mounts routes and due_jobs kinds only in its own register.ts`
- **PLAN §5, foundation list.** After `│  │  ├─ src/dev/       # POST /dev/inbound simulator (MESSAGING_MODE=mock only)` add the line `│  │  ├─ src/{plan,agentApi,venueClient}/register.ts  # foundation stubs: (app, jobs) => void`
- **A §2**
  - Replace: `PLAN §5 lists no owner for `src/repo/` or `src/money/`. A takes both: post "A owns repo/ + money/holdGate.ts" in team chat at 6:00.`
  - With: `PLAN §5 assigns `src/repo/`, `src/money/` and `src/dev/` to A. A mounts its routes and job kinds (including `/venue/hook` and `/ops/*`) in `src/plan/register.ts`.`
- **B §2**
  - Replace: `` `apps/agent/src/index.ts` (foundation): the one place routes are mounted and due_jobs kinds are registered. Add your mounts in one announced PR (§5 T2).``
  - With: `` `apps/agent/src/agentApi/register.ts` (yours; foundation stub): mount `agentApiRoutes` and `creaoHookRoutes` and register your due_jobs kinds here. Never edit `src/index.ts`.``
- **B T2**
  - Replace: `Export one `agentApiRoutes` Hono instance. Ask the foundation owner to `app.route("/", agentApiRoutes)` and the same for `creaoHookRoutes` in `src/index.ts`, and to register your due_jobs kinds (T5).`
  - With: `Export one `agentApiRoutes` Hono instance, and mount it, `creaoHookRoutes` and your due_jobs kinds (T5) in `src/agentApi/register.ts`.`
- **C §7, 6:45 row.**
  - Replace: `; who mounts `/venue/hook` (raw body) and `/ops/tap-test`.`
  - With: `. (Settled: A mounts `/venue/hook` and `/ops/tap-test` in `src/plan/register.ts`; C mounts nothing in the agent except via `src/venueClient/register.ts` if needed.)`

### 2. Two Anthropic adapters are planned (`delegates/anthropicLLM.ts` from A, `ports/llm.anthropic.ts` from B)
`repairScoutJson` is claimed by both A §3.1 and B §3.2. Two clients would also split the P5/P7 request recorder.

**Fix:** one adapter, owned by A. B owns the rate and repair prompts plus their parameters. Per-request options are verified (Context7: `RequestOptions` is the second argument to `messages.create`).

- **PLAN §9**
  - Replace: `export interface LLMPort {                             // A (delegates) + B (ratings). real: Anthropic. mock: deterministic canned parses`
  - With: `export interface LLMPort {                             // A owns the one adapter (src/delegates/anthropicLLM.ts, one recorder for P5/P7); B owns rate/repair prompts (src/decide/ratePrompt.ts). mock: deterministic canned parses`
- **PLAN §9**
  - Replace: `then read `response.parsed_output` (null on failure → treat as low confidence).`
  - With: `then read `response.parsed_output`. `parse()` **throws** `AnthropicError` on JSON/zod failure (verified: `@anthropic-ai/sdk@0.135.0` `helpers/zod.js`), so wrap it in try/catch. A throw, a null `parsed_output`, or `stop_reason` `refusal`/`max_tokens` all count as low confidence. Per-call limits go in the second argument: `messages.parse(body, { timeout, maxRetries })`.`
- **A §3.1, LLMPort row**
  - Replace: `B exports `RATE_SYSTEM` and `buildRateUserMessage(prefs, bundles)` from `src/decide/ratePrompt.ts`; A's adapter only sends them.`
  - With: `B exports `RATE_SYSTEM`, `buildRateUserMessage(prefs, candidates)` and `REPAIR_SYSTEM` from `src/decide/ratePrompt.ts`; A's adapter only sends them. Parameters: rate = sonnet, `max_tokens 4096`, `{timeout: 30_000, maxRetries: 2}`; repair = haiku, `max_tokens 12000`, `{timeout: 30_000, maxRetries: 2}`.`
- **A T6, facts list.**
  - Replace `- `response.parsed_output` is null on a parse failure;`
  - With `- `messages.parse()` throws `AnthropicError` when the output fails JSON/zod validation (B verified this in `helpers/zod.js`); `parsed_output` may still be null; both map to `null`;`
- **A T6, code.**
  - Replace: `const client = new Anthropic({ timeout: 10_000, maxRetries: 1 });   // worst case ~20 s, inside T2's 45 s`
  - With: `const client = new Anthropic();                                     // per-call limits below (RequestOptions, verified)`
- **A T6, code.**
  - Replace: `model: "claude-haiku-5-5" | "claude-sonnet-5-5" = "claude-haiku-5-5"): Promise<T | null> {`
  - With: `o: { model?: "claude-haiku-5-5" | "claude-sonnet-5-5"; maxTokens?: number; timeoutMs?: number; maxRetries?: number } = {}): Promise<T | null> {`
- **A T6, code.** Make these three replacements:

  | Replace | With |
  |---|---|
  | `model, max_tokens: 2048, system,` | `model: o.model ?? "claude-haiku-5-5", max_tokens: o.maxTokens ?? 2048, system,` |
  | `const r = await client.messages.parse(body);` | `const r = await client.messages.parse(body, { timeout: o.timeoutMs ?? 10_000, maxRetries: o.maxRetries ?? 1 });   // delegates: worst case ~20 s, inside T2's 45 s` |
  | `- Call `delegateParse(Ratings, RATE_SYSTEM, …, "claude-sonnet-5-5")`.` | `- Call `delegateParse(Ratings, RATE_SYSTEM, …, { model: "claude-sonnet-5-5", maxTokens: 4096, timeoutMs: 30_000, maxRetries: 2 })`.` |

- **B §2**
  - Replace: `` `apps/agent/src/ports/llm.anthropic.ts`: you implement `rateBundles` and `repairScoutJson`. A owns the other three methods. Ping A.``
  - With: `` `apps/agent/src/decide/ratePrompt.ts` (yours): `RATE_SYSTEM`, `buildRateUserMessage(prefs, candidates)`, `REPAIR_SYSTEM`. A's `src/delegates/anthropicLLM.ts` sends them with the parameters in T6. Never create a second Anthropic client.``
- **B §3.2**
  - Replace: `| `LLMPort.rateBundles(prefs, PublicBundle[]) → Ratings` (claude-sonnet-5-5, effort low) and `repairScoutJson(raw, category)` (claude-haiku-5-5) | `src/ports/llm.anthropic.ts` | `score.ts` orchestrator, `research.ts` |`
  - With: `| Prompts and parameters for `LLMPort.rateBundles(prefs, RateCandidate[])` (claude-sonnet-5-5, low, 4096, 30 s × 2 retries) and `repairScoutJson` (claude-haiku-5-5, low, 12000, 30 s × 2 retries) | `src/decide/ratePrompt.ts` | A's `AnthropicLLM` adapter |`
- **B T6**
  - Replace: `**`rateBundles`** (`llm.anthropic.ts`, @anthropic-ai/sdk 0.135.0). VERIFIED in the package source:`
  - With: `**`rateBundles` / `repairScoutJson` request shape** (B specifies; A's `delegates/anthropicLLM.ts` sends it; @anthropic-ai/sdk 0.135.0). VERIFIED in the package source:`
- **B T6, code.**
  - Replace: `const client = new Anthropic({ timeout: 30_000, maxRetries: 2 });   // TS timeout is in ms`
  - With: `// A's adapter sends: messages.parse(body, { timeout: 30_000, maxRetries: 2 })  (RequestOptions, verified Context7)`
  - Also: `parse` forwarding RequestOptions is the same SDK path as `create`. Add one adapter test that `{timeout: 1}` throws.

### 3. Shortlist and winner orchestration is built twice (A `recompute` vs B `runShortlist`/`runWinner`), and the hook names disagree
Both plans compose, filter, rate, write `app.bundles` and emit `shortlist`. The hook names also differ: A uses `research.start/cancelPlan/startLiveDemo/onPlanConfirmed` and `plan.onOptionsReady`; B uses `onResearchReady/onResearchFailed/runShortlist/runWinner`.

**Fix:**
- B's orchestrators live in `decide/score.ts`, which is already on the P1 allowlist, so P1 is unchanged and A's §3.3 item 5 goes away.
- They compute only. A owns transitions, `app.bundles` writes, the `shortlist` SSE and every fan-out.
- `onResearchFailed` is dropped: cached options are always available.

- **PLAN §9.** Replace the two lines starting `// pure (B): compose(options, plan) → Bundle[]; filter(...` with:
  ```
  // pure (B, src/decide): compose(options, plan) → Bundle[]; fitsPrefs(bundles, prefs[]) → Bundle[];
  //   filter(bundles, constraints) → Bundle[]; effectiveHardMax(c) → cents; selectForRating(bundles) → Bundle[≤15];
  //   shortlist(bundles, ratings, constraints) → Bundle[≤3]; pickWinner(shortlist, ballots, ratings, constraints) → bundleId;
  //   resolveApprovals(parse: BallotParse, shortlist: PublicBundle[], planTimeStart: HHMM) → bundleId[]  (minutes since plan start, +24 h wrap)
  // orchestrators (B, src/decide/score.ts; P1 allowlist, the ONLY place constraints are loaded for decisions):
  //   computeShortlist(planId) → { from_count, survived_count, survivors: Bundle[], top3: Bundle[] }  (rates + upserts app.ratings; writes nothing else, emits nothing)
  //   computeWinner(planId, version) → bundleId   (shortlist = app.bundles rows with shortlist_rank for that version)
  // hooks (final): A → B: startResearch(planId), cancelResearch(planId), startConciergeFor(planId), startLiveScoutDemo()
  //                B → A: plan.onOptionsReady(planId)  (enqueues recompute `recompute:<planId>:options`)
  // A owns plan transitions, app.bundles writes, the `shortlist` SSE, T_STILL_LOOKING, research-phase typing and every fan-out.
  ```
- **A §3.2**
  - Replace: `| B | `compose(options, plan)`, `filter(bundles, constraints)`, `shortlist(bundles, ratings, constraints)`, `pickWinner(shortlist, ballots, ratings, constraints)`, and `effectiveHardMax(c)` exported from `decide/filter.ts` | `plan/decision.ts`, `plan/ballots.ts`, `money/holdGate.ts` |`
  - With: `| B | `computeShortlist(planId)`, `computeWinner(planId, version)` (`decide/score.ts`), `resolveApprovals(parse, shortlist, planTimeStart)` (`decide/ballot.ts`), `effectiveHardMax(c)` (`decide/filter.ts`) | `plan/decision.ts`, `plan/ballots.ts`, `money/holdGate.ts` |`
- **A §3.2**
  - Replace: `| B | `research.start(planId)`, `research.cancelPlan(planId)`, `research.startLiveDemo()`, `research.onPlanConfirmed(planId)`. The last one starts Concierge, and B sends `T_ITINERARY` through `notify`. | These are proposed hook names; confirm them at the 6:00 sync |`
  - With: `| B | `startResearch(planId)`, `cancelResearch(planId)`, `startLiveScoutDemo()`, `startConciergeFor(planId)` (starts Concierge; B sends `T_ITINERARY` through `notify`) | Final names (PLAN §9) |`
- **A, global rename.** Replace each name in T7, T9, T11 and T14:

  | Old | New |
  |---|---|
  | `research.start(planId)` | `startResearch(planId)` |
  | `research.cancelPlan(planId)` / `research.cancelPlan` | `cancelResearch(planId)` |
  | `research.startLiveDemo()` | `startLiveScoutDemo()` |
  | `research.onPlanConfirmed(planId)` | `startConciergeFor(planId)` |

- **A §3.3 item 5.** Replace the whole item (`5. **PLAN clarification for P1 (raise at 6:00).** … (they shouldn't; the SQL stays in `repo/`).`) with: `5. (Withdrawn: constraints are loaded only inside B's `decide/score.ts` orchestrators, so P1 and its allowlist are unchanged.)`
- **A T7 `recompute`.** Replace steps 1–5 (`1. Load the plan, options …` through `5. `top3 = shortlist(survivors, ratings, constraints)`.`) with: `1. `const { from_count, survived_count, survivors, top3 } = await computeShortlist(planId)` (B: loads options, members ≥ PREFS_DONE and not DECLINED, prefs and constraints; rates each member with only that member's prefs (P2); upserts `app.ratings`).`
- **A T7, step 6 (RESEARCHING branch).**
  - Replace `- write `app.bundles` for this version;`
  - With `- write `app.bundles` for this version (every survivor with `survived=true`; `shortlist_rank` 1–3 for `top3`);`
  - Make the same change in the VOTING branch (`- write the new version's bundles`).
- **A T8.** Replace the paragraph `**Constraints are evaluated in code.** Times are compared …` and its three bullets with: `**Constraints are evaluated in code by B's `resolveApprovals(parse, publicShortlist, plan.time_start)`** (minutes since plan start, +24 h for times before `time_start`). It drops *i* if `show_end_est(i) > end_before`, `dinner_time(i) < start_after`, or `exclude.index === i`. Digits-only replies call it with `constraints: []`. A never re-implements it.`
- **A T8**
  - Replace `1. `winnerId = pickWinner(shortlist, ballots, ratings, constraints)` (B). Non-voters approve nothing.`
  - With `1. `winnerId = await computeWinner(planId, version)` (B). Non-voters approve nothing.`
- **A §8.1**
  - Replace the row `| `ballot.constraints.test.ts` | … | A |`
  - With `| `ballot.constraints.test.ts` | Moved into B's `decide/ballot.test.ts` (same cases, including the `00:30` show end) | B |`
- **B §3.1**
  - Replace: `| A | Plan state machine hooks | You call `onResearchReady(planId)` / `onResearchFailed(planId)`. A calls your `startResearch(planId)` and `runWinner(planId, version)`. Names are agreed at the 8:45 PM checkpoint (§7). |`
  - With: `| A | Plan state machine hooks (final, PLAN §9) | You call `plan.onOptionsReady(planId)` once both categories have options (live or cached). A calls your `startResearch`, `cancelResearch`, `computeShortlist`, `computeWinner`, `resolveApprovals`, `startConciergeFor`, `startLiveScoutDemo`. |`
- **B §3.1.** Delete the row `| A | A typing helper, e.g. `setTypingFor(userId)`, … | `research_typing` job. Agree the name at 8:45 PM. |`
- **B §3.2**
  - Replace: `| `startResearch(planId)`, `runShortlist(planId, version)`, `runWinner(planId, version) → bundleId`, `startConciergeFor(planId)`, `startLiveScoutDemo()` |`
  - With: `| `startResearch(planId)`, `cancelResearch(planId)`, `computeShortlist(planId)`, `computeWinner(planId, version) → bundleId`, `startConciergeFor(planId)`, `startLiveScoutDemo()` |`
- **B §3.2**
  - Replace `| `compose`, `fitsPrefs`, `filter`, `shortlist`, `pickWinner`, `resolveApprovals` | `src/decide/*` | A (ballot wiring, winner) |`
  - With `| `compose`, `fitsPrefs`, `filter`, `effectiveHardMax`, `selectForRating`, `shortlist`, `pickWinner`, `resolveApprovals` | `src/decide/*` | A (`holdGate` uses `effectiveHardMax`; ballots use `resolveApprovals`) |`
- **B T2**
  - Replace `Otherwise enqueue `checkResearchReady` (T5).`
  - With `Otherwise enqueue `check_research_ready` (T5).` (the T2 name was internally inconsistent with T5)
- **B T5 table.**
  - Replace the `check_research_ready` row with: `| `check_research_ready` | `<planId>:<researchRunId>` | now | If both categories now have options (live or cached) → `plan.onOptionsReady(planId)` (A dedupes with `recompute:<planId>:options`). Otherwise mark done. |`
  - Delete the `research_typing` and `research_still_looking` rows (A's T7 typing interval and T10 `still_looking` job own these).
- **B T6.** Replace the block from `Orchestrators inside `score.ts`.` through `- `runWinner(planId, version)` → `pickWinner` → bundle id.` with:
  `Orchestrators inside `score.ts` (P1 allowlist). They load constraints through `repo/privateConstraints.ts` and never log or emit constraint values.`
  `- `computeShortlist(planId)`: options → compose → fitsPrefs → filter → selectForRating → one `llm.rateBundles(prefs, candidates)` per member in parallel (indices 1..n) → upsert `app.ratings` → shortlist. Returns `{from_count, survived_count, survivors, top3}`. It writes no `app.bundles`, emits no SSE and sends no message; A does all three after its transition. If `top3.length < 3`, A sends `T_NO_FIT`.`
  `- `computeWinner(planId, version)`: loads the version's shortlist (`app.bundles.shortlist_rank`), ballots, ratings and constraints → `pickWinner`.`
- **B T6 table, `ballot.ts` row.**
  - Replace `` `resolveApprovals(parse: BallotParse, shortlist: PublicBundle[]) → string[]` ``
  - With `` `resolveApprovals(parse: BallotParse, shortlist: PublicBundle[], planTimeStart: string) → string[]` ``
  - In the same row, replace `end_before` drops bundles with `show_end_est > time`; `start_after` drops bundles with `dinner_time < time`.` with: `Times are minutes since `planTimeStart`, with +24 h for any time earlier than it. `end_before` drops `show_end_est > time`; `start_after` drops `dinner_time < time`.`
- **B T6 tests.**
  - Replace `- `ballot.test.ts`: "2, but not if it ends after 10" parsed → only bundle 2, and only if it ends ≤ 22:00.`
  - With `- `ballot.test.ts`: "2, but not if it ends after 10" → only bundle 2, and only if it ends ≤ 22:00; a `00:30` show end counts as after 22:00; `exclude` and `start_after` cases (moved from A).`
- **B T7**
  - Replace `and the `check_research_ready` job to A's `onResearchReady(planId)`.`
  - With `and the `check_research_ready` job to A's `plan.onOptionsReady(planId)`.`
- **B §6**
  - Replace `| A's state machine | 8:45 PM | Call `startResearch`/`runShortlist` from a vitest harness |`
  - With `| A's state machine | 9:40 PM | Call `startResearch`/`computeShortlist` from a vitest harness |`
- **B §8.1**
  - Replace `two `check_research_ready` jobs → one `runShortlist`.`
  - With `two `check_research_ready` jobs → one `recompute` enqueued.`

### 4. X-ray events are double-emitted (B `emitXray` builds fan-out and delegate entries; A also emits them)
- **B T7.** Replace the paragraph `**`xray.ts`:** `emitXray(planId)` builds these contexts: …` through `A calls it after each fan-out.` with: `**`xray.ts`:** `emitScoutXray(planId, briefs)` emits `xray {contexts:[scout_input:dinner, scout_input:show]}` (`locked:false`, preview = the brief JSON) at research start. A emits the `fanout` and `delegate:lane-<n>` entries. Each `xray` event carries a partial list, and `consoleReducer` merges contexts by `name`.`
- **B T9**
  - Replace `It ignores ids ≤ the last applied id, so the snapshot and the SSE replay don't double-apply.`
  - Append: ` It merges `xray.contexts` by `name` (each event is partial).`
- **PLAN §8 SseEvent `xray`.**
  - Replace `locked: z.boolean(), preview: z.string().nullable() })) }),   // delegates: locked=true, preview=null`
  - With `locked: z.boolean(), preview: z.string().nullable() })) }),   // delegates: locked=true, preview=null. Partial list; console merges by name. B emits scout_input:*, A emits fanout + delegate:*`

### 5. The `notify` signature differs (PLAN/B use 3 arguments; A requires `{key}`), and B can't build the `tpl:` key
- **PLAN §4, P3, "Enforced by".**
  - Replace `` `notify(userId, TemplateId, vars)` is the only path to `MessagingPort.sendText` ``
  - With `` `notify(userId, TemplateId, vars, { key, planId?, replyTo? })` is the only path to `MessagingPort.sendText`; keys come from `tplKey(planId, userId, templateId, version, suffix?)` or `replyKey(inboundId, n)` (both exported from `src/notify/notify.ts`) ``
- **CLAUDE/AGENTS, invariant 4.**
  - Replace `(`notify(userId, TemplateId, vars)`)`
  - With `(`notify(userId, TemplateId, vars, { key })`, keys from `tplKey()`/`replyKey()`)`
- **A §3.1**
  - Replace `| Everyone | `notify(userId, TemplateId, vars, { key, replyTo? })`.`
  - With `| Everyone | `notify(userId, TemplateId, vars, { key, planId?, replyTo? })`, `tplKey(planId, userId, templateId, version, suffix?)`, `replyKey(inboundId, n)`.`
- **B T2, `/agent/itinerary` row.**
  - Replace `Then call `notify(userId,"T_ITINERARY",{itinerary_url, ics_url})` for each participant. Idempotent: A's `tpl:<planId>:<userId>:T_ITINERARY:<version>` key ensures each user gets it once.`
  - With `Then, per participant: `notify(userId, "T_ITINERARY", {itinerary_url, ics_url}, { planId, key: tplKey(planId, userId, "T_ITINERARY", plan.version) })`. The key makes it once per user.`
- **B T11**
  - Replace `Then call `notify(userId,"T_ITINERARY",{itinerary_url, ics_url})` once per participant. A's `tpl:` key keeps it once per user, whichever path delivered the itinerary.`
  - With the same `notify(..., { planId, key: tplKey(planId, userId, "T_ITINERARY", plan.version) })` call. Because the key is identical on both paths, each user gets it once whichever path delivered the itinerary.

### 6. `ledger`, `counters` and `tap.verify` SSE are emitted by both A and C
**Fix:**
- C's `VenuePort.commit` emits `tap.signed` + `tap.verify`; this also covers tap-test.
- C's `venueClient/ledger.ts` exports `emitLedger(ev)` and `emitCounters()`.
- A only calls them.

- **A §3.1, console row.**
  - Replace `• `plan.state`, `lane`, `shortlist`, `vote.tally`, `ledger`;<br>• `tap.verify` (relayed from the venue hook and from commit results);<br>• `counters`;<br>`
  - With `• `plan.state`, `lane`, `shortlist`, `vote.tally`;<br>• `ledger`/`counters` by calling C's `emitLedger(ev)`/`emitCounters()` (`venueClient/ledger.ts`); `tap.*` is emitted inside C's `VenuePort.commit`;<br>`
- **A T9.** Above the hook dispatch table, insert: `In this table "emit `ledger`" means `emitLedger(ev)` and "emit `counters`" means `emitCounters()`, both from C's `venueClient/ledger.ts`.`
- **A T9 table.**
  - Replace `| `tap.verified` | `tap.verify` SSE with `report = TapVerifyReport.parse(data)` |`
  - With `| `tap.verified` | Ignore: the venue never emits it (C's `commit` emits the `tap.verify` SSE) |`
- **A T9 commit job.**
  - Replace `3. `res = venue.commit(orderId, canonicalConsent(ord))`, then emit `tap.verify` and branch on `res.result`:`
  - With `3. `res = venue.commit(orderId, consentFromOrder(ord))` (C's `commit` emits `tap.signed` + `tap.verify`), then branch on `res.result`:`
- **A T9.** Replace the paragraph `**`counters`** are computed from `app.events` and plan states:` and its three bullets with: `**`counters`**: call C's `emitCounters()` (computed from the DB) after `order.captured`, `order.cancelled`, CONFIRMED and CANCELLED.`

### 7. The consent helper name and type don't match (A expects `canonicalConsent(order: OrderStatus) → ConsentSet`; C defines `canonicalConsent(c: ConsentSet): string`)
- **C T3 `tap.ts`.** After the `canonicalConsent` function, insert:
  ```ts
  export function consentFromOrder(o: OrderStatus): ConsentSet {   // agent-side builder; never hand-build
    return { order_id: o.order_id, total_cents: o.total_cents, shares: o.shares.map(s => {
      if (!s.cybs_payment_id) throw new Error(`share ${s.share_id} has no cybs_payment_id`);
      return { share_id: s.share_id, cybs_payment_id: s.cybs_payment_id, amount_cents: s.amount_cents }; }) };
  }
  ```
- **A §3.2**
  - Replace `| C | `canonicalConsent(order: OrderStatus) → ConsentSet` from `packages/shared/src/tap.ts` | `plan/commit.ts`. **Never hand-build the consent body.** Use C's name if it differs. |`
  - With `| C | `consentFromOrder(order: OrderStatus) → ConsentSet` from `@tab/shared/tap` (`VenuePort.commit` serializes it with `canonicalConsent(c) → string`) | `plan/commit.ts`. **Never hand-build the consent body.** |`
- **A §6**
  - Replace `| `canonicalConsent` | C ships `tap.ts` | Foundation stub | Import C's export |`
  - With `| `consentFromOrder` | C ships `tap.ts` | Foundation stub | Import from `@tab/shared/tap` |`
- **PLAN §5.**
  - Replace `│  ├─ src/tap.ts        # consent canonicalization, signature-base builder (shared by signer & verifier)`
  - With `│  ├─ src/tap.ts        # C owns. canonicalConsent, consentFromOrder, signature-base builder. Imports node:crypto: export ONLY via subpath "@tab/shared/tap", never re-export from index.ts (keeps it out of apps/web)`
  - Then add the line `│  ├─ package.json      # exports: ".", "./private", "./tap", "./pricing", "./templates"`

### 8. `/ops/tap-test` is implemented twice (A calls `venue.commit` directly; C ships `runTapTest` with a replay guard)
- **A T14**
  - Replace `| `venue.commit(orderId, canonicalConsent(await venue.getOrder(orderId)), kind)` on the current plan's order → emit `tap.verify`. **Never** triggers `cancel` (PLAN §3.2: only a real failure cancels). |`
  - With `| `runTapTest(kind, orderId)` from C's `venueClient/tapTest.ts`, on the most recent plan's `venue_order_id`. C refuses `replay` while an OPEN order has every share AUTHORIZED, and C's `commit` emits the SSE. **Never** triggers `cancel` (PLAN §3.2). |`
- **C T8**
  - Replace `` `tapTest.ts` (`runTapTest(kind)`): latest demo order → `getOrder` → consent → commit with `test`. ``
  - With `` `tapTest.ts` (`runTapTest(kind, orderId)`; A passes the most recent plan's `venue_order_id`): `getOrder` → `consentFromOrder` → commit with `test`. ``

### 9. The venue-hook HMAC check is implemented twice (A inline; C exports `verifyVenueHook`)
- **A T9 code.** Replace the block from `const ts = c.req.header("X-Tab-Timestamp") ?? ""` through `const ev = VenueEvent.parse(JSON.parse(raw));` with:
  ```ts
  const raw = await c.req.text();                                   // raw bytes; never re-serialized JSON
  const ev = verifyVenueHook(raw, c.req.raw.headers);               // C: skew ≤300 s, sha256 HMAC, timingSafeEqual, VenueEvent.parse; null on failure
  if (!ev) return c.body(null, 401);
  ```
- **C T5**
  - Replace `exports `verifyVenueHook(rawBody: string, headers)`.`
  - With `exports `verifyVenueHook(rawBody: string, headers: Headers): VenueEvent | null` (null on any failure).`
- **Test split.** `venuehook.hmac.test.ts` stays with A for route plus dedupe. C adds `venueClient/hook.test.ts` for signature, skew and tamper.

### 10. The sweep call is implemented twice (A raw `fetch`; C `callVenueSweep()`)
- **A T10, `venue_sweep` row.**
  - Replace `Otherwise `fetch(VENUE_BASE_URL + "/ops/sweep", {method:"POST", headers:{Authorization:\`Bearer ${VENUE_OPS_KEY}\`}, signal: AbortSignal.timeout(10_000)})`.`
  - With `Otherwise `await callVenueSweep()` (C, `venueClient/sweep.ts`; 10 s abort).`
- **PLAN §18, sweep row.**
  - Replace `| timeout reversals (AUTH_UNKNOWN >60 s), expired-deadline reversals, outbox redelivery |`
  - With `| → `{ok, timeout_reversed, expired_cancelled, outbox_delivered, nonces_purged}`: timeout reversals (AUTH_UNKNOWN >60 s), expired-deadline reversals, stuck REVERSING, outbox redelivery, nonce purge |`

### 11. A commit rejection while the order is still COMMITTING cancels a plan that is about to capture
How it happens:
1. A `commit` network timeout leads to a retry, or a second request reaches `/checkout` while captures are still running.
2. C returns 409 `rejected`, and A runs `cancel()`.
3. The venue only cancels OPEN orders, so `order.cancelled` never arrives.
4. Then `order.captured` arrives, but `COMMITTING→CONFIRMED` fails because the plan is now CANCELLING. The plan is stuck.

- **A T9 commit job.**
  - Replace `- **`rejected`** → `cancel(planId, "commit_rejected")`.`
  - With `- **`rejected`** → `o = venue.getOrder(orderId)`. Only if `o.status === 'OPEN'` → `cancel(planId, "commit_rejected")`. `COMMITTING`/`CAPTURED` → do nothing (`order.captured` will confirm). `NEEDS_ATTENTION` → `system:error`. A `CommitPendingError` thrown by `commit` → do nothing (wait for `order.captured`).`
- **C T5**
  - Replace `**Timeout safety:** on a network timeout during `commit`, call `getOrder` before any retry. A retry with a fresh signature is safe because of the venue's row lock and conditional UPDATE (T7).`
  - With `**Timeout safety:** on a network timeout during `commit`, call `getOrder`. OPEN → retry once with a fresh signature (safe: row lock + conditional UPDATE, T7). COMMITTING/CAPTURED → throw `CommitPendingError` (A waits for `order.captured`). Never retry more than once.`
- **PLAN §3.2, TAP-verify row.**
  - Replace `A real failure (not a demo test button) → cancel the plan (reverse all).`
  - With `A real failure (not a demo test button) on an order that is still OPEN → cancel the plan (reverse all). If the order is COMMITTING or CAPTURED, wait for `order.captured`.`

### 12. `share.released` is handled by plan state instead of the venue's `retry` flag, and the `T_DECLINED_RETRY` key suffix is underspecified
- **A T9 table.**
  - Replace `| `share.released` | If the plan is not CANCELLING/CANCELLED (a timeout reversal): `T_DECLINED_RETRY {url: data.pay_url}` and stage `LINK_SENT`. Otherwise stage `RELEASED`. Then `ledger`. |`
  - With `| `share.released` | If `data.retry === true` (timeout reversal on an OPEN order): `T_DECLINED_RETRY {url: data.pay_url}`, update `pay_links`, stage `LINK_SENT`. Otherwise stage `RELEASED`. Then `ledger`. |`
- **A T5**
  - Replace `- `T_DECLINED_RETRY` `:<new share token id or attempt>`;`
  - With `- `T_DECLINED_RETRY` `:<VenueEvent.event_id>` (unique per declined/released event, stable on redelivery);`
- **PLAN §8, VenueEvent.**
  - Replace `data: z.record(z.string(), z.unknown()),  // e.g. {cybs_payment_id_short, card_last4} | TapVerifyReport`
  - With `data: z.record(z.string(), z.unknown()),  // per C §3.1: share.authorized {amount_cents, card_brand, card_last4, cybs_payment_id_short ('…'+last 8)}; share.declined {pay_url, expires_at}; share.released {retry, pay_url?, expires_at?}; share.captured {amount_cents, cybs_capture_id_short}; order.captured {total_cents}; order.cancelled {reason}; order.needs_attention {share_ids}. The venue never emits tap.verified. pay_url travels only on this HMAC hook; never written to app.events/SSE/logs`

### 13. Pay-link TTL (30 min) is shorter than the 60-min approval window, so the T-30m `T_REPING` link is dead
C flagged this, A requires `expires_at ≥ deadline_at`, and A's `app.pay_links` already settles where pay URLs are stored.
- **PLAN §11 (venue).**
  - Replace `| `PAY_LINK_TTL_MIN` | `30` |`
  - With `| `PAY_LINK_TTL_MIN` | `1440` (token expiry = `least(now()+TTL, deadline_at)`, so in practice the deadline; still single-use and amount-bound) |`
- **C §3.3.** Replace the two "Open items with A" bullets (`- **Pay URLs are returned once.** …` and `- **[→ PLAN §11] Link TTL vs. re-ping.** …` with its sub-bullets) with: `- Settled: A stores current pay URLs in `app.pay_links` (A's migration 004) and overwrites them on `share.declined` and `share.released{retry:true}`. `PAY_LINK_TTL_MIN=1440` (PLAN §11), so links live until `deadline_at`.`
- **C §11.** Delete the row `| [→ PLAN §11] `PAY_LINK_TTL_MIN=30` vs. the approval window / `T_REPING` | … |`

### 14. `payer_ref` length: PLAN §6 says a full hex HMAC (64 chars), but §8 requires 32
A and C both already use `.slice(0,32)`.
- **PLAN §6**
  - Replace `payer_ref text not null unique,          -- hex HMAC(PAYER_REF_SECRET, id); the ONLY identity the venue sees`
  - With `payer_ref text not null unique,          -- hmacSha256Hex(PAYER_REF_SECRET, id).slice(0,32) (128 bits; matches ^[0-9a-f]{32}$); the ONLY identity the venue sees`
- **C §3.1.** Replace the paragraph `**[→ PLAN, with A/foundation] `payer_ref` length.**` and its bullets with: `` `payer_ref` = `hmacSha256Hex(PAYER_REF_SECRET, userId).slice(0, 32)` (PLAN §6, settled). ``
- **C §11.** Delete the row `| [→ PLAN] `payer_ref` 64-hex HMAC vs. the 32-hex contract regex | … |`

### 15. Migrations: numbering collides, `003_roles.sql` won't run through `pnpm db:migrate`, and later tables never get grants
- **Variables:** `:'AGENT_DB_PW'` is psql-only syntax, so a postgres.js migrator can't run it.
- **Grants:** `grant all on all tables` only covers tables that exist at that moment. A's `004_pay_links` and C's later venue tables would be unreadable by `tab_agent` and `tab_venue`.

- **PLAN §6.** Replace the line `-- 003_roles.sql  (UNVERIFIED: custom-role login through Supavisor "role.projectref". Smoke test: psql with each role.` with: `-- db/roles.sql (NOT in db/migrations; run once as postgres: psql "$OWNER_DATABASE_URL" -v AGENT_DB_PW=… -v VENUE_DB_PW=… -f db/roles.sql). UNVERIFIED: custom-role login through Supavisor "role.projectref". Smoke test: psql with each role.`
- **PLAN §6.** Append to that block:
  ```sql
  alter default privileges in schema app   grant all on tables to tab_agent;  alter default privileges in schema app   grant all on sequences to tab_agent;
  alter default privileges in schema venue grant all on tables to tab_venue;  alter default privileges in schema venue grant all on sequences to tab_venue;
  -- migrations must run as the same owner role (postgres) for these defaults to apply
  ```
- **PLAN §5**
  - Replace `├─ db/migrations/       # 001_app.sql, 002_venue.sql, 003_roles.sql`
  - With `├─ db/migrations/       # 001_app.sql, 002_venue.sql, 004_pay_links.sql (A), 005+_venue_*.sql (C); db/roles.sql run once via psql`
- **CLAUDE/AGENTS**
  - Replace `pnpm db:migrate                  # applies db/migrations/*.sql to $DATABASE_URL`
  - With `pnpm db:migrate                  # applies db/migrations/*.sql in order to $OWNER_DATABASE_URL (postgres role); roles: psql -f db/roles.sql once`
- **C §2**
  - Replace `` `db/migrations/00N_venue_*.sql` | New additive venue migrations only.``
  - With `` `db/migrations/005_venue_*.sql` onward (004 is A's) | New additive venue migrations only.``
- **A §2**
  - Replace `` `db/migrations/00{1,2,3}_*.sql` ``
  - With `` `db/migrations/00{1,2}_*.sql`, `db/roles.sql` ``
- **PLAN §11.** Add the agent row: `| `OWNER_DATABASE_URL` | local/CI only: postgres-role URL for migrations; never on Fly or Vercel |`

### 16. Re-running Reset breaks the seed: `research_runs.creao_run_id` is unique, but the seed copies the fixture's real runId into it on every Reset
- **A T7 seed.**
  - Replace `3. Load B's cached options (with their real runId) into `app.options` and `research_runs(source 'cached', idempotency_key 'seed:<planId>:<category>')`.`
  - With `3. Per category insert `research_runs(kind 'scout', category, status 'completed', source 'cached', idempotency_key 'seed:<planId>:<category>', creao_run_id NULL, result {cached_from_run_id, share_url})`, then load B's cached options into `app.options` with `run_id` = that row's id. Never put the fixture's real runId in `creao_run_id` (it is unique, so the second Reset would fail).`
- **PLAN §3.1 step 0**
  - Replace `(stored with its real runId)`
  - With `(its real runId kept in `research_runs.result.cached_from_run_id`)`

### 17. The seed date uses UTC "today" (it is already Sunday on Fly after 5 PM PDT Saturday), and demo budgets live where B's fixture test can't read them
- **A T7 seed.**
  - Replace `1. Plan "Dinner + show", area "Westwood / Sawtelle", today, 18:30–23:00,`
  - With `1. Plan "Dinner + show", area "Westwood / Sawtelle", LA-local today (`new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date())`; Fly runs UTC), 18:30–23:00,`
- **A T7 seed.**
  - Replace `2. Create the team users from env `DEMO_TEAM`: JSON `[{phone_e164, first_name, target_pp_cents, hard_max_pp_cents}]`. Phones are PII, so they live only in Fly secrets and `.env.local`.`
  - With `2. Create the team users from env `DEMO_TEAM`: JSON `[{phone_e164, first_name}]` (PII: Fly secrets and `.env.local` only). Lane *i*'s synthetic demo budget and prefs come from `fixtures/demo-seed.json` `members[i] = {target_pp_cents, hard_max_pp_cents, prefs}`, so B's `demo.fixture.test.ts` uses the same values.`
- **A T14.** Replace the `seedDemo()` self-check block (heading plus 3 items) with: `**Seed check:** covered by B's `demo.fixture.test.ts` (≥3 survive at a $30 judge cap, the shortlist changes v1→v2, index 2 ends ≤ 22:00), run in `pnpm test` before every deploy. There is no runtime check: it would read constraints outside the P1 allowlist.`
- **B T16**
  - Replace `Confirm `seed:demo` uses date 2026-10-18.`
  - With `` `seed:demo` uses LA-local today (A T7), which is 2026-10-18 on Sunday.``

### 18. Reset, Replay and the live-Scout showcase plan: PLAN never defines them and nobody creates the showcase row
- **PLAN §18, ops row.**
  - Replace `| `{kind?}` → `{ok}` | B ↔ A/C |`
  - With `| reset: cancel every plan in a non-terminal state (COLLECTING…CANCELLING) (venue cancel → reverse holds, `cancelResearch`, no DMs), free `DEMO_CODE`, `seedDemo()` (new plan row, so a fresh `plans.ref`); replay: reset, then feed `fixtures/demo-script.json` through `route()`; tap-test `{kind}`: C's `runTapTest`; live-scout: B's `startLiveScoutDemo()`; release-seats → `{ok, released}`. All Bearer OPERATOR_KEY; CORS preflight for `Authorization`. | A routes; B UI; C tap-test |`
- **PLAN §7.** After the CANCELLING line, add: `SHOWCASE: B's live-Scout showcase row only. It never transitions; the router, Reset and jobs ignore it.`
- **A T14, reset row.**
  - Replace `Then `transition(<any non-terminal> → CANCELLED)` **with no DMs**`
  - With `Then `transition([COLLECTING, RESEARCHING, VOTING, ORDERING, APPROVING, COMMITTING, CANCELLING] → CANCELLED)` **with no DMs** (never touches `SHOWCASE`)`
- **B C-9.** Replace the item text from `**C-9. Live Scout showcase plan (ask A):**` through `…through a small repo function.` with: `**C-9. Live Scout showcase plan (B owns):** `liveDemo.ts` lazily creates one row (title "Live Scout showcase", code 'S'+3 random base36, state `SHOWCASE`, the demo area/date/times) and runs `startLiveScoutDemo()` against its `plan_ref`.`
- **B C-8.** Replace the item text with: `**C-8. Settled:** A's `seedDemo()` inserts a new plan row on every Reset, so `plans.ref` is fresh (default `gen_random_uuid()`).`
- **B T14**
  - Replace `Ask A to keep the seeded **code** stable across Reset.`
  - With `A's Reset frees and reuses `DEMO_CODE` (default 4821).`

### 19. Join error codes disagree (A: 409 means plan closed, invalid input → 400, no 404; B: 409 means capacity, invalid → 422, 404 means unknown code)
- **A T4, step 1.**
  - Replace `Otherwise return 409 `{error:"plan_closed"}`.`
  - With `No plan with that code → 404 `{error:"not_found"}`. Code exists but state ∉ that set → 409 `{error:"plan_closed"}`. Zod failure → 422 `{error:"invalid", issues:[{path,message}]}`. Rate limit → 429 `{error:"rate_limited"}`.`
- **A §8.1**
  - Replace `Invalid E.164 → 400;`
  - With `Invalid E.164 → 422; unknown code → 404;`
- **B T8 table.**
  - Replace `| 409/503 | "Tab is at capacity, try again in a minute" (PLAN §3.2) |`
  - With two rows: `| 503 / 429 | "Tab is at capacity, try again in a minute" (PLAN §3.2) |` and `| 409 | "This plan isn't taking new people anymore." |`
- **B T8.** Delete `Confirm the error status codes with A at 10:15 PM.`
- **PLAN §18, join row.**
  - Replace `→ `{assigned_number, sms_href, join_text}``
  - With `→ 200 `{assigned_number, sms_href, join_text}` | 404 not_found | 409 plan_closed | 422 invalid | 429 | 503 capacity`

### 20. `/events/snapshot` has no shape, and CORS for `/ops/*` is missing
- **PLAN §18, console row.**
  - Replace `+ `GET /events/snapshot``
  - With `+ `GET /events/snapshot?k=` → `{ last_id: number, events: { id: number, data: SseEvent }[] }` (last 500; foundation builds both)`
- **PLAN §11**
  - Replace `(CORS for /join, /plans, /events)`
  - With `(CORS for /join, /plans, /events, /events/snapshot; /ops/* uses `cors({ origin: WEB_ORIGIN, allowHeaders: ["Authorization","Content-Type"], allowMethods: ["POST"] })`, verified Context7 /honojs/website)`
- **A T14.** After `All `/ops/*` routes require `Authorization: Bearer OPERATOR_KEY`, compared with `crypto.timingSafeEqual` after a length check.` append: ` Mount `cors({ origin: env.WEB_ORIGIN, allowHeaders: ["Authorization", "Content-Type"], allowMethods: ["POST"] })` before them (B's ops bar sends a preflight).`
- **B C-6.** Replace the item text with: `**C-6. Settled (PLAN §18):** `{ last_id, events: { id, data }[] }`, foundation-built.`

### 21. Env var gaps and name drift
- **PLAN §11 (agent).** Add these rows:
  - `| `AGENT_API_ALLOW_TEST_REF` | `0` (B; `1` only during CREAO agent building) |`
  - `| `DEMO_TEAM` | `[{phone_e164, first_name}]` JSON (PII; secret) |`
  - `| `DEMO_CODE` | `4821` |`
  - `| `TYPING_REFRESH_MS` | `5000` until A's S4 result |`
  - `| `TEST_DATABASE_URL` | local/CI only |`
  - `| `VOICE_ENABLED`, `ELEVENLABS_API_KEY`, `ELEVENLABS_AGENT_ID`, `ELEVENLABS_PHONE_NUMBER_ID`, `ELEVENLABS_WEBHOOK_SECRET` | voice go only |`
- **B T13**
  - Replace `(`DATABASE_URL_TEST` if that is the convention)`
  - With `(`TEST_DATABASE_URL`, PLAN §11)`
- **C T5.** `VENUE_PUBLIC_HOST` is a venue env var, not an agent one, so the agent can't assert against it.
  - Replace `builds the URL from `VENUE_BASE_URL`, whose host must equal `VENUE_PUBLIC_HOST` (assert this at boot);`
  - With `builds the URL from `VENUE_BASE_URL`, which must be the venue's production origin (= the venue's `VENUE_PUBLIC_URL`); `@authority` = `new URL(VENUE_BASE_URL).host`;`

### 22. `TAX`: PLAN (0.0975, unverified) vs B (0.1025, from the CDTFA L-1037 PDF)
B's value is evidence-backed, so it wins. The address lookup stays as a smoke test.
- **PLAN §8**
  - Replace `` `TAX = 0.0975` (**UNVERIFIED** LA rate; confirm before 11 PM).``
  - With `` `TAX = 0.1025` (CDTFA Special Notice L-1037: LA County 9.750% → 10.250% from Oct 1, 2026. City of LA by address lookup is **UNVERIFIED**; smoke test: CDTFA lookup for 325 Westwood Plaza, 90095, before 11 PM).``
- **C §11**
  - Replace `| `TAX = 0.0975` (B confirms) | CDTFA lookup | 11 PM |`
  - With `| `TAX = 0.1025` (B's PR; C acks venue prices) | CDTFA address lookup | 9:30 PM |`
- **PLAN §19**
  - Replace `| LA sales-tax rate for `TAX` | Official CDTFA lookup | B | |`
  - With `| LA sales-tax rate for `TAX` (0.1025 per L-1037) | CDTFA address lookup, 325 Westwood Plaza | B | |`

### 23. Ratings run over up to 15 candidates, but `PublicBundle.index` is `max(3)`
- **PLAN §8.** After `PublicBundle`, add `export const RateCandidate = PublicBundle.extend({ index: z.number().int().min(1).max(20) });  // rating input only`
- **PLAN §9**
  - Replace `rateBundles(prefs: Preferences, bundles: PublicBundle[]): Promise<Ratings>;`
  - With `rateBundles(prefs: Preferences, candidates: RateCandidate[]): Promise<Ratings>;`
- **B C-1.** Replace `Proposal for type clarity (additive, before 11 PM):` with `Adopted in PLAN §8/§9:`

### 24. Research trigger: PLAN says ≥3 prefs-done plus GO; A and the `T_ORG_JOIN_STATUS` copy allow GO with 2
- **PLAN §3.1 step 6**
  - Replace `(≥3 members prefs-done and organizer `go`, or party target reached, or the demo seed)`
  - With `(organizer GO with ≥2 prefs-done (under 3 → one `T_SMALL_GROUP` warning, then GO again), or party target reached, or the demo seed)`

### 25. PLAN §7 is missing transitions that A implements
- **PLAN §7.** After `CANCELLING ──(venue order CANCELLED)──▶ CANCELLED  [T_CANCELLED to all]` add:
  ```
  VOTING ──(shortlist <3 after a change)──▶ CANCELLED  [T_NO_FIT]
  ORDERING ──(bundle unavailable)──▶ CANCELLED  [T_NO_FIT]
  ORDERING ──(I'm out | cancel plan)──▶ CANCELLING
  COLLECTING|RESEARCHING|VOTING ──(<2 members remain | ops reset)──▶ CANCELLED
  any non-terminal ──(ops reset)──▶ CANCELLED  [no DMs]
  ```

### 26. The timeline doesn't match the teammate plans
- **PLAN §13, 6:00–6:45 row.**
  - A cell: replace `Real `PhotonMessaging` adapter; route table; JOIN path on a real phone` with `Real `PhotonMessaging` + consumer; JOIN through `route()` on a real phone by 7:15`.
  - B cell: replace `Real `CreaoPlanner`; webhook + poll; `/agent/*` live; Scout calls `tab ping` from an API run` with `` `/agent/*` live + final skill; Scout calls `tab ping` from an API run (CreaoPlanner 6:35–7:15, webhook/poll 7:15–7:45)``.
- **PLAN §13, 9:30–11:30 row, B cell.** Replace `Release judge-test seats` with `Record backup clips`. In the A cell, append `; Reset before and `/ops/release-seats` after each judge`.
- **B §7.** Replace the `| 8:45 PM | A | …` row with: `| 9:40 PM | A | Hooks (PLAN §9 names) wired; `register.ts` mounted. `seedDemo` + `recompute` with your real `computeShortlist` on cached fixtures (mock LLM) → VOTING with 3 bundles and `shortlist` on the console. |` (B's pure functions land at 9:00 and A's T7 at 9:40, so 8:45 was not reachable.)
- **B §7.** Replace `| ~1:00 AM | C |` with `| ~1:30 AM | C |` to match C's checkpoint and B's T12 window.
- **A §7.** Replace `| ~9:40 | B | `seedDemo` + `recompute` with B's real pure functions` with `| ~9:40 | B | `seedDemo` + `recompute` with B's real `computeShortlist``.
- **C §7, 9:30 PM row.** A's order, hook and sweep code doesn't exist until 10:00–11:45. Replace it with: `| **9:30 PM** | — | C alone: `scripts/agent-sim.ts` with the agent's real `VenuePort` (`checkAvailability` → `createOrder` → `getOrder`) passes TAP on the live venue; `hook-echo.ts` verifies HMAC. |` and add: `| **10:30 PM** | A | `VENUE_MODE=live` on Fly: A's `create_order` gets `pay_url`s; signed `share.*` hooks reach `/venue/hook`. Sweep due_job by 11:45. |`

### 27. Voice: nobody schedules the `voice_nudge` job, and the recap templates are missing from A's list
- **A T9, `create_order` step 7.**
  - Replace `Schedule `approve_reping` (approve_at − 30 min; with `DEMO_TIMERS`, − 3 min) and `approve_deadline` (approve_at).`
  - Append: ` If `VOICE_ENABLED=1`, also schedule `voice_nudge` (`voice:<planId>:<v>`, approve_at − 15 min; B registers the handler).`
- **A §3.3 item 1.** Append `; voice go only: `T_VOICE_RECAP_IN`, `T_VOICE_RECAP_OUT`, `T_VOICE_RECAP_LATER` (B's C-4; A writes the copy)`.
- **B V3**
  - Replace `A's re-ping ladder calls it at T-15m for the last holdout.`
  - With `A schedules the `voice_nudge` job at T-15m; B's handler calls the last holdout.`

### 28. Ownership lines in CLAUDE/AGENTS are incomplete, and the Microform localhost rule contradicts C's S6
- **CLAUDE/AGENTS.** Replace the three ownership bullets with:
  - `A: `apps/agent/src/{photon,router,delegates,plan,notify,jobs,join,ops,money,repo,dev}`, `packages/shared/src/templates.ts`, migration 004.`
  - `B: `apps/agent/src/{creao,decide,agentApi,voice}`, `apps/web`, `skills/tab`, cached-options fixtures, README/Devpost.`
  - `C: `apps/venue`, `apps/agent/src/{tap,venueClient}`, `packages/shared/src/{tap,pricing}.ts` (B may change `TAX` with C's ack), migrations 005+.`
- **CLAUDE/AGENTS**
  - Replace `Microform only works on the venue's production HTTPS origin, so test payments there, not on preview URLs.`
  - With `Microform `targetOrigins` must match exactly: use the venue's production HTTPS origin, never preview URLs. Localhost works in the official sample but is UNVERIFIED for us (C's S6).`

### 29. The key-directory flow and the venue module layout in PLAN don't match C
- **PLAN §18**
  - Replace `| verifier → key dir | `GET /keys/[keyid]` (labelled "mock Visa key directory") | JWK | C |`
  - With `| verifier → key dir | in-process read of `TAP_KEY_DIRECTORY_JSON`; `GET /keys/[keyid]` publishes the same JWK for judges (labelled "mock Visa key directory") | JWK | C |`
- **PLAN §5**
  - Replace `src/{tap,cybs,pricing-bridge,db}, app/{pay,api,...}`
  - With `src/{tap,cybs,pricing-bridge,db,outbox,ids,token,sweep}, app/{pay,api,availability,orders,checkout,keys,ops}, scripts/, test/`
- **PLAN §18, agent → venue row.** Append: `; cancel body `{"reason": string}`, signed agent-payer-auth with content-digest`.

### 30. Visa AI13522 wording (C verified the wording; PLAN did not)
- **PLAN §10**
  - Replace `Holds: Visa AI13522 allows 10 days CIT CNP.`
  - With `Holds: Visa Business News AI13522 (effective Apr 2024): 10-calendar-day authorization-to-clearing window for cardholder-initiated card-not-present transactions.`
- **PLAN §16 #8**
  - Replace `well inside Visa's 10-day CIT window (AI13522).`
  - With `well inside Visa's 10-calendar-day authorization-to-clearing window for cardholder-initiated card-not-present transactions (AI13522).`

### 31. C's cut #4 (`GET /availability`) would break A's `create_order` step 1
- **C §9**
  - Replace `4. `GET /availability` (keep it only as a TAP demo if there's time).`
  - With `4. (Removed: the route is 3 lines and A's `create_order` calls it.)`
- **C §9**
  - Replace `3. Automatic fresh links after timeout reversals, `share.released{retry:true}`. Keep the reversal; A re-sends via `T_DECLINED_RETRY` on the next order event.`
  - With `3. Automatic fresh links after timeout reversals: send `share.released{retry:false}`. That share stays RELEASED and the plan cancels at the approval deadline (all-or-nothing still holds).`

---

## Remaining risks

- **Two pollers on one DB.** The PLAN §15 backup runs a second local agent (`MESSAGING_MODE=mock`) against the same DB, so both processes run the due_jobs poller and Fly may send real DMs. Before switching, run `fly scale count 0 -a tab-agent`, or point the backup at a separate DB.
- **Decision-path latency.** `computeShortlist` makes one Sonnet call per member with up to 15 candidates, at 30 s × 2 retries. Measure p95 before 11 PM. If it is over about 20 s, the "group changed" beat stalls; cap candidates at 9.
- **CREAO runtime facts are still unverified** (B's U1–U13): Secrets and skills in API runs, idempotency replay, GET field names, credits. The cached path is the safety net, so fixture freshness (B T10/T16) is demo-critical.
- **Unproven shortlist-change beat.** The demo depends on the $30 judge cap changing the shortlist. Only B's `demo.fixture.test.ts` proves it, so it must run in CI before every deploy (Issue 17).
- **Supavisor custom-role login is unverified.** The fallback is a single role, which drops DB-level M1 separation; the M1/P1 grep tests still apply.
- **Cybersource sandbox behaviour is unverified:** COF/one-tap, minimal `billTo`, `merchantDescriptor`, the response to a timeout reversal of a never-sent auth, and the double-capture reason. Sweep action (b) assumes a definitive 4xx means released; confirm with C's S5 before 11 PM.
- **Vercel durations.** `maxDuration=120` on checkout, cancel and sweep assumes fluid compute on the venue's plan, and four sequential captures at 20 s each fit only barely. Lower `apiClient.timeout` to 15 s if checkout nears the limit.
- **Photon runtime facts are unverified:** `receivedBy` presence, `sentBy.handle` format, typing refresh, and replay retention. A restart longer than the retention window loses messages.
- **Voice starts late.** If voice is go, it starts after 11 PM and competes with B's T10–T12 (real Scout, Concierge, TAP panel). Hold the 2 AM hard stop and hand T12 to A or C as B's plan requires.
- **Judge PII is retained.** After a judge's seat is released, `app.users` (phone, first name), `dm_routes` and lane names remain. Decide whether `release-seats` also runs the `forget me` scrub for non-team users. This is not in any plan.
- **Unverified dependencies:** `@notionhq/client@5.27.1` (1 day old) and `next@16.4.2` (2 days old). Rollback pins are 5.27.0 and 16.4.1.
- **Booth answers can force changes after 6:45 PM:** the Photon SDK eligibility (spectrum-ts vs `@photon-ai/api`) and Visa's acceptance of `@method` + `content-digest` and the mock directory. Keep `MessagingPort` and the TAP component list swappable.