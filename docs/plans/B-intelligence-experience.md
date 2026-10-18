# B: Intelligence and experience. Build plan (Claude-Code-ready)

**Owner:** B. **Written:** Sat Oct 17, 4:25 PM PDT. **Code stops:** Sun 12:00 PM. No deploys after 11:30 AM.

**Read order:**
1. `docs/PLAN.md`: contracts §8, ports §9, API facts §10, env §11, UNVERIFIED register §19.
2. This file.
3. `CLAUDE.md`.

If this file conflicts with PLAN.md, PLAN.md wins. Raise the conflict in team chat.

**Tags used here:**
- **VERIFIED (source):** checked today against the named primary source.
- **UNVERIFIED — smoke-test first:** do not build on it until its §11 smoke test passes. Record each result in PLAN §19.

---

## 1. Context and goal

Tab's thesis: *"Say no without saying why. Nobody pays until everyone's in."* B owns four areas:
- **Open-world intelligence:** CREAO Tab Scout and Tab Concierge.
- **Plain-code mechanism:** compose, filter, Nash shortlist and winner.
- **Evidence surfaces:** the join page and the Trust Console.
- **Submission:** README, Devpost and video.

| Prize | What B's work earns | Rubric lines B carries |
|---|---|---|
| CREAO Best AI-First Disruptor ($2,000) | Scout produces every option the group can vote on ("Remove the agent and Tab has nothing to vote on"). Concierge writes the itinerary, the .ics and the Notion page. All three CREAO modes are used: API Trigger + webhook, our own skill/CLI, and our service via Secrets. The validate/fix loop is visible in the [API] thread. | AI as foundation 30, Depth 25, Originality 20, Track fit 15, Demo 10 |
| Main track / Overall | The filter is a pipeline step no LLM can call. Nash shortlist. The value-specific privacy test (P7). A console that shows privacy holds by construction. | Technical Depth; Execution & Polish |
| Visa ($2,000) | Console ledger, TAP panel, three merchant counters. The discovery → decision → personalization stages. | UX 25, Commerce Impact 15 |
| Photon iMessage | Join page (a judge is in a DM within ~60 s); delivery lane on the console | Traction, Craft |
| Photon Voice + MLH ElevenLabs (stretch, gated) | Outbound nudge to the last holdout | Voice criteria |
| Required for every prize | README, Devpost text, 2–3 min video | Devpost "What to Submit" (VERIFIED: devpost.txt) |

---

## 2. What you own and what you must NOT touch

**You own these paths (create and edit freely):**

| Path | Contents |
|---|---|
| `apps/agent/src/creao/` | `client.ts` (CreaoPlanner implements PlannerPort), `brief.ts`, `research.ts` (start/reconcile/timeout/cached), `hook.ts` (`/creao/hook/:secret`), `concierge.ts`, `notionFallback.ts`, `ics.ts`, `xray.ts`, `liveDemo.ts` |
| `apps/agent/src/decide/` | `config.ts`, `compose.ts`, `fitsPrefs.ts`, `filter.ts`, `score.ts`, `ballot.ts`, `rateCandidates.ts` + `*.test.ts` |
| `apps/agent/src/agentApi/` | `/agent/*` routes, `/p/:planRef/itinerary`, `/p/:planRef/plan.ics` |
| `apps/agent/src/voice/` | Stretch only: ElevenLabs outbound + `/voice/hook` |
| `apps/agent/fixtures/cached-options/*` | Real Scout snapshots. You own the content; the format is the foundation's. |
| `apps/agent/test/privacy.e2e.test.ts`, `apps/agent/test/brief.schema.test.ts` | P6/P7 tests |
| `apps/web/**` | `/` (create plan), `/j/[code]` (join), `/console` |
| `skills/tab/**` | `SKILL.md`, `tab` (Python 3 stdlib CLI), `schema/*.json`, `test_tab.py` |
| `README.md`, `docs/devpost.md`, video files (not in git) | Submission |

**Shared files. Edit only after announcing it:**
- `packages/shared/src/pricing.ts`: only the `TAX` constant, and C must ack (§3.3, C-3).
- `packages/shared/src/index.ts`: additions only, always announced. After 11 PM, additions only.
- `apps/agent/src/ports/llm.anthropic.ts`: you implement `rateBundles` and `repairScoutJson`. A owns the other three methods. Ping A.
- `apps/agent/src/index.ts` (foundation): the one place routes are mounted and due_jobs kinds are registered. Add your mounts in one announced PR (§5 T2).

**Never touch:**
- `apps/venue/**` and `apps/agent/src/{tap,venueClient}` (C).
- `apps/agent/src/{photon,router,delegates,plan,notify,jobs,join,ops}` (A). Call their exported functions and ask before editing.
- `src/repo/privateConstraints.ts`: read it only through its exported function.
- Never call `MessagingPort.sendText`. Use `notify()` (P3).
- Never import `@tab/shared/private` outside `decide/filter.ts` and `decide/score.ts` (P1). This includes **test files**. Build test constraint objects as plain literals typed through `Parameters<typeof filter>[1]`, so the P1 import test never sees a test-file import.
- Never put `CREAO_API_KEY` anywhere except a Fly secret (S1). Never put card data, budgets or names into CREAO inputs (P6).

---

## 3. Interfaces

### 3.1 You consume

| From | Contract (PLAN.md name) | Use |
|---|---|---|
| Foundation | `PlannerPort`, `LLMPort` + mocks (§9). `emit()` → `app.events` → `SseEvent` (§8). The due_jobs registry. `repo/privateConstraints.ts`. | Implement the real adapters. Emit `creao.run`, `creao.progress`, `shortlist` and `xray`. |
| Foundation | `priceBundle()` (`packages/shared/src/pricing.ts`) | `compose()` prices bundles with it |
| A | `notify(userId, TemplateId, vars)` | `T_STILL_LOOKING`, `T_ITINERARY`, and `T_NO_FIT` if A delegates it |
| A | A typing helper, e.g. `setTypingFor(userId)`, using the stored `dm_routes` address | `research_typing` job. Agree the name at 8:45 PM. |
| A | Plan state machine hooks | You call `onResearchReady(planId)` / `onResearchFailed(planId)`. A calls your `startResearch(planId)` and `runWinner(planId, version)`. Names are agreed at the 8:45 PM checkpoint (§7). |
| A | `POST /join`, `POST /plans`, `GET /events?k=`, `GET /events/snapshot`, `POST /ops/*` (§18) | Web pages and console. **CORS:** `/ops/*` must allow `POST` plus the `Authorization` and `Content-Type` request headers from `WEB_ORIGIN` (it needs a preflight). Raise this with A at 10:15 PM. |
| C | SSE events `tap.signed`, `tap.verify` (`TapVerifyReport`), `ledger`, `counters` | Console TAP panel, ledger and counters |

### 3.2 You provide

| Contract | Provided by | Consumer |
|---|---|---|
| Real `PlannerPort` (`startScout`, `startConcierge`, `getRun`, `cancel`, `downloadArtifact`) | `src/creao/client.ts` | `research.ts`, `concierge.ts` |
| `LLMPort.rateBundles(prefs, PublicBundle[]) → Ratings` (claude-sonnet-5-5, effort low) and `repairScoutJson(raw, category)` (claude-haiku-5-5) | `src/ports/llm.anthropic.ts` | `score.ts` orchestrator, `research.ts` |
| `/agent/ping`, `/agent/progress` (`AgentProgress`), `/agent/options/validate` and `/agent/options` (`ScoutSubmission` → `ValidationResult`), `/agent/itinerary` (`Itinerary`) | `src/agentApi/` | `tab` CLI in the CREAO sandbox |
| `POST /creao/hook/:CREAO_HOOK_SECRET` | `src/creao/hook.ts` | CREAO |
| `compose`, `fitsPrefs`, `filter`, `shortlist`, `pickWinner`, `resolveApprovals` | `src/decide/*` | A (ballot wiring, winner) |
| `startResearch(planId)`, `runShortlist(planId, version)`, `runWinner(planId, version) → bundleId`, `startConciergeFor(planId)`, `startLiveScoutDemo()` | `research.ts`, `score.ts`, `concierge.ts`, `liveDemo.ts` | A's state machine and `/ops/live-scout` |
| `GET /p/:planRef/itinerary` (HTML), `GET /p/:planRef/plan.ics` | `src/agentApi/` | `T_ITINERARY` links |
| Web: `/`, `/j/[code]`, `/console?k=` | `apps/web` | users, judges |

### 3.3 Contract notes. Raise them at the 6:00 PM foundation pull; decide by 6:45

- **C-1. `PublicBundle.index` is `max(3)`, but ratings run over up to 15 candidates.**
  - The limit is runtime-only. `z.infer<typeof PublicBundle>['index']` is `number`, and `Ratings` has no max. So pass the up to 15 candidates **in one call** with indices 1..15 and **never** `.parse()` them as `PublicBundle`. No chunking is needed.
  - Proposal for type clarity (additive, before 11 PM): `export const RateCandidate = PublicBundle.extend({ index: z.number().int().min(1).max(20) })`, with `rateBundles(prefs, bundles: RateCandidate[])`.
- **C-2. PLAN's `filter(bundles, constraints)` signature has no prefs.**
  - Dietary and time-window checks go in a separate pure `fitsPrefs(bundles, prefs[])`, which touches no private data.
  - The orchestrators that need constraints (`runShortlist`, `runWinner`) live **inside `score.ts`**. That file is already on the P1 allowlist, so the allowlist does not change.
- **C-3. `TAX` must change from `0.0975` to `0.1025`.**
  - Evidence (VERIFIED today, PDF text extracted): CDTFA Special Notice L-1037 (August 2026), "New Sales and Use Tax Rates Effective October 1, 2026". The countywide table reads "County of Los Angeles B47 D29 9.750% 10.250%" and "applies within the unincorporated area of the listed county and within any incorporated city…" that has no own district rate change.
  - The City of Los Angeles (Westwood, Sawtelle, UCLA) is not in the notice's per-city list. Its current rate equals the county's 9.75%, so the new rate is 10.25%.
  - Remaining check (2 min): use the CDTFA "Find a Sales and Use Tax Rate by Address" tool for `325 Westwood Plaza, Los Angeles, CA 90095`. The notice says new rates are searchable from Oct 1, 2026.
  - Then: PR the one-line change, get C's ack (it changes venue prices), re-run the fixture tests, and record the result in PLAN §19 before 11 PM.
- **C-4. Voice (only if go):** a call summary sent to a user must be a **template** (P4). Add `T_VOICE_RECAP_IN`, `T_VOICE_RECAP_OUT` and `T_VOICE_RECAP_LATER` (additive; A writes the copy). Never forward ElevenLabs' LLM summary text.
- **C-5. Itinerary storage:** there is no itineraries table. Store the `Itinerary` in the concierge run's `app.research_runs.result` under the key `itinerary`. Store the raw CREAO run result under the key `creao`, so reconcile never overwrites the itinerary. No migration is needed.
- **C-6. Snapshot shape:** A decides the `/events/snapshot` auth (`?k=`) and response shape. Proposed: `{ last_id: number, events: { id: number, data: SseEvent }[] }`. Agree with A at 10:15 PM.
- **C-7. New env var (additive):** `AGENT_API_ALLOW_TEST_REF` (default `0`). Add it to `.env.example` and announce it.
- **C-8. Reset (ask A):** `/ops/reset` and `seed:demo` must create plans with a **new** `plans.ref` each time. Scout idempotency keys contain `planRef`, so reusing a ref would make CREAO replay old runs.
- **C-9. Live Scout showcase plan (ask A):** `seed:demo` also creates a separate "Live Scout showcase" plan row with the demo plan's area, date and times. Its state is never advanced. `startLiveScoutDemo()` runs against **its** `plan_ref`, so the CLI's active-run lookup can never confuse the showcase run with a real plan's run. Fallback: `liveDemo.ts` creates the row lazily through a small repo function.

---

## 4. Before the foundation lands (4:25–6:00 PM)

### 4.1 Accounts and setup (4:25–4:45)

