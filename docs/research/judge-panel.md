# Adversarial judge panel review: "Tab"

## Verdict

The product hangs together only if it is pitched as one thesis: **"Say no without saying why. Nobody pays until everyone's in."** Pitched as four sponsor integrations, it reads as scattered.

The six reports hold several blocking contradictions, listed in §6. The biggest is that three reports still build on iMessage features that Photon 2.0 does not have. A second is that two reports make privacy claims that contradict each other.

## 1. Claims I re-verified myself (decision-critical)

| Claim | Result | Source |
|---|---|---|
| iMessage on 2.0 has no polls, tapbacks, edits or unsend | **Confirmed.** The iMessage message union is Text, Attachment, MessageRead, SpaceTypingUpdate and ImessageGroupContent only. Polls, reactions and edits exist only in the SMS and WhatsApp unions. sendMessage is described as "text and image messages". | Local OpenAPI: `components.schemas.ImessageMessageContent`, `POST /v1/projects/{id}/messages` |
| 2.0 = `@photon-ai/api`, and spectrum-ts = Stable | **Confirmed.** "Beta (2.0) documents the Photon platform… `https://api.photon.codes/v1`". The brief's "SDK reference" link points to spectrum-ts (Stable), which contradicts this. | photon-llms.txt lines 3-22; photon.md |
| Free plan includes 25 iMessage assignments, and they can be released | **Confirmed.** `DELETE …/imessage/assignments/{id}` frees the seat. | plans-and-billing.md lines 44, 74; OpenAPI |
| Voice needs an SMS number plus a payment method; shared lines can't take calls | **Confirmed.** "Add a payment method before you buy resources". Voice costs $0.013/min, and the Free plan includes no voice minutes. | billing.md line 40; get-started/voice.md line 26 |
| Photon is not on Devpost | **Confirmed.** Zero matches in the Devpost prize list. How to enter is unknown. | devpost.txt |
| Only one CREAO track per project? | **Still unresolved, but leans to a single track.** creao.md says "Pick the track that fits" and "select the CREAO track" (singular). Devpost lists the three prizes separately. | creao.md lines 81, 104 |
| A CREAO run share link exposes the whole conversation | **Confirmed.** "Anyone with the link can view the full conversation — including messages, artifacts, and generated files." The README link therefore publishes the run's inputs. | docs.creao.ai/features/chat |
| CREAO Secrets are account-wide | **Confirmed.** They are "injected into every agent sandbox session". Whether they load in API-triggered runs is not stated. | docs.creao.ai/features/secrets |
| `threadId` and `idempotencyKey` are live | Both are listed on the hackathon Tech Stack page inside creao.md, which is authoritative for the event. The CREAO report flags them as UNVERIFIED only because they are missing from the public docs, which is overcautious. A smoke test is still needed. | creao.md, Tech Stack section |
| TAP rules: 8-minute window, minimum components, 6 verification steps | **Confirmed.** The spec allows "additional fields" only where "an Agent or a Payment Scheme may optionally define" them. Adding `@method` and `content-digest` is therefore allowed but is our own extension, so say so. | developer.visa.com TAP spec |
| "Sunday" prior art | **Confirmed.** It is an iMessage concierge inside group chats that books restaurants, sends Partiful invites and makes voice calls. It won "[Anthropic] Best Use of Claude Agent SDK" at TreeHacks 2026. | devpost.com/software/sunday-94odas (via curl) |
| Zelle 76% and 20% figures | **Confirmed verbatim.** Release dated June 30, 2026; research by Accelerant Research with Early Warning Services. | zelle.com press release |
| Field size | **144 participants** on Devpost, roughly 40-50 teams. It is a small field, so odds of placing are better than at a large event. | devpost.txt |

**New and unanalyzed by all six reports:** Devpost also lists prizes with unknown requirements:
- Paper "Best Designed Hack": $1.5k / $1k / $500
- Intuit: gift cards, a fintech fit
- MLH "Best Use of ElevenLabs": earbuds; the voice stretch would qualify for free
- Base44 "Build Something People Want": $2k
- Cognition Devin: $5k

Check each requirement. Enter only the ones the product already meets as it stands.

## 2. Scores by panel (best proposed version)

### LA Hacks main judges: 7/10

