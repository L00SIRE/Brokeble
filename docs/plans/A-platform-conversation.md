# docs/plans/A-platform-conversation.md

# Plan A: Platform and conversation

**Owner:** A. **Written:** Sat Oct 17, 4:25 PM PDT. **Verified:** Sat 5:30 PM (see the Verification log at the end).
**Precedence:** `docs/PLAN.md` comes first and this file is A's plan inside it. If the two disagree, PLAN wins: raise it in team chat and never diverge silently.
**Read first:** PLAN §3 (flow), §4 (invariants), §7 (state machines), §8 (contracts), §9 (ports), §10 (API facts), §11 (env vars), §18 (who calls whom).

**Verification legend:**
- **(verified)** means the item was checked in this session against a primary source. Sources used: the `@photon-ai/api@0.5.0` package (`dist/*.d.ts`, README), the Photon beta OpenAPI/AsyncAPI and beta docs, the claude-api skill, `@anthropic-ai/sdk@0.135.0` on unpkg, Context7 (`/porsager/postgres`), the npm registry, unpkg type files, and the Fly docs.
- **UNVERIFIED — smoke-test first** means the item is not confirmed. Each one has a smoke test, and all of them are listed again in §11.

---

## 1. Context and goal

**Why:** SquadTab exists because of the moment someone has to say "I can't afford that" in front of the group. A owns every message a human sends or receives. That covers:
- the judge's self-join;
- each person's **private delegate**;
- the plan state machine that turns sealed constraints into one booked plan;
- the deadline ladder that releases every hold when a plan fails.

| Prize | What A delivers |
|---|---|
| **Photon iMessage ($700/$300)** | All of it:<br>• live DMs on Photon 2.0 (`@photon-ai/api@0.5.0` plus Socket.IO with a persisted replay cursor);<br>• the judge joins from their own phone;<br>• typing within about 1 s, and mark-as-read;<br>• idempotent sends;<br>• `SHARED_LINE_*` handling;<br>• the decline and deadline edge cases. |
| **Main / Overall** (Technical Depth, Execution) | • The context-isolation boundary (P1–P5).<br>• Exactly-once state transitions (M5).<br>• Three clean live runs by 4 AM. |
| **Visa ($2k):** UX 25, Trust 15 | • holdGate (M7).<br>• "Released" wording (M9).<br>• All-or-nothing orchestration: order → holds → TAP commit → capture, or reverse everything.<br>A calls C's VenuePort; C owns the money code. |
| **CREAO ($2k)** | The research trigger and the CREAO → VOTING wiring. B owns the CREAO code. |

**Thesis to protect in every line of code:** *"Say no without saying why. Nobody pays until everyone's in."*

---

## 2. What you own and what you must not touch

| Path (A owns) | Contents |
|---|---|
| `apps/agent/src/photon/` | `client.ts` (SDK instance), `consumer.ts` (Socket.IO + cursor), `normalize.ts` (→ `InboundEvent`), `errors.ts` (problem codes), `messaging.ts` (`PhotonMessaging implements MessagingPort`) |
| `apps/agent/src/router/` | `route.ts` (dispatch order), `commands.ts` (regex table), `luhn.ts` |
| `apps/agent/src/delegates/` | `anthropicLLM.ts` (`AnthropicLLM implements LLMPort`, no-tools request builder), `input.ts` (`buildDelegateInput`), `budget.ts`, `prefs.ts`, `ballot.ts`, `free.ts`, `prompts.ts`, `awaiting.ts` (in-memory per-user awaiting flags) |
| `apps/agent/src/plan/` | `machine.ts`, `membership.ts`, `decision.ts`, `ballots.ts`, `order.ts`, `commit.ts`, `cancel.ts`, `venueHook.ts` |
| `apps/agent/src/notify/` | `notify.ts` (**the only caller of `MessagingPort.sendText`**, P3), `render.ts`, `fanout.ts` |
| `apps/agent/src/jobs/` | due_jobs handler registrations (the poller itself is foundation) |
| `apps/agent/src/join/` | `POST /join`, `POST /plans`, `seats.ts` |
| `apps/agent/src/ops/` | `POST /ops/{reset,replay,tap-test,live-scout,release-seats}`, `seed.ts` |
| `apps/agent/src/money/holdGate.ts` | holdGate (on the P1 allowlist) |
| `apps/agent/src/repo/` | includes `privateConstraints.ts`, the only SQL that touches `private_constraints` (P1) |
| `apps/agent/scripts/seedDemo.ts`, `apps/agent/fixtures/{demo-seed,demo-script}.json` | `pnpm seed:demo`, canned prefs, Replay script. The cached-options fixtures are B's. |
| `packages/shared/src/templates.ts` | `TemplateId`, copy, vars schemas. Announce changes; additive-only after 11 PM. |
| `db/migrations/004_pay_links.sql` | A's additive table (T9). Announce before 8 PM. |
| `scratch/photon/` | throwaway spikes, git-ignored |

PLAN §5 assigns `src/repo/`, `src/money/` and `src/dev/` to A. A mounts its routes and job kinds (including `/venue/hook` and `/ops/*`) in `src/plan/register.ts`.

**Do not touch. Ping the owner instead:**
- **B:** `apps/agent/src/{creao,decide,agentApi,voice}/**`, `apps/web/**`, `skills/tab/**`, `fixtures/cached-options/*`.
- **C:** `apps/agent/src/{tap,venueClient}/**`, `apps/venue/**`, `packages/shared/src/{tap,pricing}.ts`.
- **Foundation (announce changes):** `packages/shared/src/{index,private}.ts`, `apps/agent/src/ports/**`, `db/migrations/00{1,2}_*.sql`, `db/roles.sql`.

**Never:**
- commit `.env*` or anything under `scratch/`;
- import `@tab/shared/private` outside the P1 allowlist;
- call `sendText` outside `notify.ts`;
- put `tools`, `tool_choice` or an assistant prefill on any LLM request;
- log inbound text, outbound text, pay URLs or request bodies.

---

## 3. Interfaces you consume and provide

Contract names are exactly as in PLAN §8 and §9.

### 3.1 You provide

| To | Interface | Contract |
|---|---|---|
| Everyone | `MessagingPort`, real implementation `PhotonMessaging` | PLAN §9 |
| Everyone | `notify(userId, TemplateId, vars, { key, planId?, replyTo? })`, `tplKey(planId, userId, templateId, version, suffix?)`, `replyKey(inboundId, n)`. Also `notifyRaw(addr: DmAddress, "T_NOT_IN_PLAN", {}, key)`, for unknown senders only, defined in `notify.ts`. | `TemplateId` + vars schemas in `templates.ts` |
| B (`decide`), C | `LLMPort`, real implementation `AnthropicLLM`: `parseBudget`, `parsePreferences`, `parseBallot`, `repairScoutJson`.<br>`rateBundles` is plumbed by A, but **B owns its prompt and model choice** (PLAN §18 "A (adapter + delegates), B (rate/repair prompts)"). B exports `RATE_SYSTEM`, `buildRateUserMessage(prefs, candidates)` and `REPAIR_SYSTEM` from `src/decide/ratePrompt.ts`; A's adapter only sends them. Parameters: rate = sonnet, `max_tokens 4096`, `{timeout: 30_000, maxRetries: 2}`; repair = haiku, `max_tokens 12000`, `{timeout: 30_000, maxRetries: 2}`. | `DelegateInput`, `BudgetParse`, `Preferences`, `BallotParse`, `Ratings`, `PublicBundle` |
| B (`creao`) | `plan.onOptionsReady(planId)`. B calls it once both categories have options (`live\|cached`); A enqueues `recompute`. | — |
| B (`apps/web`) | `POST /join`, `POST /plans`, `POST /ops/*` | PLAN §18 |
| C (`apps/venue`) | `POST /venue/hook` (HMAC) | `VenueEvent` |
| B (console) | SSE events A emits:<br>• `plan.state`, `lane`, `shortlist`, `vote.tally`;<br>• `ledger`/`counters` by calling C's `emitLedger(ev)`/`emitCounters()` (`venueClient/ledger.ts`); `tap.*` is emitted inside C's `VenuePort.commit`;<br>• `xray` (fan-out and delegate-🔒 entries; the console merges entries by `name`);<br>• `delivery`, `system`. | `SseEvent` |

### 3.2 You consume

| From | Interface | Use |
|---|---|---|
| Foundation | `sql` (postgres.js), `emit(SseEvent, tx?)`, `registerJob(kind, handler)`, `enqueue(kind, dedupeKey, dueAt, payload)`, `/dev/inbound`, mocks for all 4 ports, Hono `app`. | Everything. **If foundation names differ, use foundation's names and update this file.** |
| B | `computeShortlist(planId)`, `computeWinner(planId, version)` (`decide/score.ts`), `resolveApprovals(parse, shortlist, planTimeStart)` (`decide/ballot.ts`), `effectiveHardMax(c)` (`decide/filter.ts`) | `plan/decision.ts`, `plan/ballots.ts`, `money/holdGate.ts` |
| B | `startResearch(planId)`, `cancelResearch(planId)`, `startLiveScoutDemo()`, `startConciergeFor(planId)` (starts Concierge; B sends `T_ITINERARY` through `notify`) | Final names (PLAN §9) |
| C | `VenuePort`: `checkAvailability`, `createOrder`, `getOrder`, `commit`, `cancel` | `plan/order.ts`, `commit.ts`, `cancel.ts`, `ops/tap-test` |
| C | `consentFromOrder(order: OrderStatus) → ConsentSet` from `@tab/shared/tap` (`VenuePort.commit` serializes it with `canonicalConsent(c) → string`) | `plan/commit.ts`. **Never hand-build the consent body.** |

### 3.3 Additive contract changes A will announce (before 8 PM; all additive)