| ☐ | Item | Exact steps |
|---|---|---|
| ☐ | CREAO dedicated hackathon account | Sign up at agent.creao.ai through the "Register here" hackathon link (creao.md). At the booth, give the account email for the Pro Plus upgrade (creao.md: "send your account email to the CREAO booth"). |
| ☐ | `capi_` account key | Settings → API Keys. An account key runs any of your agents (VERIFIED creao.md). Send it to Claude's operator out-of-band for the `CREAO_API_KEY` Fly secret. Never put it in chat logs or git. |
| ☐ | `TAB_AGENT_TOKEN` | `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. The same value goes in CREAO Secrets and in the Fly secret. |
| ☐ | CREAO Secrets (sidebar → Secrets → **Add secret**) | Add `TAB_API_BASE` (your scratch tunnel URL for now, §4.4; switch it to `https://tab-agent.fly.dev` at 6:00) and `TAB_AGENT_TOKEN`. **Nothing else.** Names allow only uppercase letters, digits and `_`. They appear as env vars with the same names (VERIFIED docs.creao.ai/features/secrets: "available as `process.env.SECRET_NAME`… `os.environ[...]`"; "scoped to your account"; "injected into every agent sandbox session". The docs don't mention API runs → U4). |
| ☐ | Notion | Create a workspace page **"Tab Plans"**. In CREAO: Skills page → **Connectors** tab → Notion → **Connect** (OAuth) (VERIFIED features/skills-and-connectors). For the code fallback: create an internal integration, copy its token to `NOTION_TOKEN`, add the integration to "Tab Plans" through the page's ••• → Connections, and copy the page id to `NOTION_PARENT_PAGE_ID`. |
| ☐ | Agent autonomy | Leave each agent's autonomy at **"Auto (default)"**. With "Ask first", refused writes in API runs appear as "Action blocked" under "Pending approvals" (VERIFIED features/agents). |
| ☐ | Devpost | Create the team on la-ai-hackathon-2026.devpost.com (VERIFIED: devpost.html links). Invite A and C, and confirm all three are admitted. |
| ☐ | Vercel `tab-web` | In C's Vercel team: New Project → import the main repo once A creates it → Root Directory `apps/web`. Claim the name now, so `https://tab-web.vercel.app` (or whatever Vercel assigns) is fixed. DM the origin to A for `WEB_ORIGIN`. |
| ☐ | Applied Intelligence track text | Read live.lahacks.com/tracks while logged in and paste the text into `docs/devpost.md`. |

### 4.2 Booth questions you own (answers into PLAN §19 by 6:45)

**CREAO**
1. Can we enter only Disruptor, or also Team Empowerment? We assume Disruptor only.
2. Do Secrets and GitHub-installed skills load inside API-triggered runs?
3. Can the README share link be an [API] run thread we choose?
4. How many credits does a research run cost, and can we get a top-up for rehearsals?
5. Can Notion page **creation** run unattended in API runs? (The docs only say "Read and update pages".)
6. Is there a rate limit for `capi_` account keys?

(`POST /api/v1/runs`, `idempotencyKey` and `/cancel` are on the hackathon Tech Stack page, creao.md, which is authoritative. Smoke tests S1–S5 settle them faster than a booth question.)

**Organizers / Devpost**
1. What is the official Applied Intelligence text?
2. What are the requirements for Paper Best Designed Hack, Intuit and MLH ElevenLabs?
3. Can a submission be edited after a first submit, before noon?

**Photon (voice only)**
1. Do hackathon credits cover an SMS number and voice minutes? The Free plan includes no voice minutes; voice costs $0.013/min (judge_panel, from beta_billing.md).

### 4.3 Build Tab Scout in the CREAO UI (4:45–5:45)

CREAO saves agents only in the UI ("Saving is done in the agent.creao.ai interface; the API only runs agents", creao.md).

**Step 1. Install the skill first (§4.4).** Skills page → paste the GitHub URL in the sidebar input → **Install**. The repo (or subfolder) must contain `SKILL.md` with frontmatter `name` (lowercase, digits, hyphens) and `description` (VERIFIED features/skills-and-connectors).
- Before 6 PM, install from the public spike repo `github.com/<you>/tab-skill`.
- From 7 PM, install from `https://github.com/<org>/<repo>/tree/main/skills/tab`. The docs explicitly allow subdirectory URLs (VERIFIED: their example is `…/tree/main/skills/data-cleaner`).

**Step 2. Open a new chat and paste exactly:**

```
I want to build a reusable research agent named "Tab Scout". It will be run from an API with exactly three text inputs, named exactly:
- plan_ref: an opaque UUID. Never interpret it; pass it to the tab CLI unchanged.
- category: either "dinner" or "show" (make this a dropdown).
- brief: a JSON string like {"category":"dinner","area":"Westwood / Sawtelle","date":"2026-10-17","time_window":{"start":"18:30","end":"23:00"},"party_size":4,"dietary_tags":["vegetarian"],"vibe":["casual","lively"],"price_tiers":["<$25","$25-50","$50+"],"count_per_tier":4}

Job: find real, currently operating options in brief.area on brief.date (America/Los_Angeles time).
- category "dinner": restaurants open at time_window.start and for at least 90 minutes after it, that can seat party_size, ideally fitting every dietary tag.
- category "show": live shows or events (comedy, music, theater, film screenings, free events all count) that start between 90 and 150 minutes after time_window.start and end before time_window.end.
For EACH of the 3 per-person price tiers (before tax and tip) find count_per_tier options (12 total; at least 6 is acceptable if the area is thin). For the "<$25" tier prefer genuinely cheap or free options.

Every option needs: category, name, address, area (copy brief.area exactly), url (official site or listing), price_tier (one of the three strings), est_low_pp_usd and est_high_pp_usd (integers per person, high >= low; est_high is the realistic high, be conservative), price_evidence_url (a page that shows prices or a menu), dietary_fit (only tags from brief.dietary_tags you actually verified), pitch (one friendly sentence, max 140 characters, no prices, no URLs, no emojis).
- dinner adds: opens, closes (24h HH:MM, the hours on brief.date), hours_evidence_url.
- show adds: show_start, show_end_est (24h HH:MM), showtime_evidence_url.
If you cannot find evidence for a required field, drop that option instead of guessing.

Use the installed "tab" skill exactly like this:
1. Run: tab ping
2. At each research step run: tab progress --plan <plan_ref> --kind scout --category <category> "<short step, no URLs, max 140 chars>"
3. Write options.json as {"plan_ref": <plan_ref>, "category": <category>, "options": [...]} (run "tab schema options" to see the exact schema).
4. Run: tab options validate options.json. If it prints errors, fix exactly those fields and validate again (at most 5 rounds).
5. When validation passes, run: tab options submit options.json
6. Finish by replying with ONLY the contents of options.json inside one ```json block.

Rules: never ask questions; never contact, book, buy from or log in to any venue or site; never save memories; never print or echo environment variables or secrets; use only public web information.

