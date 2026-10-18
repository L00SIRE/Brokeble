# SquadTab: coding-agent instructions (Codex; same content as CLAUDE.md)

SquadTab is an iMessage group planner. Each friend DMs SquadTab privately, SquadTab finds a dinner + show bundle everyone can afford, and nobody pays until everyone's in.
- **Hackathon:** LA Hacks AI, Sat Oct 17 – Sun Oct 18 2026. **Code stops Sun 12:00 PM PDT; no deploys after 11:30 AM.**
- **Read first:** `docs/PLAN.md` (single source of truth: contracts §8, ports §9, API facts §10, env vars §11).
- **Then your plan:** `docs/plans/A-platform-conversation.md`, `docs/plans/B-intelligence-experience.md` or `docs/plans/C-trust-commerce.md`.
- **Research:** `docs/research/*`.
- **Ownership:**
  - A: `apps/agent/src/{photon,router,delegates,plan,notify,jobs,join,ops,money,repo,dev}`, `packages/shared/src/templates.ts`, migration 004.
  - B: `apps/agent/src/{creao,decide,agentApi,voice}`, `apps/web`, `skills/tab`, cached-options fixtures, README/Devpost.
  - C: `apps/venue`, `apps/agent/src/{tap,venueClient}`, `packages/shared/src/{tap,pricing}.ts` (B may change `TAX` with C's ack), migrations 005+.
- Ping the owner before editing their files.
- `packages/shared` changes must be announced and are additive-only after 11 PM.

## Invariants (MUST; each has a test, see PLAN §4)
1. **Budgets live only in `app.private_constraints`.**
   - They are read only by (a) that person's own delegate, (b) `decide/filter.ts` and `decide/score.ts`, (c) `money/holdGate.ts`.
   - Access goes only through `src/repo/privateConstraints.ts`.
   - Import `@tab/shared/private` only from those files.
2. A delegate sees only its own person's inbound message plus that person's own state. **There is no group-coordinator LLM.**
3. **No LLM ever has tools** (no payment, commit, cancel or filter tools). The filter is a pipeline step, never a callable.
4. **Money and privacy messages are templates** (`notify(userId, TemplateId, vars, { key })`, keys from `tplKey()`/`replyKey()`). Only `src/notify/notify.ts` may call `MessagingPort.sendText`.
5. CREAO inputs are `ResearchBrief` only: enums, area, date, times, party size. No names, phones, budgets or user free text.
6. `app.events` and SSE never carry constraint values. The X-ray shows delegates as 🔒.
7. **Cybersource credentials, TMS tokens and card data live only in `apps/venue`** (schema `venue`). Card data lives only inside Microform iframes.
8. Amounts come from the venue DB via `priceBundle()`, never from URLs, LLM output or request bodies.
9. Capture happens only after a TAP-verified commit whose body equals the consent set rebuilt from the DB, with every share AUTHORIZED. Otherwise nothing is captured.
10. Cybersource has no idempotency header. Use a unique `(share_id, op, attempt)`, a deterministic `clientReferenceInformation.code`, a persisted `transactionId` (≤30 chars) and a timeout reversal. **Never blind-retry an auth.**
11. Copy: never "$0 instantly" and never "Visa-verified agent". Say "Nobody was charged; your pending authorization was released."
12. **No secrets in git.** `.env*` is ignored. Run `git status` before every commit. The `capi_` key never reaches the browser or CREAO Secrets.

## Photon: Beta (USE) vs Stable (NEVER)
| | Beta 2.0 (use) | Stable (do not use) |
|---|---|---|
| SDK | `@photon-ai/api@0.5.0` (exact) + `socket.io-client@4.8.4` | `spectrum-ts`, `@photon-ai/advanced-imessage`, npm `photon-cli`, Photon "skills" |
| API | `https://api.photon.codes/v1/projects/{pho_prj_…}/…`, Bearer `pho_sk_…` | stable origins / CLI |
| Inbound | Socket.IO `path:/v1/projects/{id}/events/ws`, emit `subscribe {startSeq, apiVersion:"2026-07-01"}`, `on("delivery",(event,{seq}))` | stable webhooks / HMAC |
| Docs | `photon.codes/docs/beta/*`; Photon MCP search with `version: "Beta"` | non-`/beta/` pages |

Shared lines rules:
- DMs only; the user texts first.
- Reply with the inbound `space.id` (spaceId) and `receivedBy.id` (senderId).
- Content is `{type:"text", format:"plain", text}`.
- Every send carries `"idempotency-key"`.
- **No polls, tapbacks, text.update, edits or effects** (not in the iMessage content union).

## CREAO facts
- Base `https://agent.creao.ai/api/v1`, `Authorization: Bearer capi_…` (account key, server only).
- `POST /runs {appId, inputs, webhookUrl, idempotencyKey(8–128), threadId?}` → 202 `{id,status}`.
- `GET /runs/{id}`; `POST /runs/{id}/cancel`.
- Artifacts: `GET /runs/{id}/artifacts/download?artifactId=…` (auth required).
- **Webhooks are unsigned.** Use a path secret, dedupe on runId / `X-Creao-Delivery-Id`, then **re-fetch the run and act only on that**. Also poll every 15 s.
- Never use developer.creao.ai or `cr_sk_`.
- Agents are saved in the UI (Create Agent / Update Environment); the API only runs them.
- Secrets are account-wide: only `TAB_API_BASE` and `TAB_AGENT_TOKEN` go there.

## Anthropic
- Models: `claude-haiku-5-5` (budget, prefs and ballot parsing), `claude-sonnet-5-5` (ratings).
- Call: `client.messages.parse({..., output_config:{format: zodOutputFormat(Schema), effort:"low"}})`, with `zodOutputFormat` from `@anthropic-ai/sdk/helpers/zod`.
- No `tools`, no assistant prefill, no forced `tool_choice`. Check for a `refusal` stop reason.

## Recommended MCPs (docs only; never put payment keys in MCP configs)
Codex users: register the same servers in your Codex MCP config (HTTP servers by URL; the Cybersource one is the local `cybersource-developer-mcp start` command).
```bash
claude mcp add --transport http photon-docs https://photon.codes/docs/mcp       # search with version "Beta"
pipx install cybersource-developer-mcp && claude mcp add cybersource-developer-mcp -- cybersource-developer-mcp start
claude mcp add --transport http visa-developer https://developer.visa.com/mcp   # OAuth opens only if a feature needs it
claude mcp add --transport http context7 https://mcp.context7.com/mcp
claude mcp add --transport http notion https://mcp.notion.com/mcp               # OAuth
```
Before calling any external library API, look it up with Context7 or the vendor MCP. Never guess. Tag anything unconfirmed **UNVERIFIED** and add a smoke test to PLAN §19.
CREAO has no MCP; use `https://docs.creao.ai/llms.txt`.

## UI work
For any UI change (`apps/web`, `apps/venue` pages), apply the skills `vercel-react-best-practices`, `vercel-composition-patterns` and `web-design-guidelines`.

## Commands
```bash
pnpm install                     # pnpm@10.21.0, Node 22
pnpm dev                         # agent :8080, web :3000, venue :3001 (mock modes by default)
pnpm dev:agent | dev:web | dev:venue
pnpm sim:plan                    # full mocked plan through POST /dev/inbound
pnpm test                        # vitest (includes privacy.e2e, tap.verify, statemachine.race)
pnpm typecheck
pnpm db:migrate                  # applies db/migrations/*.sql in order to $OWNER_DATABASE_URL (postgres role); roles: psql -f db/roles.sql once
pnpm seed:demo                   # demo plan + 3 members + cached options
fly deploy -c apps/agent/fly.toml --remote-only --ha=false   # exactly 1 machine (auto_stop_machines="off")
fly secrets set -a tab-agent KEY=value
# Vercel: projects tab-venue (root apps/venue) and tab-web (root apps/web); push to main deploys
```
Microform `targetOrigins` must match exactly: use the venue's production HTTPS origin, never preview URLs. Localhost works in the official sample but is UNVERIFIED for us (C's S6).
Before reporting work done: tests green, `git status` clean of `.env*` and secrets.