**Still disappointing:**
- "AI plans dinner in iMessage" has already won a prize (Sunday).
- All-or-nothing group payment has existed since 2012 (PayByGroup) and in Airbnb split pay since 2017. Originality rests entirely on combining sealed constraints with an assurance contract.
- The vocabulary is too dense for 3 minutes: RFC 9421, Nash welfare, TAP, advocates, CREAO and Cybersource.
- Execution breadth is very high for 3 people in about 19 hours.

**Doubted claim:** the framing report's 1-5 scores for F5 (all 5s) are judgment and come with no evidence.

**Biggest risk:** a half-working demo across 4 integrations. Polish (Execution & Polish) loses to a narrower project that works perfectly.

### Photon: 6.5/10 (7.5 if the judge's own phone joins live and voice ships)

**Still disappointing:**
- Photon's first "What you can build" bullet is "Agents that join human-to-human conversations." Tab cannot.
- With no polls, tapbacks or effects, the iMessage experience is text plus images, which feels less native than Stable-SDK projects.
- Calling 3 stateless Anthropic calls "advocates" or "multi-agent" will read as overclaiming to a judge who values depth.

**Doubted claims:**
- Whether the agent-profile name and avatar show on a shared line is UNVERIFIED.
- So is how the `sms:` prefilled body behaves on iOS.

**Biggest risk:** this is the most crowded track at an AI hackathon. Its entry mechanism is unknown (not on Devpost), and the "which SDK counts as 2.0" ambiguity could disqualify the build. Settle both at the booth before 6:45 PM.

### CREAO: 7/10 maximized (the report's "86/100" is self-scored)

**Still disappointing:**
- The judges' first question will be "couldn't Google Places or Perplexity do the Scout's job?" The "remove the agent and it dies" line is true only because we chose to route research through CREAO.
- The Concierge design has the agent call **our own** venue API for availability and a quote. That is a deterministic call wrapped in a run that takes minutes, and a CREAO judge will see it as theater.

**Doubted claims:**
- Browser Use inside API runs (unverified).
- Secrets and skills inside API runs (not stated in the docs).
- Multi-track eligibility.

**Biggest risk:** latency in a 4-5 minute table demo. Runs "usually take a few minutes", so Scout followed by Concierge on the critical path cannot be shown live. Only a pre-warmed run plus the live progress lane can.

### Visa: 7.5/10

**Still disappointing:**
- In TAP terms, `agent-payer-auth` is sent with no Agentic Payment Container, so the agent doesn't really pay; each human pays on a web page.
- The key directory is a mock.
- A Visa judge will push back on capturing at booking for an ordinary restaurant.
- ICC, 3DS and network tokens are all absent. Keeping them out is correct, but it limits "Visa-native" depth.

**Doubted claims:**
- Refund on a same-day sandbox capture (may need a void).
- merchantDescriptor rendering.
- Sandbox activation time.

**Biggest risks:**
- Execution: about 10 hours of owner-C work on Microform v2, the capture context with HTTPS `targetOrigins`, and JWT auth, all working on a phone by the 11 PM checkpoint.
- A coherence hole (see §5, point 3): CREAO researches *real* venues, but the money goes to a *demo* venue.

## 3. What would still disappoint each panel, beyond the above

**Photon:**
- "Status bubble edited in place" still appears in the plan (line 58), the CREAO report ("iMessage status bubble edited in place") and the framing report (Craft). It cannot be built.

**CREAO:**
- Two LLM stacks: Anthropic for the personal agents and coordinator, CREAO for research. The pitch must say why. Suggested line: "CREAO does the open-world work; fast deterministic-adjacent parsing stays local for responsiveness."

**Visa:**
- Loyalty "per-share" is cosmetic. Cut it rather than oversell it.

**Main:**
- The Trust Console risks becoming the demo instead of the phone. Judges remember the phone.

## 4. Single biggest risk per prize (summary)

- **Main:** scope sprawl, which leads to an unpolished demo.
- **Photon:** entry mechanism and SDK eligibility are unconfirmed, and the field is crowded.
- **CREAO:** looks swappable, and its latency is invisible or fake in the demo.
- **Visa:** Cybersource and Microform execution on time, plus the real-venue vs demo-merchant incoherence.

## 5. Is the combined product coherent?

It is coherent **if** every element is presented as evidence for one sentence: *"Tab is the friend who knows everyone's budget and tells no one, and nobody pays until everyone's in."* Under that sentence:
- Photon is "private by design, DMs not group chat".
- CREAO is "the open-world scout that never sees a budget".
- Visa is "per-person consent, all-or-nothing, an agent that cryptographically can't commit what humans didn't approve".