Test it now with plan_ref=00000000-0000-4000-8000-000000000000, category=dinner and brief={"category":"dinner","area":"Westwood / Sawtelle","date":"2026-10-17","time_window":{"start":"18:30","end":"23:00"},"party_size":4,"dietary_tags":["vegetarian"],"vibe":["casual","lively"],"price_tiers":["<$25","$25-50","$50+"],"count_per_tier":4}
```

**Step 3. Iterate in the same chat** until `validate` passes and `submit` returns ok.
- The test ref `000…000` is accepted only while `AGENT_API_ALLOW_TEST_REF=1` (§5 T2). The stub accepts anything before 6 PM.
- Then ask in the chat:
  - "Run `python3 --version` and tell me the output." (Python 3 in the sandbox is UNVERIFIED, U6.)
  - "Copy the tab script and its schema/ folder into the workspace as ./tab and ./schema, make ./tab executable, and run ./tab ping."
- Files inside the workspace are saved with the agent; files outside it are not (VERIFIED pro/agent-runtime-environment). This is mode B (saved CLI).

**Step 4. Click Create Agent** (the button is in the chat input bar; VERIFIED features/agents).
- Output format: **Markdown**. The options are Dashboard, Markdown and Html (VERIFIED).
- Instructions field: paste the "Rules" paragraph and steps 1–6 again.
- After the agent is created, open its page and confirm:
  - The input form shows exactly `plan_ref`, `category` (dropdown dinner/show) and `brief`. If the names differ, fix them by chat (Update Environment) **before** any API call. The docs say fields are "generated automatically from the original prompt" (U7).
  - Default model: pick the fastest model that passed the test, and write its name in §11. (`chatModelId` can also be set per run in the API body (creao.md), but the model id strings are unknown, so don't use it.)
  - If a memory setting is visible, turn it off.
- Copy the **agent ID** (shown on its page, per creao.md) into `CREAO_SCOUT_APP_ID`.

**Step 5. Update Environment.** The button is top-right on the agent detail page. In that chat, confirm `./tab ping` works, then click **Save to Agent** in the blue banner. VERIFIED pro/agent-runtime-environment: it saves pip packages, global npm packages, system tools, and scripts and files in the workspace.

### 4.4 Throwaway spikes in `scratch/creao/` (git-ignored)

- **Skill spike:** create the public repo `tab-skill` with `SKILL.md`, `tab` and `schema/` from §5 T3 (copy them verbatim). Install it (§4.3 step 1).
- **Stub server** `scratch/creao/stub.mjs` (node:http, no dependencies, port 8787):
  - Accepts the five `/agent/*` routes.
  - Checks the Bearer token, logs the body (it is PII-free) and returns the PLAN §8 response shapes.
  - On the first call, `validate` returns `{ok:false, errors:[{path:"options.0.url", message:"Invalid URL"}]}`; after that it returns ok. This exercises the fix loop.
- **Tunnel:** install with `winget install Cloudflare.cloudflared` (the winget manifest exists, VERIFIED microsoft/winget-pkgs), then run `cloudflared tunnel --url http://localhost:8787` (VERIFIED Cloudflare TryCloudflare docs). Put the printed `https://…trycloudflare.com` URL into the `TAB_API_BASE` Secret until 6:00. Fallback: inspect webhooks only, at webhook.site.
- **Curl smoke file** `scratch/creao/smoke.sh`: run §8.2 S1–S6 with the Scout appId as soon as it exists (5:45–6:00).

---

## 5. Step-by-step tasks after the foundation (6:00 PM →)

Each task lists its time box, files, exact calls and a sketch.

### T1 (6:00–6:10) Pull and verify the foundation

- Run `pnpm install && pnpm typecheck && pnpm test && pnpm sim:plan`.
- Confirm that `PlannerPort` / `LLMPort` / `SseEvent` / `ScoutSubmission` / `Itinerary` match PLAN §8–9 verbatim. Raise C-1..C-9.
- Run `pnpm why zod`. It must show exactly one version (4.6.7). `zodOutputFormat` imports `zod/v4` through the SDK's peer dependency and must resolve to the same copy as `@tab/shared`. If two copies show up, ask the foundation to pin zod exactly in every package.
- Run `pnpm --filter ./apps/agent exec node -e` with a one-liner that selects one `app.plans` row. Confirm that `event_date` comes back as a JS `Date` and `time_start` as a `"HH:MM:SS"` string. postgres.js 3.4.9 parses OID 1082 (date) into `Date` and leaves `time` as a string (VERIFIED `src/types.js`). `brief.ts` and `compose.ts` normalize both (T7).
- Set Fly secrets (or DM Claude's operator): `CREAO_API_KEY`, `CREAO_SCOUT_APP_ID`, `CREAO_HOOK_SECRET` (32+ random chars), `TAB_AGENT_TOKEN`, `PLANNER_MODE=mock`, `AGENT_API_ALLOW_TEST_REF=0`, `NOTION_TOKEN` and `NOTION_PARENT_PAGE_ID`.
- Switch the CREAO Secret `TAB_API_BASE` to `https://tab-agent.fly.dev`.

### T2 (6:10–6:35) `/agent/*` API: `apps/agent/src/agentApi/routes.ts`

Hono 4.13.13: `app.get/post`, `c.req.header()`, `c.req.json()`, `c.json()`. Body limit: `bodyLimit({ maxSize: 256 * 1024, onError: c => c.json({ok:false}, 413) })` from `hono/body-limit` (VERIFIED Context7 /honojs/website). Export one `agentApiRoutes` Hono instance. Ask the foundation owner to `app.route("/", agentApiRoutes)` and the same for `creaoHookRoutes` in `src/index.ts`, and to register your due_jobs kinds (T5).

```ts
import { createHash, timingSafeEqual } from "node:crypto";
const h = (s: string) => createHash("sha256").update(s).digest();
export const safeEq = (a: string, b: string) => timingSafeEqual(h(a), h(b)); // equal-length digests
const authed = (c: Context) => {
  const a = c.req.header("authorization") ?? "";
  return safeEq(a.startsWith("Bearer ") ? a.slice(7) : "", env.TAB_AGENT_TOKEN);
};
// Active-run check (PLAN §8): plans.ref = plan_ref AND research_runs.status IN ('pending','running')
//   AND started_at > now() - interval '20 minutes' AND kind matches (run_kind 'scout' ⇒ kind IN ('scout','scout_live_demo'))
//   AND (for scout) research_runs.category = body.category. Else 403.
// Exception: plan_ref '00000000-0000-4000-8000-000000000000' when env.AGENT_API_ALLOW_TEST_REF === '1'
//   → validate runs normally; submit/progress return success but persist nothing. Default OFF; off in the demo.
```

| Route | Behaviour |
|---|---|
| `GET /agent/ping` | Auth only, no active-run check → `200 {ok:true}`. Log `agent.ping` (no headers). |
| `POST /agent/progress` | Bad token → 401. `AgentProgress.parse`. Strip control chars from `step` (`/[\u0000-\u001f\u007f]/g`). Keep an in-memory per-run counter (1 machine); past 60 → `429`. `emit({type:"creao.progress", run_id: creao_run_id ?? null, kind, category, step})` → `202 {ok:true}`. |
| `POST /agent/options/validate` | `ScoutSubmission.safeParse` + business checks → `200 ValidationResult`. Each error is `{path: issue.path.join("."), message}`. |
| `POST /agent/options` | Same validation. On failure → `422 ValidationResult`. Otherwise upsert into `app.options` → `201 {ok:true, accepted:n}`. Option id = `'opt_' + sha1(category\|name\|address).slice(0,10)`. If the run is `scout_live_demo`, store the options only in `research_runs.result` (never in `app.options`). Otherwise enqueue `checkResearchReady` (T5). |
| `POST /agent/itinerary` | `Itinerary.safeParse`, plus `ics` must contain `END:VCALENDAR` and `BEGIN:VEVENT` → store in the active concierge run's `result.itinerary` → `201 {ok:true, itinerary_url, ics_url}`. Then call `notify(userId,"T_ITINERARY",{itinerary_url, ics_url})` for each participant. Idempotent: A's `tpl:<planId>:<userId>:T_ITINERARY:<version>` key ensures each user gets it once. |

**Business checks** (beyond zod):
- `body.category === every option.category`, and it matches the run's category.
- `norm(option.area) === norm(plan.area)`, where `norm` = lowercase, trimmed, whitespace collapsed.
- `est_high_pp_usd >= est_low_pp_usd` (the PLAN refine).
- No duplicate `name|address`.
- `pitch` is sanitized: URLs and control chars stripped, ≤140 chars.

**Gate prep (6:35):**
1. Set `AGENT_API_ALLOW_TEST_REF=1`.
2. Start one Scout run by curl (§8.2 S1).
3. Confirm `agent.ping` and a validate call in `fly logs -a tab-agent`.

This is the 6:45 gate: "Scout calls tab ping from an API run; returns valid options via the CLI". PLAN §13 also lists the CreaoPlanner for 6:00–6:45. The gate needs only the CLI path, so T4 and T5 run right after it. Flag this in chat if anyone objects.

### T3 (in parallel with T2, 6:10–6:30) `skills/tab/` final

Move the spike into the repo.

`skills/tab/SKILL.md` (exact):

```markdown
---
name: tab
description: Report progress to Tab and validate or submit Tab Scout options and Tab Concierge itineraries; use whenever a task mentions plan_ref, Tab Scout or Tab Concierge.
---
# tab CLI

Needs env vars TAB_API_BASE and TAB_AGENT_TOKEN (CREAO Secrets). Never print them.
Find the CLI: `TAB=$(command -v tab || ls ./tab 2>/dev/null)`. If empty:
`R=https://raw.githubusercontent.com/<org>/<repo>/main/skills/tab; mkdir -p schema && curl -fsSL $R/tab -o ./tab && curl -fsSL $R/schema/options.schema.json -o schema/options.schema.json && curl -fsSL $R/schema/itinerary.schema.json -o schema/itinerary.schema.json && chmod +x ./tab && TAB=./tab`

Commands (python3). Exit 0 = ok; 1 = validation errors printed as "path: message"; 2 = usage; 3 = env missing; 4 = network; 5 = not authorized, no active run, or server error.
- `$TAB ping`
- `$TAB progress --plan <plan_ref> --kind scout|concierge [--category dinner|show] "<step>"`
- `$TAB schema options|itinerary`
- `$TAB options validate <file>` then `$TAB options submit <file>`
- `$TAB itinerary submit <file>`

Loop: write the file → validate → fix exactly the reported paths → validate again (max 5) → submit.

If python3 is missing, use curl with the same JSON bodies:
`curl -fsS -X POST "$TAB_API_BASE/agent/options/validate" -H "Authorization: Bearer $TAB_AGENT_TOKEN" -H "Content-Type: application/json" --data @options.json`
(routes: /agent/ping, /agent/progress, /agent/options/validate, /agent/options, /agent/itinerary)
```

`skills/tab/tab` rules:
- Python 3 stdlib only, starting with `#!/usr/bin/env python3`.
- The executable bit is set in git: `git update-index --chmod=+x skills/tab/tab` (needed on Windows).

```python
import argparse, json, os, sys, time, urllib.request, urllib.error
EXIT_OK, EXIT_INVALID, EXIT_USAGE, EXIT_CONFIG, EXIT_NET, EXIT_SERVER = 0, 1, 2, 3, 4, 5
def die(msg, code): print(f"tab: {msg}", file=sys.stderr); sys.exit(code)
def call(method, path, body=None):
    base, token = os.environ.get("TAB_API_BASE", "").rstrip("/"), os.environ.get("TAB_AGENT_TOKEN", "")
    if not base or not token: die("TAB_API_BASE/TAB_AGENT_TOKEN not set (CREAO Secrets)", EXIT_CONFIG)
    data = None if body is None else json.dumps(body).encode()
    for attempt in range(3):
        req = urllib.request.Request(base + path, data=data, method=method, headers={
            "Authorization": "Bearer " + token, "Content-Type": "application/json", "User-Agent": "tab-cli/1"})
        try:
            with urllib.request.urlopen(req, timeout=20) as r: return r.status, json.loads(r.read() or b"{}")
        except urllib.error.HTTPError as e:            # must precede URLError (HTTPError subclasses it)
            if e.code >= 500 and attempt < 2: time.sleep(2 ** attempt); continue
            try: return e.code, json.loads(e.read() or b"{}")
            except ValueError: return e.code, {}
        except (urllib.error.URLError, TimeoutError) as e:
            if attempt < 2: time.sleep(2 ** attempt); continue
            die(f"network error ({e.__class__.__name__})", EXIT_NET)
# Subcommands (argparse):
#   ping → GET /agent/ping
#   progress → POST /agent/progress {plan_ref, run_kind, category|null, step[:140]}
#   schema → print schema/<name>.schema.json next to this file (os.path.dirname(os.path.realpath(__file__))), else ./schema/
#   options validate|submit <file>  /  itinerary submit <file> → read JSON, POST, then:
#     200/201 + ok → print "ok" (and "accepted: n"), exit 0
#     200/422 + errors → print "path: message" lines, exit 1
#     401/403 → "not authorized or no active run for this plan_ref", exit 5
#     other → exit 5
# Never print the token or the environment.
```

**Schema generation:** `packages/shared/scripts/gen-skill-schema.ts` runs `z.toJSONSchema(ScoutSubmission)` and `z.toJSONSchema(Itinerary)` (zod 4.6.7, default target draft-2020-12; VERIFIED Context7 /colinhacks/zod) and writes `skills/tab/schema/{options,itinerary}.schema.json`. Add a `pnpm gen:skill-schema` script and run it after any contract change.

**`skills/tab/test_tab.py`:** `unittest` plus an `http.server` stub on 127.0.0.1 (a random port). It runs the CLI as a subprocess (`[sys.executable, path_to_tab, ...]`), because the file has no `.py` extension and can't be imported directly. Cases:
- ok path;
- 422 prints paths and exits 1;
- missing env exits 3;
- 503 then 200 retries;
- the token never appears in stdout/stderr.

Run: `python -m unittest skills/tab/test_tab.py`.

Then re-install the skill from `…/tree/main/skills/tab`, uninstall the spike-repo skill, and re-run Update Environment → `./tab ping` → Save to Agent.

### T4 (6:35–7:15) CREAO client: `src/creao/client.ts` (implements PlannerPort)

**Facts.** creao.md is authoritative for the event; docs.creao.ai/pro/api-trigger was re-checked today:
- Base `https://agent.creao.ai`, header `Authorization: Bearer capi_…`.
- `POST /api/v1/runs {appId, inputs, webhookUrl, idempotencyKey(8–128), threadId?}` → 202 `{id, status:"pending", appId, appName}`.
- `GET /api/v1/runs/{id}` and `POST /api/v1/runs/{id}/cancel`.
  - These are in creao.md. The public docs page shows only the app-scoped `POST /api/v1/apps/{appId}/runs` and `GET /api/v1/apps/{appId}/runs/{runId}`, and mentions neither `idempotencyKey` nor cancel. Hence the S1–S5 smoke tests.
- Webhook body: `{runId, status, threadId, result:{text, chatText?, artifacts[]}}`. Webhook status is only `completed` or `failed`; it carries no error details, so poll for `errorCode`.
- Webhook header `X-Creao-Delivery-Id`: "A UUID that is the same on every attempt for the run's result".
- Delivery: up to 3 attempts; "no response within 10 seconds is retried"; "Redirects are not followed"; at-least-once; unsigned (VERIFIED api-trigger + creao.md).
- A run that fails before execution (e.g. insufficient credits) "ends without a webhook" (VERIFIED). **Polling is mandatory.**
- Artifacts: `GET /api/v1/runs/{runId}/artifacts/download?artifactId=<encoded>` needs the key on every request and returns a **302** to temporary storage (≤1 h). Do not forward the key to another origin (VERIFIED).

```ts
const BASE = "https://agent.creao.ai/api/v1";
async function creao<T>(path: string, init: RequestInit & { headers?: Record<string,string> } = {}): Promise<T> {
  const res = await fetch(BASE + path, { ...init, signal: AbortSignal.timeout(15_000),
    headers: { Authorization: `Bearer ${env.CREAO_API_KEY}`, "Content-Type": "application/json", ...init.headers } });
  const text = await res.text();
  if (!res.ok) throw new CreaoError(res.status, text.slice(0, 300));   // never log headers
  return (text ? JSON.parse(text) : {}) as T;                           // cancel may return an empty body
}
export class CreaoPlanner implements PlannerPort {
  async startScout(planRef: string, brief: ResearchBrief, attempt: number) {
    const b = ResearchBrief.parse(brief);                       // P6 gate: strict object
    const r = await creao<{ id: string }>("/runs", { method: "POST", body: JSON.stringify({
      appId: env.CREAO_SCOUT_APP_ID,
      inputs: { plan_ref: planRef, category: b.category, brief: JSON.stringify(b) },
      webhookUrl: `${env.PUBLIC_BASE_URL}/creao/hook/${env.CREAO_HOOK_SECRET}`,
      idempotencyKey: `scout-${planRef}-${b.category}-a${attempt}`,   // ≤52 chars, [a-z0-9-]
    }) });
    return { runId: r.id };
  }
  async startConcierge(i: ConciergeInput) { /* same; appId CREAO_CONCIERGE_APP_ID;
     inputs { plan_ref, itinerary: JSON.stringify(i.itinerary) }; idempotencyKey `concierge-${planRef}-a1` (49 chars) */ }
  async getRun(id: string) {
    const raw = await creao<unknown>(`/runs/${encodeURIComponent(id)}`);
    const p = CreaoRun.safeParse(raw);
    if (!p.success) { log.warn({ runId: id }, "creao.run.unparsed"); return { status: "running" } as CreaoRun; } // timeout job still ends it
    return p.data;                                                 // id = run.id ?? run.runId
  }
  async cancel(id: string) { await creao(`/runs/${encodeURIComponent(id)}/cancel`, { method: "POST" }); }
  async downloadArtifact(runId: string, artifactId: string) {
    const r1 = await fetch(`${BASE}/runs/${encodeURIComponent(runId)}/artifacts/download?artifactId=${encodeURIComponent(artifactId)}`,
      { headers: { Authorization: `Bearer ${env.CREAO_API_KEY}` }, redirect: "manual", signal: AbortSignal.timeout(15_000) });
    const loc = r1.headers.get("location");
    if (![301, 302, 303, 307, 308].includes(r1.status) || !loc) throw new CreaoError(r1.status, "artifact");
    const r2 = await fetch(loc, { signal: AbortSignal.timeout(15_000) });   // NO Authorization cross-origin
    return new Uint8Array(await r2.arrayBuffer());
  }
}
```

- **Fallback routes.** Use them only if S1 or S3 fails; flip a const and record it in §19.
  - `POST /api/v1/apps/{appId}/runs` with `{inputs, webhookUrl}`.
  - `GET /api/v1/apps/{appId}/runs/{runId}`, the only GET shown on the public docs page.
- **Retry rule:** on a network error or 5xx when starting a run, retry **once** with the same `idempotencyKey`, **and only if S2 passed** (a replayed key returns the same run). Otherwise do not retry: let `creao_timeout` fall back to cached options.
- **Credits:** on 402, mark the run failed → cached options, and log `system warn "CREAO credits"`.
- **Rate:** at most 2 concurrent runs per plan, plus polling every 15 s, is about 8 req/min. The `capi_` limit is UNVERIFIED (U11).

### T5 (7:15–7:45) Webhook, polling and timeout: `src/creao/hook.ts`, `src/creao/research.ts`

```ts
app.post("/creao/hook/:secret", async (c) => {
  if (!safeEq(c.req.param("secret"), env.CREAO_HOOK_SECRET)) return c.body(null, 404);
  let runId: unknown; try { runId = (JSON.parse(await c.req.text()) as any)?.runId; } catch {}
  if (typeof runId === "string") {
    const fresh = await insertInboundEvent("creao", c.req.header("x-creao-delivery-id") ?? runId); // insert-or-ignore
    if (fresh) setImmediate(() => reconcileByCreaoRunId(runId as string).catch(e => log.error({ err: e.message }, "creao.reconcile")));
  }
  return c.json({ ok: true });                       // always 200 in <1 s; the body is a HINT, never trusted
});
// reconcileByCreaoRunId: unknown runId (e.g. a smoke-test run) → log and return.
```

`reconcile(researchRunId)` is shared by the hook, the poll and the timeout, and is idempotent. Steps:
1. Load the row. If it is terminal, return.
2. Call `getRun()` → emit `creao.run {run_id, kind, category, status, elapsed_ms, source:'live', share_url:null}`.
3. Branch on status:
   - `pending|running`: update the status.
   - `completed`:
     - If CLI options are already stored for this run, finish `live`.
     - Otherwise extract the first ```json block, or the outermost `{…}`, from `result.text` → `ScoutSubmission.safeParse`.
     - If that fails, call `llm.repairScoutJson(text, category)` once and parse the result.
     - If that fails too, `useCached`.
   - `failed|cancelled`: `useCached`.
