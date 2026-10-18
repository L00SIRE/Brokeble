# Final recommendation: UI, onboarding and dashboard for the iMessage group-planning agent

I verified the main claims myself on 2026-10-17, using the npm registry, Photon docs, Cybersource docs, Vercel docs, Supabase docs through Context7, the Visa repo and the project briefs. Anything I could not confirm is marked **[UNVERIFIED]**.

## 0. Four corrections to both reports before anything else

1. **You have 24 hours, not 36.** `hackathon-context/lahacks.md` says "Hacking starts on Saturday at 12 PM and ends on Sunday at 12 PM", and "No code may be written after 12 PM… Late submissions will not be accepted."
   - The UI tech report's plan of about 24 hours for one engineer (19.5 hours for the must-haves) can't be done. The UI budget below is about 11 person-hours, spread across the team.
   - Judging has two rounds:
     - **Round 1 is a science fair:** "4-5 minutes each", with "multiple judges" visiting your table.
     - **Round 2 is the top 5 on stage:** "3 min pitch/demo + 5 min Q&A".
   - So the big screen only exists in Round 2. Round 1 runs on a laptop at a table and has to be repeatable 10 or more times.
2. **CREAO has no Notion requirement.**
   - `creao.md` sets one rule: a CREAO agent does the core work, the Devpost README links a run share link and the agent ID, and the demo shows the agent running.
   - Notion appears only as a suggested connector for the $500 "Team Empowerment" track. The best-fitting track is "Best AI-First Disruptor" ($2,000): "Remove the agent, and the product stops working… API Trigger + webhooks, connectors, Browser Use".
   - The same brief says "Runs take minutes… show progress in your UI… no live token streaming on the API Trigger". That is a direct argument for showing CREAO run status on the console. It also means a 3-minute demo can't wait for a live run.
3. **The Photon prize needs Photon 2.0.**
   - `photon.md` says "your project must be built on Photon 2.0" and points to the spectrum-ts SDK. The UI tech report recommends `@photon-ai/advanced-imessage` 2.3.0, which is a different package.
   - Use `spectrum-ts` (12.11.0 on npm, published 2026-10-15). Whether advanced-imessage counts as "Photon 2.0" is **[UNVERIFIED]**, so don't risk it.
   - spectrum-ts cloud iMessage "connects to managed iMessage infrastructure via gRPC". That confirms a persistent backend process is needed and Vercel can't host it ([connection-and-routing](https://photon.codes/docs/spectrum-ts/providers/imessage/connection-and-routing)).
4. **Never write "Visa-verified agent."** With the sample registry from `visa/trusted-agent-protocol`, Visa is not verifying anything; your own merchant checks an RFC 9421 signature. Visa judges score Trust & Responsibility at 15% and will notice.
   - Copy: "Purchased by Tab using a signed agent request (Visa Trusted Agent Protocol)."
   - Console: "✓ Signature verified by merchant (RFC 9421)".