It turns scattered with Slack, Telegram, the Plan page, Watcher schedules, Browser Use, ICC, loyalty, seat transfer, or "advocates negotiating".

Three fixes are required for coherence:
1. **Purge impossible iMessage features** everywhere: polls, tapbacks, edits, effects, group posts.
2. **Pick one privacy claim.** The privacy report is right. Replace "no budget ever entered any model context" (framing report, red-team demo) with: "Only your own agent hears your budget. The group agent and CREAO never get it, and every money decision is plain code." The red-team demo still works, because the group coordinator truly doesn't have the budget.
3. **Merchant honesty.** Label the merchant "Tab Partner Venue (sandbox merchant of record)". Never brand the pay page with a real restaurant's name, which would impersonate that business. Pitch it as: "CREAO finds real options; partner merchants integrate Tab checkout; the demo merchant is ours." Make the demo experience prepaid or ticketed ("dinner + show" tickets) so capture at booking is normal.

## 6. Contradictions between reports (with resolutions)

1. **Photon capabilities vs the CREAO, framing and privacy reports.** The latter three assume a status bubble edited in place, native polls, or a "native poll fallback". → Resolution: option-card PNGs, "reply 1/2/3", LLM-parsed free-text ballots, typing refresh, and threaded replies only. Live progress shows on the Trust Console, not as edited DMs.
2. **Privacy report vs framing report and plan.** The privacy report has a personal LLM read the budget from the DM. The framing report and plan say budgets never reach any model, using regex stripping. → Adopt the privacy report: per-person context, a template confirmation, and code-owned numbers. Delete the regex number stripping. Keep the value-specific payload test on coordinator, CREAO and fan-out payloads.
3. **Framing "advocate per person with isolated memory" (3.5 h) vs privacy "personal delegate = one stateless call" (about 1.5 h).** They are the same thing. → Build it once (about 2 h). Present it as "a private delegate per friend submitting sealed constraints to a code mechanism". Never say "agents negotiate".
4. **Agent naming.** The Slack report says Researcher + Scribe + Watcher; the CREAO report says Scout + Concierge with remind mode. → Use Scout and Concierge. Drop Watcher; it duplicates Concierge remind mode, and that only matters for Team Empowerment, which is probably not enterable.
5. **Browser Use.** The framing report has the Scout "live-verify via Browser Use"; the CREAO report rates it high-risk and unverified in API runs. → Use web search and fetch only. Browser Use is not in the plan.
6. **Concierge on the critical path** (CREAO report) vs Photon "responsive" and the 4-5 minute table demo. → Move Concierge **after** the commit: itinerary HTML, .ics and Notion page, asynchronous. The venue prices the order deterministically, as the plan already says.
7. **Voice.** The Photon report says re-evaluate it ($400, 4.5 h); the framing report says high risk; the plan says cut. → Make it a gated stretch: only if a card is on the Photon account by 6:45 PM **and** the 11 PM end-to-end checkpoint passes. It also earns the MLH ElevenLabs entry.
8. **Slack report EV** includes Team Empowerment, and the CREAO report's "secondary". creao.md's singular wording makes this near zero. → Ignore it unless the booth says yes. The Slack report itself says not to build Slack (agreed: Slack isn't a Photon channel).
9. **Wording.** The plan's pay page says "Otherwise $0", and reports use "auto-reverse = $0". The Visa report corrects this. → Say "Nobody was charged; your pending authorization was released." Never say "$0 instantly".

## 7. Minimum feature set that maximizes expected prize value

### Core (never cut)

1. **Join flow.** QR code → join page (phone, optional budget field) → `assignments.create` → `sms:` link with "JOIN code" → DM. Release seats after each judge.
2. **DM craft.** Typing indicator within about 1 second, refreshed during runs; mark-as-read; threaded replies; option-card images (plain text first, images if time allows).
3. **Budget privacy.**
   - Budget is parsed by a personal-context LLM into `{target, hard_max}`, with a template confirmation and tier buttons as fallback.
   - The coordinator and CREAO get filtered options only.
   - A payload privacy test runs on those contexts.
   - holdGate: share ≤ hard_max, or a private yes (about 1 h; maps to Visa ICC "spending limits").
4. **CREAO Scout** (one saved agent, one run per category):
   - The `tab` skill/CLI with `options validate|submit` and `progress`.
   - `TAB_AGENT_TOKEN` (narrow scope) in Secrets.
   - `idempotencyKey`; webhook with re-fetch, plus polling.
   - The README run link points at a PII-free run, since the share link exposes the full conversation.
5. **Filter and Nash-welfare shortlist** in pure code. Free-text secret ballot. "k of n voted" with no names.
6. **Venue (merchant of record).**
   - Microform pay page; auth with TOKEN_CREATE and stored-credential (COF) flags; capture all, reverse all, timeout reversal.
   - Prepaid or ticketed experience; "released" wording.
7. **TAP.**
   - Own signer and verifier with a strict 8-minute window and nonce store.
   - Content-digest binding to the consent set, recomputed by the venue.
   - Tamper, replay, expired and wrong-tag buttons.
   - Mock key directory, labelled as a mock.
8. **Trust Console.**
   - Lanes Invited → HELD → CAPTURED/RELEASED with real Cybersource IDs.
   - Context X-ray (budget shown as a lock icon only).
   - CREAO lane fed by agent-posted progress, plus run link.
   - TAP panel.
   - Three merchant counters.
   - Reset/Replay.
9. **Concierge after the commit** (asynchronous): itinerary artifact, .ics, Notion page. This is the second agent and second README run link. Fall back to Notion from code.

### Stretch, in order (each only after the 11 PM checkpoint)

1. Voice nudge plus call memory (Photon Voice $400, MLH ElevenLabs). Needs a card and Photon voice setup.
2. `threadId` re-roll on "none of these" (about 1 h; CREAO depth).
3. Post-purchase "Sam can't make it" refund (test void vs refund first).
4. Read-only Plan page.

### Cut

Slack, Telegram, Watcher schedule, Browser Use, ICC/VARS, 3DS, Decision Manager, loyalty, Team Empowerment work (unless the booth explicitly allows it).

### Table demo choreography (4-5 min)

Pre-stage 3 team phones already in the plan. The judge joins as the 4th with a secret $30 cap, and the shortlist changes silently. Start a live Scout run at second 0 and say that the options shown come from a run that finished earlier. Then: judge votes, judge places a hold with the test card, TAP ✓, capture. Then reset, decline, everything RELEASED, plus one tamper rejection. Lastly the red-team ask: "what's Sam's budget?"

### Expected value (judgment, not data)

| Prize | Estimate |
|---|---|
| Visa $2k | about 0.30 → $600 |
| CREAO Disruptor $2k | about 0.25 → $500 |
| Photon iMessage $700 / $300 | about $235 |
| Overall | about $350 |
| Voice, if shipped | about $120 |
| **Total** | **about $1.7-1.8k** |

Adding Slack, Telegram or Browser Use lowers this total by taking polish hours.

## 8. Booth questions that gate the plan (by 6:45 PM)

- **Photon:** how do we enter (not on Devpost)? Does `@photon-ai/api` count as "built on 2.0" (the brief links spectrum-ts)? Can one team win both iMessage and Voice? Is the shared-line pool safe for about 15 judge assignments?
- **CREAO:** one track only? Do Secrets and GitHub skills load in API runs? Can the README link be a run we choose?
- **Visa:** is a mock key directory acceptable? Are `content-digest` / `@method` extensions acceptable? Is N cardholder-initiated authorizations captured all-or-nothing the pattern you'd recommend?
- **Devpost:** what are the requirements for Paper, Intuit and MLH ElevenLabs? Enter only if they fit as-is.

Sources:
- `C:\Users\chris\orca\projects\la-hacks\hackathon-context\` (`photon.md`, `creao.md`, `visa.md`, `lahacks.md`)
- `C:\Users\chris\.claude\plans\i-need-you-to-misty-gizmo.md`
- `C:\Users\chris\AppData\Local\Temp\claude\C--Users-chris-orca-projects-la-hacks\08253e70-32f6-4277-ab02-d60bed2ac808\scratchpad\` (`photon_dl\openapi.json`, `photon_dl\beta_plans-and-billing.md`, `photon_dl\beta_billing.md`, `photon_dl\beta_get-started_voice.md`, `photon-llms.txt`, `devpost.txt`)
- docs.creao.ai/features/chat and /features/secrets
- developer.visa.com TAP spec
- devpost.com/software/sunday-94odas
- zelle.com press release (June 30, 2026)