4. Store the raw run under `result.creao`.
5. Finish with a conditional update: `update app.research_runs set status=$s, finished_at=now() where id=$1 and status in ('pending','running') returning id`. Only the caller that gets a row back proceeds.
6. Enqueue `check_research_ready` (below).

due_jobs kinds (foundation registry, `unique(kind, dedupe_key)`; the unique key gives exactly-once):

| Kind | Dedupe key | Due | Handler |
|---|---|---|---|
| `creao_poll` | `<researchRunId>:<n>` | +15 s | `reconcile`; if not terminal, insert `n+1` |
| `creao_timeout` | `<researchRunId>` | started + 6 min (Scout), + 10 min (Concierge) | If not terminal: `cancel()` (best-effort), status `timed_out`, then `useCached` (Scout) or the Concierge fallback (T11) |
| `check_research_ready` | `<planId>:<version>` | now | When both categories have options (live or cached) → `runShortlist(planId, version)` → A's `onResearchReady`. If not ready yet, mark done without acting; the next category's finish enqueues again with the same key, so in practice use `<planId>:<version>:<finishedCount>`. `runShortlist` itself is guarded by a `run_shortlist` job keyed `<planId>:<version>`, so it runs once. |
| `research_typing` | `<planId>:<n>` | +5 s while the plan is RESEARCHING | A's typing helper (§3.1) per participant. The interval is A's §19 item. |
| `research_still_looking` | `<planId>` | +90 s | Once: `notify(u, "T_STILL_LOOKING")` per participant, if the plan is still RESEARCHING |

`useCached(row)`:
- Do nothing if live options already exist for this run (a CLI submit, then a failed run, keeps the live data).
- Otherwise load `fixtures/cached-options/<category>.json`, rewrite `plan_ref`, and upsert the options with `source:'cached'`.
- Set `research_runs.source='cached'`.
- Emit `creao.run {source:'cached', share_url: fixture.share_url}` and `system info "cached options (<category>)"`.

`startResearch(planId)` (`research.ts`):
1. Call `buildResearchBrief` per category (T7).
2. Insert two `research_runs` rows (`pending`, with `idempotency_key`) **before** the POST, so the agent's first CLI calls pass the active-run check.
3. Call `startScout` for both in `Promise.all` and store each `creao_run_id`.
4. Schedule the jobs above.
5. Emit the `xray` Scout inputs.

Limits and modes:
- Cap per plan: 2 Scout runs, 1 re-roll and 1 Concierge.
- `PLANNER_MODE=cached` skips CREAO and calls `useCached` after 2 s.

`cancelResearch(planId)`: when a plan is CANCELLED, call `cancel()` for every non-terminal run.

### T6 (7:45–9:00) Pure decision functions: `src/decide/*` (unit tests first)

`config.ts` (all tunable, no secrets):

```ts
export const DINNER_MIN_MIN = 90, SHOW_GAP_MIN = 90, SHOW_GAP_MAX = 150;
export const HARD_MAX_SLACK = 1.10, RATING_FLOOR = 0.05, RATING_DEFAULT = 0.5, COMFORT_FLOOR = 0.6;
export const MAX_RATED = 15, SHORTLIST_N = 3;
```

| File | Signature | Rules |
|---|---|---|
| `compose.ts` | `compose(options: Option[], plan:{time_start,time_end,area}) → Bundle[]` | Times are normalized with `.slice(0,5)` (postgres `time` comes back as `HH:MM:SS`). T = minutes(time_start). Dinner: `opens ≤ T` and `closes ≥ T+90` (if `closes ≤ opens`, add 1440). Show: `start ∈ [T+90, T+150]`; end = `show_end_est` (+1440 if before start); end ≤ time_end (+1440 if time_end < time_start). `norm(d.area) === norm(s.area)`. `all_in_pp_cents = priceBundle(...)`. id = `'bnd_'+sha1(dinnerId\|showId)[0:10]`. Deterministic sort by id. |
| `fitsPrefs.ts` | `fitsPrefs(bundles, prefs: Preferences[]) → Bundle[]` | For every member: `prefs.dietary ⊆ dinner.dietary_fit`; `earliest_start ≤ dinner_time` if set; `show_end_est ≤ latest_end` if set. |
| `filter.ts` (P1) | `filter(bundles, constraints: PrivateConstraints[]) → Bundle[]` | Keep a bundle iff `all_in_pp_cents ≤ effectiveHardMax(c)` for **every** c. `effectiveHardMax = hard_max_pp_cents ?? Math.round(target_pp_cents*1.10)`. No logging. |
| `rateCandidates.ts` | `selectForRating(bundles) → Bundle[]` (≤15) | Greedy coverage: repeatedly add the bundle that covers a not-yet-covered dinner or show (ties broken by id), then fill by id. |
| `score.ts` (P1) | `nashWelfare(b, ratings, constraints)`, `shortlist(bundles, ratings, constraints) → Bundle[3]`, `pickWinner(shortlist, ballots, ratings, constraints) → bundleId` (+ the orchestrators below) | See the scoring rules below. |
| `ballot.ts` | `resolveApprovals(parse: BallotParse, shortlist: PublicBundle[]) → string[]` | Start from the `approvals` indices. Drop `exclude` indices. `end_before` drops bundles with `show_end_est > time`; `start_after` drops bundles with `dinner_time < time`. `none_of_these` → []. Digit-only replies call it with constraints []. A calls this. |

**Scoring rules (`score.ts`):**
- Rating r = clamp(rating, 0.05, 1); a missing rating counts as 0.5.
- Comfort = 1 if p ≤ target, else `max(0.6, 1 − 0.4·(p−target)/max(1, effMax−target))`.
- Nash welfare NW = Σ_u ln(r·comfort).
- Shortlist: sort by NW desc, then all_in asc, then id. Greedily take bundles that share no dinner or show id until there are 3.
- Winner: approvals desc → NW desc → all_in asc → id. Non-voters approve nothing.

Orchestrators inside `score.ts`. They load constraints through `repo/privateConstraints.ts` and **never log or emit constraint values**.
- `runShortlist(planId, version)`:
  1. options → compose → fitsPrefs → filter → persist `app.bundles` (`survived`) → selectForRating.
  2. Per member, all in parallel: one `llm.rateBundles(prefs, candidates)` call with indices 1..n (C-1) → `app.ratings`.
  3. shortlist → set `shortlist_rank`.
  4. Emit `shortlist {plan_id, version, from_count, survived_count, bundles: PublicBundle[]}`.
  5. If fewer than 3 bundles remain, return `{ok:false}`. A sends `T_NO_FIT`; the re-roll is a stretch goal.
- `runWinner(planId, version)` → `pickWinner` → bundle id.

**`rateBundles`** (`llm.anthropic.ts`, @anthropic-ai/sdk 0.135.0). VERIFIED in the package source:
- `zodOutputFormat` comes from `@anthropic-ai/sdk/helpers/zod`, and `output_config.effort` takes `'low'|'medium'|'high'|'xhigh'|'max'`.
- **`messages.parse()` throws `AnthropicError` when the output fails JSON parsing or the zod schema.** It does not return `parsed_output: null`.
- The helper moves unsupported constraints (regex `pattern`, `minItems` > 1, min/max) into the description and re-checks them client-side.
- Thinking is on by default on Sonnet 5.5 and Haiku 5.5 (claude-api skill), and thinking tokens count toward `max_tokens`. Don't set `max_tokens` too low.

```ts
const client = new Anthropic({ timeout: 30_000, maxRetries: 2 });   // TS timeout is in ms
try {
  const r = await client.messages.parse({
    model: "claude-sonnet-5-5", max_tokens: 4096,
    system: "You rate evening plans for ONE person using ONLY their stated preferences. Ignore price; price is handled elsewhere. Score each plan index from 0 to 1.",
    messages: [{ role: "user", content: JSON.stringify({ preferences: prefs, plans: bundles }) }],
    output_config: { format: zodOutputFormat(Ratings), effort: "low" },
  });                                   // NO tools, NO prefill, NO tool_choice, NO temperature (P5)
  if (r.stop_reason === "refusal" || r.stop_reason === "max_tokens" || !r.parsed_output) return { ratings: [] };
  return r.parsed_output;
} catch (e) {                           // AnthropicError (schema/JSON) or APIError after retries
  log.warn({ err: (e as Error).name }, "llm.rate.failed");   // never log prompt or prefs
  return { ratings: [] };               // → RATING_DEFAULT in code
}
```

The server-side refusal `fallbacks` beta is deliberately not used: a refusal only degrades to default ratings.

`repairScoutJson`:
- Model `claude-haiku-5-5`, effort `low` (its default is `medium`), `max_tokens: 12000`.
- The input is Scout text only. The output schema is `ScoutSubmission`.
- Use the same try/catch. Return `parsed_output ?? null`.

**Tests** (`pnpm --filter ./apps/agent exec vitest run src/decide`):
- `compose.test.ts`: midnight wrap; show-window edges at T+90 and T+150 inclusive; area mismatch dropped; `"18:30:00"` input normalized.
- `filter.test.ts`: null hard_max → round(target×1.10); one member below → bundle gone; exact equality kept. Constraint objects are plain literals (no `@tab/shared/private` import).
- `fitsPrefs.test.ts`: a vegan member drops a non-vegan dinner; `latest_end`.
- `score.test.ts`: diversity (no shared dinner/show); a zero rating clamps to 0.05; comfort is monotonic; deterministic tie-break.
- `winner.test.ts`: approvals beat NW; ties → NW; non-voters.
- `ballot.test.ts`: "2, but not if it ends after 10" parsed → only bundle 2, and only if it ends ≤ 22:00.
- `pricing.test.ts` (with C): `priceBundle` with TAX 0.1025.
- `demo.fixture.test.ts`, using `fixtures/cached-options/*` and `fixtures/demo-seed.json`:
  - **At least 3 diverse bundles survive at a 3000-cent hard max** (PLAN §15). At TAX 0.1025 and TIP 0.18, this needs `ceil(dinner_high·1.2825 + show_high·1.1025) ≤ $30`. Seed at least 3 distinct cheap dinners and at least 3 cheap or free shows.
  - The shortlist with the 3 seeded members **differs** from the shortlist after the $30 judge is added (the v1→v2 refresh beat).
  - In the post-judge shortlist, the bundle at index 2 has `show_end_est ≤ 22:00`, so the scripted judge reply "2, but not if it ends after 10" yields an approval.