1. **New `TemplateId`s** (copy in T5):
   - `T_HELP`, `T_STATUS`, `T_OUT_ACK`, `T_RECEIPTS`, `T_FORGOTTEN`, `T_ORGANIZER_ONLY`;
   - `T_BALLOT_CLARIFY`, `T_BUDGET_CONFIRM_NOCAP`, `T_SMALL_GROUP`, `T_NOT_IN_PLAN`;
   - `T_CARD_REMOVED` (stretch); voice go only: `T_VOICE_RECAP_IN`, `T_VOICE_RECAP_OUT`, `T_VOICE_RECAP_LATER` (B's C-4; A writes the copy).
2. **`VenueEvent.data` keys requested from C:**
   - `card_brand` on `share.authorized`, for `T_HELD`;
   - `pay_url` + `expires_at` on `share.declined`, and on `share.released` after a timeout reversal, for `T_DECLINED_RETRY`.
3. **Venue requirements (no contract change):**
   - The pay-link `expires_at` must be ≥ the order's `deadline_at`. Otherwise `T_REPING` sends a dead link.
   - `X-Tab-Timestamp` is in unix **seconds**.
   - `/checkout` runs the 6 TAP steps **before** any order-state check. That way `/ops/tap-test` still shows a full report on an order that is already captured.
4. **Migration `004_pay_links.sql`** (app schema only).
5. (Withdrawn: constraints are loaded only inside B's `decide/score.ts` orchestrators, so P1 and its allowlist are unchanged.)
6. **Stretch only:** `VenuePort.forgetPayer(payerRef)` → venue `POST /payers/{payer_ref}/forget`. C decides. If it is not built, "remove card" replies `T_HELP`.

---

## 4. Before the foundation lands (4:25–6:00 PM)

### 4.1 Accounts (4:25–4:45)

| # | Do | Done when |
|---|---|---|
| 1 | **Photon:** sign up and create a project with the iMessage channel. Dashboard: try `app.beta.photon.codes` first; photon.md says `app.photon.codes/dashboard` (ask the booth which). Create an API key `pho_sk_…` with `project:read`, `project:write`, `platforms:read`, `platforms:write`; it is shown once. | `PHOTON_API_KEY` and `PHOTON_PROJECT_ID` are in the password manager. The ID has the form `pho_prj_` + 26 chars (verified pattern `^pho_prj_[0-7][0-9a-hjkmnp-tv-z]{25}$`). |
| 2 | Anthropic API key | `ANTHROPIC_API_KEY` stored |
| 3 | Supabase project in the region nearest LAX | DB password, session pooler `:5432` string and transaction pooler `:6543` string stored |
| 4 | Fly: `fly apps create tab-agent`. Fly app names are global. **If the name is taken**, use `tab-agent-<team>` and post the URL at once: it changes `PUBLIC_BASE_URL`, `AGENT_HOOK_URL`, `TAB_API_BASE` (CREAO Secrets) and `NEXT_PUBLIC_AGENT_URL`. | App URL posted in chat |
| 5 | Public GitHub repo; add B and C | Repo URL in chat. Nothing is pushed yet (the foundation pushes). |
| 6 | Share the secrets with Claude's operator out-of-band (password manager or DM; never git or chat logs) | Foundation can deploy |

### 4.2 Photon booth questions (answers recorded in PLAN §19 by 6:45)

1. How do we enter the iMessage prize (and Voice), given it isn't on Devpost? Can one team win both?
2. Does `@photon-ai/api` (2.0 beta, `api.photon.codes/v1`) count as "built on Photon 2.0"? The brief links spectrum-ts.
3. Is the shared-line pool safe for about 15 judge assignments Sunday? The free tier has 25 seats, and we release after each judge.
4. Do the agent-profile name and avatar show on shared lines?
5. Do hackathon credits cover an SMS number for voice? (Asked on B's behalf.)
6. Which dashboard URL is correct?
7. How long does Socket.IO replay retain history? The cursors doc only says "Replay is limited to retained history" (verified quote).
8. What is the `MESSAGE_TOO_LONG` limit for iMessage text? The code (422) is in the catalog; the limit is not.
9. How long are `Idempotency-Key`s retained?

### 4.3 Throwaway spikes in `scratch/photon/` (4:45–6:00)

```bash
mkdir -p scratch/photon && cd scratch/photon
printf '*\n' > .gitignore                       # nothing here is ever committed
npm init -y >/dev/null && npm pkg set type=module
npm i --save-exact @photon-ai/api@0.5.0 socket.io-client@4.8.4
# .env.local (never committed): PHOTON_API_KEY, PHOTON_PROJECT_ID, MY_PHONE (E.164), PHOTON_SETUP_KEY=a-unique-string
node --env-file=.env.local <spike>.mjs           # Node 22 --env-file; plain .mjs avoids a TS toolchain here
```

**S1. Assign your own phone (5 min), `assign.mjs`.** (verified: package `schemas.d.ts` `CreateSharedLineAssignmentInput`, and the namespace `projects.platforms.imessage.assignments`)

```js
import { Photon } from "@photon-ai/api";
const photon = new Photon({ headers: { Authorization: `Bearer ${process.env.PHOTON_API_KEY}` } });
const a = await photon.projects.platforms.imessage.assignments.create({
  path: { id: process.env.PHOTON_PROJECT_ID },
  headers: { idempotencyKey: process.env.PHOTON_SETUP_KEY },   // camelCase for this op (SDK → Idempotency-Key)
  body: { handle: process.env.MY_PHONE, firstName: "A" },
});
console.log(a.assignmentId, a.assignedPhoneNumber);
```

- **Expected:** 201 with `assignmentId` and `assignedPhoneNumber`.
- **Errors (verified in the OpenAPI):** 409 `ASSIGNMENT_EXISTS`, 409 `SHARED_LINE_CAP_EXCEEDED`, 503 `SHARED_LINE_POOL_EXHAUSTED`, 422 `IDEMPOTENCY_KEY_REUSED` (same key, different body).
- **Reading the code:** `err.body.code` on `ApiError` (problem body field `code`, verified).
- **Key format:** 1–255 visible ASCII characters, no spaces (verified).

**S2. Socket.IO echo (25 min), `echo.mjs`.** This follows the official `beta/websocket/example` (epoch guard, bounded queue) plus a reply.

```js
import { io } from "socket.io-client";
import { Photon } from "@photon-ai/api";
const { PHOTON_API_KEY: key, PHOTON_PROJECT_ID: id } = process.env;
const photon = new Photon({ headers: { Authorization: `Bearer ${key}` } });
let cursor = Number(process.env.START_SEQ ?? 0), epoch = 0, pending = 0, queue = Promise.resolve();
const socket = io("https://api.photon.codes", {
  path: `/v1/projects/${id}/events/ws`, addTrailingSlash: false, transports: ["websocket"],
  extraHeaders: { Authorization: `Bearer ${key}` }, autoConnect: false,
});
socket.on("connect", () => socket.timeout(10_000).emit("subscribe", { startSeq: cursor, apiVersion: "2026-07-01" },
  (err, res) => { if (err) return socket.io.engine.close(); console.log("subscribed", JSON.stringify(res)); }));
socket.on("disconnect", () => { epoch++; });
socket.on("delivery", (event, { seq }) => {
  const gen = epoch;
  if (++pending > 128) { pending--; epoch++; socket.io.engine.close(); return; }
  queue = queue.then(async () => {
    if (gen !== epoch || seq <= cursor) return;
    const m = event.data?.object;
    console.log(seq, event.type, event.id, m?.sentBy?.kind, m?.sentBy?.handle, m?.receivedBy?.id, m?.space?.kind);
    if (event.type === "message.received" && m.sentBy.kind === "human") {
      const t0 = Date.now();
      await photon.projects.setSpaceTyping({ path: { id, spaceId: m.space.id }, body: { senderId: m.receivedBy.id, typing: true } });
      await photon.projects.markMessageRead({ path: { id, messageId: m.id }, headers: { "idempotency-key": `read:${m.id}` } });
      await new Promise(r => setTimeout(r, 1500));
      await photon.projects.sendMessage({ path: { id }, headers: { "idempotency-key": `echo:${m.id}` },
        body: { spaceId: m.space.id, senderId: m.receivedBy.id, parentMessageId: m.id,
                content: { type: "text", format: "plain", text: `pong (${Date.now() - t0} ms)` } } });
    }
    cursor = seq;
  }).catch(e => { console.error("handler failed", e.message); if (gen === epoch) { epoch++; socket.io.engine.close(); } })
    .finally(() => { pending--; });
});
socket.on("delivery_error", e => console.error("delivery_error", e.code, e.fatal, e.retryable));
socket.on("connect_error", e => console.error("connect_error", e.message));
socket.connect();
```

**Expected:**
- The ack is `{ok:true, projectId, apiVersion, connectionId, startSeq, limits:{maxFrameBytes,…}}`, or `{ok:false, error:{code,…}}` (verified in the AsyncAPI).
- Texting "ping" shows a typing bubble, then a threaded "pong".

**Record in §19:**
- Is `receivedBy` present? The schema marks it optional (verified). Runtime presence: **UNVERIFIED — smoke-test first**.
- The exact format of `sentBy.handle`: E.164 like `+13105551234`? **UNVERIFIED — smoke-test first.** Router step 4 depends on it.
- The `message.accepted|dispatched|delivered` deliveries after your own send. Typing and read requests also return action Messages (verified), so expect extra deliveries for those.
- How a `parentMessageId` reply renders on iOS (**UNVERIFIED — smoke-test first**).

**S3. Replay (10 min).**
1. Kill `echo.mjs` after one message and note the last printed seq.
2. Text twice more.
3. Restart with `START_SEQ=<that seq>`.

Expected: the two missed messages are delivered. A positive `startSeq` resumes **after** that seq; "do not add one" (verified, cursors doc). With `START_SEQ=0` you get live events only.

**S4. Typing refresh interval (10 min).** Call `setSpaceTyping(true)` every 5 s for 60 s, then every 10 s for 60 s, and note when the bubble drops. The API says "Repeat true to refresh … Callers control refreshes" (verified), but the expiry is not documented. This sets `TYPING_REFRESH_MS`. **UNVERIFIED — smoke-test first.**

**S5. Native-feature rejection check (10 min, optional; cut it if behind).**
- The send union `SendContent` *does* include `poll`, `reaction` and `text.update` (verified).
- The iMessage content union is only Text, Attachment, MessageRead, SpaceTypingUpdate and Group (verified).
- Send one of each to your own DM and record the problem code. Expect 422 `UNSUPPORTED_CONTENT`: **UNVERIFIED — smoke-test first**.

```js
// poll:        { type: "poll", question: "Q?", options: [{ id: "1", text: "A" }, { id: "2", text: "B" }], selectionMode: "single" }
// reaction:    { type: "reaction", reaction: "❤️", action: "add" }   + parentMessageId = an inbound id
// text.update: { type: "text.update", format: "plain", text: "edited" } + parentMessageId = your own sent id
```

We never use these, whatever the result. The result only feeds the Photon pitch line ("we checked").

**S6. Agent profile (10 min).** The path parameter is `projectId`, not `id` (verified):

```js
await photon.projects.agentProfile.update({ path: { projectId: id }, headers: { idempotencyKey: "profile-tab-1" }, body: { firstName: "SquadTab" } });
// avatar (stretch, 4–7 AM), verified sequence:
// const u = await photon.projects.agentProfile.createAvatarUpload({ path:{projectId:id}, body:{ contentType:"image/png" } }); // {uploadUrl, formFields, uploadId, expiresAt}
// multipart POST to u.uploadUrl: every formFields entry, then the file as the FINAL part; no Photon credentials; don't log the URL/fields
// await photon.projects.agentProfile.commitAvatar({ path:{projectId:id}, headers:{ idempotencyKey:"avatar-1" }, body:{ uploadId: u.uploadId } });
```

Text from a second team phone and check whether "SquadTab" shows (**UNVERIFIED — smoke-test first** on shared lines).

**S7. Release (2 min).** Run `photon.projects.platforms.imessage.assignments.release({ path: { id, assignmentId } })`. This is `DELETE …/assignments/{assignmentId}` → 200, and it is repeat-safe (verified). Re-create it with a **new** idempotency key, then text first again. The rule (verified, sendMessage description): a shared line sends "only to a peer with an active Assignment who has messaged it since that Assignment."

**Also before 6:00:**
- Assign the 3 team phones plus 1 spare through S1 and keep the `assignmentId`s.
- Each team phone sends at least 3 messages to SquadTab.
- Put the team phones in `DEMO_TEAM` (T14).

---

## 5. Step-by-step tasks (after the foundation lands at 6:00)

Times are wall-clock with Claude Code. Docs:
- Photon beta: `https://photon.codes/docs/beta/…`.
- Anthropic structured outputs: `https://platform.claude.com/docs/en/build-with-claude/structured-outputs.md`.

The **money spine (T9) must be green by 11 PM**. If you are behind, cut free-text delegate parsing (T6 prefs and ballot fall back to empty prefs and digits) before you cut T9.

### T0. 6:00–6:10: pull, run, sync
- `pnpm install && pnpm test && pnpm sim:plan` must be green on mocks.
- 5-minute sync with B and C:
  - hook names are final (PLAN §9); confirm C's `consentFromOrder` export;
  - post the §3.3 list.

### T1. 6:10–6:30: `PhotonMessaging` adapter (`src/photon/{client,messaging,errors}.ts`)

`@photon-ai/api@0.5.0` (exact). The base URL defaults to `https://api.photon.codes` (verified).

```ts
import { Photon, ApiError } from "@photon-ai/api";
// verified options: headers, timeoutMs (per attempt, default 30000), retry {maxAttempts 1–3, statuses, …}
export const photon = new Photon({
  headers: { Authorization: `Bearer ${env.PHOTON_API_KEY}` },
  timeoutMs: 10_000,
  retry: { maxAttempts: 2 },              // bounds worst case per call to ~20 s (see T2 timeout)
});
const id = env.PHOTON_PROJECT_ID;

export const problemCode = (e: unknown) =>
  e instanceof ApiError ? ((e.body as { code?: string } | undefined)?.code ?? `HTTP_${e.status}`) : "TRANSPORT";

export class PhotonMessaging implements MessagingPort {
  async sendText(to: DmAddress, text: string, o: { idempotencyKey: string; replyTo?: string }) {
    const m = await photon.projects.sendMessage({
      path: { id }, headers: { "idempotency-key": o.idempotencyKey },
      body: { spaceId: to.spaceId, senderId: to.agentUserId,
              ...(o.replyTo ? { parentMessageId: o.replyTo } : {}),
              content: { type: "text", format: "plain", text } },
    });                                                       // 202 → Message
    return { messageId: m.id };
  }
  async setTyping(to: DmAddress, on: boolean) {
    await photon.projects.setSpaceTyping({ path: { id, spaceId: to.spaceId }, body: { senderId: to.agentUserId, typing: on } });
  }
  async markRead(messageId: string, key: string) {
    await photon.projects.markMessageRead({ path: { id, messageId }, headers: { "idempotency-key": key } });
  }
  async assign(handle: string, firstName: string, key: string) {
    const a = await photon.projects.platforms.imessage.assignments.create({ path: { id }, headers: { idempotencyKey: key }, body: { handle, firstName } });
    return { assignmentId: a.assignmentId, assignedPhoneNumber: a.assignedPhoneNumber };
  }
  async release(assignmentId: string) { await photon.projects.platforms.imessage.assignments.release({ path: { id, assignmentId } }); }
  // start(): T2
}
```

**Facts (verified in the package types and README):**
- **Header casing differs by operation, and TypeScript enforces it.**
  - `sendMessage` and `markMessageRead` take `"idempotency-key"`.
  - `assignments.create`, `agentProfile.update` and `commitAvatar` take `idempotencyKey`.
  - `setSpaceTyping` takes no key.
- The client retries 408/429/502/503/504 only for GET requests and requests that carry an idempotency key. Typing has no key, so it is sent once.
- **Typing and markRead are cosmetic.** Call them fire-and-forget through `safe(() => …)`, which swallows the error and logs it, so they never block a reply.

**Error map (`errors.ts`).** Codes and statuses are verified in the OpenAPI.

| Code | HTTP | Action |
|---|---|---|
| `SHARED_LINE_INBOUND_REQUIRED` | 403 | Never retry. `outbound_messages.status='blocked_inbound'`; that user must text first. |
| `SHARED_LINE_NOT_ASSIGNED` | 403 | `system:error`. The seat was released, so the user must re-join. |
| `SHARED_LINE_CAP_EXCEEDED` / `SHARED_LINE_POOL_EXHAUSTED` | 409 / 503 | Join: 503 `{error:"capacity"}` |
| `ASSIGNMENT_EXISTS` | 409 | Join: adopt the existing assignment via `list` (T4) |
| `IDEMPOTENCY_KEY_REUSED` | 422 | Bug (same key, different body). Log an error and never resend with a new key. |
| `UNSUPPORTED_CONTENT`, `MESSAGE_TOO_LONG`, `INVALID_CONTENT` | 422 | Bug. Log an error. |
| `SPACE_NOT_SENDABLE`, `SENDER_NOT_SENDABLE` | 409 | Log a warning and mark the route stale |
| `RATE_LIMITED` | 429 | The SDK retries keyed requests; log if it still fails |

**Gate at 6:45:** the S2 echo works on a real phone, **and** `PhotonMessaging.sendText` reaches your own phone. Prove it with a one-off `tsx` script that uses a `dm_routes` row captured from S2.

### T2. 6:30–6:55: consumer with cursor and dedupe (`src/photon/{consumer,normalize}.ts`)

`socket.io-client@4.8.4`. The contract, verified against the beta websocket docs and `photon-asyncapi.yaml`:
- `subscribe {startSeq, apiVersion}`: `startSeq: 0` means live; a positive value resumes **after** that seq.
- `delivery(event, {seq, replyExpected})`.
- `delivery_error {code, message, fatal, retryable}`. Fatal codes include `slow_consumer`, `capacity` and `server_draining`.
- Polling and session recovery are disabled. Socket.IO owns reconnects, and the client **must subscribe again on every `connect`** with the saved cursor.

```ts
let cursor = await loadCursor();                 // select seq from app.photon_cursor where id=1
let epoch = 0, pending = 0, queue = Promise.resolve();
const failures = new Map<string, number>();
socket.on("connect", () => socket.timeout(10_000).emit("subscribe", { startSeq: cursor, apiVersion: env.PHOTON_API_VERSION },
  (err: unknown, res: any) => { if (err) return socket.io.engine.close(); if (!res.ok) log.error({ code: res.error.code }, "subscribe failed"); }));
socket.on("disconnect", () => { epoch++; });
socket.on("delivery", (event, { seq }) => {
  const gen = epoch;
  if (++pending > 128) { pending--; epoch++; socket.io.engine.close(); return; }   // replay redelivers
  queue = queue.then(async () => {
    if (gen !== epoch || seq <= cursor) return;
    if (!(await seenInbound(event.id))) {                         // select 1 from app.inbound_events where source='photon' and event_id=$1
      try { await withTimeout(handle(event, seq), 45_000); }
      catch (e) {
        const n = (failures.get(event.id) ?? 0) + 1; failures.set(event.id, n);
        if (n < 3) throw e;                                       // stop stream; resume from last good cursor (docs)
        await emit({ type: "system", level: "error", msg: "inbound poison skipped" });
      }
      await markInboundSeen(event.id);                            // insert … on conflict do nothing (AFTER success)
    }
    await saveCursor(seq); cursor = seq;                          // update app.photon_cursor set seq=$1 where id=1
  }).catch(() => { if (gen === epoch) { epoch++; socket.io.engine.close(); } })
    .finally(() => { pending--; });
});
socket.on("delivery_error", e => log.warn({ code: e.code, fatal: e.fatal }, "delivery_error"));
socket.on("connect_error", e => log.error({ m: e.message }, "connect_error"));
```

**Why this shape:**
- **Dedupe is checked first and inserted only after success.** Inserting first would lose a message when a handler crashes. Sends are keyed, so a redelivery is safe.
- **Poison handling is a deliberate deviation.** The docs say to stop the stream on failure. After 3 failures of the same `event.id` we skip it instead, trading one lost message for demo liveness.
- **The 45 s per-event timeout** covers the worst case of an LLM call (10 s × 2 attempts) plus a send (10 s × 2). A timed-out handler may still finish, and its sends are idempotent.
- **Event types:**
  - `message.received` → normalize → `route()`.
  - `message.accepted|dispatched|delivered|failed` → look up `data.object.id` in `outbound_messages.photon_message_id`. If found, emit a `delivery` SSE (`message_id_short` = last 6 characters). Otherwise ignore it: typing and read requests produce action Messages too.
  - All other types are ignored.

**`normalize.ts` → `InboundEvent`.** Verified fields:
- `ImessageMessageReceivedEvent`: `{id, type, apiVersion, source, timestamp, data:{projectId, object}}`.
- `ReceivedImessageMessage`: `id, space{id,kind}, sentBy{id,handle,kind}, receivedBy?{id,handle,kind}, content, parentMessageId?, timestamps{receivedAt}`.

| `InboundEvent` field | Source |
|---|---|
| `event_id` | `event.id` |
| `seq` | `seq` |
| `message_id` | `obj.id` |
| `platform` | `"imessage"` (drop other platforms) |
| `from_handle` | `obj.sentBy.handle` |
| `from_user_id` | `obj.sentBy.id` |
| `agent_user_id` | `obj.receivedBy?.id ?? dm_routes.agent_user_id`. If both are missing, log an error and drop. |
| `space_id` | `obj.space.id` |
| `space_kind` | `obj.space.kind` (drop unless `"direct"`; verified value in `beta/get-started/imessage`) |
| `content_type` | `obj.content.type` |
| `text` | `content.type === "text" ? content.text : null` |
| `parent_message_id` | `obj.parentMessageId ?? null` |
| `received_at` | `obj.timestamps.receivedAt` (preserved across replay; verified) |

- Drop the event when `sentBy.kind !== "human"` (verified value).
- **Never log `text`.** The pino child logger carries only `{event_id, msg6, lane}`.
- Error logging: serialize only `err.code` and `err.message` for DB and SDK errors. Driver error objects can carry query parameters (**UNVERIFIED — smoke-test first** for postgres.js; we never print the full object either way).

### T3. 6:55–7:15: router skeleton + JOIN on a real phone (`src/router/*`)

`route(e: InboundEvent)` runs these steps in fixed order; the first match wins:

```
0. user = by users.photon_user_id = from_user_id, else by phone_e164 = from_handle (then set photon_user_id).
   If user: upsert app.dm_routes(user, space_id, agent_user_id, agent_number=receivedBy.handle)
1. text null → safe(markRead); return
2. LUHN INTERCEPT (before any LLM, log or text write): /(?:\d[ -]?){13,19}/ → strip spaces and dashes → length 13–19 && luhn
   → notify(T_CARD_INTERCEPT, replyTo=e.message_id); emit system "card number intercepted (lane n)"; counter++; return
3. safe(markRead(e.message_id, `read:${e.message_id}`)); safe(setTyping(true))      // fire-and-forget
4. no user → notifyRaw(T_NOT_IN_PLAN); return
5. COMMANDS (normalize: trim, lowercase, ’→'):
   ^join\s+(\d{4})$  ^(help|\?)$  ^status$  ^(i'?m out|out|stop|leave)$  ^receipts?$  ^remove card$
   ^forget me$  ^cancel plan$  ^go$  ^wait$  ^change budget$
6. AWAITING FLAGS (delegates/awaiting.ts, in-memory; lost on restart = the user just re-sends):
   'holdgate' (pending hold_gates row is the source of truth) → /^(y|yes|yeah|yep|ok)$/ | /^(n|no|nope)$/, else resend T_HOLD_GATE
   'tiers'  → /^[1-4]$/ → tier map
   'budget' → delegates/budget
7. STAGE HANDLERS (the user's participant row in the most recent non-terminal plan):
   JOINED                  → delegates/budget
   BUDGET_LOCKED           → delegates/prefs
   plan VOTING, stage ≥ PREFS_DONE → /^\s*[1-3](\s*[, ]\s*[1-3])*\s*$/ → digits ballot; else delegates/ballot (re-vote allowed until close)
   anything else           → delegates/free (ask_about_others → T_ONLY_YOURS, else T_HELP)
```

**Rules:**
- Stage order is a code array: `INVITED < JOINED < BUDGET_LOCKED < PREFS_DONE < VOTED < GATED < LINK_SENT < HELD < CAPTURED`. `RELEASED` and `DECLINED` are terminal.
- A send clears typing, so there is no `setTyping(false)`.
- Never leave typing on longer than `TYPING_REFRESH_MS` without a refresh.

**Gate at 7:15:** JOIN on a real phone produces `T_JOIN_WELCOME` + `T_BUDGET_ASK`. A plan row inserted by hand is enough.

### T4. 7:15–7:45: join API and seats (`src/join/*`)

**`POST /join`.** CORS via `cors({ origin: env.WEB_ORIGIN })` from `hono/cors` (verified: `origin` takes a string). Rate limit 10/min per IP, keyed on the `Fly-Client-IP` header (verified: Fly request headers doc).

Body, parsed with zod:
- `code`;
- `phone_e164: z.e164()` (verified in zod 4.6.7);
- `first_name: z.string().min(1).max(40)`;
- `budget_usd?: {target: number, hard_max?: number}`;
- `consent: z.literal(true)`.

There is no request-body logging anywhere; the pino redact paths include `budget_usd`.

Steps:
1. Find the plan by code with state ∈ {COLLECTING, RESEARCHING, VOTING}. No plan with that code → 404 `{error:"not_found"}`. Code exists but state ∉ that set → 409 `{error:"plan_closed"}`. Zod failure → 422 `{error:"invalid", issues:[{path,message}]}`. Rate limit → 429 `{error:"rate_limited"}`.
2. Upsert the user by `phone_e164`, with `payer_ref = createHmac('sha256', PAYER_REF_SECRET).update(userId).digest('hex').slice(0,32)`. This matches `^[0-9a-f]{32}$`.
3. Upsert the participant as `INVITED`, with `lane = coalesce(max(lane),0)+1`. Emit `lane`.
4. If `budget_usd` is present: convert dollars to cents, validate as in T6, then call `repo/privateConstraints.upsert(…, source:'form', confidence:'high')`. **No `@tab/shared/private` import here.**
5. **Seat:**
   - Reuse the active `app.assignments` row (`released_at is null`) if there is one.
   - Otherwise call `assign(phone, first_name, key)` with key `join:<planId>:<userId>`, plus `:<n>` if that user has released assignments. Without the suffix, Photon's idempotency cache would replay the released assignment.
   - `ASSIGNMENT_EXISTS` → page through `assignments.list({ path:{id}, query:{ pageSize:100, pageToken } })`. The result is `{assignments[], nextPageToken?}`, released rows excluded by default (verified). Adopt the row whose `handle` matches.
   - `SHARED_LINE_CAP_EXCEEDED` / `SHARED_LINE_POOL_EXHAUSTED` → 503 `{error:"capacity"}`.
6. Return `{assigned_number, sms_href: "sms:" + n + "&body=" + encodeURIComponent("JOIN " + code), join_text: "JOIN " + code}`. iOS `&body=` behaviour is **UNVERIFIED — smoke-test first**; B shows the number and the code in plain text as well.

**`seats.ts`:**
- `releaseSeat(userId)` = `release()` + `update app.assignments set released_at=now()`.
- `releaseAllExceptTeam()` releases every active assignment whose user's phone is not in `DEMO_TEAM`.

`POST /plans` moves to T13. The demo plan comes from `seedDemo` (T7), so nothing before 11 PM needs it.

### T5. 7:45–8:10: templates + notify (`packages/shared/src/templates.ts`, `src/notify/*`)

`templates.ts` exports:
- the `TemplateId` enum;
- `COPY: Record<TemplateId,string>`, with PLAN §8 copy verbatim;
- `VARS: Record<TemplateId, z.ZodObject>`.

**Rendering rules:**
- `render(id, vars)` replaces `{name}` and throws on a missing variable.
- **Money formatting (the copy already contains the `$`):**
  - `usd0(cents) = String(Math.floor(cents/100))` for budgets (`T_BUDGET_CONFIRM`) and per-person bundle prices. Use floor so we never overstate a max.
  - `usd2(cents) = (cents/100).toFixed(2)` for share amounts (`T_HOLD_GATE`, `T_PAY_LINK`, `T_HELD`, `T_CAPTURED`).
- **Dates and times use `Intl.DateTimeFormat` with `timeZone:"America/Los_Angeles"`; no date library.**
  - `{date}` uses `{weekday:"short", month:"short", day:"numeric"}`.
  - `{deadline}` uses `{hour:"numeric", minute:"2-digit"}`.

**Additive copy (announce):**

| Id | Copy |
|---|---|
| `T_HELP` | "Text STATUS, I'M OUT, RECEIPTS, CHANGE BUDGET or FORGET ME. Your budget stays between us." |
| `T_STATUS` | "{title}: {phase}." `phase` comes from a fixed code map, e.g. "3 of 4 voted", "waiting on holds (2 of 4 in)". |
| `T_OUT_ACK` | "Got it, you're out of {title}. Nobody's told why." |
| `T_RECEIPTS` | "Your bookings:\n{lines}". Lines are code-built, e.g. "Oct 17 · Dinner + show · $30.00 · card ••1111", or "None yet." |
| `T_FORGOTTEN` | "Done. I deleted your budget, preferences and votes." |
| `T_ORGANIZER_ONLY` | "Only the organizer can do that." |
| `T_BALLOT_CLARIFY` | "Which ones would you be happy with? Reply with numbers, like '1 3'." |
| `T_BUDGET_CONFIRM_NOCAP` | "Just between us: no hard cap. Text 'change budget' anytime." |
| `T_SMALL_GROUP` | "Heads up: with fewer than 3 people, it's easier to guess each other's limits. Reply GO again to continue." |
| `T_NOT_IN_PLAN` | "I don't see you in a plan yet. Open the join link your friend shared." |
| `T_CARD_REMOVED` (stretch) | "Done. Your saved card is removed from the venue." |

**`notify(userId, id, vars, {key, replyTo?})`:**
1. Zod-parse `vars`, then render.
2. Load `dm_routes`. If there is no route: upsert `outbound_messages(status='blocked_inbound')` and return. **Never send a first message.**
3. Claim the key:
   ```sql
   insert into app.outbound_messages (idempotency_key,user_id,plan_id,template_id,status)
   values (…,'pending') on conflict (idempotency_key) do update set updated_at=now()
   where app.outbound_messages.status not in ('accepted','blocked_inbound') returning 1
   ```
   No row back means the message was already accepted, so return. A failed or pending row is retried with the **same** Photon key; Photon deduplicates it.
4. `sendText`, then set `photon_message_id` and `status='accepted'`. On error, set `status='failed:'+problemCode(e)`.
5. **Store only `template_id`, never the text.**

**Keys** (PLAN §3.2; printable ASCII, ≤255 characters, verified):
- Direct replies: `reply:<inboundMessageId>:<n>`.
- Plan-driven: `tpl:<planId>:<userId>:<templateId>:<version>`.
- Templates sent more than once per version get a discriminator suffix:
  - `T_VOTE_TALLY` `:<k>`;
  - `T_IN_COUNT` `:<k>`;
  - `T_REPING` `:1`;
  - `T_DECLINED_RETRY` `:<VenueEvent.event_id>` (unique per declined/released event, stable on redelivery);
  - `T_HOLD_GATE` `:<amount_cents>`.

**`fanout.ts`:**
- `fanout(planId, id, varsFor(userId))` sends to every participant whose stage ∉ {DECLINED, INVITED}.
- Fan-out templates also emit `xray {name:"fanout", locked:false, preview:<rendered text for the lowest lane>}`. They are: `T_PICKS`, `T_PICKS_REFRESH`, `T_VOTE_TALLY`, `T_WINNER`, `T_IN_COUNT`, `T_CAPTURED`, `T_CANCELLED`, `T_NO_FIT`.
- **Personal templates never go to the X-ray or the logs.** Neither do pay URLs.

**`T_PICKS` lines:**
- Format: `${i}. ${title} · dinner ${h:mm} → show ${h:mm} · $${usd0(all_in)} pp all-in\n   ${pitch}`.
- The pitch is sanitized: strip control characters and newlines, ≤140 characters.
- Keep the whole message under about 600 characters. The `MESSAGE_TOO_LONG` limit is **UNVERIFIED — smoke-test first**.

### T6. 8:10–8:55: private delegates (`src/delegates/*`)

`@anthropic-ai/sdk@0.135.0`. Verified in the claude-api skill and on unpkg:
- `client.messages.parse` with `zodOutputFormat` from `@anthropic-ai/sdk/helpers/zod` (exported in 0.135.0; peer `zod ^3.25 || ^4`);
- `output_config: { format, effort }`;
- `messages.parse()` throws `AnthropicError` when the output fails JSON/zod validation (B verified this in `helpers/zod.js`); `parsed_output` may still be null; both map to `null`;
- check `stop_reason === "refusal"`;
- no prefill and no forced `tool_choice` on 5.5 models;
- **no `temperature`, `top_p` or `top_k`** (non-default values return 400 on Haiku 5.5 and Sonnet 5.5);
- Haiku 5.5 runs adaptive thinking by default with effort default `medium`, so set `low`;
- do not send `thinking`;
- the TS `timeout` is in **ms**.

```ts
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
const client = new Anthropic();                                     // per-call limits below (RequestOptions, verified)

export async function delegateParse<T>(schema: z.ZodType<T>, system: string, input: DelegateInput, extra?: string,
                                       o: { model?: "claude-haiku-5-5" | "claude-sonnet-5-5"; maxTokens?: number; timeoutMs?: number; maxRetries?: number } = {}): Promise<T | null> {
  const body = {
    model: o.model ?? "claude-haiku-5-5", max_tokens: o.maxTokens ?? 2048, system,                  // thinking shares max_tokens; 1024 risks truncation
    messages: [{ role: "user" as const, content: (extra ? extra + "\n\n" : "") + JSON.stringify(input) }],
    output_config: { format: zodOutputFormat(schema), effort: "low" as const },  // NO tools / tool_choice / prefill / sampling
  };
  recorder?.(body);                                   // test hook for P5/P7
  try {
    const r = await client.messages.parse(body, { timeout: o.timeoutMs ?? 10_000, maxRetries: o.maxRetries ?? 1 });   // delegates: worst case ~20 s, inside T2's 45 s
    if (r.stop_reason === "refusal" || r.stop_reason === "max_tokens") return null;
    return (r.parsed_output as T | null) ?? null;
  } catch { return null; }                            // API or client-side validation failure → low confidence
}
```

**`buildDelegateInput(userId, msg, stage)`** returns `{ user_first_name, stage, message_text: msg.slice(0,2000) }` **and nothing else** (P2). Emit `xray {name:"delegate:lane-n", locked:true, preview:null}`.

**Prompts (`prompts.ts`)** are fixed strings with no per-request data:
- **`BUDGET_SYSTEM`:** "You read ONE person's own message about what they'd spend per person on tonight's outing (dinner + show, all-in). Return cents. target_pp_cents = what they'd like to spend; hard_max_pp_cents = the most they'd ever spend, or null if they gave no ceiling. Examples: '30 tops' → 3000/3000; '60ish, could stretch to 80' → 6000/8000; 'around 45' → 4500/null. If it isn't clearly a budget, confidence=low."
- **`PREFS_SYSTEM`:** extract `Preferences`. No money fields. Dietary and vibe must use the enums. Times are HH:MM 24h or null.
- **`BALLOT_SYSTEM`:** "The user is choosing among the numbered plans below (public info). Return the plan numbers they'd be happy with, conditions (end_before/start_after HH:MM, exclude n), none_of_these, and intent: 'ask_about_others' if they ask about anyone else's budget, money or reasons; 'other' if not a vote." Pass the shortlist as `extra`: PublicBundle index, title, times and price, all public.

**Budget acceptance** (code, after the LLM; PLAN §3.2):

```ts
const ok = p && p.confidence === "high" && p.target_pp_cents >= 500 && p.target_pp_cents <= 100000
  && (p.hard_max_pp_cents === null || (p.hard_max_pp_cents >= p.target_pp_cents && p.hard_max_pp_cents <= 100000));
```

- **Accepted:**
  1. `repo/privateConstraints.upsert(source 'dm', confidence 'high', confirmed_at now())`.
  2. `T_BUDGET_CONFIRM {target: usd0(target), max: usd0(effectiveHardMax(c))}`.
  3. Clear the awaiting flag.
  4. If the stage is JOINED, set it to `BUDGET_LOCKED` and send `T_PREFS_ASK`.
  5. If the plan is VOTING, enqueue `recompute` (a constraint change).
  6. If an order exists, re-run holdGate (T9).
- **Otherwise:** send `T_BUDGET_TIERS` and set the awaiting flag to `'tiers'`.

**Tier map (code only; our choice, to announce):**

| Reply | target / hard_max (cents) | Confirmation |
|---|---|---|
| 1 | 4000 / 5000 | `T_BUDGET_CONFIRM` |
| 2 | 6500 / 8000 | `T_BUDGET_CONFIRM` |
| 3 | 10000 / 12000 | `T_BUDGET_CONFIRM` |
| 4 | 50000 / null | `T_BUDGET_CONFIRM_NOCAP` |

All tier writes use source `'tier'` and confidence `'high'`.

**The other parsers:**
- **Prefs:** `parsePreferences` → upsert `app.preferences`. A null result stores empty prefs. Then stage `PREFS_DONE`, emit `lane`, call `membership.onPrefsDone(planId)`.
- **Free text and `ask_about_others`:** `parseBallot({…stage:"free"}, [])`, using only `intent`.
  - `ask_about_others` → `T_ONLY_YOURS`, sent as a reply to the inbound message. Anything else → `T_HELP`.
  - Code fallback (always on, and the only path when `LLM_MODE=mock`): `/budget|afford|spend|max/i` **and** another participant's first name → `T_ONLY_YOURS`. The match runs in code only.
- **`repairScoutJson` (B's caller):** the same wrapper with system prompt "Fix this JSON to match the schema; do not invent fields" and the `ScoutSubmission` schema. It sees Scout text only.
- **`rateBundles`:**
  - Call `delegateParse(Ratings, RATE_SYSTEM, …, { model: "claude-sonnet-5-5", maxTokens: 4096, timeoutMs: 30_000, maxRetries: 2 })`.
  - Build the user content with B's `buildRateUserMessage(prefs, candidates)`. Add a variant of the wrapper that takes a raw user string; keep the recorder.
  - A null result means B's default scores.

**UNVERIFIED — smoke-test first: zod regex and nullable with `zodOutputFormat`.** The skill says the SDK strips unsupported constraints and validates them client-side, but `pattern` is not listed as either supported or unsupported. Does `zodOutputFormat` accept the `HHMM` `.regex()` and `.nullable()` in `Preferences`?
- Smoke test (5 min, scratch script): `parsePreferences` on "veggie, nothing after 10pm".
- Expected: `latest_end:"22:00"`, `dietary:["vegetarian"]`.
- If it throws or comes back null: use an LLM-facing copy with `z.string()` in place of `HHMM`, validate HHMM in code, and announce the change.

### T7. 8:55–9:40: state machine, research trigger, decision wiring, minimal seed (`src/plan/{machine,membership,decision}.ts`, `scripts/seedDemo.ts`)

**`transition(planId, from: State | State[], to, opts?: {version?, bumpVersion?})`.** Array parameters use `sql.array` (verified, Context7 `/porsager/postgres`). The prior state comes back from a CTE, so the event's `from` is exact.

```ts
export async function transition(planId: string, from: State | State[], to: State, opts: { version?: number; bumpVersion?: boolean } = {}) {
  const froms = Array.isArray(from) ? from : [from];
  return sql.begin(async tx => {                                   // verified: sql.begin(cb), rollback on throw
    const [r] = await tx`
      with prev as (select id, state from app.plans where id = ${planId} for update)
      update app.plans p set state = ${to}, updated_at = now()
        ${opts.bumpVersion ? tx`, version = p.version + 1` : tx``}
      from prev
      where p.id = prev.id and prev.state = any(${sql.array(froms)})
        ${opts.version !== undefined ? tx`and p.version = ${opts.version}` : tx``}
      returning p.id, p.version, prev.state as from_state`;
    if (!r) return null;                                           // lost the race → caller does nothing (M5)
    await emit({ type: "plan.state", plan_id: planId, from: r.from_state, to, version: r.version }, tx);
    return r;
  });
}
```

If foundation's `emit` cannot take a transaction handle, call `emit` right after `sql.begin` resolves. Never raw-insert into `app.events`: that would bypass the SSE broadcast and the `SseEvent.parse` check (P8).

**Membership:**
- **`onJoinText(user, code)`:**
  1. Set the participant to `JOINED`.
  2. Send `T_JOIN_WELCOME {title, date}`.
  3. If a form budget exists: send `T_BUDGET_CONFIRM` (or `_NOCAP`) + `T_PREFS_ASK`, and set the stage to `BUDGET_LOCKED`. Otherwise send `T_BUDGET_ASK`.
- **`onPrefsDone(planId)`:**
  - **COLLECTING:** if the PREFS_DONE count = `party_target`, call `transition(COLLECTING→RESEARCHING)`. The winner calls `startResearch(planId)` (B) and schedules `still_looking` at +90 s.
  - **RESEARCHING:** nothing. Recompute runs when options are ready.
  - **VOTING:** enqueue `recompute` with dedupe `recompute:<planId>:<inboundEventId>`.
- **Organizer GO** (organizer only, else `T_ORGANIZER_ONLY`):
  - Needs at least 2 PREFS_DONE.
  - Fewer than 3 and not yet warned → `T_SMALL_GROUP`, and set an in-memory warned flag.
  - Otherwise trigger as above.
- **WAIT** → `T_STATUS`.

**Typing during RESEARCHING:** an in-memory interval per plan calls `safe(setTyping(true))` for every participant every `TYPING_REFRESH_MS` (from S4; default 5000). It stops when the plan leaves RESEARCHING. Losing it on restart is fine.

**`decision.ts` → `recompute(planId)`** is a due_jobs handler, which keeps heavy work off the inbound path:
1. `const { from_count, survived_count, survivors, top3 } = await computeShortlist(planId)` (B: loads options, members ≥ PREFS_DONE and not DECLINED, prefs and constraints; rates each member with only that member's prefs (P2); upserts `app.ratings`).
2. Branch:
   - **`top3.length < 3`** → `transition([RESEARCHING, VOTING] → CANCELLED)` → fan-out `T_NO_FIT`. Never say who or why.
   - **State RESEARCHING** → `transition(RESEARCHING→VOTING)`. Then:
     - write `app.bundles` for this version (every survivor with `survived=true`; `shortlist_rank` 1–3 for `top3`);
     - emit `shortlist`;
     - fan-out `T_PICKS`;
     - schedule `vote_deadline`.
   - **State VOTING, and the top3 ids differ from the current version's shortlist** → `transition(VOTING→VOTING, {version, bumpVersion:true})`. If it returns null, another recompute won, so return. Otherwise:
     - write the new version's bundles (every survivor with `survived=true`; `shortlist_rank` 1–3 for `top3`; old ballots are ignored, because they are keyed by version);
     - emit `shortlist`;
     - send `T_PICKS_REFRESH` to members who had the old version and `T_PICKS` to newcomers;
     - schedule `vote_deadline` for the new version.
   - **Unchanged** → newcomers get `T_PICKS` only.

`plan.onOptionsReady(planId)` (called by B) enqueues `recompute` with key `recompute:<planId>:options`.

**`seedDemo()` minimal** (needed for checkpoint 1; the self-check comes in T14):
1. Plan "Dinner + show", area "Westwood / Sawtelle", LA-local today (`new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date())`; Fly runs UTC), 18:30–23:00, `party_target 4`, code `DEMO_CODE` (default `4821`).
2. Create the team users from env `DEMO_TEAM`: JSON `[{phone_e164, first_name}]` (PII: Fly secrets and `.env.local` only). Lane *i*'s synthetic demo budget and prefs come from `fixtures/demo-seed.json` `members[i] = {target_pp_cents, hard_max_pp_cents, prefs}`, so B's `demo.fixture.test.ts` uses the same values.
   - Budgets go through the repo with `source 'form'`.
   - Canned prefs come from `fixtures/demo-seed.json`.
   - Stage `PREFS_DONE`.
3. Per category insert `research_runs(kind 'scout', category, status 'completed', source 'cached', idempotency_key 'seed:<planId>:<category>', creao_run_id NULL, result {cached_from_run_id, share_url})`, then load B's cached options into `app.options` with `run_id` = that row's id. Never put the fixture's real runId in `creao_run_id` (it is unique, so the second Reset would fail).
4. `transition(COLLECTING→RESEARCHING)`, then enqueue `recompute`.

**Sends happen only in the agent process** (the due_jobs poller). `pnpm seed:demo` writes rows and enqueues; it never sends.

### T8. 9:40–10:00: ballots, tally, winner (`src/plan/ballots.ts`)

**Parsing:**
- **Digits:** `1 3` → indices, deduplicated, each 1–3.
- **Free text:** `parseBallot(input, publicShortlist)`.
  - `confidence low` or `intent other` → `T_BALLOT_CLARIFY` once per version, then `T_HELP`.
  - `ask_about_others` → `T_ONLY_YOURS`.
  - `none_of_these` → empty approvals.

**Constraints are evaluated in code by B's `resolveApprovals(parse, publicShortlist, plan.time_start)`** (minutes since plan start, +24 h for times before `time_start`). It drops *i* if `show_end_est(i) > end_before`, `dinner_time(i) < start_after`, or `exclude.index === i`. Digits-only replies call it with `constraints: []`. A never re-implements it.

**Recording the ballot:**
- Upsert `app.ballots(plan_id, user_id, plan_version, approvals = bundle ids, constraints, source)`.
- Set the stage to `VOTED`.
- Fan-out `T_VOTE_TALLY {k,n}` (key suffix `k`) and emit `vote.tally`.

**Close** when every member (stage ≥ PREFS_DONE, not DECLINED) has a ballot for the current version, or when the `vote_deadline` job fires:
1. `winnerId = await computeWinner(planId, version)` (B). Non-voters approve nothing.
2. `transition(VOTING→ORDERING, {version})`. The winner then:
   - sets `chosen_bundle_id`;
   - fans out `T_WINNER {title}`;
   - enqueues `create_order` with key `order:<planId>:<v>`.

### T9. 10:00–11:00: order, holdGate, pay links, venue hook, commit, cancel

**Migration `db/migrations/004_pay_links.sql` (A, additive):**

```sql
create table app.pay_links (plan_id uuid references app.plans(id), user_id uuid references app.users(id),
  plan_version int not null, share_id text not null, amount_cents int not null, pay_url text not null,
  expires_at timestamptz not null, updated_at timestamptz not null default now(),
  primary key (plan_id, user_id, plan_version));
```

`pay_url` is a single-use bearer link to pay one's **own** share; it holds no card data. Never log it, emit it on SSE or put it in an X-ray preview. This table exists because `OrderStatus` does not return pay URLs, and `T_REPING` / `T_HOLD_GATE YES` need them later.

**`create_order` job (`order.ts`):**
1. `venue.checkAvailability(bundleId)`. If unavailable → `transition(ORDERING→CANCELLED)` + `T_NO_FIT`.
2. Build `CreateOrderRequest`:
   - `plan_ref = plans.ref`, `plan_version`;
   - `bundle: VenueBundle {bundle_key: bundle.id, date, dinner {name, address, time: dinner_time, est_high_pp_usd}, show {…, time: show_start}}`;
   - `party_size = members.length` (2–8);
   - `payer_refs` = the members' `payer_ref`s;
   - `deadline_at = now + APPROVE_WINDOW`.
3. `res = venue.createOrder(req)`.
4. `update app.plans set venue_order_id, deadlines = deadlines || {approve_at}`.
5. `transition(ORDERING→APPROVING, {version})`. **If this returns null**, the plan was cancelled while the order was in flight: call `venue.cancel(res.order_id, "plan_cancelled")` and return. Otherwise the order is orphaned.
6. For each share (map `payer_ref` → user):
   - upsert `pay_links`;
   - `gate = holdGate.check(planId, userId, version, amount)`;
   - `'link'` → `T_PAY_LINK {title, amount: usd2, deadline, url}`, stage `LINK_SENT`;
   - `'ask'` → `T_HOLD_GATE {amount: usd2}`, stage `GATED`, awaiting flag `'holdgate'`.
7. Schedule `approve_reping` (approve_at − 30 min; with `DEMO_TIMERS`, − 3 min) and `approve_deadline` (approve_at). If `VOICE_ENABLED=1`, also schedule `voice_nudge` (`voice:<planId>:<v>`, approve_at − 15 min; B registers the handler).

**Windows (our choice; PLAN fixes only the demo values):**

| Mode | Vote | Approve | Re-ping |
|---|---|---|---|
| `DEMO_TIMERS=1` | 5 min | 10 min | T-3 min |
| otherwise | 30 min | 60 min | T-30 min |

**`money/holdGate.ts`** (on the P1 allowlist; M7):

```ts
export async function check(planId: string, userId: string, planVersion: number, amountCents: number): Promise<"link" | "ask"> {
  const c = await privateConstraints.get(planId, userId);
  if (!c || amountCents <= effectiveHardMax(c)) return "link";
  await sql`insert into app.hold_gates (plan_id,user_id,plan_version,share_amount_cents,status)
            values (${planId},${userId},${planVersion},${amountCents},'pending') on conflict do nothing`;
  return "ask";
}
```

**Answers and changes:**
- **YES** → set `approved` → `T_PAY_LINK` with the stored URL.
- **NO** → set `declined` → treated as "I'm out" (T11).
- **"change budget" while APPROVING and not HELD** → after the re-parse, re-run `check`. `'ask'` → `T_HOLD_GATE`.

**`POST /venue/hook` (`venueHook.ts`):**

```ts
const raw = await c.req.text();                                   // raw bytes; never re-serialized JSON
const ev = verifyVenueHook(raw, c.req.raw.headers);               // C: skew ≤300 s, sha256 HMAC, timingSafeEqual, VenueEvent.parse; null on failure
if (!ev) return c.body(null, 401);
// dedupe: app.inbound_events ('venue', ev.event_id) → already seen → 200. Insert after dispatch succeeds.
```

Return 200 fast, then dispatch:

In this table "emit `ledger`" means `emitLedger(ev)` and "emit `counters`" means `emitCounters()`, both from C's `venueClient/ledger.ts`.

| `ev.type` | Action |
|---|---|
| `share.authorized` | 1. Stage `HELD`.<br>2. `T_HELD {amount, brand: displayBrand(data.card_brand) ?? "card", last4: data.card_last4}`.<br>3. Fan-out `T_IN_COUNT {k,n}`.<br>4. Emit `ledger`.<br>5. Enqueue `commit` with key **`commit:<planId>:<v>:<share_id>`** (one per share; see note). |
| `share.declined` | `T_DECLINED_RETRY {url: data.pay_url}` to that person only; update `pay_links`; emit `ledger` |
| `share.auth_unknown` | Emit `ledger` only (the venue sweep reverses it) |
| `share.released` | If `data.retry === true` (timeout reversal on an OPEN order): `T_DECLINED_RETRY {url: data.pay_url}`, update `pay_links`, stage `LINK_SENT`. Otherwise stage `RELEASED`. Then `ledger`. |
| `share.captured` | Stage `CAPTURED` → `ledger` |
| `order.captured` | `confirm(planId)` (idempotent) |
| `order.cancelled` | `transition(CANCELLING→CANCELLED)`. The winner fans out `T_CANCELLED` and emits `counters`. |
| `order.needs_attention` | `system:error` "capture needs attention". **No DMs.** |
| `tap.verified` | Ignore: the venue never emits it (C's `commit` emits the `tap.verify` SSE) |

`displayBrand` maps `VISA`/`visa`/`001` → "Visa", and the same for Mastercard and Amex.

**Note:** `app.due_jobs` is unique on `(kind, dedupe_key)`, and finished rows stay in the table. A single per-plan commit key would therefore swallow the last share's commit job after an early one returned "not all authorized". The exactly-once guarantee comes from the `APPROVING→COMMITTING` transition, not from the key.

**`commit` job (`commit.ts`):**
1. `ord = venue.getOrder(orderId)`. If any share is not AUTHORIZED, return.
2. `transition(APPROVING→COMMITTING, {version})`. Null → return.
3. `res = venue.commit(orderId, consentFromOrder(ord))` (C's `commit` emits `tap.signed` + `tap.verify`), then branch on `res.result`:
   - **`captured`** → `confirm(planId)`, which runs `transition(COMMITTING→CONFIRMED)`. The winner:
     - fans out `T_CAPTURED {title, amount: usd2}`;
     - emits `counters`;
     - calls `startConciergeFor(planId)`.
   - **`rejected`** → `o = venue.getOrder(orderId)`. Only if `o.status === 'OPEN'` → `cancel(planId, "commit_rejected")`. `COMMITTING`/`CAPTURED` → do nothing (`order.captured` will confirm). `NEEDS_ATTENTION` → `system:error`. A `CommitPendingError` thrown by `commit` → do nothing (wait for `order.captured`).
   - **`partial`** → `system:error`, no DMs (the venue sets NEEDS_ATTENTION).

**`cancel(planId, reason)` (`cancel.ts`):**
1. `transition([ORDERING, APPROVING, COMMITTING] → CANCELLING)`. Null → return.
2. No `venue_order_id` → `transition(CANCELLING→CANCELLED)` + fan-out `T_CANCELLED`. If `create_order` is still in flight, its step 5 cancels the orphan order.
3. Otherwise call `venue.cancel(orderId, reason)`.
   - `status === 'CANCELLED'` → `transition(CANCELLING→CANCELLED)` + `T_CANCELLED` + `counters`.
   - Otherwise wait for `order.cancelled`.
4. `cancelResearch(planId)` (B).

**`counters`**: call C's `emitCounters()` (computed from the DB) after `order.captured`, `order.cancelled`, CONFIRMED and CANCELLED.

Request details come from C's TAP docs and the VenuePort JSDoc. **A never builds TAP headers.**

### Checkpoint 1: 11:00 PM

End to end on 2 real phones: join → cached options → ballot → sandbox hold → TAP commit → capture → `T_CAPTURED`. If it is red, all three swarm it and no stretch work starts.

### T10. 11:00–11:45 PM: deadline ladder (`src/jobs/*`)

Every handler is idempotent: a unique dedupe key plus a state and version guard.

| kind | dedupe_key | due | Handler |
|---|---|---|---|
| `still_looking` | `still:<planId>` | research start + 90 s | If still RESEARCHING → fan-out `T_STILL_LOOKING` |
| `org_join_status` | `orgjoin:<planId>` | create + 20 min (demo 3) | If COLLECTING and joined < target → `T_ORG_JOIN_STATUS {k,n}` to the organizer |
| `recompute` | `recompute:<planId>:<triggerId>` (inbound event id, `options` or `seed`) | now | T7 |
| `vote_deadline` | `vote:<planId>:<v>` | `deadlines.vote_at` | If VOTING with the same version → close the vote (T8) |
| `create_order` | `order:<planId>:<v>` | now | T9 |
| `approve_reping` | `reping:<planId>:<v>` | approve_at − 30 min (demo −3) | `T_REPING {title, deadline, url}` **only to members who are not HELD**; nobody else learns who |
| `voice_nudge` (B, only if voice ships) | `voice:<planId>:<v>` | approve_at − 15 min | B |
| `approve_deadline` | `approve:<planId>:<v>` | approve_at | If APPROVING → `cancel(planId,"deadline")` |
| `commit` | `commit:<planId>:<v>:<shareId>` | now | T9 |
| `venue_sweep` | `sweep:<floor(epoch_s/30)>` | every 30 s | Skip when `VENUE_MODE=mock`. Otherwise `await callVenueSweep()` (C, `venueClient/sweep.ts`; 10 s abort). Insert the next bucket in `finally`; also insert the current bucket at boot. |

### T11. 11:45 PM–12:15 AM: "I'm out", decline, cancel plan

- **"I'm out", STOP, or holdGate NO:**
  - State ∈ {COLLECTING, RESEARCHING, VOTING} → stage `DECLINED` + `T_OUT_ACK`. In VOTING, also enqueue `recompute` (membership changed). If fewer than 2 members remain → CANCELLED + `T_CANCELLED`.
  - State ∈ {ORDERING, APPROVING} → `cancel(planId, "member_out")`. Everyone gets `T_CANCELLED`, and **nobody is named**.
  - State ∈ {COMMITTING, CONFIRMED} → `T_STATUS`. It is too late; refunds are a stretch.
- **"cancel plan"** (organizer only, else `T_ORGANIZER_ONLY`) → `cancel()`.
- **"change budget"** → set the awaiting flag to `'budget'` → `T_BUDGET_ASK`.
  - Do **not** move the stage back to JOINED: that would drop the person from member counts and trigger a recompute.
  - Allowed until that person is HELD.
  - After an order exists, it re-runs holdGate (T9) and never re-plans (PLAN §3.2).

### T12. 12:15–12:30 AM: card-number intercept hardening

`luhn.ts` unit test cases:

| Input | Expected |
|---|---|
| `4111 1111 1111 1111` | hit |
| `4111-1111-1111-1112` | miss |
| 12-digit numbers | miss |
| `call me at 3105551234` | miss |

A second test asserts that the intercept runs **before** markRead, the delegate and any logger call: the pino test transport receives no `4111`.

### T13. 12:30–1:15 AM: chat commands + `POST /plans`

| Command | Behaviour |
|---|---|
| `status` | `T_STATUS` from the phase map plus counts. No names, no budgets. |
| `receipts` | For CONFIRMED plans where the user is CAPTURED: `venue.getOrder(venue_order_id)` → their share by `payer_ref` → `T_RECEIPTS` lines with `card ••{card_last4}`. `OrderStatus.Share` has no brand. |
| `forget me` | 1. If the user is in an ORDERING/APPROVING plan, run "I'm out" first.<br>2. Send `T_FORGOTTEN`.<br>3. Delete their rows in `private_constraints` (via the repo), `preferences`, `ratings`, `ballots`, `hold_gates`, `pay_links` and `dm_routes`.<br>4. Set `users.first_name='(removed)'` and `phone_e164='forgotten:'||id`.<br>5. `releaseSeat`. |
| `remove card` | Stretch. Only if C ships `forgetPayer` → `T_CARD_REMOVED`; otherwise `T_HELP`. |
| `help` / unknown | `T_HELP` |

**`POST /plans`.** Same CORS and Fly-Client-IP rate limit as `/join` (5/min). Body: `{title, area, date, time_start, time_end, party_target, organizer:{phone_e164, first_name}}`, validated with `z.e164()`, `IsoDate`, `HHMM`, and `party_target` 2–8.
1. Upsert the organizer.
2. Insert the plan with a random 4-digit `code`; retry on a unique violation, at most 10 times.
3. Schedule `org_join_status`.
4. `join_url = ${WEB_ORIGIN}/j/${code}`, and `qr_svg = await QRCode.toString(join_url, { type: "svg", margin: 1, width: 256 })`. Use `qrcode@1.5.4` + `@types/qrcode@1.5.6`, pinned exact (verified: `toString(text, options): Promise<string>`).
5. Return `{code, join_url, qr_svg}`. The organizer joins through `/j/<code>` like everyone else.

### T14. 1:15–2:00 AM: Reset, Replay, seed self-check, seats (`src/ops/*`)

All `/ops/*` routes require `Authorization: Bearer OPERATOR_KEY`, compared with `crypto.timingSafeEqual` after a length check. Mount `cors({ origin: env.WEB_ORIGIN, allowHeaders: ["Authorization", "Content-Type"], allowMethods: ["POST"] })` before them (B's ops bar sends a preflight).

| Route | Behaviour |
|---|---|
| `POST /ops/reset` | 1. For each non-terminal plan: if `venue_order_id`, call `venue.cancel(orderId,"reset")` (reverses holds). Then `transition([COLLECTING, RESEARCHING, VOTING, ORDERING, APPROVING, COMMITTING, CANCELLING] → CANCELLED)` **with no DMs** (never touches `SHOWCASE`), and `cancelResearch(planId)`.<br>2. Free the demo code: `update app.plans set code = $new where code = $DEMO_CODE`, where `$new` is `'R'` + 3 random base36 characters. Retry on a unique violation (up to 10 times).<br>3. `seedDemo()`.<br>4. Emit `system:info "reset"`.<br>Returns `{ok}` in under 10 s; it never waits for CREAO or ratings. |
| `POST /ops/replay` | Reset, then feed `fixtures/demo-script.json` (team members' scripted texts) through the same `route()` used by `/dev/inbound`, with synthetic event ids. Replies go to the real team phones, which have texted first. PLAN does not define Replay; this is A's definition, so confirm the button with B. |
| `POST /ops/tap-test` `{kind: "tamper"\|"replay"\|"expired"\|"wrong_tag"}` | `runTapTest(kind, orderId)` from C's `venueClient/tapTest.ts`, on the most recent plan's `venue_order_id`. C refuses `replay` while an OPEN order has every share AUTHORIZED, and C's `commit` emits the SSE. **Never** triggers `cancel` (PLAN §3.2). |
| `POST /ops/live-scout` | `startLiveScoutDemo()` (B) |
| `POST /ops/release-seats` | `seats.releaseAllExceptTeam()` → `{ok, released:n}` |

**Seed check:** covered by B's `demo.fixture.test.ts` (≥3 survive at a $30 judge cap, the shortlist changes v1→v2, index 2 ends ≤ 22:00), run in `pnpm test` before every deploy. There is no runtime check: it would read constraints outside the P1 allowlist.

### T15. 2:00–2:20 AM: console events audit

- Every `emit()` goes through `SseEvent.parse` (P8).
- `lane` fires on every stage change. `amount_cents` is the share amount (null before the order); `cybs_id_short` comes from the hook.
- `xray` fires on each delegate call (`locked:true, preview:null`) and on each fan-out.

### T16. 2:20–3:20 AM: tests (§8). Then 3:20–4:00 AM: three full rehearsals before checkpoint 2.

### 4:00–7:00 AM
- Copy polish. PLAN copy is final for money and privacy, so polish only the additive copy.
- Agent avatar (S6).
- Checkpoint-2 bug fixes.
- **Rest 5:00–6:30.**

---

## 6. Mocks until teammates deliver, and how to switch

| Port / dependency | Until | Mock | Switch |
|---|---|---|---|
| `MessagingPort` | T1 (~6:30) | `MESSAGING_MODE=mock`: `POST /dev/inbound` (body shape in `src/dev/inbound.ts`), sends go to the console log | `MESSAGING_MODE=photon` + `PHOTON_*`. Keep mock mode for `pnpm sim:plan` and the Photon-down backup (PLAN §15). |
| `LLMPort` | T6 | `LLM_MODE=mock`: deterministic canned parses (foundation) | `LLM_MODE=anthropic` |
| B's pure functions | B ships them (~9 PM) | Foundation stubs: compose = first 9 combinations, filter = identity, shortlist = first 3, pickWinner = most approvals | Import from `src/decide/*` |
| `PlannerPort` / `research.*` | B's real CREAO (after 6:45) | `PLANNER_MODE=mock` (fixtures after 5 s + fake progress) or `cached` | B sets `PLANNER_MODE=live` |
| `VenuePort` | C's TAP-signed client (~10 PM) | `VENUE_MODE=mock`: in-memory venue with fake holds. To simulate a hold, use the mock's authorize helper. If it is missing, add `POST /dev/venue/authorize/:shareId` in `src/dev/` (mock mode only); it posts a correctly HMAC-signed `share.authorized` to `/venue/hook`. | `VENUE_MODE=live` + `VENUE_BASE_URL`, `TAP_*`, `VENUE_HOOK_SECRET`, `VENUE_OPS_KEY` |
| `consentFromOrder` | C ships `tap.ts` | Foundation stub | Import from `@tab/shared/tap` |

---

## 7. Integration checkpoints

| Time | With | What must work |
|---|---|---|
| **6:00** | B, C | Foundation pulled; `pnpm sim:plan` green; hook names agreed (§3.2); §3.3 list posted |
| **6:45 go/no-go** | all | S2 echo on a real phone; `PhotonMessaging.sendText` reaches a real phone; booth answers recorded |
| 7:15 | — | JOIN → `T_JOIN_WELCOME` + `T_BUDGET_ASK` on a real phone through `route()` |
| ~9:40 | B | `seedDemo` + `recompute` with B's real `computeShortlist` on cached fixtures (mock LLM) → VOTING with 3 bundles + `shortlist` in B's console |
| ~10:30 | C | `VENUE_MODE=live`: `createOrder` against the deployed `tab-venue` returns `pay_url`s; a signed `/venue/hook` `share.authorized` passes HMAC |
| **11:00 PM checkpoint 1** | all | End to end on 2 real phones through capture (above) |
| ~2:00 AM | C | Each path works:<br>• decline → `T_DECLINED_RETRY`;<br>• "I'm out" → reverse all → `T_CANCELLED`;<br>• AUTH_UNKNOWN → sweep → released → retry link;<br>• deadline → reverse all. |
| **4:00 AM checkpoint 2** | all | 4 phones (at least 1 not a team phone), 3 clean runs in a row, Reset in under 10 s |
| **7:00 AM** | all | Feature freeze |

---

## 8. Verification

### 8.1 Unit and integration tests (vitest; `pnpm test`)

Tests that need SQL semantics (race, notify, transition) run against `TEST_DATABASE_URL`: local Postgres or a separate Supabase schema, never prod data.

| Test | Asserts | Owner |
|---|---|---|
| `privacy.imports.test.ts` (P1) | `@tab/shared/private` imports and the SQL string `private_constraints` appear only on the allowlist | A (foundation may scaffold) |
| `templates.only.test.ts` (P3/P4) | `.sendText(` appears only in `src/notify/notify.ts`, plus the port and mock definitions | A |
| `llm.notools.test.ts` (P5) | Every recorded request lacks `tools`, `tool_choice`, `temperature`, `top_p` and `top_k`, and its last message role is `user` | A |
| `delegate.input.test.ts` (P2) | `buildDelegateInput` keys are exactly `user_first_name, stage, message_text` | A |
| `privacy.e2e.test.ts` (P7) | A provides the recorder hooks (LLM requests, notify texts per user, pino transport capture); B writes the test | B (A supports) |
| `holdgate.test.ts` (M7) | Share > effective max → `ask` + a `hold_gates` row; ≤ → `link`; a null hard_max uses round(target×1.10) | A |
| `statemachine.race.test.ts` (M5) | 2 concurrent `commit` jobs → exactly one `venue.commit`; 2 concurrent `cancel`s → one `venue.cancel`; 2 concurrent recomputes → one version bump | A |
| `commit.lastshare.test.ts` | 4 `share.authorized` events in order → 4 commit jobs; only the last reaches `venue.commit` | A |
| `order.cancelrace.test.ts` | "I'm out" during an in-flight `create_order` → `venue.cancel` is called on the new order | A |
| `copy.lint.test.ts` (M9) | No template contains "$0 instantly" or "Visa-verified"; `T_CANCELLED` equals the PLAN copy byte for byte | A |
| `luhn.test.ts` | T12 cases; intercept before any logger or LLM call | A |
| `router.commands.test.ts` | Each command regex routes correctly (including "I’m out" with a curly apostrophe); digits ballots parse; "change budget" keeps the stage | A |
| `ballot.constraints.test.ts` | Moved into B's `decide/ballot.test.ts` (same cases, including the `00:30` show end) | B |
| `photon.consumer.test.ts` | Fake socket:<br>• cursor saved only after success;<br>• a duplicate `event.id` is handled once;<br>• seq ≤ cursor is skipped;<br>• a stale-epoch delivery is skipped;<br>• 3× poison → skipped + system event. | A |
| `notify.idempotency.test.ts` | The same key twice → one `sendText`; a failed row → resent with the same key; no dm_route → `blocked_inbound`, no send | A |
| `venuehook.hmac.test.ts` | Bad signature → 401; skew > 300 s → 401; duplicate `event_id` → handled once | A |
| `join.test.ts` | Invalid E.164 → 422; unknown code → 404; `ASSIGNMENT_EXISTS` → adopts via list; `SHARED_LINE_CAP_EXCEEDED` → 503 `capacity` | A |

### 8.2 Smoke scripts
- `scratch/photon/{assign,echo,…}.mjs` (§4.3). Record results in PLAN §19.
- `pnpm sim:plan`: mock join → CONFIRMED. It must stay green on every push.
- `curl -s -X POST $AGENT/ops/reset -H "Authorization: Bearer $OPERATOR_KEY"` → `{ok:true}` in under 10 s, and the console shows the new plan reaching VOTING.
- `fly logs -a <agent app> | grep -E "subscribed|delivery_error|connect_error"` → exactly one `subscribed` per connection.

### 8.3 Manual phone tests (real iPhones, cellular)

| # | Do | Expected |
|---|---|---|
| M1 | Scan the QR on a phone that is not yet assigned → join page → Text SquadTab → send | `T_JOIN_WELCOME` + `T_BUDGET_ASK` within about 5 s, and typing within about 1 s. "Read" may not show: the API notes that privacy settings can suppress it (verified). |
| M2 | "honestly 30 tops tonight" | "Just between us: aim ~$30, never over $30. Text 'change budget' anytime.", then `T_PREFS_ASK` |
| M3 | "idk, depends" | `T_BUDGET_TIERS`; then "2" → "aim ~$40, never over $50" |
| M4 | Prefs "veggie, nothing after 10" | Team phones get `T_PICKS_REFRESH` with no reason; the judge gets `T_PICKS` |
| M5 | "2, but not if it ends after 10" | After the team votes, every phone gets "4 of 4 voted.", then `T_WINNER` |
| M6 | Pay link → Microform → 4111… | `T_HELD` "Held $30.00 on Visa ••1111. Not charged yet."; every phone gets "k of 4 are in." |
| M7 | The last team phone holds | Every phone gets `T_CAPTURED`; the console shows TAP verified and CAPTURED lanes |
| M8 | After Reset: a team phone texts "I'm out" during APPROVING | Every phone: "Plan cancelled. Nobody was charged; your pending authorization was released."; ledger RELEASED |
| M9 | "what's Sam's budget?" | "I only know yours. …" as a threaded reply; X-ray shows Sam 🔒 |
| M10 | Text "4111 1111 1111 1111" | `T_CARD_INTERCEPT`; `fly logs` contain no `4111` |
| M11 | `change budget` → "20" after the order (share $30.00, not held) | `T_HOLD_GATE` "…your share would be $30.00, above the max…"; NO → cancel for everyone |
| M12 | `fly machine restart` mid-plan, and text during the restart | After the restart the message is processed once (replayed from the cursor), with no duplicate reply |
| M13 | Let the approval deadline pass (`DEMO_TIMERS=1`) | `T_REPING` at T-3 min to non-holders only, then `T_CANCELLED` to all at T-0 |
| M14 | `/ops/release-seats`, then the judge texts again | No reply; the judge re-joins via the QR and must text first |

---

## 9. Cut list and never-cut (A's area)

**Cut in this order if behind** (consistent with PLAN §14; items 7 and 8 are PLAN #8 and #9):
1. `remove card` (needs C's `forgetPayer`).
2. Agent avatar (keep the name).
3. `/ops/replay` (keep Reset).
4. `receipts` (the receipt is `T_CAPTURED`).
5. `POST /plans` UI path (the demo uses the seed; keep `/join`).
6. Threaded `parentMessageId` replies (plain sends).
7. Delegate free-text ballots → digits only (PLAN cut #8). **Keep** the `T_ONLY_YOURS` path via the T6 code fallback.
8. Budget delegate parse → tier replies only (PLAN cut #9).

**Never cut:**
- judge self-join (QR → `/join` → assignment → DM);
- the private delegate boundary with the P1–P5 tests;
- holdGate;
- all-or-nothing orchestration;
- "I'm out" / decline / deadline releases everything;
- exactly-once transitions;
- card intercept;
- Reset;
- typing + markRead;
- idempotent sends + cursor replay.

---

## 10. Demo and pitch responsibilities (A drives the live demo)

**Before each judge (60 s):**
1. `/ops/reset`.
2. The console shows VOTING v1 with 3 team lanes.
3. Team phones unlocked, on cellular.
4. Spare phone ready.
5. `DEMO_TIMERS=1`.
6. QR card on the table.

**After each judge:** `/ops/release-seats`.

**Table version (PLAN §15), A's beats:**

| t | Beat |
|---|---|
| 0:20 | Zelle hook verbatim: *"According to Zelle research (June 2026), 76% of Gen Z consumers who have fronted money for a group expense, like a trip or event, say they were not fully repaid."* Then the thesis. |
| 0:45 | Guide the judge through the QR, the phone number and Text SquadTab. Prompt them to text "honestly 30 tops tonight". Point at the team phones: "the group changed, and nobody knows why." |
| 1:45 | Prompt "2, but not if it ends after 10". The team taps its votes, then the winner arrives. |
| 2:30 | Hand over to C for pay and TAP. Team phones hold with one tap. |
| 3:30 | After C's tamper: Reset → a team phone texts "I'm out" → every DM shows the "released" copy, and nobody is named. |
| 4:15 | Prompt "what's Sam's budget?" → "I only know yours." Hand over to B for the X-ray and the CREAO thread. |

**Stage version:** A runs the phones on the projector (USB mirroring) at 0:25–0:50 and 2:10–2:40.

**Q&A A answers:** PLAN §16 #2 (how private), #3 (inference), #4 (charge-Sam) and #11 (why DMs). For Photon judges: "@photon-ai/api 2.0 with a persisted Socket.IO cursor. We checked: polls and tapbacks aren't in the iMessage content union, so we don't fake them."

**Recordings (7:00–9:30):** drive the phones while B records. Re-run until no beat fails.

**Words:**
- Say: "private delegate per friend", "sealed constraints", "plain-code mechanism", "hold", "released".
- Never say: "agents negotiate", "advocates", "$0 instantly", "Visa-verified agent".

---

## 11. UNVERIFIED items (A-owned) and their smoke tests

Every item below is **UNVERIFIED — smoke-test first**. Record each result in PLAN §19.

| Item | Smoke test | Expected / fallback |
|---|---|---|
| Photon prize entry; whether `@photon-ai/api` counts as 2.0 | Booth (§4.2) | If spectrum-ts is required: keep `MessagingPort` and raise it in chat immediately |
| Dashboard URL | Booth | — |
| Agent name/avatar visible on shared lines | S6 | Name only, or neither: no change |
| Typing refresh interval | S4 | Sets `TYPING_REFRESH_MS` (default 5000) |
| Poll / reaction / text.update rejected on shared-line DMs | S5 | Expect 422 `UNSUPPORTED_CONTENT`; never used either way |
| `receivedBy` present at runtime (schema: optional) | S2 log | Fall back to the stored `dm_routes.agent_user_id` |
| `sentBy.handle` format equals the E.164 we assigned | S2 log | Lookup by `photon_user_id` first (router step 0); normalize the handle to E.164 |
| `parentMessageId` rendering on iOS | S2 | If it looks bad: drop `replyTo` (cut #6) |
| Socket.IO replay retention ("limited to retained history") | S3 + booth | Restart recovery holds for minutes; beyond that, accept the loss |
| `MESSAGE_TOO_LONG` limit (code 422 verified, limit unknown) | Booth; send an 800-character `T_PICKS` in a scratch run | Keep `T_PICKS` under 600 characters; trim pitches to 80 if needed |
| Photon idempotency-key retention window | Booth | Keys include plan id and version, so cross-plan collisions are impossible |
| Link rich previews to recipients | Send `T_PAY_LINK` after 3 or more exchanges; look on the phone | The plain-text link still works |
| `zodOutputFormat` + zod 4 `.regex()` / `.nullable()` (`Preferences`) | T6 smoke | Loosen the LLM-facing schema and validate HHMM in code (announce) |
| Haiku 5.5 `effort:"low"` latency | Time 10 `parseBudget` calls | p50 ≤ 1.5 s. Otherwise keep the typing bubble on and consider the tier-first ask. |
| iOS `sms:…&body=` prefill (B owns the page; A returns `sms_href`) | Tap on 2 iPhones | The number and `JOIN 4821` are shown in plain text anyway |
| Supavisor login with custom roles (`tab_agent.<ref>`) | `psql` with the role on the session pooler | Single role; the P1/M1 tests enforce the discipline |
| Ordering of sequential sends to one DM | Watch M1 (`T_JOIN_WELCOME` before `T_BUDGET_ASK`) | Add 300 ms between sequential personal sends |
| postgres.js errors carrying query parameters | Trigger a constraint violation in a test; inspect the error keys | Log only `err.code` and `err.message` (already the rule) |
| Fly app name `tab-agent` available | `fly apps create tab-agent` | Use `tab-agent-<team>` and update the four URLs (§4.1 #4) |

**Before every push:** `git status` shows no `.env*`, nothing under `scratch/` and no phone numbers in fixtures, and the tests are green.

---

## Verification log

### Corrections made to the draft

| # | Where | Draft said | Correction and evidence |
|---|---|---|---|
| 1 | T3 / §7 gate | JOIN through the router was due by the 6:45 gate, but T3 was scheduled 6:55–7:15 | 6:45 now requires the S2 echo plus `PhotonMessaging.sendText` on a real phone. JOIN through `route()` is gated at 7:15. |
| 2 | Timeline T4–T9 | The money spine (order, holdGate, hook, commit, cancel) got 20 min (10:40–11:00), with overflow past checkpoint 1 | T9 now has 10:00–11:00. `POST /plans` moved to T13 (the demo uses the seed). A minimal `seedDemo` moved into T7, because checkpoint 1 needs a plan. |
| 3 | T9 / T10 `commit` dedupe | `commit:<planId>:<version>` | `app.due_jobs` is unique on `(kind, dedupe_key)` and keeps done rows (PLAN §6), so the last share's commit job would be dropped after an early no-op. The key is now `commit:<planId>:<v>:<shareId>`; M5 stays guaranteed by the transition. Test `commit.lastshare.test.ts` added. |
| 4 | T7 / T10 `recompute` dedupe | `recompute:<planId>:<v>:<memberCount>` | A budget change in VOTING (PLAN §3.1 step 8) doesn't change the count, so it would be silently skipped. The key is now per trigger (`<inboundEventId>`, `options`, `seed`). Concurrent bumps are guarded by `transition(...,{version, bumpVersion})`. |
| 5 | T9 `create_order` vs `cancel` | No handling when the plan is cancelled during `createOrder` | If `ORDERING→APPROVING` loses, call `venue.cancel(orderId)` on the orphan. Test `order.cancelrace.test.ts` added. |
| 6 | T7 `transition` SQL | `state = any(${froms})` with a raw JS array; `from: String(froms)`; raw insert into `app.events` | `sql.array(froms)` (Context7 `/porsager/postgres`: `= any(${sql.array(ids)})`). The prior state comes from a `FOR UPDATE` CTE. Events go through foundation `emit()` so SSE and `SseEvent.parse` (P8) aren't bypassed. |
| 7 | T11 "change budget" | Set the stage back to the budget step | That would drop the member from `stage ≥ PREFS_DONE` counts mid-vote and trigger a spurious recompute. It now uses an awaiting flag and keeps the stage. Router step 6 added. |
| 8 | T14 reset code | `'R' || substr(md5(id),1,3)` | 4,096 values with a unique `code`: roughly a 30% collision chance over 50 resets, which would make Reset fail. Now `'R'` + 3 random base36 characters with a retry. |
| 9 | T5 `notify` | `on conflict do nothing`: a failed send is never retried | Upsert reclaims rows that are not `accepted`/`blocked_inbound` and resends with the **same** Photon key (Photon deduplicates; `Idempotent-Replayed`, verified in the retries doc). |
| 10 | T2 consumer | No epoch guard; ack `ok` not checked; `received_at = event.timestamp`; 20 s timeout | Added the official example's epoch guard (`beta/websocket/example`). The ack's `ok`/`error` is checked (AsyncAPI). `received_at` = `obj.timestamps.receivedAt`, "preserved across replay" (OpenAPI). The timeout is 45 s to fit worst-case LLM plus send retries. |
| 11 | T1 / T6 client config | Photon default retries (3 × 30 s); Anthropic `timeout 15_000, maxRetries 2` | Photon `timeoutMs 10_000, retry {maxAttempts: 2}` (SDK README options). Anthropic `timeout 10_000, maxRetries 1` (TS timeout is ms; skill). Typing and markRead are fire-and-forget. |
| 12 | T6 delegate request | `max_tokens: 1024`; sampling not mentioned | Haiku 5.5 runs adaptive thinking by default and thinking shares `max_tokens`, so it is now 2048. Added "no temperature/top_p/top_k" (non-default sampling → 400 on Haiku 5.5 and Sonnet 5.5; skill thinking table). The P5 test asserts it. |
| 13 | §8.3 M11 | "your share would be $30" | `T_HOLD_GATE` uses `usd2` → "$30.00". `usd0` (floor) and `usd2` are now defined explicitly. |
| 14 | T13 receipts | "Visa ••1111" | `OrderStatus.Share` has `card_last4` but no brand (PLAN §8). Now "card ••1111". |
| 15 | T13 forget me | Kept `phone_e164` | It is now scrubbed to `'forgotten:'||id`; `T_FORGOTTEN` is sent before `dm_routes` is deleted. |
| 16 | T2 deliveries | Every `message.*` delivery mapped to a lane | setTyping and markRead return action Messages (OpenAPI descriptions, verified), so unmapped ids are ignored. |
| 17 | T3 user lookup | By phone only | Lookup by `photon_user_id` first (column exists in PLAN §6), then by phone. The handle format is UNVERIFIED. |
| 18 | T8 time comparisons | Plain string compare | Times are compared as minutes since plan start, with +24 h for post-midnight times. |
| 19 | T7 seed | The seed script sends `T_PICKS` | The script only writes rows and enqueues `recompute`; the agent sends. `research_runs.idempotency_key` includes the planId (column is unique). |
| 20 | T10 `venue_sweep` | Self-rescheduling with no bootstrap or failure path | Bootstrap at boot, insert the next bucket in `finally`, 10 s abort, skip in mock mode. |
| 21 | §3.3 | No P1 clarification for `decision.ts` | Added item 5: decision and ballots pass constraints through, with no type import. Raise at 6:00. |
| 22 | §3.3 | — | Added the venue requirement that TAP steps run before order-state checks, so tap-test works on a captured order (demo beat 3:30). |
| 23 | §4.1 Fly | `tab-agent.fly.dev` assumed | Fly app names are global, so a fallback name and the list of URLs to update were added. |
| 24 | T9 pay_links | — | Marked as a bearer secret: never logged, emitted or previewed. |
| 25 | §8.1 | DB-semantics tests unspecified | They run on `TEST_DATABASE_URL`. |
| 26 | S5 / §9 | S5 mandatory; cut list lacked `/plans` | S5 is optional. `POST /plans` added as cut #5. |
| 27 | Legend | ✅ markers | Replaced with "(verified)" and the exact tag "UNVERIFIED — smoke-test first". |

### Confirmed in this session (no change needed)

- **npm registry versions:**
  - `@photon-ai/api@0.5.0` (published 2026-10-16; engines node ≥22; dep `zod ^4.6.5`);
  - `socket.io-client@4.8.4`;
  - `@anthropic-ai/sdk@0.135.0` (peer `zod ^3.25 || ^4`);
  - `hono@4.13.13`, `@hono/node-server@2.1.5`;
  - `zod@4.6.7`, `postgres@3.4.9`, `pino@10.4.0`;
  - `qrcode@1.5.4`, `@types/qrcode@1.5.6`.
- **Photon SDK** (`dist/schemas.d.ts`, `rpc.generated.d.ts`, README):
  - Operations: `projects.sendMessage`, `setSpaceTyping`, `markMessageRead`, `platforms.imessage.assignments.{create,list,release}`, `agentProfile.{update,createAvatarUpload,commitAvatar}`.
  - Header casing as stated; `path.projectId` for agentProfile.
  - `ApiError.body`, the `timeoutMs` and `retry` options, and the retry rules.
  - Base URL `https://api.photon.codes`.
- **Photon OpenAPI:**
  - Problem codes and statuses in the T1 table; idempotency-key pattern `^[\x21-\x7e]{1,255}$`.
  - The shared-line send rule quote; `release` = `DELETE …/assignments/{assignmentId}` → 200, repeat-safe; `list` → `{assignments[], nextPageToken?}`.
  - The iMessage content union; `SendContent` includes poll, reaction and text.update.
  - The `ReceivedImessageMessage` fields, with `receivedBy` optional.
  - The event envelope `{id,type,apiVersion:"2026-07-01",source,timestamp,data:{projectId,object}}`.
  - Avatar upload steps (fields, then file last, no credentials).
- **Photon AsyncAPI and beta docs:**
  - `subscribe {startSeq, apiVersion?}`, `delivery(event,{seq,replyExpected})`, and the `delivery_error` fields and codes.
  - Cursor semantics ("do not add one", persist after success, retained-history limit); session recovery disabled; re-subscribe after reconnect.
  - `sentBy.kind "human"`, `receivedBy.kind "agent"`, `space.kind "direct"`.
- **Anthropic (claude-api skill + unpkg):**
  - `messages.parse`, `zodOutputFormat` at `@anthropic-ai/sdk/helpers/zod`, `output_config.{format,effort}`, `parsed_output` null on failure.
  - Refusal stop reason; no prefill; forced `tool_choice` → 400 on 5.5 models.
  - Model ids `claude-haiku-5-5` / `claude-sonnet-5-5`; Haiku 5.5 effort default `medium`, Sonnet 5.5 `high`; TS timeout in ms.
  - Unsupported schema constraints are stripped and validated client-side.
- **zod 4.6.7:** `z.e164()`, `z.strictObject`, `z.looseObject` exist.
- **Hono 4.13.13:** `cors({origin: string})` from `hono/cors`.
- **postgres.js (Context7):** `sql.begin(async sql => …)`, conditional fragments `sql\`\``, `sql.array`, `sql.json`.
- **qrcode:** `toString(text, {type:"svg", margin, width}): Promise<string>`.
- **Fly:** the `Fly-Client-IP` request header is documented.

### Left UNVERIFIED (each has a smoke test in §11)

- **Booth and docs questions:** Photon prize entry and SDK eligibility; dashboard URL; replay retention; the `MESSAGE_TOO_LONG` limit; idempotency-key retention.
- **Shared-line and iOS behaviour:** agent name/avatar on shared lines; typing refresh interval; poll/reaction/text.update rejection codes; `parentMessageId` rendering; link rich previews; send ordering; iOS `sms:&body=` prefill.
- **Runtime payload shape:** `receivedBy` presence at runtime; `sentBy.handle` format.
- **Anthropic:** `zodOutputFormat` with `.regex()`/`.nullable()`; Haiku 5.5 low-effort latency.
- **Infrastructure:** Supavisor custom-role login; postgres.js errors exposing parameters; Fly app-name availability.