**Top platform risk, confirmed:** group chats need a dedicated line.
- Photon's docs say "Shared-pool mode does not create group chats and does not subscribe to iMessage's group-event stream", while on dedicated lines (Business) "Group creation and inbound group-change events are supported" ([connection-and-routing](https://photon.codes/docs/spectrum-ts/providers/imessage/connection-and-routing)).
- On shared lines, "a shared line cannot send an unsolicited first message" ([beta imessage](https://photon.codes/docs/beta/get-started/imessage)).
- `photon.md` says the same about groups.
- Ask Photon's booth in hour 0. Every design choice below assumes you get a dedicated line, with a DM-only fallback noted where it matters.

---

## 1. Verdict: is UI beyond iMessage needed? Yes, but very little

iMessage is the product. The web exists only where the rules or the judges force it.

| Rank | Surface | Why it earns its place |
|---|---|---|
| **Must** | **One hold page** `/h/[token]`, mobile web. First-time users see the Microform card entry; returning users see a single "Hold $42.00" button. | Card numbers may only be typed into hosted fields. It is also the consent moment. **Merge the tech report's `/join` and `/approve` into this one page**: two routes means twice the states to build for no gain to the user. |
| **Must** | **Trust Console** `/console`, read-only, on a laptop in Round 1 and the projector in Round 2 | Privacy, holds and the agent signature are invisible on a phone. The console also shows the four phones' parallel progress that the audience can't see. It is the only surface that serves all four sets of judges. Contents in §4. |
| **Must** | **Demo reset and replay** (operator-only, hidden behind a key on the console) | Science-fair judging means running the full loop 10 or more times in 90 minutes. Neither report has this; without it the second judge sees stale state. Reset means: cancel the plan, reverse all holds, clear state and reuse cached CREAO results. |
| **Should** | Branded link-preview (OG) image for the hold link (~0.5h) | Next's `opengraph-image.tsx` with `ImageResponse` at 1200x630 is verified ([Next docs](https://github.com/vercel/next.js/blob/canary/docs/01-app/03-api-reference/04-functions/image-response.mdx)). Showing "Your share $42.00" is fine because that number is already in the group poll; **never put a budget on it**. |
| **Should** | Notion plan page, **written by code after the filter** using `@notionhq/client` 5.27.1 | It gives the group a real reference (times, addresses, links). Writing it from code is fast and deterministic and guarantees it only contains options that passed the filter. A second CREAO run would add minutes. Cut it if it's not done by H14. |
| **Should, only with a dedicated line** | Printed table card with a QR code that opens an `sms:` link with a prefilled message | Lets science-fair judges feel the 🔒 budget moment on their own phones. It won't work on a shared line, which only accepts its assigned sender. The `&body=` syntax on iOS is undocumented by Apple ([Sendblue guide](https://docs.sendblue.com/guides/imessage-link-button/)) **[UNVERIFIED on iOS 26]**. |
| **Cut** | `/me` page, any user dashboard or settings page | Everything is a text away (§3). "No app, no account, no dashboard" is part of the pitch. |
| **Cut** | Face ID via WebAuthn | Each device would need a registration step first, plus server verification. That's 3–4 hours of risk for something the "Hold" tap already proves (a human approved). |
| **Cut** | Unified Checkout, Apple Pay, Click to Pay | Apple Pay needs domain verification, a developer account and a test device. Click to Pay needs Business Center enablement. |
| **Cut** | Native app, App Clip, iMessage extension or app cards, landing site, .ics files, DM polls, voice agent | Not worth it in 24 hours. |

---

## 2. First-time setup, step by step

**Rules this follows** (verified in Photon's [deliverability guide](https://photon.codes/docs/best-practices/imessage-deliverability)):
- The user should text first where possible.
- No links or media in the first message; Apple "suppresses link-clicking until a reply lands".
- Share the contact card "shortly after the first exchange".
- Aim for "at least three messages from the user in each conversation".
- Limits: 50 new conversations per line per day, 5,000 outbound messages per day. "3am messages signal automation."

### A. Starting a group (initiator)

1. Maya adds the agent's number to her existing group. This needs a dedicated line. Shared-line fallback: Maya DMs "plan … with Leo, Sam, Ava" and the agent works purely through DMs.
2. The agent speaks once, as notice to everyone:
   > "Hi all, I'm Tab. I plan things for this group when someone mentions me, and stay quiet otherwise."
3. Maya: "Tab plan dinner and a show Saturday for the 4 of us".
   - The agent tapbacks her message within a second, then shows typing.
   - It kicks off the CREAO research **immediately**; research doesn't need budgets.
4. Group message:
   > "On it. I'm DMing each of you 3 quick questions. What you tell me there stays private. Picks by 8pm."

### B. Invited member's first DM (Leo)

Every reply below goes through a **deterministic router in code before any LLM call**.

1. First DM is text only, has no link, and ends with a question:
   > "Hey, it's Tab from Sat crew. Maya asked me to plan Saturday. 30 seconds, 3 questions. First, what should I call you?"
   - The agent learns names by asking. Photon doesn't document sender display names **[UNVERIFIED]**.
2. Leo: "Leo". The agent sends its contact card, then:
   > "Nice to meet you, Leo. Save my card so I don't show up as unknown."
3. The budget question (state `awaiting_budget`, handled by code only):
   > "What's the most you'd spend all-in Saturday? Just a number. No one in the group and no AI ever sees it. Only a calculator checks prices against it."
   - Leo: "60". The agent reacts 🔒 (fallback: the ❗ tapback if arbitrary emoji don't render **[UNVERIFIED]**) and replies "Locked 🔒".
   - If the reply isn't a clear number: "Just the number works, like 50."
   - If it's a range: "I'll use $60 as your max."
4. Timing and preferences in **one** question (no DM poll):
   > "Saturday: reply 1 for 6:00, 2 for 7:00, 3 for either. Plus any cravings, food restrictions or hard no's."
5. > "Got it. Picks hit the group soon. Text me anytime to change anything."

That's 3 or more user messages, which clears Photon's trust threshold.

**Missing from both reports: strip numbers before the LLM.** Before any DM text reaches the LLM, code replaces currency-like numbers with `[amount]`. A user who writes "vegetarian, and honestly my budget's like 60" would otherwise leak the budget through the preference turn. This is what makes "no AI ever sees it" true, not just usually true.

### C. Card onboarding (first hold only, consent at the moment of need)

1. DM: "Your share: $42.00 (dinner $28 + show $14). Tap to hold it. It only becomes a charge if all 4 are in by Fri 6pm." followed by the link and its preview.
2. The page shows:
   - The plan header.
   - A big "$42.00".
   - A 3-step "Hold now → Charge only if everyone's in → Otherwise released, $0" explainer.
   - Microform fields.
   - An **unchecked** box: "Save this card for next time (stored as a Visa/Cybersource token, never on our servers)".
   - The "Hold $42.00" button.
3. Success: "Held, not charged" with a "Back to Messages" button. DM: "Held $42.00 on Visa •• 4242. Not charged yet ✅"

### D. Returning user

> "Sat crew is planning again (Friday). Still vegetarian, no stand-up? 'yes' or tell me what changed."

Then the budget question again ("last time $60, 'same' works"). The budget is never silently reused. The hold page shows "Visa •• 4242 · Change" and one button.

### E. People not on an iPhone

Pitch this in Q&A; don't build it.
- The hold page works in any browser.
- They vote by text with "1/2/3".
- Mixed groups downgrade to SMS/RCS group behaviour. Whether the agent's line works in a mixed group is **[UNVERIFIED]**.
- iOS 26 native polls need every member on iOS 26, so **always accept "1/2/3" text votes in the group too.**

### Group posts: at most 4 per plan

Intro → "3 picks that work for everyone. Vote by 8pm 👇" plus the native poll → "It's Bestia → Hamilton 🎉 Check your DMs to lock in. Nobody's charged unless all 4 are in" → "Booked ✅ …" with the confetti effect.

The live "Locked in: 3 of 4" status is edited in place. Whether a bot is bound by Apple's 5-edits-in-15-minutes rule is **[UNVERIFIED]**; fallback is one new message at "all in".

---

## 3. What users can do

**In chat.** Commands that touch money or budgets are matched by regex before any LLM call, and confirmed with yes/no.

| Everyone | Initiator |
|---|---|
| `status` (counts only, never names) | `cancel plan` (reverses all holds) |
| `budget 50` (allowed until you hold; after that: "You already held $42. Drop out instead?") | `close poll` |
| `I'm out` (confirm → every hold is reversed, the group is told "Saturday's off for now", nobody is named) | `replan` |
| `receipts` (DM list: date, plan, amount, card last 4, held/charged/released) | |
| `my card` / `remove card` | |
| `forget me` (confirm → wipe DB rows and delete the token) | |
| `help` / `stop` | |

**On the web:** only the hold page.
- Approve your share.
- Enter or change your card.
- Opt in to saving it.
- No history, settings or budget on the web, ever.

**Privacy rules users experience without being told:**
- Exclusion reasons are pooled: "Didn't make the cut for this group."
- Declines and dropouts are never named in the group.
- Every money event produces a DM: held, charged or released.
- Copy never promises when a pending line disappears, because the issuer controls that.

**Security gap in the tech report: a forwarded link could spend a saved card.** The tech report's "the phone number is the identity" doesn't hold for saved cards: a forwarded `/h/` link would let anyone tap "Hold" on the owner's saved card. Mitigations:
- Single-use links with a short expiry, consumed only on POST (preview fetchers do GETs).
- The exact amount is re-checked on the server.
- After the hold, a DM "Held $42 on ••4242. Not you? Reply undo".
- Alternative worth a 5-minute team decision: for **saved-card** users, approve by replying `hold` in DM, which is authenticated by their iMessage identity. This is faster on stage; the hosted page stays for first-time card entry.
- Also: **mint the capture context when the page loads, not when the link is issued.** The context is valid for 15 minutes ([Cybersource](https://developer.cybersource.com/docs/cybs/en-us/digital-accept-flex/developer/all/rest/digital-accept-flex/microform-integ-v2/micro-getting-started-pay-card/micro-getting-started-pay-card-ss-setup/creating-server-side-context-v2-card.html)), and tying the link to it (as the tech report proposes) would expire links needlessly.

---

## 4. Dashboard decision: a judge Trust Console, and no user dashboard

**Users don't get a dashboard.** A friend group won't open one; chat covers status, receipts, editing the budget, removing the card and deleting data.

**Judges get a console.** It is read-only and laid out 16:9 with type readable from 5 meters.

| Zone | Exact contents |
|---|---|
| **Header** | Plan title, a 5-step stepper (Gather → Research → Vote → Hold → Book), and the hold-deadline countdown |
| **People** (left) | One lane per first name (no phone numbers): Invited → Answered 🔒 (value never shown) → Voted → **Held $42.00** → **Captured** or **Released**, with a shortened Cybersource ID in monospace |
| **Budget firewall** (center) | "Budget replies intercepted by code before the AI: 4/4". A live excerpt of the **actual LLM prompt** showing `Leo: [budget: received, redacted by code]`. "CREAO found 12 options → plain-code filter kept 3 · per-person reasons: not stored". |
| **Money and agent purchase** (right) | "$168.00 held · $0.00 charged", which flips to "Captured $168.00". The signed request: method, path, `Signature-Input` (keyid, created, nonce) and a shortened `Signature`. The merchant result "✓ Signature verified (RFC 9421)". |
| **Footer** | The last 6 events, a CREAO run chip (status plus run share link plus agent ID, as CREAO's rules require), and a hidden operator bar with Reset and Replay last run |

**Change to the UX design's live leak counter.** It proposed a "budget values in LLM traffic: 0" counter based on string-matching. Live, that will false-positive: a "$60 tasting menu" in research output matches a $60 budget, and a non-zero number on stage would be a disaster. Show the intercept count and the real redacted prompt instead, which is evidence rather than a claim. Keep the string-match scan as an automated test.

The console is built from an event log that **has no budget column**, so it proves privacy by construction.

**Use in the 3-minute demo.** Mirror the hero phone on the left and the console on the right. Mirroring method **[UNVERIFIED]**: QuickTime over USB or iPhone Mirroring; rehearse on the real projector.

| Time | What happens |
|---|---|
| 0:00–0:20 | Maya mentions Tab. Tapback, then the group message. Console lanes appear as "Invited". |
| 0:20–0:55 | The hero answers the DMs; "60" gets 🔒. The firewall shows the redacted prompt. Teammates answer on the other 3 phones and their lanes go to Answered 🔒. |
| 0:55–1:20 | CREAO chip shows done (**say honestly that the research was pre-warmed**, since runs take minutes) → "12 → 3" → poll in the group → votes. |
| 1:20–2:05 | Hero taps the hold link → preview card → hold page → "Held, not charged". All lanes go Held. Group: "Locked in: 4 of 4". |
| 2:05–2:35 | The TAP request appears, the merchant verifies it, all 4 lanes flip to **Captured at the same moment**, and confetti fires in the group. |
| 2:35–3:00 | Close: "No person or AI ever saw a budget. Remove the agent and this dies." |
| Q&A | "Want to see someone drop out?" → Replay → every hold Released, nobody named. |

**Round 1 (science fair):** the same loop in 4 minutes, with Reset between judges.

---

## 5. UI tech (versions checked on the npm registry 2026-10-17, with publish dates)

| Package | Version | Published | Use |
|---|---|---|---|
| next | 16.4.2 | 2026-10-15 | Hold page (server-rendered), console, `opengraph-image.tsx`. It's 2 days old: if it misbehaves, roll back one patch. |
| react | 19.3.1 | 2026-10-14 | |
| tailwindcss | 4.3.3 | 2026-07-16 | One theme file shared by both pages |
| shadcn (CLI) | 4.22.0 | 2026-10-16 | Only Button, Card, Badge and Sonner |
| motion | 14.3.0 | 2026-10-15 | Optional, **console only**. CSS transitions are enough. |
| spectrum-ts | 12.11.0 | 2026-10-15 | Photon SDK (backend, not UI) |
| @notionhq/client | 5.27.1 | — | Plan page written from code |
| @supabase/supabase-js, jose | — | — | **Not needed.** Use opaque random tokens and store only the sha256 hash, as the tech report rightly says. |

**Payments UI: Microform v2.**
- Endpoint verified: `POST https://apitest.cybersource.com/microform/v2/sessions`; `targetOrigins` and `allowedCardNetworks` are required, and the origin should be "hard coded on the server side". Lifetime verified: 15 minutes ([Cybersource](https://developer.cybersource.com/docs/cybs/en-us/digital-accept-flex/developer/all/rest/digital-accept-flex/microform-integ-v2/micro-getting-started-pay-card/micro-getting-started-pay-card-ss-setup/creating-server-side-context-v2-card.html)).
- Deploy to the **final production domain in hour 1**. Preview URLs won't match `targetOrigins`.
- I did not re-verify the "no wildcards / localhost exception" rule or the style-property limits; they come from the tech report's sources.

**Hosting.** Next.js on Vercel for the web; the persistent Node backend (spectrum-ts over gRPC) on Fly or Railway.

**Real-time mechanism: SSE from the persistent backend.**
- How it works:
  - An append-only `events` table with a monotonic id and no budget column.
  - `GET /events/stream?key=…` sends `id:` lines so the browser's EventSource reconnects with `Last-Event-ID` and replays anything missed.
  - Fallback: poll `GET /events?after=id` every 1s.
  - The console connects cross-origin (CORS on that one route) and is protected by an unguessable `CONSOLE_KEY`.
- Why not the alternatives:
  - Vercel SSE is capped by function max duration: Hobby 300s, Pro 800s, 1800s in beta ([Vercel limits](https://vercel.com/docs/functions/limitations)).
  - Supabase `postgres_changes` would need an anon-readable table, and Supabase itself says "We recommend using Broadcast for most use cases" ([Supabase](https://supabase.com/docs/guides/realtime/subscribing-to-database-changes)). Use Supabase Realtime only if the backend already runs on Supabase.

**Visa TAP.** The repo ships a TAP agent (Streamlit), a React merchant frontend, a FastAPI backend with signature verification, a Node CDN proxy "implementing RFC 9421 signature verification", and an agent registry ([visa/trusted-agent-protocol](https://github.com/visa/trusted-agent-protocol)).
- **Reskin its merchant frontend as the demo venue.** Don't build a venue UI.
- The `Signature-Input`/`Signature` header names come from RFC 9421 ([rfc9421](https://www.rfc-editor.org/rfc/rfc9421)). I didn't confirm them in the repo itself.

---

## 6. Ownership and hours (about 11 person-hours of UI in total)

**Split the UI by where the code already lives, and name one experience owner.** Don't hand it all to one person.

| Owner | UI work | Hours |
|---|---|---|
| **Payments engineer** | `/h/[token]`: Microform, saved-card state, the 7 states (loading, card-form failed, declined, expired, already held, cancelled, success) and the OG image. The client is tightly coupled to the capture context and authorization calls, so splitting it puts a hand-off at the riskiest point. | ~4.5 |
| **CREAO/venue engineer** | `/console`, the SSE client, Reset/Replay, the theme file (set up in H1), the table card and the reskinned TAP merchant. This person has idle time while CREAO runs take minutes. | ~6 |
| **Photon/conversation engineer = experience owner** | Every message as a **fixed template** (money and privacy messages are never generated by the LLM), the demo script, and final say on copy | ~2, inside their own work |

Optional: the team limit is 4. A fourth admitted hacker would get the most value as "experience and demo owner".

**Milestones** (H0 = Sat 12:00 PM):

| Hour | Time | Milestone |
|---|---|---|
| H0–H1 | Sat noon–1 PM | Dedicated line secured; Next app deployed to the production domain |
| H6 | Sat 6 PM | Unstyled hold page places a sandbox authorization end to end |
| H10 | Sat 10 PM | Console showing live events |
| H16 | Sun 4 AM | Happy path and dropout path working on 4 phones; **feature freeze** |
| H16–H22 | Sun 4–10 AM | Polish, at least 5 full rehearsals, backup video recorded |
| H23 | Sun 11 AM | Devpost submitted; README has the CREAO run link and agent ID |

---

## 7. Polish checklist (the 10 things that make it feel world-class)

1. A tapback within 1s and typing indicators. The agent never goes silent.
2. Money and privacy messages are fixed templates: under 2 lines, "$42.00" written in full, "hold" until capture.
3. The agent's contact card has a photo and is pre-saved on every demo phone, so no Junk banner.
4. A branded link preview for the hold link. No budget anywhere, ever.
5. The hold page is server-rendered with the header visible immediately; Microform styled to match; tabular figures for amounts; 44px tap targets; 16px+ inputs; a single clear button.
6. Every failure state is designed and rehearsed: declined, expired, dropout.
7. One status message edited in place, and confetti only on "Booked".
8. On the console, all lanes flip to Captured or Released together; type readable at 5m; tested on the real projector.
9. The console shows the actual redacted prompt (evidence, not a claim).
10. Reset/Replay plus cached CREAO results, so every judge sees a full, fresh loop.

**Cut list:** `/me`, `/join` as a separate page, WebAuthn, Unified Checkout / Apple Pay / Click to Pay, DM polls, .ics, Supabase (unless already in use), jose, Motion on the payment page, the live leak counter based on string-matching, any user dashboard, a landing site, an app / App Clip / extension, voice, a custom statement descriptor.

---

## 8. Unverified items and open questions

- Whether a dedicated Photon line is available at the event and what it costs. The docs tie dedicated lines to the Business plan; whether the free beta covers one is unconfirmed.
- Whether the "Applied Intelligence" track name and any extra criteria apply. live.lahacks.com/tracks returned no content and Devpost returned 403. The general criteria in `lahacks.md` are verified: Technical Depth, Product Thinking & Impact, Originality & Insight, Execution & Polish.
- What Devpost requires in a submission (for example a video).
- Whether outbound polls work in groups, and whether every vote comes through as an event. The docs say "`poll(title, …)` still requires a nonempty title" ([native-polls](https://photon.codes/docs/spectrum-ts/providers/imessage/messaging-features/native-polls)) but say nothing about DM vs group.
- Whether arbitrary emoji reactions work, how edit limits apply to a bot, sender display names, and whether user tapbacks reach the agent.
- Whether a dedicated line can DM a group member first who has never texted it.
- Link previews from non-contacts, the `sms:` `&body=` syntax on iOS 26, and the phone mirroring method.
- The Cybersource saved-card delete endpoint. I could only find the v1 instrument-identifier delete; one community thread reports that deleting a customer's default payment instrument is refused ([thread](https://community.developer.cybersource.com/t5/cybersource-APIs/About-Deleting-Default-Customer-s-Payment-Method-in-TMS/td-p/84598)). Don't claim "remove card" works until it's tested.
- Whether `TOKEN_CREATE` on payment authorizations returns a token (the tech report's community report); the Microform style list; the CSP hostnames.
- Whether CREAO's API exposes run status for the console chip. `creao.md` says "async runs with webhooks or polling", but I couldn't find primary API docs.
- Whether `advanced-imessage` qualifies as "Photon 2.0". Avoid it and use spectrum-ts.
- Team decision needed: should saved-card approval be a DM reply (`hold`) or the one-button page? The reply is more secure and faster; the page is more visible to Visa judges.