### T7 (9:00–9:30) `buildResearchBrief` + wiring with A: `src/creao/brief.ts`

```ts
const isoDate = (d: Date | string) => (d instanceof Date ? d.toISOString().slice(0, 10) : d.slice(0, 10));
const hhmm = (t: string) => t.slice(0, 5);
export function buildResearchBrief(category, plan, prefsList: Preferences[], partySize: number): ResearchBrief {
  return ResearchBrief.parse({                    // strict: an extra key (e.g. budget) throws
    category, area: plan.area, date: isoDate(plan.event_date),
    time_window: { start: hhmm(plan.time_start), end: hhmm(plan.time_end) },
    party_size: Math.min(8, Math.max(2, partySize)),
    dietary_tags: [...new Set(prefsList.flatMap(p => p.dietary))].sort(),
    vibe: topK(prefsList.flatMap(p => p.vibe), 3),     // frequency desc, then alphabetical
    price_tiers: ["<$25", "$25-50", "$50+"], count_per_tier: 4 });
}
```

Wiring:
- Wire A's `RESEARCHING` entry to `startResearch(planId)`, and the `check_research_ready` job to A's `onResearchReady(planId)`.
- Run with `PLANNER_MODE=mock`, then `cached`. `pnpm sim:plan` must reach VOTING.

**`xray.ts`:** `emitXray(planId)` builds these contexts:
- `scout_input:dinner` / `scout_input:show`: `locked:false`, preview = the brief JSON;
- `fanout`: preview = the last fan-out template id;
- `delegate:lane-<n>`: `locked:true, preview:null`.

Call it at research start. A calls it after each fan-out.

### T8 (9:30–10:15) `apps/web`: join page, then the create page

Before writing UI, invoke the skills `vercel-react-best-practices`, `vercel-composition-patterns` and `web-design-guidelines`.

Build `/j/[code]` first; it is never cut. The demo plan comes from `seed:demo`, so `/` can stay minimal.

Stack (npm registry checked today):
- next 16.4.2 (Oct 15), react/react-dom 19.3.1, tailwindcss 4.3.3 + @tailwindcss/postcss 4.3.3 (Jul 16).
- shadcn CLI **4.21.4** (Oct 7). 4.22.0 is one day old, and its `init`/`add` flags are identical (VERIFIED from both tarballs' `dist/index.js`).
- `@tab/shared` resolves without config: Next 16's Turbopack transpiles workspace packages automatically (VERIFIED Context7 /vercel/next.js, transpilePackages page). Add `transpilePackages: ['@tab/shared']` only if `next build` fails to resolve it.

```bash
pnpm dlx shadcn@4.21.4 init -c apps/web -b radix --no-monorepo      # -y defaults to true for init
pnpm dlx shadcn@4.21.4 add -c apps/web button card badge input label checkbox table separator sonner
```

All nine components resolve in the registry (HTTP 200 checked today).

Next 16: `params` and `searchParams` are **Promises**. `await` them in Server Components (VERIFIED Context7 /vercel/next.js v16 upgrade guide).

**`/j/[code]` (join):**
- Phone: `type="tel" autoComplete="tel" inputMode="tel"`. Normalize: 10 digits → `+1…`; 11 digits starting with 1 → `+…`; otherwise require a leading `+`. Validate with `z.e164()` (VERIFIED Context7 /colinhacks/zod).
- First name.
- Optional private budget `{target, hard_max?}` in USD: `inputMode="decimal" autoComplete="off"`. Helper text: "Only Tab's code checks prices against this. Nobody in the group sees it."
- Required consent checkbox.
- `POST /join {code, phone_e164, first_name, budget_usd?, consent:true}` → `{assigned_number, sms_href, join_text}`.
- Success state:
  - a big "Text Tab" `<a href={sms_href}>`;
  - **also** the number and `JOIN 4821` in plain text with copy buttons (iOS prefilled body is UNVERIFIED);
  - the line "Send it as your first message. Tab can't text you first."

| State | UI |
|---|---|
| submitting | Button disabled + spinner; inputs read-only |
| 409/503 | "Tab is at capacity, try again in a minute" (PLAN §3.2) |
| 404 | "That code doesn't match a plan" |
| 422 | Field-level errors (`aria-live="polite"`) |
| network | Retry button |

Privacy rules for the join page:
- Never `console.log` the form.
- No analytics.
- Do not persist the budget in local or session storage.

UX rules:
- Inputs at 16 px or larger; 44 px tap targets; a label on every input.
- `tabular-nums` for money; no layout shift on error.

Confirm the error status codes with A at 10:15 PM.

**`/` (organizer):**
- Form fields: title, area (text, 2–60), date, start, end, party_target (2–8), organizer phone + first name.
- `POST ${NEXT_PUBLIC_AGENT_URL}/plans` → `{code, join_url, qr_svg}`.
- Render the QR as `<img src={"data:image/svg+xml;charset=utf-8," + encodeURIComponent(qr_svg)} alt="QR code to join">`. Never use `dangerouslySetInnerHTML`.
- Copy-link button.
- Copy: "Paste this link in your group chat. Tab never joins it."

### T9 (10:15–11:00) Console skeleton: `/console?k=KEY`

- Server page: `const { k } = await searchParams`, then pass `k` to a Client Component. **Never** put the key in `NEXT_PUBLIC_*` (PLAN §11).
- `new EventSource(`${AGENT}/events?k=${encodeURIComponent(k)}`)`. The browser reconnects automatically with `Last-Event-ID` (the server sends `id:`). A's `/events` needs CORS for `WEB_ORIGIN`.
- On open: `GET /events/snapshot?k=` (shape per C-6).
- Each frame: `SseEvent.safeParse(JSON.parse(e.data))`. Drop invalid frames and count them in a debug badge.
- `consoleReducer(state, event)` is a **pure** function in `apps/web/lib/consoleReducer.ts`, unit-tested with vitest 5.0.5. It ignores ids ≤ the last applied id, so the snapshot and the SSE replay don't double-apply.

Layout: 16:9, readable from 5 m. Key numbers ≥28 px, IDs in mono, `tabular-nums`, `prefers-reduced-motion` respected.

| Zone | Content | Events |
|---|---|---|
| Header | Plan title, a stepper (Gather → Research → Vote → Hold → Book) driven by `plan.state`, version | `plan.state` |
| Left: People | One lane per `first_name`, with stage chips INVITED→…→CAPTURED/RELEASED. The budget is only ever shown as 🔒. Share amount + `cybs_id_short`. | `lane`, `ledger`, `vote.tally` |
| Center: Shortlist + X-ray | "CREAO found N → plain-code filter kept M" (`from_count`/`survived_count`), 3 cards; X-ray tiles (scout_input preview JSON; fanout; delegates 🔒) | `shortlist`, `xray` |
| Right: Money + TAP | Ledger, TAP panel (T12), counters | `ledger`, `tap.*`, `counters` |
| Bottom: CREAO lane | Run chips: kind/category, short runId, status, elapsed (ticked client-side from first seen), a `live`/`cached` badge, "Open run" when `share_url` is set. Streaming progress lines (last 8). | `creao.run`, `creao.progress` |
| Footer | Delivery lifecycle dots, last 6 `system` messages, hidden ops bar | `delivery`, `system` |

### 11:00 PM Checkpoint 1 (§7)

### T10 (11:00 PM–12:00 AM) Real Scout in the loop + snapshot

- Set `PLANNER_MODE=live` and `AGENT_API_ALLOW_TEST_REF=0` on Fly.
- Run a full plan on 2 phones with live Scout. Measure the latency of 3 runs (§11).
- Snapshot script: `apps/agent/scripts/creao-snapshot.ts <researchRunId>` (`pnpm --filter ./apps/agent creao:snapshot`).
  - It writes `fixtures/cached-options/<category>.json` from the stored options, in the foundation's format plus `run_id`, `share_url`, `captured_at` and `brief`.
  - Create the **share link** for that run's [API] thread with the share icon in the thread header (VERIFIED features/chat: "Anyone with the link can view the full conversation"; read-only; revoke by clicking the icon again and disabling the link).
  - Before publishing the link, search the thread for `TAB_AGENT_TOKEN`'s first 8 characters. If the token appears, rotate it (Fly secret + CREAO Secret) and pick another run.
  - Paste the URL into the fixture.
- Re-run `demo.fixture.test.ts`. If fewer than 3 bundles survive at $30, re-run Scout with the cheap-tier emphasis and snapshot again.

### T11 (12:00–1:15 AM) Tab Concierge

**Build it in the UI** (same flow as §4.3), in a new chat:

```
Build a reusable agent named "Tab Concierge". Inputs, named exactly: plan_ref (opaque UUID, never interpret it) and itinerary (a JSON string: {"date","area","party_size","dinner":{"name","address","time"},"show":{"name","address","time"}}; times are 24h America/Los_Angeles).
Job: write the group's night-out plan.
1. Run: tab ping. At each step run: tab progress --plan <plan_ref> --kind concierge "<short step>".
2. With web search and fetch, research: getting from the dinner to the show (walk/drive/transit time), parking near each, the show's doors time, dress code, and up to 6 short know-before-you-go tips (ID, bag policy, age limits). Public info only.
3. Write iCalendar text: BEGIN:VCALENDAR, VERSION:2.0, PRODID:-//Tab//Concierge//EN, one VEVENT for dinner (90 minutes) and one for the show, with UID, DTSTAMP, DTSTART/DTEND in UTC with a Z suffix (convert from America/Los_Angeles), SUMMARY and LOCATION; END:VCALENDAR.
4. Create a Notion page titled "<Dinner at X → Show at Y>" as a child of the Notion page named "Tab Plans", containing the stops, logistics and tips. Put its URL in notion_url. If Notion fails, set notion_url to null and continue.
5. Write itinerary.json matching "tab schema itinerary" (title, date, stops[{kind,name,address,time,notes}], logistics{getting_there,parking,doors,dress_code,know_before[]}, ics, notion_url, plan_ref) and save it as a file. Run: tab itinerary submit itinerary.json; fix reported errors and resubmit (max 5).
6. Reply with ONLY the itinerary.json content in one ```json block.
Rules: never contact, book, buy from, pay or message any venue or person; never sign anything; never save memories; never print environment variables or secrets.
```

Then: Create Agent → confirm the input names → Update Environment → Save to Agent → copy the agent ID into `CREAO_CONCIERGE_APP_ID` (Fly secret).

**Code: `src/creao/concierge.ts`.**
- A calls `startConciergeFor(planId)` on CONFIRMED.
- Build a `ConciergeInput` from the chosen bundle (names, addresses, times, area, party size; **no person data**) → `startConcierge`.
- Schedule `creao_poll` and `creao_timeout` (10 min).
- On `completed` with no itinerary submitted:
  1. Look for an artifact titled `itinerary.json` → `downloadArtifact` → `Itinerary.safeParse`.
  2. Otherwise use the fallback.

**Fallback (cut list #6/#7):**
- `ics.ts` builds a minimal VCALENDAR: two VEVENTs, UTC `Z` times, CRLF line endings.
- The fallback `Itinerary` uses fixed logistics strings (e.g. `getting_there: "See each venue's website for directions."`), so the schema still validates.
- `notionFallback.ts` creates the page with `@notionhq/client@5.27.1` (pinned in PLAN; published Oct 16, so smoke-test it first, U17; fallback pin 5.27.0, published Sep 29).
- The calls below are VERIFIED with Context7 /makenotion/notion-sdk-js: `parent: { page_id }` is allowed, a page under a page uses the `title` property, and the default Notion-Version is `2025-09-03`.

```ts
import { Client } from "@notionhq/client";
const notion = new Client({ auth: env.NOTION_TOKEN });
const page = await notion.pages.create({
  parent: { page_id: env.NOTION_PARENT_PAGE_ID },
  properties: { title: { title: [{ text: { content: title } }] } },
  children: stops.map(s => ({ paragraph: { rich_text: [{ text: { content: `${s.time} · ${s.name} · ${s.address}` } }] } })),
});
const url = "url" in page ? page.url : `https://www.notion.so/${page.id.replaceAll("-", "")}`;
```

**Hosted pages (`agentApi`):**
- `GET /p/:planRef/itinerary`: server-rendered HTML from the stored `Itinerary` JSON (`result.itinerary`), with **every field HTML-escaped**. Never render Concierge HTML (XSS risk). Headers: `Cache-Control: no-store`, `X-Robots-Tag: noindex`.
- `GET /p/:planRef/plan.ics`: `Content-Type: text/calendar; charset=utf-8`, `Content-Disposition: attachment; filename="tab-plan.ics"`.
- Unknown ref → 404.

Then call `notify(userId,"T_ITINERARY",{itinerary_url, ics_url})` once per participant. A's `tpl:` key keeps it once per user, whichever path delivered the itinerary.

### T12 (1:15–2:15 AM) Console evidence panels + ops bar

- **TAP panel.** It renders `tap.signed` (method, path, `signature_input`, `signature_short`) and `tap.verify.report`:
  - six step rows ✓/✗ with `detail`;
  - the business checks;
  - `signature_base` in a mono block;
  - `accepted`/`reason`.

  The report comes from the venue, relayed by the agent as SSE. **No iframe**: it would need venue CSP / frame-ancestors changes for no gain.

  Labels, using PLAN §1 wording: "Signed agent request (Visa Trusted Agent Protocol) ✓ verified by merchant" and "Key directory: **mock**". "RFC 9421" appears only in the detail row. Never "Visa-verified" (M9).
- **Ledger:** one row per lane with `status`, amount and `cybs_id_short`. All lanes flip together on `order.captured` or release.
- **Counters:** groups converted all-or-nothing · $ fronted by any individual **$0.00** · holds released.
- **Ops bar** (hidden until `?ops=1`):
  - The operator key is typed into a password field and kept in `sessionStorage` only.
  - Buttons → `POST ${AGENT}/ops/{reset|replay|live-scout|release-seats}` and `/ops/tap-test {kind:"tamper"|"replay"|"expired"|"wrong_tag"}`, with `Authorization: Bearer <key>`. This needs A's CORS preflight support (§3.1).
  - Buttons are disabled while a request is in flight; a toast shows the result.
- **`liveDemo.ts`:**
  - `startLiveScoutDemo()` starts a Scout run (`kind:'scout_live_demo'`, category `dinner`) against the **showcase plan** (C-9), using the brief built from that plan. Key: `live-<showcaseRef>-dinner-<unixMinute>` (57 chars).
  - Server-side debounce: refuse if a live demo started less than 3 min ago.
  - Its options never enter `app.options`.
  - A wires the `/ops/live-scout` route to it.

### T13 (2:15–3:30 AM) Privacy tests (never cut)

**`apps/agent/test/brief.schema.test.ts` (P6):**
- `ResearchBrief` rejects extra keys (`budget`, `names`, `phone`).
- The output keys of `buildResearchBrief` are exactly the contract keys.
- `startScout` inputs are exactly `{plan_ref, category, brief}`.

**`apps/agent/test/privacy.e2e.test.ts` (P7):** a full mocked run, using the foundation's test DB setup (`DATABASE_URL_TEST` if that is the convention). It must not import `@tab/shared/private` or contain the SQL string `private_constraints`. If the foundation's P1 grep also scans `test/**`, ask it to exempt nothing; this file needs neither.

1. **Recorders:**
   - LLM fake: records `(method, userId?, input)`. Its `parseBudget` regex-parses `\d+(\.\d\d)?` from the message, so values flow realistically into `private_constraints`.
   - Planner fake: records `startScout`/`startConcierge` arguments.
   - Messaging fake: records `(userId, text)`.
   - Venue fake: records request bodies.
   - pino: a capture destination stream.
   - SSE: a test client on `/events`.
   - `app.events` rows.
2. **Members and budgets (target/max):**
   - L1 $31.17/$40.00
   - L2 $47.29/$52.11
   - L3 $63.43/null (effective $69.77 = round(6343×1.10) cents)
   - L4 $88.61/$91.03

   Drive the flow through `/dev/inbound`: join, budget DM, prefs, ballot, holds via the venue fake, commit.
3. **Forms checked per value:**
   - cents (`3117`);
   - `31.17`;
   - `$31.17`;
   - `$31` as a word-boundary regex `/\$31(?![\d.])/`;
   - the same forms for L3's effective max.
4. **Assert:** each value appears **only** in that member's own delegate calls and in outbound texts to that member. It appears nowhere in:
   - other members' delegate calls;
   - `rateBundles`/`repairScoutJson` inputs;
   - planner inputs;
   - fan-out texts;
   - `app.events`;
   - SSE frames;
   - logs;
   - venue requests.
5. **Fixture rule:** the fixture options must produce **no bundle `all_in_pp` (or share) equal to $31, $40, $47, $52, $63, $69, $88 or $91**, or a price would cause a false positive. Assert this precondition first.
6. **Static strings:** the templates and tiers contain `$25/$50/$80` and `<$25/$25-50/$50+`, which don't collide with the test values. Assert that too.

### T14 (3:30–4:00 AM) Demo readiness

- `demo.fixture.test.ts` is green.
- Make a table card with the QR code for `${WEB}/j/<demo code>`. The code is fixed per seed, but the plan ref is fresh each time (C-8). Ask A to keep the seeded **code** stable across Reset.
- Print the pre-warm checklist.

### 4:00 AM Checkpoint 2 (§7)

### T15 (4:00–5:30 AM) README + Devpost draft (then rest 5:30–7:00)

**`README.md`:**
- one-paragraph pitch + thesis;
- architecture diagram (from PLAN §5);
- run steps (`pnpm install`, `pnpm dev`, `pnpm sim:plan`, `pnpm test`);
- **CREAO section:**
  - the Scout and Concierge **agent IDs**;
  - **share links** to one Scout run and one Concierge run (PII-free by construction; token check done in T10);
  - the skill repo URL (`…/tree/main/skills/tab`);
  - the exact API calls (§T4), with webhook re-fetch and polling;
  - "Remove the agent and Tab has nothing to vote on";
- the privacy invariants (P1–P8) and the P7 test;
- Visa section: the merchant honesty text verbatim (PLAN §2.3), the TAP verifier steps, and "no APC";
- hackathon provenance: "all code written Oct 17–18, 2026".

**`docs/devpost.md`** (paste into Devpost; required fields per devpost.txt "What to Submit"):
- What it does, and the problem (Zelle line verbatim, PLAN §1).
- Track: Applied Intelligence + the official text.
- How it applies to Visa / CREAO / Photon: one paragraph each, from PLAN §2.2–2.4.
- How we built it; challenges; accomplishments; what's next.
- Built with: TypeScript, Hono, Node 22, Next.js 16, Tailwind 4, shadcn, Supabase Postgres, Fly.io, Vercel, Photon 2.0 (`@photon-ai/api`), CREAO, Anthropic Claude (Haiku 5.5 / Sonnet 5.5), Cybersource, Visa TAP, Notion.
- Avoid the PLAN §1 banned words.

### T16 (7:00–9:30 AM) Video, fresh snapshot, Devpost draft

- **8:00:** Scout runs for **Sunday's date (2026-10-18)** → `creao:snapshot` → `demo.fixture.test.ts` green. This is a data refresh, allowed after the freeze. Confirm `seed:demo` uses date 2026-10-18.
- **7:00–9:00 video (2:30 target):**
  - 0:00 hook (Zelle);
  - 0:15 judge-style join on a phone;
  - 0:45 private budget → shortlist refresh;
  - 1:05 CREAO lane + [API] thread validate/fix;
  - 1:30 hold → TAP ✓ → capture with real IDs;
  - 1:55 tamper rejected;
  - 2:10 "I'm out" → all released;
  - 2:25 thesis.

  Record the phones with iPhone's built-in Screen Recording and the console with OBS (or Windows Game Bar). Edit in Clipchamp or any editor. Upload unlisted to YouTube, and keep per-beat backup clips on the laptop.
- **9:30:** Devpost draft **submitted**. Tracks: main + Visa + CREAO Disruptor, plus Photon per the booth's answer, plus Paper/Intuit/MLH only if we already qualify.

### Voice stretch (only if GO)

- **Go condition at 6:45 PM:** a payment method is on the Photon org, an SMS number can be bought, and B is on schedule.
- **Start:** only after the 11 PM checkpoint passes **and** A or C takes over T12 polish.
- **Hard stop:** 2:00 AM if the SIP echo call fails.

Steps:

- **V1 (30 min), setup.** VERIFIED against the local copy of `photon.codes/docs/beta/cookbooks/voice/elevenlabs` (`photon_dl/beta_cookbooks_voice_elevenlabs.md`):
  - Buy an SMS number. Shared iMessage assignments do not support Voice.
  - Photon project → Voice → create the default profile → **SIP**.
  - Photon **Outbound calls**: select SHA-256 → **Enable outbound**. Save the one-time password.
  - ElevenLabs → **Deploy → Phone Numbers → Import number → From SIP Trunk** (Photon number in `+E.164`). Media Encryption **Allowed**.
  - ElevenLabs Outbound Configuration: Address `sip.photon.codes:5061` (no `sip:` prefix), TLS, codecs G.722/PCMU/PCMA, plus the Photon outbound username and password.
  - Photon inbound destination: `sips:sip.rtc.elevenlabs.io:5061`, TLS, no SIP credentials.
  - ElevenLabs agent prompt: collect intent only (`in` / `out` / `later`) through a data-collection field `intent`. Dynamic variables `{{first_name}}`, `{{title}}`, `{{deadline}}`. Never mention amounts or other people.
- **V2 (20 min), SIP echo:** ElevenLabs → the imported number → **Outbound call** → **Send Test Call** to a team phone. Pass = the phone rings and the agent talks.
- **V3 (45 min), `src/voice/call.ts`:**
  - `POST https://api.elevenlabs.io/v1/convai/sip-trunk/outbound-call` with header `xi-api-key: <ELEVENLABS_API_KEY>`.
  - Body: `{agent_id, agent_phone_number_id, to_number, conversation_initiation_client_data:{dynamic_variables:{first_name,title,deadline}}}`.
  - Response 200: `{success, message, conversation_id?, sip_call_id?}`. Endpoint, body fields, response and auth header are all VERIFIED with Context7 /websites/elevenlabs_io.
  - A's re-ping ladder calls it at T-15m for the last holdout.
- **V4 (45 min), `POST /voice/hook`** (post-call webhook, type `post_call_transcription`):
  - Verify the `ElevenLabs-Signature: t=<ts>,v0=<hex>` header, where `v0 = HMAC_SHA256(secret, "<ts>.<rawBody>")`, with a constant-time compare (format VERIFIED with Context7, ElevenLabs webhook docs).
  - Rejecting timestamps older than 30 min is our policy; the SDK's exact tolerance is UNVERIFIED.
  - `secret` = the HMAC secret ElevenLabs shows when you create the webhook.
  - Read `data.analysis.data_collection_results` → `intent`. The exact path is UNVERIFIED; log the raw body once (U19).
  - Map the intent to `notify(user, T_VOICE_RECAP_IN|OUT|LATER)` (C-4). Money still moves only on a text YES.
- **Env (additive):** `VOICE_ENABLED`, `ELEVENLABS_API_KEY`, `ELEVENLABS_AGENT_ID`, `ELEVENLABS_PHONE_NUMBER_ID`, `ELEVENLABS_WEBHOOK_SECRET`.

---

## 6. Mocks until teammates deliver, and switching to real

| Dependency | Use until | Mock | Switch to real |
|---|---|---|---|
| CREAO (your own) | T4 done | Foundation `PlannerPort` mock (`PLANNER_MODE=mock`) | `PLANNER_MODE=live`; `cached` for rehearsals without credits |
| Anthropic ratings | `ANTHROPIC_API_KEY` set | `LLM_MODE=mock` (deterministic) | `LLM_MODE=anthropic` |
| A's state machine | 8:45 PM | Call `startResearch`/`runShortlist` from a vitest harness | A's RESEARCHING entry calls them |
| A's `/join`, `/plans`, `/events` | Foundation (6 PM) | Foundation dev server, `MESSAGING_MODE=mock` | `NEXT_PUBLIC_AGENT_URL=https://tab-agent.fly.dev` |
| C's TAP/ledger events | ~1 AM | `apps/web/fixtures/sse-sample.ndjson` (hand-written valid `SseEvent`s, including a rejected `tap.verify`) fed to `consoleReducer`; `?replay=fixture` dev flag | Live SSE |
| Agent `/agent/*` (before 6 PM) | 6:00 PM | `scratch/creao/stub.mjs` + cloudflared | Secret `TAB_API_BASE=https://tab-agent.fly.dev` |

---

## 7. Integration checkpoints

| Time | With | Must work |
|---|---|---|
| **6:00 PM (F)** | Claude/all | Foundation pulled; `pnpm sim:plan` green; single zod copy; C-1..C-9 raised |
| **6:45 PM gate** | all | Booth answers recorded. `agent.ping` hit from an **API** Scout run. Scout produced valid options via `tab options submit` (else the result.text path becomes primary). Voice go/no-go decided. |
| 8:45 PM | A | Hook names agreed and wired: `startResearch`, `onResearchReady`, `runShortlist`, `runWinner`, `resolveApprovals`, `startConciergeFor`, `emitXray`, typing helper. Routes mounted and due_jobs kinds registered. A mock plan reaches VOTING with your shortlist. |
| 9:30 PM | C | `TAX=0.1025` merged with C's ack; the venue's `priceBundle` equals the agent's prices in a shared test |
| 10:15 PM | A | `/join` status codes; `/events/snapshot` shape (C-6); CORS for `/ops/*` with `Authorization`; `lane`/`vote.tally`/`plan.state` events flowing |
| **11:00 PM Checkpoint 1** | all | 2 real phones: join → cached options → ballot → sandbox hold → TAP commit → capture. The console shows lanes and the CREAO lane. If red: swarm it; no voice. |
| ~1:00 AM | C | `tap.signed`, `tap.verify` (accepted + tamper-rejected), `ledger` and `counters` render; the `/ops/tap-test` kinds work |
| **4:00 AM Checkpoint 2** | all | 4 phones (at least 1 not a team phone), 3 clean runs in a row, Reset works, `privacy.e2e` green, the live Scout lane shows progress |
| 7:00 AM | all | Feature freeze |
| 9:30 AM | B | Devpost draft submitted |
| 11:30 / 11:45 AM | all | No deploys / final submit |

---

## 8. Verification

### 8.1 Automated (all in `pnpm test` unless noted)

- `decide/*.test.ts` (T6), including `demo.fixture.test.ts` and `pricing.test.ts`.
- `creao/hook.test.ts`:
  - wrong secret → 404;
  - always 200;
  - a duplicate `X-Creao-Delivery-Id` reconciles once;
  - a body with a fake `status:"completed"` while GET returns `running` → nothing finishes;
  - an unknown runId is ignored.
- `creao/reconcile.test.ts`:
  - completed + CLI options → live;
  - completed + `result.text` JSON → live;
  - invalid → repair → cached;
  - failed → cached;
  - CLI options, then failed → stays live (no cached merge);
  - timeout → `cancel` called + cached;
  - two concurrent reconciles → one finish;
  - two `check_research_ready` jobs → one `runShortlist`.
- `creao/client.test.ts`: an empty-body cancel doesn't throw; artifact 302 and 307 both followed without `Authorization`.
- `agentApi/routes.test.ts`:
  - bad token → 401;
  - inactive run → 403;
  - the test ref works only with the flag;
  - the 61st progress post → 429;
  - control chars stripped;
  - `area` mismatch error path `options.3.area`;
  - a live-demo submit doesn't touch `app.options`.
- `llm.rate.test.ts`: an SDK `AnthropicError` thrown on schema failure → `{ratings: []}`; the request body has no `tools` key.
- `brief.schema.test.ts` (P6) and `privacy.e2e.test.ts` (P7). Never skipped.
- `apps/web`: `consoleReducer.test.ts` (each `SseEvent` type; rejected TAP; ids at or below the last applied id ignored) and `normalizePhone.test.ts`.
- `python -m unittest skills/tab/test_tab.py`.

### 8.2 CREAO smoke script `scratch/creao/smoke.sh`

It uses `$CREAO_API_KEY`, `$APP` (the Scout appId) and `$HOOK` (webhook.site or the Fly hook URL). The `brief` value is the JSON string from §4.3, escaped.

| # | Command | Expected | On failure |
|---|---|---|---|
| S1 | `curl -sS -X POST https://agent.creao.ai/api/v1/runs -H "Authorization: Bearer $CREAO_API_KEY" -H "Content-Type: application/json" -d '{"appId":"'$APP'","inputs":{"plan_ref":"00000000-0000-4000-8000-000000000000","category":"dinner","brief":"…"},"webhookUrl":"'$HOOK'","idempotencyKey":"smoke-run-0001"}'` | 202 `{"id":…,"status":"pending"}` | Retry with `POST /api/v1/apps/$APP/runs` and `{inputs, webhookUrl}`; set the fallback const |
| S2 | S1 again with the same key | **Same** `id` | Idempotency not honoured: dedupe locally on `research_runs.idempotency_key` and **disable** the start retry (T4) |
| S3 | `curl -sS https://agent.creao.ai/api/v1/runs/$ID -H "Authorization: Bearer $CREAO_API_KEY"` every 15 s | Status → `completed`. **Save the raw JSON** to `docs/research/creao-run-sample.json` and adjust `CreaoRun` (id vs runId, result, errorCode) | Use `/api/v1/apps/$APP/runs/$ID` |
| S4 | Webhook inbox | Body `{runId,status,threadId,result}` + `X-Creao-Delivery-Id` (UUID) | Rely on polling |
| S5 | Start one more run, then `curl -sS -X POST …/runs/$ID2/cancel …` | Status `cancelled` | Cancel unsupported: just ignore late results |
| S6 | `curl -sS -o /dev/null -w "%{http_code} %{redirect_url}\n" "…/runs/$ID/artifacts/download?artifactId=$ENC" -H "Authorization: Bearer $CREAO_API_KEY"` | `302 https://…` | The Concierge fallback is code-only |
| S7 | In the [API] thread | `tab ping`, the validate→fix→submit loop and progress lines are visible; stub/Fly logs show the calls | Secrets or skill missing in API runs: ask the booth; fall back to the result.text path only |
| S8 | Time 3 runs; read the credit balance before and after | Record latency and credits per run in §11 / PLAN §19 | Ask the booth for a top-up |

### 8.3 Manual phone tests

| Test | Steps | Expected |
|---|---|---|
| Join on iPhone | Scan QR → `/j/<code>` → fill in → tap "Text Tab" | Messages opens to the assigned number with the body prefilled (or the plain-text number + code is visible). JOIN reaches the agent; the welcome arrives within a few seconds. |
| Capacity | Operator exhausts the seats, or A forces a 409 | Capacity message; no crash |
| Console on the projector laptop | Open `/console?k=…` and view it from 5 m | Lanes readable; they flip on hold/capture; X-ray delegates show 🔒 only; no budget digits anywhere |
| Live Scout beat | Press "Start live Scout" | Chip appears in under 2 s; first progress line within the measured latency |
| Tamper beat | Ops → Tamper | TAP step 6 ✗ "content-digest"; nothing captured; ledger unchanged |
| Itinerary | After capture | `T_ITINERARY` arrives; the itinerary page opens on the phone; the .ics adds 2 events at the right local times |

---

## 9. Cut list (your area; in PLAN order) and never-cut items

**Cut in this order if behind:**
1. Plan page (not built).
2. Refund (not yours).
3. `threadId` re-roll (stretch: `POST /runs {appId, threadId, inputs, idempotencyKey:"scout-<ref>-<cat>-a2"}`; whether form inputs apply with a threadId is UNVERIFIED).
4. **Voice.** Default **NO-GO** unless every condition in the "Voice stretch" section (end of §5) holds.
5. PNG cards (not built; text only).
6. Concierge Notion via connector → `notionFallback.ts`.
7. Concierge entirely → code ICS + Notion; README links one Scout run.
8. (A) free-text ballots → digits.
9. (A) budget parse → tiers.

UI trims before any cut above: drop any motion library and the delivery lane, simplify the stepper, and reduce `/` to the bare form.

**Never cut:**
- Judge self-join page.
- Private filter + `privacy.e2e.test.ts`.
- Scout live run + CREAO lane.
- Console ledger.
- README with agent IDs + share link.
- Video.

---

## 10. Demo and pitch responsibilities

- **Before each judge:**
  - `PLANNER_MODE=live`;
  - cached fixtures fresh (Sunday snapshot);
  - console open with `?k=`;
  - the [API] run thread open in a second tab;
  - live Scout not started in the last 3 min;
  - judge seats released after each judge (Ops → Release seats).
- **Table 0:00:** press **Start live Scout**. Say: *"CREAO is researching right now; the options you'll see come from a run that finished earlier."* Point at the progress lines arriving from inside the sandbox.
- **Table 4:15:** open the [API] thread and show the validate → fix → submit loop. Say: *"Remove the agent and Tab has nothing to vote on."*
- **Stage 0:50–1:20:** narrate the CREAO lane and the self-validation. Use: *"CREAO does the open-world work; fast per-message parsing stays local for responsiveness."*
- **Q&A you answer** (PLAN §16):
  - #3 inference: always 3 picks, no reasons, and the filter can't be called;
  - #5 "Couldn't Google Places do this?";
  - #6 why Anthropic + CREAO;
  - #12 why this scoring.
- **Vocabulary:** "private delegate per friend", "sealed constraints", "plain-code mechanism". Never "Nash welfare", "advocates", "agents negotiate", "Visa-verified", "$0 instantly".
- **B owns:** video, README, Devpost, table-card QR, and the backup clips on the laptop.

---

## 11. UNVERIFIED items and their smoke tests (record results in PLAN §19)

| # | Item | Why unverified | Smoke test | Fallback |
|---|---|---|---|---|
| U1 | `POST /api/v1/runs` with appId in the body; `GET /api/v1/runs/{id}`; `POST …/cancel` | Listed in creao.md (authoritative); the public api-trigger page shows only app-scoped routes and no cancel | §8.2 S1/S3/S5 | App-scoped routes; no cancel |
| U2 | `idempotencyKey` replay | Listed in creao.md; absent from the public api-trigger page | S2 | Local dedupe by `idempotency_key`; no start retry |
| U3 | GET run JSON field names (`id`/`runId`, `result`, `errorCode`, `threadId`) | Not shown for the `/api/v1` path | S3: save the raw JSON and adjust `CreaoRun` (keep it lenient) | — |
| U4 | Secrets inside API-triggered runs | Docs say "injected into every agent sandbox session" but are silent on API runs | S7 (`agent.ping` in Fly logs from an [API] run) | Booth; result.text-only path |
| U5 | GitHub skill available in API runs, and where its files land | Docs silent | S7; SKILL.md has the curl self-install fallback | Saved `./tab` + `./schema` in the environment |
| U6 | Python 3 in the sandbox | Docs don't name runtimes | Ask in chat: `python3 --version` | SKILL.md curl commands |
| U7 | Input field names preserved exactly by Create Agent | Docs: fields are "generated automatically from the original prompt" | Inspect the agent page form; the S1 run shows the values in the thread | Rename via Update Environment chat |
| U8 | Notion page **create** in an unattended run | Docs: the connector can "Read and update pages, databases, and wikis" (no create) | Concierge test API run; check "Tab Plans" | `notionFallback.ts` |
| U9 | Run latency and credits per run | Docs: "a few minutes" | S8 ×3 | Cached + pre-warm; top-up |
| U10 | Share icon present on an [API] thread | Share is documented per thread; [API] runs appear as threads | Share icon in the [API] thread; open the link in incognito | Share a UI test-run thread seeded with the same PII-free inputs |
| U11 | `capi_` rate limit | Not documented for the API Trigger | Booth question 6; watch for 429 | Poll every 20 s |
| U12 | Webhook reaches the Fly URL | Docs: public https only, no redirects | S4 with the Fly hook | Polling |
| U13 | Artifact redirect from Node `fetch(redirect:"manual")` | The route's behaviour from Node is untested | S6, plus a Node one-liner | Skip artifacts |
| U14 | iOS `sms:` prefilled body (PLAN §19, B) | Undocumented by Apple | Tap on 2 iPhones (one on older iOS) | Plain-text number + code (always shown) |
| U15 | City of LA rate = 10.25% | County rate VERIFIED (CDTFA L-1037: 9.750% → 10.250% from Oct 1, 2026); the city rate is inferred from its absence in the per-city list | CDTFA address lookup for 325 Westwood Plaza | Use 0.1025 |
| U16 | Applied Intelligence track text | Page not readable without login | live.lahacks.com/tracks | Ask organizers |
| U17 | `@notionhq/client@5.27.1` (1 day old) works and returns `url` | New release | One `pages.create` in scratch | Pin 5.27.0; build the URL from the id |
| U18 | next 16.4.2 (2 days old) builds on Vercel | Fresh release | `pnpm --filter ./apps/web build` locally, then on Vercel | Roll back one patch (16.4.1) |
| U19 | Voice: Photon SMS number purchase; SIP echo; `data_collection_results.intent` path; ElevenLabs signature tolerance | The cookbook covers UI test calls only | V2 echo; log the raw webhook body once | Cut voice (cut #4) |
| U20 | Tab Scout output stays within 6–16 options with valid evidence URLs at the default model | Model-dependent | 3 S8 runs pass `validate` within 5 rounds | Pick a stronger model on the agent page; cached options |

**Sources checked today:**
- `hackathon-context/creao.md` (Tech Stack page);
- docs.creao.ai: pro/api-trigger, features/secrets, features/skills-and-connectors, features/agents, features/chat, pro/agent-runtime-environment;
- local Photon beta docs (`photon_dl/beta_cookbooks_voice_elevenlabs.md`, `beta_get-started_voice.md`);
- Context7: /websites/elevenlabs_io (outbound SIP call, auth header, webhook signature), /makenotion/notion-sdk-js, /colinhacks/zod, /vercel/next.js, /honojs/website;
- the `@anthropic-ai/sdk@0.135.0` package source (`helpers/zod.js`, `lib/parser.js`, `lib/transform-json-schema.js`, `OutputConfig` typings) and the claude-api skill (model defaults);
- the `shadcn@4.22.0` and `@4.21.4` tarballs (CLI flags) and the ui.shadcn.com registry (component JSON 200s);
- `postgres@3.4.9` `src/types.js`;
- the npm registry (publish dates: next 16.4.2 Oct 15; react 19.3.1 Oct 14; shadcn 4.22.0 Oct 16, 4.21.4 Oct 7; @notionhq/client 5.27.1 Oct 16, 5.27.0 Sep 29; zod 4.6.7 Oct 12; vitest 5.0.5 Oct 15; tailwindcss and @tailwindcss/postcss 4.3.3 Jul 16; @anthropic-ai/sdk 0.135.0 Oct 15; hono 4.13.13 Oct 4);
- CDTFA L-1037 PDF text (cdtfa.ca.gov/formspubs/l1037.pdf);
- Cloudflare TryCloudflare docs and the microsoft/winget-pkgs manifest `Cloudflare/cloudflared`;
- the local devpost.txt / devpost.html.

---

## Verification log

### Corrections made

| # | Where | Draft said | Corrected to | Evidence |
|---|---|---|---|---|
| 1 | T6 `rateBundles`, `repairScoutJson` | `if (!r.parsed_output) return default`, implying parse returns null on bad output | Wrap in try/catch. `messages.parse()` **throws** `AnthropicError` on JSON or zod failure. | `@anthropic-ai/sdk@0.135.0` `helpers/zod.js` (`parse` throws) and `lib/parser.js` |
| 2 | T6 `rateBundles` | `max_tokens: 800` | `max_tokens: 4096` (repair: 12000), plus handling of `stop_reason === "max_tokens"`. Adaptive thinking is on by default on Sonnet/Haiku 5.5, so a low cap truncates the JSON. | claude-api skill thinking/effort table |
| 3 | T6 | No client timeout | `new Anthropic({ timeout: 30_000, maxRetries: 2 })` (TS timeout in ms; default 10 min) | claude-api skill "Client config" |
| 4 | C-1, T6, U20 | Chunk ratings in groups of 3 until the contract changes; U20 for cross-chunk calibration | One call with indices 1..15. `index.max(3)` is runtime-only and we never `.parse()` candidates. The RateCandidate proposal is kept for type clarity. The old U20 was removed. | zod `z.infer` semantics; PLAN §8 `Ratings` has no max |
| 5 | T8 | `shadcn@4.22.0` (1 day old) | `shadcn@4.21.4` (Oct 7). Flags `-c`, `-b radix`, `--no-monorepo` confirmed in both tarballs; `-y` defaults to true for `init`. | npm registry; `dist/index.js` of both tarballs |
| 6 | T8 | `transpilePackages: ['@tab/shared']` | Not needed: Turbopack transpiles workspace packages. Add it only if the build fails. | Context7 /vercel/next.js transpilePackages page |
| 7 | T1, T7, T6 `compose` | Plan fields used raw | Normalize `event_date` (postgres.js returns `Date`) and `time_*` (returns `"HH:MM:SS"`) before `ResearchBrief.parse` and compose. Otherwise the HHMM/IsoDate checks throw. | `postgres@3.4.9/src/types.js` (date parser for 1082 only) |
| 8 | T5 | `checkResearchReady` called inline from both `/agent/options` and reconcile | Run through due_jobs `check_research_ready` / `run_shortlist` with dedupe keys, so the shortlist is built exactly once | Race analysis; PLAN M5 pattern |
| 9 | T5 `useCached` | Always upserts cached options | Skips if live CLI options already exist for that run | Logic fix (no mixing of live and cached) |
| 10 | C-9, T12 `liveDemo` | Live demo ran against the demo plan's `plan_ref` | Uses a dedicated "showcase" plan ref, so the active-run lookup stays unambiguous | Active-run check design (PLAN §8) |
| 11 | C-8 | Not covered | Reset must mint a new `plans.ref`, otherwise Scout idempotency keys replay old runs | creao.md idempotencyKey semantics |
| 12 | T4 client | `res.json()` on every response; only 302 accepted on artifacts; unconditional start retry | Text-then-JSON (empty cancel body safe); accept 301/302/303/307/308; retry only if S2 confirmed key replay | creao.md + api-trigger (cancel body undocumented) |
| 13 | C-5, T2, T11 | The itinerary and the CREAO result share `research_runs.result` without keys | `result.itinerary` vs `result.creao`, so reconcile can't overwrite the itinerary | Logic fix |
| 14 | T3 SKILL.md | The curl fallback downloads only `tab`; `tab schema` then has no files; exit codes 0/1 only | The fallback also downloads `schema/*.json`; all exit codes 0–5 documented; the schema path resolves next to the script, else `./schema` | Design consistency |
| 15 | T3 `test_tab.py` | Unspecified invocation | Run the CLI via subprocess, because `tab` has no `.py` extension and can't be imported | Python import semantics |
| 16 | §2, T6, T13 | Tests could import `PrivateConstraints` | Tests use plain literals; no `@tab/shared/private` import and no `private_constraints` SQL string in tests, so the P1 grep stays green | PLAN P1 allowlist |
| 17 | §3.1, §7 | No CORS note for the ops bar | `/ops/*` needs preflight support for `Authorization` from `WEB_ORIGIN` (A) | Browser CORS rules (custom header triggers a preflight) |
| 18 | §2, T2 | Route mounting and job registration implicit | An explicit announced PR to the foundation's `src/index.ts` | Ownership table |
| 19 | T6 `demo.fixture.test` | Two assertions | Adds: shortlist index 2 ends ≤ 22:00 (the scripted judge reply "not if it ends after 10"); seed dates 2026-10-18; arithmetic for the $30 cap at TAX 0.1025 | PLAN §15 demo script |
| 20 | T6 tests | `pnpm --filter agent test decide` | `pnpm --filter ./apps/agent exec vitest run src/decide` (path filter; the package name is the foundation's) | pnpm filter syntax |
| 21 | Voice V3/V4 | Fields cited from the Python SDK; `ELEVENLABS_WEBHOOK_SECRET ≥16 chars` | Endpoint, body, response and `xi-api-key` verified against the ElevenLabs API docs; the secret is the one ElevenLabs issues; 30-min tolerance marked as our policy; the `intent` path stays UNVERIFIED | Context7 /websites/elevenlabs_io |
| 22 | Voice V1 | Brief SIP summary | Added the cookbook steps: SHA-256 outbound, one-time password, no `sip:` prefix, Media Encryption Allowed | Local Photon cookbook copy |
| 23 | T12 TAP label | "✓ Signature verified by merchant (RFC 9421)" | "Signed agent request (Visa Trusted Agent Protocol) ✓ verified by merchant"; RFC 9421 only in the detail row | PLAN §1 vocabulary |
| 24 | §9 cut #4 | "every §T5 condition" (wrong reference) | "the Voice stretch section (end of §5)" | Internal reference |
| 25 | §4.2 CREAO Q6 | Booth question about `/api/v1/runs`, `idempotencyKey`, cancel | Dropped: creao.md is authoritative for the event and S1–S5 answer it faster (judge_panel calls the UNVERIFIED flag overcautious). The rate-limit question kept as Q6. | creao.md; judge_panel §1 |
| 26 | T10 | Share link published directly | Check the thread for the token prefix first; rotate `TAB_AGENT_TOKEN` if found (a share link exposes the full conversation) | features/chat (VERIFIED) |
| 27 | T1 | Not covered | `pnpm why zod` must show a single 4.6.7, because the SDK's `zodOutputFormat` imports `zod/v4` via a peer dependency | SDK `helpers/zod.js` imports `zod/v4` |
| 28 | T5 `research_typing` | B calls `MessagingPort.setTyping` directly | Calls A's typing helper (A owns Photon/DM routes); agreed at 8:45 | Ownership table |
| 29 | T11 fallback | Not covered | The fallback `Itinerary` fills fixed logistics strings so the required schema fields validate | PLAN §8 `Itinerary` (all logistics fields required) |
| 30 | T2 vs PLAN §13 | Silent schedule deviation | Noted: the 6:45 gate needs only the CLI path; CreaoPlanner lands 6:35–7:45 | PLAN §13 |
| 31 | T4 facts | Webhook statuses unspecified | Webhook `status` is only `completed` or `failed`, with no error details (poll for `errorCode`); delivery id is a UUID constant across attempts | docs.creao.ai/pro/api-trigger |
| 32 | T6 | Fallbacks not discussed | The server-side refusal `fallbacks` beta for Sonnet 5.5 is deliberately omitted: a refusal only degrades to default ratings (avoids overengineering) | claude-api skill |
| 33 | T8 | `/` built first | `/j/[code]` first (never cut); `/` kept minimal (demo uses the seed) | Time realism vs the 6:45–11 PM load |
| 34 | §4.1 Secrets | — | Added the name rule (uppercase, digits, `_`) and the "Add secret" path | features/secrets |
| 35 | C-7 | Implicit env var | `AGENT_API_ALLOW_TEST_REF` declared as an additive `.env.example` entry, announced | PLAN §11 lists env vars exhaustively |

### Re-verified and unchanged (VERIFIED today)

- npm versions and dates: next 16.4.2, react/react-dom 19.3.1, tailwindcss and @tailwindcss/postcss 4.3.3, zod 4.6.7, vitest 5.0.5, @anthropic-ai/sdk 0.135.0, hono 4.13.13, @hono/node-server 2.1.5, postgres 3.4.9, pino 10.4.0, tsx 4.23.15, typescript 6.0.3 (7.0.2 is latest, and PLAN pins 6), @notionhq/client 5.27.1.
- Anthropic:
  - model ids `claude-haiku-5-5` and `claude-sonnet-5-5` are in the SDK `Model` type;
  - `output_config.effort` values;
  - `zodOutputFormat` path;
  - Haiku 5.5 default effort `medium`, Sonnet 5.5 default `high` (so set `low`);
  - no prefill, no forced `tool_choice`, `refusal` stop reason.
- CREAO:
  - base URL and `capi_` keys (account vs agent key);
  - routes per creao.md; webhook body and headers; at-least-once delivery; no redirects; 10 s timeout; no webhook on pre-execution failure; artifact 302 + 1 h + don't forward the key;
  - Secrets env exposure and account scope;
  - skills install from repo root or subdirectory, plus the frontmatter rules;
  - Notion connector path;
  - Create Agent location, output formats, Auto/Ask-first behaviour and "Action blocked";
  - Update Environment → Save to Agent and what it saves;
  - share-link semantics and revocation.
- zod 4: `z.e164()`; `z.toJSONSchema` defaults to draft-2020-12.
- Hono: `bodyLimit` from `hono/body-limit` with `maxSize` and `onError`.
- Next 16: async `params`/`searchParams`.
- Notion: `pages.create` with `parent.page_id`, the `title` property, `children` blocks; default version `2025-09-03`.
- CDTFA L-1037: LA County 9.750% → 10.250% effective Oct 1, 2026.
- cloudflared: quick-tunnel command and winget package id.
- Devpost: subdomain la-ai-hackathon-2026 and the "What to Submit" list.
- Photon/ElevenLabs cookbook: SIP addresses, TLS, codecs, and that shared lines cannot take calls.

### Left UNVERIFIED (each has a smoke test in §11)

- U1–U13 (CREAO runtime behaviour on the hackathon account).
- U14 (iOS `sms:` body).
- U15 (City of LA rate by address lookup).
- U16 (track text).
- U17 (`@notionhq/client@5.27.1` freshness).
- U18 (next 16.4.2 freshness).
- U19 (voice purchase, echo, webhook payload path and tolerance).
- U20 (Scout output quality at the chosen model).
- Also unverified, carried from PLAN: `threadId` re-roll input behaviour (cut #3), and `chatModelId` model id values (not used).
